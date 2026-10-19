# Contributing

This repository mirrors the client-facing contract of Koldera Core. Please open an issue before changing an operation or schema. A server behavior change must land in Core first; maintainers then sync it here and propagate the resulting commit to the SDKs and CLI. See [README.md](README.md#update-the-contract) for the sequence.

Run `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm validate` before opening a pull request. Use synthetic fixture values only. Do not submit real HTTP captures, credentials, private server code or customer documents.

By submitting a contribution, you agree to license it under this repository's [Apache-2.0 licence](LICENSE) (section 5). Koldera Core is a separate product and accepts contributions under its own terms.
