import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import test from "node:test";
import { lineCount } from "../.cursor/hooks/common.mjs";

async function hook(script: string, payload: object, env: NodeJS.ProcessEnv = {}) {
  const result = await new Promise<{ stdout: string }>((resolve, reject) => {
    const child = execFile("node", [script], { env: { ...process.env, SHUNT_MIN_LINES: "3", ...env }, cwd: process.cwd(), shell: false }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}: ${stderr}`));
      else resolve({ stdout });
    });
    child.stdin?.end(JSON.stringify(payload));
  });
  return JSON.parse(result.stdout);
}

test("lineCount handles newline styles", () => {
  assert.equal(lineCount("a\nb\nc"), 3);
  assert.equal(lineCount("a\r\nb"), 2);
});

test("read hook denies broad large reads and allows targeted reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "large.txt");
  await writeFile(path, "one\ntwo\nthree", "utf8");
  const script = ".cursor/hooks/before-read-file.mjs";
  assert.equal((await hook(script, { tool_input: { path } })).permission, "deny");
  assert.equal((await hook(script, { tool_input: { path, offset: 2, limit: 1 } })).permission, "allow");
});

test("shell hook denies cat/head of large files but allows pipes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "large.txt");
  await writeFile(path, "one\ntwo\nthree", "utf8");
  const script = ".cursor/hooks/before-shell-execution.mjs";
  assert.equal((await hook(script, { command: `cat ${path}` })).permission, "deny");
  assert.equal((await hook(script, { command: `head ${path}` })).permission, "deny");
  assert.equal((await hook(script, { command: `cat ${path} | rg two` })).permission, "allow");
});
