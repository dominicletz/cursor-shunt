import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixtureLineCount, FIXTURE_FILE_SPECS, SHUNT_MIN_LINES, writeFixture } from "../bench/generate-fixture.ts";
import { isBulkReadInvocation } from "../bench/routing.ts";
import { percentageSavings, sumTokenUsage } from "../bench/summary.ts";

test("fixture generator creates one large deterministic file per spec", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cursor-shunt-fixture-"));
  try {
    const paths = await writeFixture(directory);
    assert.equal(paths.length, FIXTURE_FILE_SPECS.length);
    for (const [index, spec] of FIXTURE_FILE_SPECS.entries()) {
      const content = await readFile(paths[index], "utf8");
      assert.ok(
        fixtureLineCount(content) >= SHUNT_MIN_LINES,
        `${spec.relativePath} should be at least ${SHUNT_MIN_LINES} lines`,
      );
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

test("bulk-read detection scans serialized tool arguments", () => {
  assert.equal(
    isBulkReadInvocation({ command: "npx tsx scripts/bulk-read.ts --question \"find auth\" --paths generated/a.ts" }),
    true,
  );
  assert.equal(
    isBulkReadInvocation({ input: { argv: ["npx", "tsx", "bulk-read.ts", "--paths", "generated/a.ts"] } }),
    true,
  );
  assert.equal(
    isBulkReadInvocation({ command: "npx tsx scripts/bulk_read.ts --paths generated/a.ts" }),
    true,
  );
  assert.equal(isBulkReadInvocation({ command: "npx tsx scripts/other.ts" }), false);
});
