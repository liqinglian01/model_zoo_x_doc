const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const matrixPath = path.join(repoRoot, "src/context/doc-scope-matrix.json");
const scopedBuildScript = path.join(__dirname, "build-scoped-site.js");
const tempBuildRoot = path.join(repoRoot, ".docusaurus", "pagefind-dev-build");
const staticRoot = path.join(repoRoot, "static");

function toProductFolder(product) {
  return String(product)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "_");
}

function runNodeScript(scriptPath, envPatch) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...envPatch,
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runPagefind(sourceDir) {
  const pagefindRunner = path.join(
    repoRoot,
    "node_modules",
    "pagefind",
    "lib",
    "runner",
    "bin.cjs",
  );
  const pagefindArgs = [
    pagefindRunner,
    "--site",
    sourceDir,
    "--output-path",
    path.join(sourceDir, "pagefind"),
  ];
  const result = spawnSync(
    process.execPath,
    pagefindArgs,
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.error) {
    console.error(`[prepare-pagefind-dev] pagefind spawn error: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function getBuildMatrix() {
  const matrixRaw = fs.readFileSync(matrixPath, "utf8");
  const matrix = JSON.parse(matrixRaw);
  const productVersionMatrix = matrix.PRODUCT_VERSION_MATRIX || {};
  const combos = [];
  for (const [product, versions] of Object.entries(productVersionMatrix)) {
    for (const version of versions || []) {
      combos.push({ product, version });
    }
  }
  return combos;
}

function getDefaultDevCombos(fullCombos) {
  // core 模式自动取“每个产品的第一个版本”，避免固定白名单需要手工维护
  // 顺序由 PRODUCT_VERSION_MATRIX 中的声明顺序决定
  const firstComboByProduct = new Map();
  for (const combo of fullCombos) {
    if (!firstComboByProduct.has(combo.product)) {
      firstComboByProduct.set(combo.product, combo);
    }
  }
  return Array.from(firstComboByProduct.values());
}

function getScopedDocsDir(product, version) {
  return path.join(
    repoRoot,
    ".docusaurus",
    "scoped-docs",
    toProductFolder(product),
    version,
    "docs",
  );
}

function hashDirectory(dir) {
  const hash = crypto.createHash("sha1");

  function walk(currentDir) {
    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const rel = path.relative(dir, fullPath).replace(/\\/g, "/");
      hash.update(rel);
      hash.update("\0");
      hash.update(fs.readFileSync(fullPath));
      hash.update("\0");
    }
  }

  if (fs.existsSync(dir)) {
    walk(dir);
  }
  return hash.digest("hex");
}

function buildReuseKey(product, version, contentHash) {
  // DocScope blocks are resolved during build and can differ by product/version.
  // Include scope in reuse key to avoid cross-scope index reuse mistakes.
  return `${toProductFolder(product)}::${version}::${contentHash}`;
}

function copyPagefindToStatic(sourceBuildDir, targetPagefindDir) {
  const sourcePagefindDir = path.join(sourceBuildDir, "pagefind");
  if (!fs.existsSync(sourcePagefindDir)) {
    console.error(`[prepare-pagefind-dev] missing pagefind dir: ${sourcePagefindDir}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(targetPagefindDir), { recursive: true });
  fs.rmSync(targetPagefindDir, { recursive: true, force: true });
  fs.cpSync(sourcePagefindDir, targetPagefindDir, { recursive: true });
}

function main() {
  const fullCombos = getBuildMatrix();
  if (fullCombos.length === 0) {
    console.error("[prepare-pagefind-dev] no product/version combos found.");
    process.exit(1);
  }
  const mode = (process.env.DOC_PAGEFIND_DEV_MODE || "core").toLowerCase();
  const combos = mode === "full" ? fullCombos : getDefaultDevCombos(fullCombos);

  const skipExisting = process.env.DOC_PAGEFIND_DEV_SKIP_EXISTING === "1";
  console.log(
    `[prepare-pagefind-dev] mode=${mode}, total combinations: ${combos.length}, skipExisting=${skipExisting}`,
  );
  const reusedByHash = new Map();

  for (const combo of combos) {
    const productFolder = toProductFolder(combo.product);
    const targetPagefindDir = path.join(staticRoot, productFolder, combo.version, "pagefind");

    if (skipExisting && fs.existsSync(path.join(targetPagefindDir, "pagefind-ui.js"))) {
      console.log(
        `[prepare-pagefind-dev] skip existing: ${combo.product} ${combo.version}`,
      );
      continue;
    }

    const tempOutDir = path.join(tempBuildRoot, productFolder, combo.version);
    fs.rmSync(tempOutDir, { recursive: true, force: true });
    fs.mkdirSync(tempOutDir, { recursive: true });
    // 先过滤文档并计算指纹，重复内容直接复用已有索引目录
    runNodeScript(scopedBuildScript, {
      DOC_BUILD_PRODUCT: combo.product,
      DOC_BUILD_VERSION: combo.version,
      DOC_BUILD_OUT_DIR: tempOutDir,
      DOC_BUILD_FILTER_ONLY: "1",
    });
    const scopedDocsDir = getScopedDocsDir(combo.product, combo.version);
    const contentHash = hashDirectory(scopedDocsDir);
    const reuseKey = buildReuseKey(combo.product, combo.version, contentHash);
    const reusedFrom = reusedByHash.get(reuseKey);
    if (reusedFrom) {
      fs.mkdirSync(path.dirname(targetPagefindDir), { recursive: true });
      fs.rmSync(targetPagefindDir, { recursive: true, force: true });
      fs.cpSync(reusedFrom.targetPagefindDir, targetPagefindDir, { recursive: true });
      console.log(
        `[prepare-pagefind-dev] reused ${combo.product} ${combo.version} from ${reusedFrom.combo.product} ${reusedFrom.combo.version}`,
      );
      continue;
    }

    console.log(`\n[prepare-pagefind-dev] building ${combo.product} ${combo.version}`);

    runNodeScript(scopedBuildScript, {
      DOC_BUILD_PRODUCT: combo.product,
      DOC_BUILD_VERSION: combo.version,
      DOC_BUILD_OUT_DIR: tempOutDir,
      DOC_BUILD_FILTER_ONLY: "",
    });

    console.log(`[prepare-pagefind-dev] indexing ${tempOutDir}`);
    runPagefind(tempOutDir);

    copyPagefindToStatic(tempOutDir, targetPagefindDir);
    console.log(
      `[prepare-pagefind-dev] ready at static/${productFolder}/${combo.version}/pagefind`,
    );
    reusedByHash.set(reuseKey, { targetPagefindDir, combo });
  }

  console.log("\n[prepare-pagefind-dev] completed.");
}

main();
