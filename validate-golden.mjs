#!/usr/bin/env node
// Validates every golden fixture against openapi.yaml (and document.schema.json / problem.schema.json).
// Usage: node validate-golden.mjs [goldenDir]   Exit code 1 when any fixture is invalid.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];
const AUTHS = new Set(["server", "session", "none"]);
const PLACEHOLDERS = {
  "{{baseUrl}}": "http://127.0.0.1:8080",
  "{{secretKey}}": "test-server-token",
  "{{sessionToken}}": "v1.eyJmYWtlIjoidHJ1ZSJ9.ZmFrZS1zaWduYXR1cmU",
  "{{idempotencyKey}}": "idem-0123456789",
};
const substitute = (text) => Object.entries(PLACEHOLDERS).reduce((t, [k, v]) => t.replaceAll(k, v), text);
const resolveJson = (value) => (value === undefined ? undefined : JSON.parse(substitute(JSON.stringify(value))));
const mediaType = (value) => String(value ?? "").split(";")[0].trim().toLowerCase();
const sha256Hex = (latin1) => createHash("sha256").update(Buffer.from(latin1, "latin1")).digest("hex");
const headerGet = (headers, name) => {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : substitute(String(headers[key]));
};

function indexOperations(api) {
  const operations = new Map();
  for (const [template, item] of Object.entries(api.paths)) {
    const source = template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, "(?<$1>[^/]+)");
    const pattern = new RegExp("^" + source + "$");
    for (const method of METHODS) {
      const op = item[method];
      if (op?.operationId) {
        operations.set(op.operationId, { template, pattern, method: method.toUpperCase(), op, parameters: [...(item.parameters ?? []), ...(op.parameters ?? [])] });
      }
    }
  }
  return operations;
}

const fmt = (errors) => (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");

export async function validateFixtures({ goldenDir, openapiPath, schemaDir = here }) {
  const api = await SwaggerParser.dereference(openapiPath);
  const operations = indexOperations(api);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validateDocument = ajv.compile(JSON.parse(readFileSync(path.join(schemaDir, "document.schema.json"), "utf8")));
  const validateProblemShape = ajv.compile(JSON.parse(readFileSync(path.join(schemaDir, "problem.schema.json"), "utf8")));
  const compiled = new Map();
  const compile = (schema) => {
    if (!compiled.has(schema)) compiled.set(schema, ajv.compile(schema));
    return compiled.get(schema);
  };

  const errors = [];
  const names = new Set();
  const files = readdirSync(goldenDir).filter((f) => f.endsWith(".json")).sort();
  for (const file of files) {
    const fail = (message) => errors.push(`${file}: ${message}`);
    let fixture;
    try {
      fixture = JSON.parse(readFileSync(path.join(goldenDir, file), "utf8"));
    } catch (e) {
      fail(`not valid JSON (${e.message})`);
      continue;
    }
    if (typeof fixture.name !== "string" || fixture.name === "") fail("name is required");
    else if (names.has(fixture.name)) fail(`duplicate fixture name ${fixture.name}`);
    else names.add(fixture.name);
    if (!AUTHS.has(fixture.auth)) fail(`auth must be one of ${[...AUTHS].join(", ")}`);
    const { request, response } = fixture;
    if (!request || !response) {
      fail("request and response are required");
      continue;
    }
    const entry = operations.get(fixture.operationId);
    if (!entry) {
      fail(`operationId ${fixture.operationId} is not in openapi.yaml`);
      continue;
    }
    const { op } = entry;

    // --- request ---
    const [pathname, query = ""] = String(request.path).split("?");
    if (request.method !== entry.method) fail(`method ${request.method} != ${entry.method} for ${fixture.operationId}`);
    const match = entry.pattern.exec(pathname);
    if (!match) fail(`path ${pathname} does not match ${entry.template}`);
    const params = new URLSearchParams(query);
    for (const p of entry.parameters) {
      if (p.in === "path" && match?.groups?.[p.name] !== undefined && !compile(p.schema)(match.groups[p.name])) fail(`path parameter ${p.name} is invalid`);
      if (p.in === "query" && p.required && !params.has(p.name)) fail(`query parameter ${p.name} is required`);
      if (p.in === "header" && p.required && headerGet(request.headers, p.name) === undefined) fail(`header ${p.name} is required`);
    }
    for (const key of params.keys()) {
      if (!entry.parameters.some((p) => p.in === "query" && p.name === key)) fail(`undeclared query parameter ${key}`);
    }
    const secured = (op.security ?? api.security ?? []).length > 0;
    const authorization = headerGet(request.headers, "Authorization");
    if (secured && authorization === undefined) fail("Authorization header is required for this operation");
    if (!secured && (authorization !== undefined || !(request.forbiddenHeaders ?? []).some((h) => h.toLowerCase() === "authorization"))) {
      fail("an operation without security must omit Authorization and list it in forbiddenHeaders");
    }
    const idem = headerGet(request.headers, "Idempotency-Key");
    if (idem !== undefined && !/^[\x21-\x7e]{1,255}$/.test(idem)) fail("Idempotency-Key must be 1-255 printable ASCII");
    const prefer = headerGet(request.headers, "Prefer");
    const requestContentType = mediaType(headerGet(request.headers, "Content-Type"));
    const requestMedia = op.requestBody?.content?.[requestContentType];
    if (request.body !== undefined) {
      if (!requestMedia) fail(`request Content-Type ${requestContentType || "(missing)"} is not declared for ${fixture.operationId}`);
      else {
        const body = resolveJson(request.body);
        const validate = compile(requestMedia.schema);
        if (!validate(body)) fail(`request body: ${fmt(validate.errors)}`);
        if (fixture.operationId === "createDocumentJob" && !validateDocument(body)) fail(`request body (document.schema.json): ${fmt(validateDocument.errors)}`);
      }
    } else if (request.rawBody !== undefined) {
      if (!requestMedia) fail(`request Content-Type ${requestContentType || "(missing)"} is not declared for ${fixture.operationId}`);
      if (request.sha256 !== sha256Hex(request.rawBody)) fail("request sha256 does not match rawBody");
    } else if (op.requestBody?.required) {
      fail("request body is required for this operation");
    }

    // --- response ---
    const status = response.status;
    // koldera-core answers 421 HOST_NOT_ALLOWED from a host-filter middleware in front of every route, but openapi.yaml
    // does not list it per operation; accept it everywhere as the shared Problem response.
    const declared = op.responses[String(status)] ?? (status === 421 ? api.components.responses.Problem : undefined);
    if (!declared) {
      fail(`status ${status} is not declared for ${fixture.operationId}`);
      continue;
    }
    const contentType = mediaType(headerGet(response.headers, "Content-Type"));
    const hasBody = response.body !== undefined || response.rawBody !== undefined;
    if (hasBody) {
      const media = declared.content?.[contentType];
      if (!media) fail(`response Content-Type ${contentType || "(missing)"} is not declared for status ${status}`);
      else if (response.body !== undefined) {
        const body = resolveJson(response.body);
        const validate = compile(media.schema);
        if (!validate(body)) fail(`response body: ${fmt(validate.errors)}`);
        if (contentType === "application/problem+json") {
          if (!validateProblemShape(body)) fail(`response body (problem.schema.json): ${fmt(validateProblemShape.errors)}`);
          if (body.status !== status) fail(`problem status ${body.status} != HTTP status ${status}`);
        }
      }
    } else if (declared.content) {
      fail(`status ${status} must carry a body`);
    }
    if (response.rawBody !== undefined) {
      if (response.sha256 !== sha256Hex(response.rawBody)) fail("response sha256 does not match rawBody");
      const length = headerGet(response.headers, "Content-Length");
      const size = Buffer.byteLength(response.rawBody, "latin1");
      if (length !== undefined && Number(length) !== size) fail(`Content-Length ${length} != ${size} bytes`);
    }

    const location = headerGet(response.headers, "Location");
    const applied = headerGet(response.headers, "Preference-Applied");
    const jobCreate = entry.method === "POST" && op.responses["202"] !== undefined;
    if (jobCreate && (status === 200 || status === 202)) {
      if (location === undefined) fail("Location header is required on 200/202 of a job-creating POST");
      else if (location !== `/v1/jobs/${response.body?.id}`) fail(`Location ${location} must be /v1/jobs/<body.id>`);
      const waitAsked = prefer !== undefined && /(^|,)\s*wait=([1-9]\d{0,2}|900)\s*(,|;|$)/.test(prefer);
      if (status === 200 && !waitAsked) fail("200 from a job-creating POST requires a Prefer: wait=N request");
      if (waitAsked && applied === undefined) fail("Preference-Applied is required when the server waited");
      if (!waitAsked && applied !== undefined) fail("Preference-Applied without a Prefer: wait=N request");
    }
    if (applied !== undefined && !/^wait=([1-9]\d{0,2}|900)$/.test(applied)) fail(`Preference-Applied ${applied} must be wait=N`);
    const retryAfter = headerGet(response.headers, "Retry-After");
    if (retryAfter !== undefined && !/^\d+$/.test(retryAfter)) fail(`Retry-After ${retryAfter} must be an integer number of seconds`);
    if (response.body?.code === "QUEUE_FULL" && retryAfter === undefined) fail("QUEUE_FULL needs Retry-After");
    if (fixture.operationId === "getJob" && status === 200 && ["queued", "running"].includes(response.body?.state) && retryAfter === undefined) {
      fail("an unfinished job needs Retry-After");
    }
    const replayed = headerGet(response.headers, "Idempotent-Replayed");
    if (replayed !== undefined && replayed !== "true") fail("Idempotent-Replayed must be true");
    if (response.body?.code === "IDEMPOTENCY_KEY_REUSED" && idem === undefined) fail("IDEMPOTENCY_KEY_REUSED needs an Idempotency-Key request");
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const goldenDir = path.resolve(process.argv[2] ?? path.join(here, "golden"));
  const count = readdirSync(goldenDir).filter((f) => f.endsWith(".json")).length;
  const errors = await validateFixtures({ goldenDir, openapiPath: path.join(here, "openapi.yaml") });
  if (errors.length > 0) {
    console.error(errors.map((e) => `FAIL ${e}`).join("\n"));
    console.error(`${errors.length} problem(s) in ${count} fixtures`);
    process.exit(1);
  }
  console.log(`OK: ${count} fixtures valid against openapi.yaml`);
}
