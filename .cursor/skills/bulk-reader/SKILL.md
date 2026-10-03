---
name: bulk-reader
description: Use the local Luna helper when Cursor blocks a large-file read.
---

# Bulk reader

When a hook denies a read because a file is at least `SHUNT_MIN_LINES` lines:

1. Form a focused question that names the decision or symbols you need.
2. Run `npx tsx scripts/bulk-read.ts --question "..." --paths path/to/file path/to/other-file`.
3. Use the concise structured result in your reasoning. The full file bodies stay inside the helper agent.
4. For a small known section, run `sed -n 'START,ENDp' path/to/file` in the shell. Do not use the `Read` tool with an offset and limit. Cursor does not send those fields to hooks, so the hook blocks that read as well.

## Editing a large file

Edit tools (`StrReplace`, `Write`) read the whole file first, and the hook cannot tell that read from a normal read. So the hook also blocks edits of large files. Before the edit:

1. Run `node .cursor/hooks/allow-edit.mjs path/to/file`. It needs no API key and no model call.
2. Make the edit. The file stays readable in full for `SHUNT_GRANT_SECONDS` seconds (default 600).

Do not use `allow-edit` to read a file in full. Use `bulk-read` or `sed -n` for that.

Do not use the `bulk-read` helper for edits, debugging, architecture decisions, or small files.
