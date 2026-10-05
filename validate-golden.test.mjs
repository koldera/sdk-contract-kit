import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { validateFixtures } from "./validate-golden.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const openapiPath = path.join(root, "openapi.yaml");
const JOB_ID = "4d2d5a6e-2b1c-4e4a-9d6b-1f3c5e7a9b01";

const job = (over = {}) => ({
  id: JOB_ID, kind: "pdf", mode: "analyze", state: "queued", createdAt: "2026-10-05T10:00:00Z",
  startedAt: null, finishedAt: null, validation: null, baselineValidation: null, finalValidation: null,
  remediationStatus: null, manualReviewRequired: true, engineVersion: null, error: null, targetUrl: null, contentSelector: null, ...over,
});
const good = () => ({
  name: "t", operationId: "getJob", auth: "server",
  request: { method: "GET", path: `/v1/jobs/${JOB_ID}`, headers: { Authorization: "Bearer {{secretKey}}" } },
  response: { status: 200, headers: { "Content-Type": "application/json", "Retry-After": "2" }, body: job() },
});
const jobPost = (status, headers, extra = {}) => ({
  name: "p", operationId: "createPdfJob", auth: "server",
  request: { method: "POST", path: "/v1/pdf/jobs", headers: { Authorization: "Bearer {{secretKey}}", "Content-Type": "application/json", "Idempotency-Key": "{{idempotencyKey}}" }, body: { uploadId: JOB_ID, mode: "analyze", profile: "ua1" }, ...extra.request },
  response: { status, headers: { "Content-Type": "application/json", ...headers }, body: job() },
});

async function run(fixtures) {
  const dir = mkdtempSync(path.join(tmpdir(), "golden-"));
  try {
    fixtures.forEach((f, i) => writeFileSync(path.join(dir, `f${i}.json`), JSON.stringify(f)));
    return await validateFixtures({ goldenDir: dir, openapiPath, schemaDir: root });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const withError = async (fixture, pattern) => {
  const errors = await run([fixture]);
  assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern}, got ${JSON.stringify(errors)}`);
};

test("a correct fixture has no errors", async () => {
  assert.deepEqual(await run([good()]), []);
});
test("unknown operationId", async () => { const f = good(); f.operationId = "nope"; await withError(f, /operationId/); });
test("path that does not match the operation", async () => { const f = good(); f.request.path = "/v1/other"; await withError(f, /path/); });
test("method that does not match the operation", async () => { const f = good(); f.request.method = "POST"; await withError(f, /method/); });
test("status not declared for the operation", async () => { const f = good(); f.response.status = 418; await withError(f, /status 418/); });
test("response body violating the schema", async () => { const f = good(); f.response.body.state = "bogus"; await withError(f, /response body/); });
test("request body violating the schema", async () => { const f = jobPost(202, { Location: `/v1/jobs/${JOB_ID}` }); f.request.body.mode = "safe_fix"; await withError(f, /request body/); });
test("202 needs a Location header", async () => { await withError(jobPost(202, {}), /Location/); });
test("Preference-Applied is only valid as wait=N", async () => { await withError(jobPost(202, { Location: `/v1/jobs/${JOB_ID}`, "Preference-Applied": "wait=abc" }), /Preference-Applied/); });
test("Retry-After must be an integer", async () => { const f = good(); f.response.headers["Retry-After"] = "soon"; await withError(f, /Retry-After/); });
test("problem status must equal the HTTP status and the code must be known", async () => {
  const f = good();
  f.response = { status: 404, headers: { "Content-Type": "application/problem+json" }, body: { type: "about:blank", title: "Not found", status: 400, code: "NOPE" } };
  await withError(f, /problem status/);
  await withError(f, /response body/);
});
test("problem responses need the problem+json content type", async () => {
  const f = good();
  f.response = { status: 404, headers: { "Content-Type": "application/json" }, body: { type: "about:blank", title: "Not found", status: 404, code: "NOT_FOUND" } };
  await withError(f, /Content-Type/);
});
test("rawBody must match its declared sha256", async () => {
  const f = { name: "d", operationId: "downloadArtifact", auth: "server", request: { method: "GET", path: `/v1/artifacts/${JOB_ID}/content?exp=1&sig=x`, headers: {}, forbiddenHeaders: ["Authorization"] },
    response: { status: 200, headers: { "Content-Type": "application/pdf" }, rawBody: "%PDF-1.4\n", sha256: "0".repeat(64) } };
  await withError(f, /sha256/);
});
test("421 HOST_NOT_ALLOWED is accepted on any operation although openapi.yaml omits it", async () => {
  const f = good();
  f.response = { status: 421, headers: { "Content-Type": "application/problem+json" }, body: { type: "about:blank", title: "Host not allowed", status: 421, code: "HOST_NOT_ALLOWED" } };
  assert.deepEqual(await run([f]), []);
});
test("duplicate fixture names are rejected", async () => {
  const errors = await run([good(), good()]);
  assert.ok(errors.some((e) => /duplicate/.test(e)), JSON.stringify(errors));
});
test("every shipped golden fixture is valid", async () => {
  assert.deepEqual(await validateFixtures({ goldenDir: path.join(root, "golden"), openapiPath, schemaDir: root }), []);
});
