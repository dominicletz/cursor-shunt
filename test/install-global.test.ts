import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import test from "node:test";
import { globalHooks, globalSkill, installGlobal, mergeHooks } from "../scripts/install-global.mjs";
import { absoluteHelperCommand, helperCommand, shuntRoot } from "../.cursor/hooks/common.mjs";

const template = {
  version: 1,
  hooks: {
    beforeReadFile: [{ command: "node .cursor/hooks/before-read-file.mjs" }],
    preToolUse: [{ command: "node .cursor/hooks/before-read-file.mjs", matcher: "Read" }],
  },
};

test("global hooks use absolute quoted paths and keep matchers", () => {
  const hooks = globalHooks(template, "/opt/shunt");
  assert.equal(hooks.beforeReadFile[0].command, 'node "/opt/shunt/.cursor/hooks/before-read-file.mjs"');
  assert.equal(hooks.preToolUse[0].matcher, "Read");
});

test("merge replaces old shunt entries and keeps unrelated hooks", () => {
  const existing = {
    version: 1,
    hooks: {
      beforeReadFile: [{ command: "node .cursor/hooks/before-read-file.mjs" }, { command: "echo keep" }],
      stop: [{ command: "echo stop" }],
    },
  };
  const merged = mergeHooks(existing, globalHooks(template, "/opt/shunt"));
  assert.deepEqual(merged.hooks.beforeReadFile.map((entry: { command: string }) => entry.command), [
    "echo keep",
    'node "/opt/shunt/.cursor/hooks/before-read-file.mjs"',
  ]);
  assert.equal(merged.hooks.stop.length, 1);
  assert.deepEqual(mergeHooks(merged, globalHooks(template, "/opt/shunt")), merged);
});

test("global skill rewrites helper invocations to absolute commands", () => {
  const text = globalSkill("Run `npx tsx scripts/bulk-read.ts --paths a`.\nnpx tsx scripts/code-write.ts \\", "/opt/shunt");
  assert.ok(text.includes(`${absoluteHelperCommand("bulk-read", "/opt/shunt")} --paths a`));
  assert.ok(!text.includes("npx tsx"));
  const edit = globalSkill("Run `node .cursor/hooks/allow-edit.mjs a.ex`.", "/opt/shunt");
  assert.equal(edit, "Run `node \"/opt/shunt/.cursor/hooks/allow-edit.mjs\" a.ex`.");
});

test("helperCommand is short inside the shunt root and absolute elsewhere", () => {
  assert.equal(helperCommand("bulk-read", shuntRoot), "npx tsx scripts/bulk-read.ts");
  assert.equal(helperCommand("bulk-read", tmpdir()), absoluteHelperCommand("bulk-read"));
});

test("installGlobal writes hooks and skills into the Cursor directory", async () => {
  const cursorDir = await mkdtemp(join(tmpdir(), "cursor-shunt-home-"));
  await mkdir(cursorDir, { recursive: true });
  await writeFile(join(cursorDir, "hooks.json"), JSON.stringify({ version: 1, hooks: { stop: [{ command: "echo stop" }] } }));
  const written = await installGlobal({ cursorDir, skipNpm: true });
  assert.equal(written.length, 3);
  const hooks = JSON.parse(await readFile(join(cursorDir, "hooks.json"), "utf8"));
  assert.equal(hooks.hooks.stop.length, 1);
  assert.ok(hooks.hooks.beforeShellExecution[0].command.includes(shuntRoot));
  assert.ok((await readFile(join(cursorDir, "skills", "bulk-reader", "SKILL.md"), "utf8")).includes(shuntRoot));

  // The installed hook must run from an unrelated directory and name an absolute helper path.
  const command: string = hooks.hooks.beforeReadFile[0].command;
  const [, script] = command.match(/"([^"]+)"/) ?? [];
  const bigFile = join(cursorDir, "big.txt");
  await writeFile(bigFile, "a\nb\nc\n");
  const out = await new Promise<string>((resolve, reject) => {
    const child = execFile("node", [script], { cwd: cursorDir, env: { ...process.env, SHUNT_MIN_LINES: "3" } }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin?.end(JSON.stringify({ file_path: bigFile }));
  });
  assert.ok(JSON.parse(out).agent_message.includes(absoluteHelperCommand("bulk-read")));
});
