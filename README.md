# Koldera SDK contract kit

This repository holds the versioned **client-facing HTTP contract** used by the Koldera SDKs and CLI. It copies the
API description from [Koldera Core](https://github.com/koldera/koldera-core). It contains schemas and synthetic HTTP
examples, not the server implementation, credentials or customer data.

**Status:** 0.1 development contract. The API may change before 1.0. This repository is not published as an npm package; SDKs vendor a pinned snapshot so their builds remain reproducible.

## What's here

| Path | Purpose |
| --- | --- |
| [`openapi.yaml`](openapi.yaml) | REST operations, request and response shapes |
| [`document.schema.json`](document.schema.json), [`problem.schema.json`](problem.schema.json) | Structured-document input and error responses |
| [`golden/`](golden) | Synthetic HTTP exchanges used by SDK and CLI tests |
| [`CORE_VERSION`](CORE_VERSION) | Core commit from which the contract was copied |
| `scripts/sync-from-core.mjs` | Maintainer script to copy an approved Core contract here |
| `scripts/sync-to-sdk.mjs` | Maintainer script to vendor this contract into each client |

The SDK and CLI repositories store `contracts/KIT_VERSION`, the exact commit of this repository used for their vendored copy. Their CI compares that copy byte for byte with this commit. The fixtures verify client parsing and protocol handling; they do not prove that a particular Core deployment implements every operation.

## Validate a checkout

Node.js 22 and pnpm 10 are used in CI:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm validate
```

`pnpm validate` checks the golden exchanges against the OpenAPI description and JSON Schemas. The fixtures contain invented IDs and tokens; do not add captured production traffic.

## Update the contract

1. Merge the API change in Koldera Core and check out that clean commit on Core's `main` branch.
2. On a branch here, run `node scripts/sync-from-core.mjs ../koldera-core`. Update synthetic fixtures for the change, then run the validation commands above and open a pull request.
3. After merging here, run `node scripts/sync-to-sdk.mjs ../koldera-js` for each SDK and `koldera-cli`. Open a pull request in each client repository and fix any failed client tests. The script writes the new `contracts/KIT_VERSION`.

Both sync scripts check the source tree and commit before copying. The kit contains only the client-facing contract;
Core's source and its own build instructions live in the Core repository.

## Licence

The contract kit is licensed under [Apache-2.0](LICENSE). This includes the client-facing contract snapshots and
synthetic fixtures in this repository. Koldera Core is a separate server licensed under
[AGPL-3.0-only](https://github.com/koldera/koldera-core/blob/main/LICENSE). Its licence governs Core itself.
