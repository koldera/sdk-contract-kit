import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { syncFromCore } from "./sync-from-core.mjs";
import { syncToSdk } from "./sync-to-sdk.mjs";

const g = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" }).trim();

function tree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "sync-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function repo(files) {
  const dir = tree(files);
  g(dir, "-c", "init.defaultBranch=main", "init", "-q");
  g(dir, "add", "-A");
  g(dir, "commit", "-qm", "init");
  g(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

const core = () =>
  repo({ "contracts/openapi.yaml": "new: api\n", "contracts/document.schema.json": "{}\n", "contracts/problem.schema.json": "{}\n" });

test("syncFromCore copies the three files and records the core commit", () => {
  const coreDir = core();
  const kitDir = tree({ "openapi.yaml": "old\n" });
  const sha = syncFromCore(coreDir, kitDir);
  assert.equal(readFileSync(path.join(kitDir, "openapi.yaml"), "utf8"), "new: api\n");
  assert.equal(readFileSync(path.join(kitDir, "CORE_VERSION"), "utf8"), `${sha}\n`);
});

test("syncFromCore refuses a dirty core tree", () => {
  const coreDir = core();
  writeFileSync(path.join(coreDir, "contracts", "openapi.yaml"), "edited\n");
  assert.throws(() => syncFromCore(coreDir, tree({})), /uncommitted changes/);
});

test("syncFromCore refuses a core HEAD that is not on origin/main", () => {
  const coreDir = core();
  writeFileSync(path.join(coreDir, "x"), "x");
  g(coreDir, "add", "x");
  g(coreDir, "commit", "-qm", "local only");
  assert.throws(() => syncFromCore(coreDir, tree({})), /not on origin\/main/);
});

test("syncToSdk mirrors the kit, deletes stale fixtures and records KIT_VERSION", () => {
  const kitDir = repo({
    "openapi.yaml": "api\n", "document.schema.json": "{}\n", "problem.schema.json": "{}\n", "CORE_VERSION": "c\n",
    "golden/a.json": "{}\n",
  });
  const sdkDir = tree({ "contracts/openapi.yaml": "old\n", "contracts/golden/stale.json": "{}\n" });
  const { sha, onMain } = syncToSdk(sdkDir, kitDir);
  assert.equal(onMain, true);
  assert.equal(readFileSync(path.join(sdkDir, "contracts", "openapi.yaml"), "utf8"), "api\n");
  assert.equal(readFileSync(path.join(sdkDir, "contracts", "KIT_VERSION"), "utf8"), `${sha}\n`);
  assert.ok(existsSync(path.join(sdkDir, "contracts", "golden", "a.json")));
  assert.ok(!existsSync(path.join(sdkDir, "contracts", "golden", "stale.json")));
});

test("syncToSdk refuses a dirty kit tree", () => {
  const kitDir = repo({ "openapi.yaml": "api\n" });
  writeFileSync(path.join(kitDir, "openapi.yaml"), "edited\n");
  assert.throws(() => syncToSdk(tree({ "contracts/x": "" }), kitDir), /uncommitted changes/);
});
