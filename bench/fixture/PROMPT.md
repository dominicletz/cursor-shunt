# Fixed parent-agent benchmark prompt

You are the parent coding agent in a token-usage benchmark. Inspect the
synthetic monorepo under `generated/` and answer the investigation below.

The four large source files are:

- `generated/apps/api/src/data/user-repository.ts`
- `generated/apps/api/src/auth/session-service.ts`
- `generated/packages/billing/src/invoice-ledger.ts`
- `generated/packages/search/src/search-index.ts`

Use the `read` tool to inspect the complete contents of each listed file.
Do not use `grep`, `glob`, or shell commands to inspect file contents. If a
read is denied, do not bypass the denial or retry the same broad read. Follow
the `bulk-reader` skill and run the prescribed `bulk-read` helper for the
denied file or files.

Report concise bullets with the file path, function or constant name, and
line number for every occurrence of `db.query` and `authenticate`. Group the
findings by file, then state which files contain both patterns. Do not
speculate about code that is not present in the four files.
