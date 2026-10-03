# Cursor installation prompts

## Global install (all projects)

Copy and paste this prompt into Cursor Agent:

```text
Install cursor-shunt globally for my Cursor user.

1. If ~/.cursor-shunt does not exist, clone https://github.com/dominicletz/cursor-shunt.git ~/.cursor-shunt; otherwise run git pull in it.
2. In ~/.cursor-shunt, run npm run install:global. It installs dependencies and merges the hooks into ~/.cursor/hooks.json and the skills into ~/.cursor/skills.
3. Run npx tsx scripts/bulk-read.ts --help and npx tsx scripts/code-write.ts --help in ~/.cursor-shunt.
4. Tell me to set CURSOR_API_KEY in the environment used by Cursor. Do not print or ask me to paste the secret into a file. Remind me to reload Cursor.
5. Summarize every file changed and report any failed verification. Do not make unrelated changes.
```

## Project-local install

Copy and paste this prompt into Cursor Agent while your target project is open:

```text
Install cursor-shunt into this workspace as a project-local tool. Work only in the current workspace.

1. If .cursor-shunt does not exist, clone https://github.com/dominicletz/cursor-shunt.git .cursor-shunt; otherwise fetch its current main branch.
2. Copy (or update) .cursor/hooks.json, .cursor/hooks/, and .cursor/skills/ from .cursor-shunt into this workspace's .cursor/ directory. Preserve unrelated existing Cursor settings and skills; merge JSON rather than overwriting unrelated hooks.
3. Copy .cursor-shunt/scripts/ into ./scripts/ without deleting existing scripts. If a name conflicts, compare the files and preserve unrelated project behavior.
4. Add the dependencies required by cursor-shunt to this workspace: npm install --save-dev @cursor/sdk tsx. Preserve the workspace's existing package scripts and dependencies.
5. Run npx tsx scripts/bulk-read.ts --help and npx tsx scripts/code-write.ts --help.
6. Tell me to set CURSOR_API_KEY in the environment used by Cursor. Do not print or ask me to paste the secret into a file. Remind me to trust/enable project hooks and reload Cursor.
7. Summarize every file changed and report any merge conflict or failed verification. Do not make unrelated code changes.
```
