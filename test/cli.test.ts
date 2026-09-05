import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { args, escapeXml, fileXml, first, stripFences } from "../scripts/cli.ts";

test("parses repeated CLI options and positional values", () => {
  const parsed = args(["--question", "find", "auth", "--paths", "a.ts", "b.ts", "--target", "out.ts"]);
  assert.equal(first(parsed, "question"), "find");
  assert.deepEqual(parsed.get("paths"), ["a.ts", "b.ts"]);
  assert.equal(first(parsed, "target"), "out.ts");
});

test("escapes and wraps file bodies as XML", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-"));
  const path = join(directory, "example.ts");
  await writeFile(path, "plain & text\n", "utf8");
  const xml = await fileXml([path]);
  assert.match(xml, /<file path=".*example\.ts">/);
  assert.match(xml, /plain & text/);
  assert.equal(escapeXml('"x"'), "&quot;x&quot;");
});

test("strips optional markdown fences", () => {
  assert.equal(stripFences("```ts\nconst answer = 1;\n```"), "const answer = 1;\n");
  assert.equal(stripFences("const answer = 1;"), "const answer = 1;\n");
});
