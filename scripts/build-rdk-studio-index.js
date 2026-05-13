const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ORIGIN = "https://developer.d-robotics.cc";
const ROOT = `${ORIGIN}/rdk_studio_doc/`;
const SEED = `${ORIGIN}/rdk_studio_doc/category/1-product-intro`;
const MAX_PAGES = 400;

const REPO_ROOT = path.join(__dirname, "..");
const STATIC_ROOT = path.join(REPO_ROOT, "static");
const OUT_JSON = path.join(STATIC_ROOT, "rdk_studio_search_index.json");
const MIRROR_ROOT = path.join(STATIC_ROOT, "rdk_studio_doc");
const PAGEFIND_OUT = path.join(STATIC_ROOT, "rdk_studio_pagefind");
const TEMP_SITE = path.join(REPO_ROOT, ".docusaurus", "rdk-studio-pagefind-site");
const OPTIONAL_ON_FAILURE =
  process.env.DOC_RDK_STUDIO_INDEX_OPTIONAL === "1" ||
  process.env.CI === "true";

const SKIP_EXT_RE = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|mp4|mp3|woff2?|ttf|eot|css|js|xml)$/i;

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(source) {
  return String(source || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUrl(url) {
  try {
    const u = new URL(url, ROOT);
    if (!u.href.startsWith(ROOT)) return null;
    if (SKIP_EXT_RE.test(u.pathname)) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function extractLinks(html) {
  const links = new Set();
  const re = /href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const n = normalizeUrl(m[1]);
    if (!n) continue;
    links.add(n);
  }
  return [...links];
}

function extractTitle(html, fallbackUrl) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1]) {
    const t = stripHtml(m[1]);
    if (t) return t;
  }
  return fallbackUrl.replace(ROOT, "/rdk_studio_doc/");
}

function toMirrorPath(urlPath) {
  const clean = String(urlPath || "/rdk_studio_doc/")
    .replace(/^\//, "")
    .replace(/^rdk_studio_doc\/?/, "")
    .replace(/\/$/, "");
  const rel = clean || "index";
  return path.join(rel, "index.html");
}

function writeMirrorHtml(rootDir, doc) {
  const fileRel = toMirrorPath(doc.url);
  const filePath = path.join(rootDir, fileRel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const contentBlocks = doc.content
    .split(/[。！？!?]\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 300)
    .map((x) => `<p>${escapeHtml(x)}</p>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(doc.title)}</title>
  </head>
  <body>
    <article>
      <h1>${escapeHtml(doc.title)}</h1>
      <p><a href="${ORIGIN}${doc.url}" rel="noreferrer">查看原文</a></p>
      ${contentBlocks}
    </article>
  </body>
</html>
`;
  fs.writeFileSync(filePath, html, "utf8");
}

function runPagefind(sourceDir, outputDir) {
  const pagefindRunner = path.join(
    REPO_ROOT,
    "node_modules",
    "pagefind",
    "lib",
    "runner",
    "bin.cjs",
  );
  const result = spawnSync(
    process.execPath,
    [pagefindRunner, "--site", sourceDir, "--output-path", outputDir],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; rdk-doc-indexer/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText}`);
  }
  const ct = String(resp.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("text/html")) {
    throw new Error(`non-html content-type: ${ct || "unknown"}`);
  }
  return resp.text();
}

async function main() {
  const queue = [SEED];
  const visited = new Set();
  const docs = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    process.stdout.write(`\r[rdk-studio-index] crawling ${visited.size}/${MAX_PAGES}`);
    let html;
    try {
      html = await fetchHtml(url);
    } catch {
      continue;
    }

    const title = extractTitle(html, url);
    const content = stripHtml(html).slice(0, 40000);
    docs.push({
      url: url.replace(ORIGIN, ""),
      title,
      content,
    });

    for (const link of extractLinks(html)) {
      if (!visited.has(link) && !queue.includes(link)) {
        queue.push(link);
      }
    }
  }
  process.stdout.write("\n");

  if (docs.length === 0) {
    const msg =
      "no pages indexed from RDK Studio. Check remote accessibility or update seed URL.";
    if (!OPTIONAL_ON_FAILURE) {
      throw new Error(msg);
    }
    console.warn(`[rdk-studio-index] warning: ${msg}`);
    console.warn(
      "[rdk-studio-index] optional mode enabled, skip external index generation and continue build.",
    );
    return;
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(docs, null, 2), "utf8");
  console.log(`[rdk-studio-index] wrote ${docs.length} docs -> ${OUT_JSON}`);

  fs.rmSync(MIRROR_ROOT, { recursive: true, force: true });
  fs.rmSync(TEMP_SITE, { recursive: true, force: true });
  fs.rmSync(PAGEFIND_OUT, { recursive: true, force: true });
  fs.mkdirSync(MIRROR_ROOT, { recursive: true });
  fs.mkdirSync(TEMP_SITE, { recursive: true });

  for (const doc of docs) {
    writeMirrorHtml(MIRROR_ROOT, doc);
    writeMirrorHtml(TEMP_SITE, doc);
  }
  console.log(`[rdk-studio-index] wrote local mirror pages -> ${MIRROR_ROOT}`);

  const tempPagefindOut = path.join(TEMP_SITE, "pagefind");
  runPagefind(TEMP_SITE, tempPagefindOut);
  fs.cpSync(tempPagefindOut, PAGEFIND_OUT, { recursive: true });
  console.log(`[rdk-studio-index] wrote pagefind index -> ${PAGEFIND_OUT}`);
}

main().catch((e) => {
  console.error(`[rdk-studio-index] failed: ${e.message}`);
  process.exit(1);
});
