# sdk-contract-kit

The HTTP contract of koldera-core as the SDKs and the CLI consume it: `openapi.yaml`, `document.schema.json`,
`problem.schema.json`, the koldera-core commit they were copied from (`CORE_VERSION`), and the golden HTTP fixtures in
[`golden/`](golden) that every SDK test suite replays. `validate-golden.mjs` checks every fixture against the OpenAPI
description and the schemas.

## Flow

```
koldera-core (private, source of truth)  --scripts/sync-from-core.mjs-->  sdk-contract-kit
sdk-contract-kit                         --scripts/sync-to-sdk.mjs----->  <sdk>/contracts/  (koldera-js, koldera-dotnet,
                                                                                            koldera-python, koldera-go,
                                                                                            koldera-cli)
```

koldera-core stays private, so SDK CI cannot compare against it. Each SDK instead records the kit commit it was synced
from in `contracts/KIT_VERSION` and its CI compares the whole `contracts/` directory (including `golden/`) with this
repository at that commit. While this repository is private the SDK check is skipped with a notice; it is enforced once
the kit is readable by the SDK workflows.

## Releasing a contract change

1. Merge the API change in koldera-core and check out that commit of `origin/main` in a clean koldera-core checkout.
2. In a branch of this repository: `node scripts/sync-from-core.mjs ../koldera-core`. The script refuses a dirty core
   tree or a HEAD that is not on `origin/main`, copies the three files, writes `CORE_VERSION` and runs
   `validate-golden.mjs`. Add or update fixtures in `golden/` for the change, run `pnpm test && pnpm validate`, open a
   pull request and merge it.
3. With this repository clean and on the merged commit: `node scripts/sync-to-sdk.mjs ../koldera-js` (and the other
   SDKs and the CLI). The script mirrors `openapi.yaml`, the schemas, `CORE_VERSION` and `golden/` into
   `<sdk>/contracts/` (deleting fixtures that no longer exist), writes `contracts/KIT_VERSION`, and warns when the kit
   commit is not on `origin/main`. Open one pull request per repository and fix the SDK where the tests fail.

## Development

```bash
pnpm install --frozen-lockfile
pnpm test      # validator and sync script tests
pnpm validate  # every fixture in golden/ against openapi.yaml and the schemas
```

## Licence

No licence is granted yet. The licence of this repository will be decided when it is published; until then all rights
are reserved.
