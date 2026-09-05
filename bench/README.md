# SDK token benchmark

This is an optional paid/live benchmark. It runs the same fixed parent prompt
against two isolated temporary workspaces:

- `baseline`: no `.cursor` integration, so the parent can read all generated
  large files directly.
- `shunt`: project hooks, skills, and helper scripts are copied in. Broad
  large-file reads are denied and the parent is expected to use
  `scripts/bulk-read.ts`.

Both arms use the same parent model. `BENCH_PARENT_MODEL` selects the model and
defaults to the pinned non-Auto model `gpt-5.6-sol`. The Luna worker model is
controlled independently by `SHUNT_MODEL` and defaults to `gpt-5.6-luna`.

## Local run

Generate the ignored synthetic source files first:

```sh
npm run bench:fixture
```

The benchmark requires a key from the environment and fails before making an
SDK call if it is missing. Use your own key locally; never put it in a file or
commit it:

```sh
export CURSOR_API_KEY="<your-own-Cursor-API-key>"
BENCH_PARENT_MODEL=gpt-5.6-sol npm run bench:ab -- \
  --runs 1 \
  --output bench/results/local-summary.json
```

`--runs N` executes both arms N times. The harness uses `@cursor/sdk` for the
parent and the existing `bulk-read` helper uses the SDK for its Luna worker.
It captures both `result.usage` and `agent.getUsage()`, records tool/transcript
routing evidence, and emits aggregate JSON. The temporary workspaces and
transcripts are removed after each arm; the output contains summary data, not
full prompts or transcripts.

The report includes parent token totals, Luna worker tokens when the helper
reports them, measured parent savings, and SDK-reported parent cost when
available. Total cost is left null when the helper's billed cost is not
available. No savings values are fabricated or checked into this repository.

## GitHub Actions

Default pull-request CI never calls the live SDK benchmark and does not need a
secret. To run the paid benchmark, a maintainer must add a repository secret
named `CURSOR_API_KEY` in **GitHub Settings → Secrets and variables → Actions**
and then start the **Live SDK benchmark** workflow with `workflow_dispatch`.
The workflow reads the key only through the GitHub Actions secrets context,
does not echo it, and uploads only the aggregate JSON summary. If the secret is
not configured, the dispatch completes with a clear skip notice.

Do not commit API keys, tokens, `.env` files, usage dumps, or raw benchmark
transcripts. Local result paths under `bench/results/`, generated fixture files,
and usage JSON dumps are ignored.
