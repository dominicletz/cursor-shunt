# Fixed benchmark question

Inspect every large source file in `packages/catalog/src/catalog-service.ts`, `packages/accounts/src/auth-service.ts`, and `packages/billing/src/billing-service.ts`. List every method that calls `db.query`, including the file path and the 1-based line number of the `db.query` call, sorted by file path and then line number. Answer only from the full file contents.

For this benchmark, use the `Read` tool on each full source file. Do not substitute a search or shell command for reading the files. If a broad read is denied, follow the project’s `bulk-reader` skill and invoke `scripts/bulk-read.ts` with this question and all three source paths.
