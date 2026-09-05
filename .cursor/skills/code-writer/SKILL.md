---
name: code-writer
description: Use the local Luna helper for repetitive boilerplate that should match an existing reference.
---

# Code writer

Use this helper for mechanical scaffolding:

```sh
npx tsx scripts/code-write.ts \
  --spec "Create a validation schema for the fields described here" \
  --reference src/existing-schema.ts \
  --target src/new-schema.ts
```

With `--target`, only a `{path, bytes}` summary enters the parent context. Without it, the generated code is printed to stdout. Review generated code before relying on it.

Do not delegate feature edits, debugging, architecture, security-sensitive code, or code that needs broad repository context.
