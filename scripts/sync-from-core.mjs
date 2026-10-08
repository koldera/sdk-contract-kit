#!/usr/bin/env node
// Copies the public HTTP contract from a koldera-core checkout into this kit, records the core commit in CORE_VERSION
// and validates the golden fixtures against the new copy.
// Usage: node scripts/sync-from-core.mjs <path-to-koldera-core-checkout>
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_FILES = ["openapi.yaml", "document.schema.json", "problem.schema.json"];
export const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export const isOnMain = (cwd, sha) => {
  try {
    git(cwd, "merge-base", "--is-ancestor", sha, "origin/main");
    return true;
  } catch {
    return false;
  }
};

export function syncFromCore(coreDir, kitDir = kitRoot) {
  if (git(coreDir, "status", "--porcelain") !== "") {
    throw new Error(`${coreDir} has uncommitted changes; sync from a clean checkout`);
  }
  const sha = git(coreDir, "rev-parse", "HEAD");
  if (!isOnMain(coreDir, sha)) {
    throw new Error(`koldera-core HEAD ${sha} is not on origin/main; fetch and check out a commit of origin/main`);
  }
  for (const file of CONTRACT_FILES) copyFileSync(path.join(coreDir, "contracts", file), path.join(kitDir, file));
  writeFileSync(path.join(kitDir, "CORE_VERSION"), `${sha}\n`);
  return sha;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error("usage: node scripts/sync-from-core.mjs <path-to-koldera-core-checkout>");
    process.exit(2);
  }
  try {
    const sha = syncFromCore(path.resolve(process.argv[2]));
    console.log(`copied ${CONTRACT_FILES.join(", ")} from koldera-core ${sha}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [path.join(kitRoot, "validate-golden.mjs")], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
