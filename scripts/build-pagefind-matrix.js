const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const matrixPath = path.join(repoRoot, "src/context/doc-scope-matrix.json");
const scopedBuildScript = path.join(__dirname, "build-scoped-site.js");
const buildRoot = path.join(repoRoot, "build");
const tempProbeRoot = path.join(repoRoot, ".docusaurus", "pagefind-matrix-probe");

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
  const cnPlugin = path.join(repoRoot, "src", "plugins", "pagefind-cn-plugin", "index.js");
  console.log(`[pagefind:matrix] injecting Chinese tokens into ${sourceDir}...`);
  const cnResult = spawnSync(process.execPath, [cnPlugin, sourceDir], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (cnResult.status !== 0) {
    console.error("[pagefind:matrix] Chinese token injection failed");
    process.exit(cnResult.status ?? 1);
  }

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
    console.error(`[pagefind:matrix] pagefind spawn error: ${result.error.message}`);
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

function copyDir(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function main() {
  const combos = getBuildMatrix();
  if (combos.length === 0) {
    console.error("[pagefind:matrix] no product/version combos found.");
    process.exit(1);
  }

  console.log(`[pagefind:matrix] total combinations: ${combos.length}`);
  const reusedByHash = new Map();

  for (const combo of combos) {
    const productFolder = toProductFolder(combo.product);
    const outDir = path.join(buildRoot, productFolder, combo.version);
    const probeOutDir = path.join(tempProbeRoot, productFolder, combo.version);
    fs.mkdirSync(probeOutDir, { recursive: true });

    // 先只做文档过滤，计算“内容指纹”
    runNodeScript(scopedBuildScript, {
      DOC_BUILD_PRODUCT: combo.product,
      DOC_BUILD_VERSION: combo.version,
      DOC_BUILD_OUT_DIR: probeOutDir,
      DOC_BUILD_FILTER_ONLY: "1",
    });
    const scopedDocsDir = getScopedDocsDir(combo.product, combo.version);
    const contentHash = hashDirectory(scopedDocsDir);
    const reuseKey = buildReuseKey(combo.product, combo.version, contentHash);
    const reusedFrom = reusedByHash.get(reuseKey);

    if (reusedFrom) {
      console.log(
        `\n[pagefind:matrix] reusing ${combo.product} ${combo.version} from ${reusedFrom.combo.product} ${reusedFrom.combo.version}`,
      );
      copyDir(reusedFrom.outDir, outDir);
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n[pagefind:matrix] building ${combo.product} ${combo.version}`);

    runNodeScript(scopedBuildScript, {
      DOC_BUILD_PRODUCT: combo.product,
      DOC_BUILD_VERSION: combo.version,
      DOC_BUILD_OUT_DIR: outDir,
    });

    console.log(`[pagefind:matrix] indexing ${outDir}`);
    runPagefind(outDir);
    reusedByHash.set(reuseKey, { outDir, combo });
  }

  console.log("\n[pagefind:matrix] completed.");
}

main();
