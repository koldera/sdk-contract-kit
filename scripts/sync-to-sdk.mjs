#!/usr/bin/env node
// Mirrors this kit into <sdk>/contracts/: openapi.yaml, the two schemas, CORE_VERSION and golden/ (stale fixtures are
// deleted), plus KIT_VERSION = the kit commit. SDK CI compares contracts/ with the kit at that commit.
// Usage: node scripts/sync-to-sdk.mjs <path-to-sdk-or-cli-checkout>
import { cpSync, existsSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_FILES, git, isOnMain, kitRoot } from "./sync-from-core.mjs";

export function syncToSdk(sdkDir, kitDir = kitRoot) {
  if (git(kitDir, "status", "--porcelain") !== "") {
    throw new Error(`${kitDir} has uncommitted changes; commit them first so KIT_VERSION describes the copied files`);
  }
  const target = path.join(sdkDir, "contracts");
  if (!existsSync(target)) throw new Error(`${target} does not exist; is ${sdkDir} an SDK checkout?`);
  const sha = git(kitDir, "rev-parse", "HEAD");
  for (const file of [...CONTRACT_FILES, "CORE_VERSION"]) copyFileSync(path.join(kitDir, file), path.join(target, file));
  rmSync(path.join(target, "golden"), { recursive: true, force: true });
  cpSync(path.join(kitDir, "golden"), path.join(target, "golden"), { recursive: true });
  writeFileSync(path.join(target, "KIT_VERSION"), `${sha}\n`);
  return { sha, onMain: isOnMain(kitDir, sha) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error("usage: node scripts/sync-to-sdk.mjs <path-to-sdk-or-cli-checkout>");
    process.exit(2);
  }
  try {
    const { sha, onMain } = syncToSdk(path.resolve(process.argv[2]));
    console.log(`mirrored sdk-contract-kit ${sha} into ${path.resolve(process.argv[2], "contracts")}`);
    if (!onMain) {
      console.warn(`warning: ${sha} is not on origin/main of sdk-contract-kit; re-run after the kit change is merged`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
