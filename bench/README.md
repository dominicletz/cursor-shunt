# SDK A/B token benchmark

This is a paid, live benchmark. It requires Node.js 22.13+ and a Cursor API key:

```sh
npm install
CURSOR_API_KEY=... npm run bench:ab -- --runs 3
```

`npm run bench:fixture` is also available when you only want to generate or refresh the synthetic fixture. The generated source files are intentionally ignored by Git; `bench/fixture/PROMPT.md` contains the fixed question.

The harness uses `@cursor/sdk` directly:

- The `baseline` arm creates a local SDK agent with `local.settingSources: []`, so project hooks and skills are disabled. The parent is instructed to use `Read` on all three large files.
- The `shunt` arm runs against the same generated fixture content with `local.settingSources: ["project"]`. The fixture receives the repository’s hooks, `bulk-reader` skill, and `bulk-read` script, so a denied broad read should be delegated to Luna.
- Both arms use the same concrete parent model, `gpt-5.6-sol` by default. Set `BENCH_PARENT_MODEL` to another concrete model ID; Auto/router modes are rejected.
- The SDK `onDelta` stream records successful large `Read` calls and shell calls to `scripts/bulk-read.ts`. Parent usage comes from `result.usage` with `agent.getUsage()` preferred when available. Luna usage is parsed from the helper’s `token_usage=` stderr diagnostic when the SDK exposes it through the shell result.

The Markdown output includes mean per-run parent input/output/cache/total tokens, billed cost when `getUsage()` reports it, parent-token savings, total tokens including Luna, and validity flags. A JSON copy is included below the table for automation. An arm is invalid when the baseline did not read every large file or when the shunt arm did not successfully delegate all files (including the explicit case where it read every file itself).

This mirrors the parent-ingest-token part of Spotify’s shunt methodology: it measures how much context the expensive parent consumes when it handles a large corpus versus receiving a focused worker result. It is not a claim about total cost savings. Luna tokens, worker latency, model pricing, cache reads/writes, and billed usage can change the total-dollar result.

## Interpreting results

The benchmark is deliberately reproducible in its fixture and question, not deterministic in model behavior. Repeat runs with `--runs 3` or more and compare means. Consider the following limitations:

- Local-agent tool choice and answer length are nondeterministic.
- Cursor model availability, model versions, tokenization, and pricing can change.
- Cache read/write tokens are reported separately and may not behave like fresh input tokens.
- `getUsage()` cost is server-derived and can be temporarily absent after a run.
- Luna usage is only included when `bulk-read` exposes it in stderr and the parent SDK stream returns that stderr.
- A validity failure means the run did not exercise the intended arm; do not use its savings number as an experiment result.

The regular CI workflow never runs this benchmark. The GitHub Actions workflow has a manual `workflow_dispatch` input named `run_bench`; set it to `true` only when a `CURSOR_API_KEY` repository secret is configured and you explicitly want to incur live usage.
