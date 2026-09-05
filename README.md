# cursor-shunt

Keep large-file I/O and repetitive scaffolding off an expensive Cursor IDE agent. `cursor-shunt` combines Cursor hooks with small local CLI agents powered by `@cursor/sdk` and `gpt-5.6-luna`.

## What it does

1. Hooks deny broad reads and shell display commands for files at or above `SHUNT_MIN_LINES`.
2. The `bulk-read` helper sends selected files and a focused question to a cheap Luna agent, then returns structured findings.
3. The `code-write` helper asks Luna to match an existing reference and can write the result directly to disk, returning only a byte summary to the parent agent.
4. Cursor skills teach an IDE agent when and how to invoke each helper.

The helpers use local SDK agents. `bulk-read` inlines XML file bodies and gives its agent no tools, so the corpus does not re-enter the parent context. `code-write` gives its agent only the `read` tool to inspect the reference.

## Install in Cursor

From a project directory, clone this repository and copy its project-local integration files, or copy `.cursor/` and `scripts/` directly:

```sh
git clone https://github.com/dominicletz/cursor-shunt.git .cursor-shunt
cp -R .cursor-shunt/.cursor ./
cp -R .cursor-shunt/scripts ./
npm install
export CURSOR_API_KEY="<your-own-Cursor-API-key>"
```

If the project already has `.cursor/hooks.json`, merge the hook entries instead of overwriting unrelated settings. Node.js 22.13 or newer is required by the Cursor SDK. Keep hooks and skills at the project root, trust the workspace, enable project hooks if prompted, and reload Cursor after installing. For a one-shot installation prompt, see [INSTALL_PROMPT.md](INSTALL_PROMPT.md).

## Usage

Ask the IDE agent a question that would otherwise require opening a large file. If the hook blocks it, the agent can run:

```sh
npx tsx scripts/bulk-read.ts \
  --question "Where is authentication state created and which callers mutate it?" \
  --paths src/auth/store.ts src/auth/session.ts
```

For repetitive generation:

```sh
npx tsx scripts/code-write.ts \
  --spec "Add the corresponding read-only repository class for the entities in this module" \
  --reference src/users/user-repository.ts \
  --target src/orders/order-repository.ts
```

With `--target`, stdout contains only `{"path":"...","bytes":...}`. Without `--target`, generated code is printed to stdout. Answers go to stdout; token usage, when exposed by the SDK, goes to stderr.

## Benchmark

The optional [SDK-based A/B benchmark](bench/README.md) measures parent-agent
usage with and without the shunt integration. It uses a fixed generated
monorepo and reports measured usage only; this project does not claim a
precomputed savings percentage.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CURSOR_API_KEY` | — | Required SDK authentication key |
| `SHUNT_MIN_LINES` | `350` | Minimum line count for broad-read and shell-display blocking |
| `SHUNT_MODEL` | `gpt-5.6-luna` | Optional model ID override; reasoning remains `none` |

Hooks fail open when they cannot parse an event or inspect a file. Targeted reads with offset/limit-style fields are allowed. Shell commands containing a pipe or redirection are allowed so commands such as `cat file | rg pattern` remain useful.

## What not to delegate

Do not use shunt for edits that need judgment, debugging, architecture, security-sensitive code, or small files. Generated code must be reviewed by the parent agent.

## Inspiration and scope

This project is Cursor-specific and uses Cursor hooks, `@cursor/sdk`, and Luna.
It has no Portal dependency or MCP server in v1.

## License

MIT © Dominic Letz 2026.