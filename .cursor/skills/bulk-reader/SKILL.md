---
name: bulk-reader
description: Use the local Luna helper when Cursor blocks a large-file read.
---

# Bulk reader

When a hook denies a read because a file is at least `SHUNT_MIN_LINES` lines:

1. Form a focused question that names the decision or symbols you need.
2. Run `npx tsx scripts/bulk-read.ts --question "..." --paths path/to/file path/to/other-file`.
3. Use the concise structured result in your reasoning. The full file bodies stay inside the helper agent.
4. For a small known section, use a targeted read with an offset and limit instead.

Do not use this helper for edits, debugging, architecture decisions, or small files.
