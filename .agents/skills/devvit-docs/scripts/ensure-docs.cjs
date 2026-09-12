#!/usr/bin/env node

/**
 * Ensures reddit/devvit-docs is cloned locally and reasonably fresh.
 * Cross-platform (Windows, Linux, macOS) — Node.js built-ins + git only.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

const REPO_URL = "https://github.com/reddit/devvit-docs.git";
const DEFAULT_TTL_HOURS = 24;
const PUBLIC_API_PATH = ["api", "public-api"];
const SPARSE_DOC_PATTERNS = [
  "/docs/**/*.md",
  "/docs/**/*.mdx",
  "/versioned_docs/**/*.md",
  "/versioned_docs/**/*.mdx",
  "/versions.json",
];
const DOC_FILE_PATTERN = /\.(?:md|mdx)$/i;

function readOptions(argv) {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      force: { type: "boolean", default: false },
      ttl: { type: "string", default: String(DEFAULT_TTL_HOURS) },
      "project-dir": { type: "string", default: process.cwd() },
      "cache-dir": { type: "string" },
    },
    strict: true,
  });

  const ttlHours = Number(values.ttl);
  if (!Number.isFinite(ttlHours) || ttlHours < 0) {
    throw new Error("--ttl must be a non-negative number of hours.");
  }

  return {
    force: values.force,
    ttlHours,
    projectDir: path.resolve(values["project-dir"]),
    cacheDir: values["cache-dir"] ? path.resolve(values["cache-dir"]) : null,
  };
}

function createLayout(options) {
  const cacheDir =
    options.cacheDir ||
    path.join(options.projectDir, "node_modules", ".cache", "devvit-skills");
  const repoDir = path.join(cacheDir, "devvit-docs");
  const docsDir = path.join(repoDir, "docs");

  return {
    cacheDir,
    repoDir,
    markerPath: path.join(cacheDir, ".devvit-docs-fetched"),
    packagePath: path.join(options.projectDir, "package.json"),
    docsDir,
    versionedDocsDir: path.join(repoDir, "versioned_docs"),
    redditApiDir: path.join(docsDir, "api", "redditapi"),
    publicApiDir: path.join(docsDir, ...PUBLIC_API_PATH),
  };
}

function log(message) {
  process.stderr.write(`[devvit-docs] ${message}\n`);
}

function formatError(error) {
  const stderr = error?.stderr ? String(error.stderr).trim() : "";
  return stderr || error?.message || String(error);
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function tryGit(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function canonicalPath(value) {
  const normalizeCase = (resolved) =>
    process.platform === "win32" ? resolved.toLowerCase() : resolved;

  try {
    return normalizeCase(fs.realpathSync(value));
  } catch {
    return normalizeCase(path.resolve(value));
  }
}

function isGitRepo(dir) {
  const topLevel = tryGit("-C", dir, "rev-parse", "--show-toplevel");
  return topLevel !== null && canonicalPath(topLevel) === canonicalPath(dir);
}

function configureSparseDocs(repoDir) {
  git("-C", repoDir, "sparse-checkout", "init", "--no-cone");
  git(
    "-C",
    repoDir,
    "sparse-checkout",
    "set",
    "--no-cone",
    ...SPARSE_DOC_PATTERNS,
  );
}

function cloneRepo(targetDir) {
  git(
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--no-checkout",
    REPO_URL,
    targetDir,
  );
  configureSparseDocs(targetDir);
  git("-C", targetDir, "checkout");
}

function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    log(`Cleanup failed for ${target}: ${formatError(error)}`);
  }
}

function restoreBackup(repoDir, backupDir) {
  if (fs.existsSync(repoDir) || !fs.existsSync(backupDir)) return;

  try {
    fs.renameSync(backupDir, repoDir);
  } catch (error) {
    log(`Could not restore the previous cache: ${formatError(error)}`);
  }
}

function replaceWithFreshClone(layout) {
  const suffix = `${process.pid}-${Date.now()}`;
  const tempDir = path.join(layout.cacheDir, `devvit-docs.tmp-${suffix}`);
  const backupDir = path.join(layout.cacheDir, `devvit-docs.old-${suffix}`);
  const hadExistingCache = fs.existsSync(layout.repoDir);

  try {
    cloneRepo(tempDir);
  } catch (error) {
    removeQuietly(tempDir);
    throw error;
  }

  try {
    if (hadExistingCache) fs.renameSync(layout.repoDir, backupDir);
    fs.renameSync(tempDir, layout.repoDir);
  } catch (error) {
    restoreBackup(layout.repoDir, backupDir);
    removeQuietly(tempDir);
    throw error;
  }

  if (hadExistingCache) removeQuietly(backupDir);
}

function refreshRepo(layout) {
  try {
    git("-C", layout.repoDir, "pull", "--ff-only");
    return "cached";
  } catch {
    log("Pull failed - trying a fresh clone.");
  }

  try {
    replaceWithFreshClone(layout);
    return "cloned";
  } catch {
    log("Fresh clone failed - using existing cache.");
    return null;
  }
}

function isStale(markerPath, ttlHours) {
  try {
    const timestamp = Number(fs.readFileSync(markerPath, "utf8").trim());
    return !timestamp || Date.now() - timestamp > ttlHours * 3_600_000;
  } catch {
    return true;
  }
}

function markFresh(markerPath) {
  fs.writeFileSync(markerPath, String(Date.now()), "utf8");
}

function ensureRepo(layout, options) {
  const cacheExists = fs.existsSync(layout.repoDir);

  if (!cacheExists || !isGitRepo(layout.repoDir)) {
    log(cacheExists ? "Cache invalid - cloning docs..." : "Cloning docs...");
    replaceWithFreshClone(layout);
    markFresh(layout.markerPath);
    return "cloned";
  }

  // Reapply the canonical patterns so existing caches pick up additions.
  configureSparseDocs(layout.repoDir);

  if (!options.force && !isStale(layout.markerPath, options.ttlHours)) {
    log("Cache fresh — skipping fetch.");
    return "cached";
  }

  log(
    options.force ? "Force-pulling docs..." : "Cache stale — pulling docs...",
  );
  const cacheStatus = refreshRepo(layout);
  if (cacheStatus) markFresh(layout.markerPath);
  return cacheStatus || "cached";
}

function uniqueExistingDirs(dirs) {
  const seen = new Set();
  return dirs.filter((dir) => {
    if (!dir || !fs.existsSync(dir)) return false;

    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return false;

    seen.add(resolved);
    return true;
  });
}

function isSameOrWithin(child, parent) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function validateDocsCheckout(repoDir) {
  const trackedDocs = git(
    "-C",
    repoDir,
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "--",
    "docs",
    "versioned_docs",
  )
    .split(/\r?\n/)
    .filter((trackedPath) => DOC_FILE_PATTERN.test(trackedPath));

  if (trackedDocs.length === 0) {
    throw new Error("The docs repository contains no Markdown files.");
  }

  const missingDocs = trackedDocs.filter(
    (trackedPath) => !fs.existsSync(path.join(repoDir, trackedPath)),
  );
  if (missingDocs.length > 0) {
    throw new Error(
      `Sparse checkout is missing ${missingDocs.length} tracked documentation file(s), including ${missingDocs
        .slice(0, 3)
        .join(", ")}.`,
    );
  }
}

function detectVersion(packagePath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const dependencies = { ...pkg.devDependencies, ...pkg.dependencies };
    const declaredVersion =
      dependencies.devvit ||
      dependencies["@devvit/web"] ||
      dependencies["@devvit/start"] ||
      "";
    const match = String(declaredVersion).match(/(\d+)\.(\d+)/);
    return match ? `${match[1]}.${match[2]}` : null;
  } catch {
    return null;
  }
}

function selectDocsRoot(layout, version) {
  const versionedRoot = version
    ? path.join(layout.versionedDocsDir, `version-${version}`)
    : null;
  const matchedVersion = Boolean(versionedRoot && fs.existsSync(versionedRoot));

  return {
    docsRoot: matchedVersion ? versionedRoot : layout.docsDir,
    matchedVersion,
  };
}

function getVersionedPublicApiRoots(layout) {
  try {
    return fs
      .readdirSync(layout.versionedDocsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(layout.versionedDocsDir, entry.name, ...PUBLIC_API_PATH),
      );
  } catch {
    return [];
  }
}

function resolveSearchPaths(layout, docsRoot) {
  const searchRoots = uniqueExistingDirs([
    docsRoot,
    isSameOrWithin(layout.redditApiDir, docsRoot) ? null : layout.redditApiDir,
  ]);
  const excludeRoots = uniqueExistingDirs([
    layout.publicApiDir,
    path.join(docsRoot, ...PUBLIC_API_PATH),
    ...getVersionedPublicApiRoots(layout),
  ]);

  return { searchRoots, excludeRoots };
}

function main() {
  const options = readOptions(process.argv);
  const layout = createLayout(options);

  fs.mkdirSync(layout.cacheDir, { recursive: true });

  const cacheStatus = ensureRepo(layout, options);
  validateDocsCheckout(layout.repoDir);

  const appDevvitVersion = detectVersion(layout.packagePath);
  const docsSelection = selectDocsRoot(layout, appDevvitVersion);
  const searchPaths = resolveSearchPaths(layout, docsSelection.docsRoot);

  process.stdout.write(
    `${JSON.stringify(
      {
        cacheStatus,
        docsRoot: docsSelection.docsRoot,
        repoDir: layout.repoDir,
        searchRoots: searchPaths.searchRoots,
        excludeRoots: searchPaths.excludeRoots,
        matchedVersion: docsSelection.matchedVersion,
        appDevvitVersion,
        docsRepoCommit: tryGit("-C", layout.repoDir, "rev-parse", "HEAD"),
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`[devvit-docs] Error: ${formatError(error)}\n`);
  process.exitCode = 1;
}
