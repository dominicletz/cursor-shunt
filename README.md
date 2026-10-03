# cursor-shunt

Keep large-file I/O and repetitive scaffolding off an expensive Cursor IDE agent. `cursor-shunt` combines Cursor hooks with small local CLI agents powered by `@cursor/sdk` and `gpt-5.6-luna`.

## What it does

1. Hooks deny broad reads and shell display commands for files at or above `SHUNT_MIN_LINES`.
2. The `bulk-read` helper sends selected files and a focused question to a cheap Luna agent, then returns structured findings.
3. The `code-write` helper asks Luna to match an existing reference and can write the result directly to disk, returning only a byte summary to the parent agent.
4. Cursor skills teach an IDE agent when and how to invoke each helper.

The helpers use local SDK agents. `bulk-read` inlines XML file bodies and gives its agent no tools, so the corpus does not re-enter the parent context. `code-write` gives its agent only the `read` tool to inspect the reference.

## Install in Cursor

Node.js 22.13 or newer is required by the Cursor SDK. Pick one option.

### Option 1: global install (all projects)

Clone the repository to a permanent location and run the installer:

```sh
git clone https://github.com/dominicletz/cursor-shunt.git ~/.cursor-shunt
cd ~/.cursor-shunt
npm run install:global
export CURSOR_API_KEY="<your-own-Cursor-API-key>"
```

The installer runs `npm install`, then writes to `~/.cursor`:

- `hooks.json`: merged with your existing hooks. Older cursor-shunt entries are replaced. A backup is saved as `hooks.json.bak`.
- `skills/bulk-reader/SKILL.md` and `skills/code-writer/SKILL.md`.

The hooks, the skills, and the hook messages use absolute paths into the clone, so they work in every project. Do not move or delete the clone. To update, run `git pull && npm run install:global` in the clone. Use `--cursor-dir <dir>` to install into a different Cursor directory, and `--skip-npm` to skip `npm install`.

### Option 2: project-local install

From a project directory, clone this repository and copy its integration files:

```sh
git clone https://github.com/dominicletz/cursor-shunt.git .cursor-shunt
cp -R .cursor-shunt/.cursor ./
cp -R .cursor-shunt/scripts ./
npm install --save-dev @cursor/sdk tsx
export CURSOR_API_KEY="<your-own-Cursor-API-key>"
```

If the project already has `.cursor/hooks.json`, merge the hook entries instead of overwriting unrelated settings. Keep hooks and skills at the project root, trust the workspace, and enable project hooks if prompted.

After either option, reload Cursor and make sure `CURSOR_API_KEY` is set in the environment that starts Cursor. For a one-shot installation prompt, see [INSTALL_PROMPT.md](INSTALL_PROMPT.md).

### Verify

```sh
npx tsx scripts/bulk-read.ts --help
```

Run it in the clone (global install) or in your project (project-local install). Then ask the agent to read a file with at least `SHUNT_MIN_LINES` lines. The hook must block the read and name the `bulk-read` command.

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
| `SHUNT_GRANT_SECONDS` | `600` | How long `allow-edit` allows full reads of a file |
| `SHUNT_GRANTS_FILE` | `<tmpdir>/cursor-shunt-grants.json` | Where `allow-edit` stores its grants |

User-level hooks run from `~/.cursor`, so the global install uses absolute paths. Hooks fail open when they cannot parse an event or inspect a file. Targeted reads with offset/limit-style fields are allowed. Shell commands containing a pipe or redirection are allowed so commands such as `cat file | rg pattern` remain useful.

## Editing large files

`StrReplace` and `Write` read the whole file before they edit it. Cursor sends that read to the hook as a normal `Read` event (`tool_name: "Read"`, `tool_input.file_path`), the same as a real read. The hook cannot tell them apart, so it would block every edit of a large file.

To edit a large file, run `node .cursor/hooks/allow-edit.mjs <file>` first. It records a grant that expires after `SHUNT_GRANT_SECONDS`, and the hook allows full reads of that file until then. The deny message names this command.

## Limits

The hooks are a cost nudge, not an access control.

- The `Read` tool and the shell commands `cat`, `head`, `tail`, `less` and `more` are checked. `head` and `tail` with a count (`-n 20`, `-20`, `-c 100`) count as targeted reads.
- Other routes are not checked: `sed`, `awk`, `rg`, `git show`, `git diff`, scripting languages and the `Grep` tool. An agent can read a large file through them.
- Both `beforeReadFile` and `preToolUse` run this script. `beforeReadFile` reads only `user_message` and `preToolUse` reads only `agent_message`, so a denial sends the same text in both fields.

## What not to delegate

Do not use shunt for edits that need judgment, debugging, architecture, security-sensitive code, or small files. Generated code must be reviewed by the parent agent.

## Inspiration and scope

This project is Cursor-specific and uses Cursor hooks, `@cursor/sdk`, and Luna.
It has no Portal dependency or MCP server in v1.

## License

MIT © Dominic Letz 2026.