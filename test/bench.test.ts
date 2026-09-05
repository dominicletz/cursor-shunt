import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ensureFixture,
  FIXTURE_FILE_PATHS,
  FIXTURE_MIN_LINES,
} from "../bench/generate-fixture.ts";
import {
  addUsage,
  combineUsage,
  meanUsage,
  percentSavings,
  sumUsage,
  type UsageSnapshot,
} from "../bench/summary.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("fixture generation creates every large source and integration copy", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "cursor-shunt-bench-"));
  try {
    await ensureFixture(fixtureDir, repositoryRoot);
    assert.match(await readFile(join(fixtureDir, "PROMPT.md"), "utf8"), /db\.query/);
    assert.ok(await readFile(join(fixtureDir, ".cursor", "hooks.json"), "utf8"));
    assert.ok(await readFile(join(fixtureDir, "scripts", "bulk-read.ts"), "utf8"));

    for (const relativePath of FIXTURE_FILE_PATHS) {
      const content = await readFile(join(fixtureDir, relativePath), "utf8");
      assert.ok(content.split(/\r?\n/).length - 1 >= FIXTURE_MIN_LINES);
      assert.match(content, /db\.query/);
    }
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("summary helpers calculate totals, means, combined usage, and savings", () => {
  const first: UsageSnapshot = {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 10,
    cacheWriteTokens: 2,
    totalTokens: 120,
    reasoningTokens: 5,
  };
  const second: UsageSnapshot = {
    inputTokens: 300,
    outputTokens: 40,
    cacheReadTokens: 30,
    cacheWriteTokens: 4,
    totalTokens: 340,
    reasoningTokens: 7,
  };

  assert.deepEqual(sumUsage([first, second]), {
    inputTokens: 400,
    outputTokens: 60,
    cacheReadTokens: 40,
    cacheWriteTokens: 6,
    totalTokens: 460,
    reasoningTokens: 12,
  });
  assert.deepEqual(meanUsage([first, second]), {
    inputTokens: 200,
    outputTokens: 30,
    cacheReadTokens: 20,
    cacheWriteTokens: 3,
    totalTokens: 230,
    reasoningTokens: 6,
  });
  assert.deepEqual(addUsage(first, second), combineUsage(first, second));
  assert.equal(percentSavings(1_000, 250), 75);
  assert.equal(percentSavings(0, 0), null);
});
