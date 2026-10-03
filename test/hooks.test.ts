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

test("read hook handles Cursor file_path and content payloads", async () => {
  const script = ".cursor/hooks/before-read-file.mjs";
  assert.equal((await hook(script, { file_path: "missing-but-provided-content.ts", content: "one\ntwo\nthree" })).permission, "deny");
  assert.equal((await hook(script, { file_path: "missing-but-provided-content.ts", content: "one\ntwo" })).permission, "allow");
  assert.equal((await hook(script, { file_path: "missing-but-provided-content.ts", content: "one\ntwo\nthree", offset: 1, limit: 1 })).permission, "allow");
});

test("preToolUse read payloads deny broad reads and honor nested ranges/content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "large.txt");
  await writeFile(path, "one\ntwo\nthree", "utf8");
  const script = ".cursor/hooks/before-read-file.mjs";

  assert.equal((await hook(script, {
    tool_name: "Read",
    tool_input: { file_path: path },
  })).permission, "deny");
  assert.equal((await hook(script, {
    tool_name: "read",
    tool_input: { file_path: "missing-but-provided-content.ts", content: "one\ntwo\nthree" },
  })).permission, "deny");
  assert.equal((await hook(script, {
    tool_name: "Read",
    tool_input: { file_path: path, offset: 2, limit: 1 },
  })).permission, "allow");
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

test("deny sends the route to the helper in both message fields with the real line limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "large.txt");
  await writeFile(path, "one\ntwo\nthree", "utf8");
  const result = await hook(".cursor/hooks/before-read-file.mjs", { tool_input: { path } });
  assert.equal(result.user_message, result.agent_message);
  assert.match(result.agent_message, /at least 3 lines/);
  assert.match(result.agent_message, /bulk-read\.ts/);
  assert.match(result.agent_message, /allow-edit\.mjs/);
});

test("allow-edit grants full reads of a large file until the grant expires", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "large.txt");
  const grants = join(directory, "grants.json");
  await writeFile(path, "one\ntwo\nthree", "utf8");
  const script = ".cursor/hooks/before-read-file.mjs";
  const env = { SHUNT_GRANTS_FILE: grants };

  assert.equal((await hook(script, { tool_name: "Read", tool_input: { file_path: path } }, env)).permission, "deny");
  await new Promise<void>((resolve, reject) => {
    execFile("node", [".cursor/hooks/allow-edit.mjs", path], { env: { ...process.env, ...env } }, (error) => (error ? reject(error) : resolve()));
  });
  assert.equal((await hook(script, { tool_name: "Read", tool_input: { file_path: path } }, env)).permission, "allow");
  assert.equal((await hook(script, { tool_name: "Read", tool_input: { file_path: path } }, { ...env, SHUNT_GRANTS_FILE: join(directory, "none.json") })).permission, "deny");
});

test("shell hook treats head/tail counts as targeted reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "large.txt");
  await writeFile(path, "one\ntwo\nthree", "utf8");
  const script = ".cursor/hooks/before-shell-execution.mjs";
  for (const command of [`head -n 2 ${path}`, `head -2 ${path}`, `tail -n +2 ${path}`, `head -c 100 ${path}`]) {
    assert.equal((await hook(script, { command })).permission, "allow", command);
  }
  assert.equal((await hook(script, { command: `cat -n ${path}` })).permission, "deny");
  assert.equal((await hook(script, { command: `tail ${path}` })).permission, "deny");
});

test("deny message points to sed for a section and not to a ranged Read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "large.txt");
  await writeFile(path, "one\ntwo\nthree", "utf8");
  const { agent_message } = await hook(".cursor/hooks/before-read-file.mjs", { tool_name: "Read", tool_input: { file_path: path } });
  assert.match(agent_message, /sed -n 'START,ENDp'/);
  assert.doesNotMatch(agent_message, /use a Read with offset and limit/);
});
