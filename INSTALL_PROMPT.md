# Cursor installation prompt

Copy and paste the single prompt below into Cursor Agent while your target project is open:

```text
Install cursor-shunt into this workspace as a project-local tool. Work only in the current workspace.

1. If .cursor-shunt does not exist, clone https://github.com/dominicletz/cursor-shunt.git .cursor-shunt; otherwise fetch its current main branch.
2. Copy (or update) .cursor/hooks.json, .cursor/hooks/, and .cursor/skills/ from .cursor-shunt into this workspace's .cursor/ directory. Preserve unrelated existing Cursor settings and skills; merge JSON rather than overwriting unrelated hooks.
3. Copy .cursor-shunt/scripts/ into ./scripts/ without deleting existing scripts. If a name conflicts, compare the files and preserve unrelated project behavior.
4. Copy package.json dependency and devDependency entries required by cursor-shunt, or install the current package dependencies with npm install. Preserve the workspace's existing package scripts and dependencies.
5. Run npm install, then run npx tsx scripts/bulk-read.ts --help and npx tsx scripts/code-write.ts --help.
6. Tell me to set CURSOR_API_KEY in the environment used by Cursor. Do not print or ask me to paste the secret into a file. Remind me to trust/enable project hooks and reload Cursor.
7. Summarize every file changed and report any merge conflict or failed verification. Do not make unrelated code changes.
```
