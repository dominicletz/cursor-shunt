import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FIXTURE_FILE_SPECS, writeFixture } from "../bench/generate-fixture.ts";
import { percentageSavings, sumTokenUsage } from "../bench/summary.ts";

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r?\n/).length;
}

test("fixture generator creates one large deterministic file per spec", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-fixture-"));
  try {
    const paths = await writeFixture(directory);
    assert.equal(paths.length, FIXTURE_FILE_SPECS.length);
    for (const [index, spec] of FIXTURE_FILE_SPECS.entries()) {
      const content = await readFile(paths[index], "utf8");
      assert.ok(lineCount(content) >= 350, `${spec.relativePath} should be at least 350 lines`);
      for (const pattern of spec.patterns) assert.match(content, new RegExp(pattern.replace(".", "\\.")));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("summary helpers add usage and calculate parent savings", () => {
  const total = sumTokenUsage([
    {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      totalTokens: 120,
      reasoningTokens: 5,
    },
    {
      inputTokens: 50,
      outputTokens: 10,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      totalTokens: 60,
    },
  ]);
  assert.deepEqual(total, {
    inputTokens: 150,
    outputTokens: 30,
    cacheReadTokens: 4,
    cacheWriteTokens: 6,
    totalTokens: 180,
    reasoningTokens: 5,
  });
  assert.equal(percentageSavings(1_000, 650), 35);
  assert.equal(percentageSavings(0, 0), undefined);
  assert.equal(sumTokenUsage([]), undefined);
});
