import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, type AgentUsage, type RunResult, type SDKAgent } from "@cursor/sdk";
import {
  combineUsage,
  meanUsage,
  normalizeUsage,
  percentSavings,
  sumUsage,
  type UsageSnapshot,
  zeroUsage,
} from "./summary.js";
import {
  ensureFixture,
  FIXTURE_DIR,
  FIXTURE_FILE_PATHS,
  FIXTURE_MIN_LINES,
} from "./generate-fixture.js";

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(BENCH_DIR, ".runs");
const DEFAULT_PARENT_MODEL = "gpt-5.6-sol";
const TOOL_NAMES = ["read", "shell"] as const;
type Arm = "baseline" | "shunt";

type CostSnapshot = {
  rawCostCents: number;
  chargedCents: number;
};

type ToolObservation = {
  eventType: string;
  tool: string;
  path?: string;
  command?: string;
  status?: string;
  totalLines?: number;
  exitCode?: number;
};

type ArmRunResult = {
  arm: Arm;
  runNumber: number;
  model: string;
  status: string;
  error: string | null;
  answerCharacters: number;
  runUsage: UsageSnapshot | null;
  agentUsage: UsageSnapshot | null;
  parentUsage: UsageSnapshot;
  parentUsageAvailable: boolean;
  parentUsageSource: "agent.getUsage" | "result.usage" | "none";
  workerUsage: UsageSnapshot;
  workerUsageAvailable: boolean;
  cost: CostSnapshot | null;
  agentUsageError: string | null;
  observations: {
    toolCalls: ToolObservation[];
    attemptedLargeReadFiles: string[];
    fullLargeReadFiles: string[];
    bulkReadInvoked: boolean;
    bulkReadSucceeded: boolean;
    bulkReadFiles: string[];
  };
  validity: {
    valid: boolean;
    baselineReadAllLargeFiles: boolean;
    shuntDelegatedAllLargeFiles: boolean;
    shuntReadAllLargeFiles: boolean;
    shuntNoDelegationWithFullReads: boolean;
    reasons: string[];
  };
};

type CostAggregate = {
  runsWithCost: number;
  rawCostCents: number;
  chargedCents: number;
  meanRawCostCents: number;
  meanChargedCents: number;
} | null;

type ArmAggregate = {
  arm: Arm;
  runCount: number;
  validRunCount: number;
  meanParentUsage: UsageSnapshot;
  totalParentUsage: UsageSnapshot;
  meanWorkerUsage: UsageSnapshot;
  totalWorkerUsage: UsageSnapshot;
  meanTokensIncludingLuna: UsageSnapshot;
  totalTokensIncludingLuna: UsageSnapshot;
  cost: CostAggregate;
  runs: ArmRunResult[];
};

type BenchmarkSummary = {
  parentModel: string;
  runsRequested: number;
  fixtureFiles: string[];
  parentTokenSavingsPercent: number | null;
  totalParentTokens: {
    baseline: number;
    shunt: number;
  };
  totalTokensIncludingLuna: {
    baseline: number;
    shunt: number;
  };
  validity: {
    valid: boolean;
    baselineValidRuns: number;
    shuntValidRuns: number;
  };
  arms: {
    baseline: ArmAggregate;
    shunt: ArmAggregate;
  };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedRelativePath(workspace: string, path: string): string {
  return relative(workspace, resolve(workspace, path)).split("\\").join("/");
}

function costFromUsage(value: AgentUsage | undefined): CostSnapshot | null {
  const cost = value?.cost;
  if (
    !cost
    || !Number.isFinite(cost.rawCostCents)
    || !Number.isFinite(cost.chargedCents)
  ) {
    return null;
  }
  return {
    rawCostCents: cost.rawCostCents,
    chargedCents: cost.chargedCents,
  };
}

class ToolRecorder {
  readonly attemptedLargeReadFiles = new Set<string>();
  readonly fullLargeReadFiles = new Set<string>();
  readonly bulkReadFiles = new Set<string>();
  readonly toolCalls: ToolObservation[] = [];
  private readonly expectedFiles: readonly string[];
  private readonly workspace: string;
  private readonly lunaUsages: UsageSnapshot[] = [];
  private bulkReadInvokedValue = false;
  private bulkReadSucceededValue = false;

  constructor(workspace: string, expectedFiles: readonly string[] = FIXTURE_FILE_PATHS) {
    this.workspace = workspace;
    this.expectedFiles = expectedFiles;
  }

  get bulkReadInvoked(): boolean {
    return this.bulkReadInvokedValue;
  }

  get bulkReadSucceeded(): boolean {
    return this.bulkReadSucceededValue;
  }

  get workerUsage(): UsageSnapshot {
    return sumUsage(this.lunaUsages);
  }

  get workerUsageAvailable(): boolean {
    return this.lunaUsages.length > 0;
  }

  record(update: unknown): void {
    const updateRecord = asRecord(update);
    const eventType = stringValue(updateRecord?.type);
    const toolCall = asRecord(updateRecord?.toolCall);
    if (!eventType || !toolCall) return;

    const tool = stringValue(toolCall.type);
    if (!tool) return;
    const args = asRecord(toolCall.args);
    const result = asRecord(toolCall.result);
    const resultValue = asRecord(result?.value);
    const status = stringValue(result?.status);
    const path = stringValue(args?.path);
    const command = stringValue(args?.command);
    const totalLines = numberValue(resultValue?.totalLines);
    const exitCode = numberValue(resultValue?.exitCode);

    this.toolCalls.push({
      eventType,
      tool,
      ...(path ? { path } : {}),
      ...(command ? { command } : {}),
      ...(status ? { status } : {}),
      ...(totalLines !== undefined ? { totalLines } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
    });

    if (tool === "read" && path) {
      const relativePath = normalizedRelativePath(this.workspace, path);
      if (this.expectedFiles.includes(relativePath)) {
        this.attemptedLargeReadFiles.add(relativePath);
        if (
          status === "success"
          && (totalLines === undefined || totalLines >= FIXTURE_MIN_LINES)
        ) {
          this.fullLargeReadFiles.add(relativePath);
        }
      }
    }

    if (tool !== "shell" || !command) return;
    const isBulkRead = /bulk-read(?:\.ts)?/.test(command);
    if (!isBulkRead) return;

    this.bulkReadInvokedValue = true;
    for (const expectedFile of this.expectedFiles) {
      if (command.includes(expectedFile) || command.includes(join(this.workspace, expectedFile))) {
        this.bulkReadFiles.add(expectedFile);
      }
    }
    if (status === "success" && (exitCode === undefined || exitCode === 0)) {
      this.bulkReadSucceededValue = true;
    }

    if (eventType === "tool-call-completed") {
      this.captureWorkerUsage(stringValue(resultValue?.stderr));
    }
  }

  private captureWorkerUsage(stderr: string | undefined): void {
    if (!stderr) return;
    for (const match of stderr.matchAll(/token_usage=({[^\r\n]*})/g)) {
      try {
        const usage = normalizeUsage(JSON.parse(match[1]));
        if (usage) this.lunaUsages.push(usage);
      } catch {
        // A backend may redact or format the diagnostic differently.
      }
    }
  }
}

function allExpectedFiles(files: ReadonlySet<string>): boolean {
  return FIXTURE_FILE_PATHS.every((path) => files.has(path));
}

function sortPaths(paths: ReadonlySet<string>): string[] {
  return [...paths].sort();
}

function validityFor(
  arm: Arm,
  recorder: ToolRecorder,
  status: string,
): ArmRunResult["validity"] {
  const baselineReadAllLargeFiles = allExpectedFiles(recorder.fullLargeReadFiles);
  const shuntDelegatedAllLargeFiles = recorder.bulkReadSucceeded
    && FIXTURE_FILE_PATHS.every((path) => recorder.bulkReadFiles.has(path));
  const shuntReadAllLargeFiles = baselineReadAllLargeFiles;
  const shuntNoDelegationWithFullReads = arm === "shunt"
    && !recorder.bulkReadInvoked
    && shuntReadAllLargeFiles;
  const reasons: string[] = [];

  if (arm === "baseline" && !baselineReadAllLargeFiles) {
    reasons.push("baseline did not successfully Read every large fixture file");
  }
  if (arm === "shunt" && !recorder.bulkReadInvoked) {
    reasons.push("shunt did not invoke scripts/bulk-read.ts");
  }
  if (arm === "shunt" && recorder.bulkReadInvoked && !recorder.bulkReadSucceeded) {
    reasons.push("bulk-read was invoked but did not complete successfully");
  }
  if (arm === "shunt" && recorder.bulkReadInvoked && !shuntDelegatedAllLargeFiles) {
    reasons.push("bulk-read did not receive all large fixture files");
  }
  if (arm === "shunt" && shuntReadAllLargeFiles) {
    reasons.push("shunt successfully Read every large fixture file");
  }
  if (status !== "finished") reasons.push(`parent run ended with status ${status}`);

  return {
    valid: reasons.length === 0,
    baselineReadAllLargeFiles,
    shuntDelegatedAllLargeFiles,
    shuntReadAllLargeFiles,
    shuntNoDelegationWithFullReads,
    reasons,
  };
}

async function runArm(
  arm: Arm,
  runNumber: number,
  fixtureDir: string,
  prompt: string,
  parentModel: string,
): Promise<ArmRunResult> {
  const workspace = join(RUNS_DIR, `${arm}-${runNumber}-${randomUUID()}`);
  const recorder = new ToolRecorder(workspace);
  let agent: SDKAgent | undefined;
  let response: RunResult | undefined;
  let runError: string | null = null;
  let usage: AgentUsage | undefined;
  let agentUsageError: string | null = null;

  try {
    await mkdir(RUNS_DIR, { recursive: true });
    await cp(fixtureDir, workspace, { recursive: true });
    agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: parentModel },
      tools: [...TOOL_NAMES],
      local: {
        cwd: workspace,
        settingSources: arm === "baseline" ? [] : ["project"],
      },
    });

    try {
      const run = await agent.send(prompt, {
        onDelta: ({ update }) => recorder.record(update),
      });
      response = await run.wait();
      if (response.status !== "finished") {
        runError = response.error?.message ?? `run ended with status ${response.status}`;
      }
    } catch (error) {
      runError = errorMessage(error);
    }

    try {
      usage = await agent.getUsage();
    } catch (error) {
      agentUsageError = errorMessage(error);
    }
  } catch (error) {
    runError = errorMessage(error);
  } finally {
    agent?.close();
    await rm(workspace, { force: true, recursive: true });
  }

  const runUsage = normalizeUsage(response?.usage) ?? null;
  const agentUsageSnapshot = normalizeUsage(usage?.usage) ?? null;
  const parentUsage = agentUsageSnapshot ?? runUsage ?? zeroUsage();
  const parentUsageAvailable = agentUsageSnapshot !== null || runUsage !== null;
  const parentUsageSource = agentUsageSnapshot !== null
    ? "agent.getUsage"
    : runUsage !== null
      ? "result.usage"
      : "none";
  const status = response?.status ?? "error";
  const validity = validityFor(arm, recorder, status);

  if (runError && !validity.reasons.includes(runError)) validity.reasons.push(runError);
  validity.valid = validity.reasons.length === 0;

  return {
    arm,
    runNumber,
    model: parentModel,
    status,
    error: runError,
    answerCharacters: response?.result?.length ?? 0,
    runUsage,
    agentUsage: agentUsageSnapshot,
    parentUsage,
    parentUsageAvailable,
    parentUsageSource,
    workerUsage: recorder.workerUsage,
    workerUsageAvailable: recorder.workerUsageAvailable,
    cost: costFromUsage(usage),
    agentUsageError,
    observations: {
      toolCalls: recorder.toolCalls,
      attemptedLargeReadFiles: sortPaths(recorder.attemptedLargeReadFiles),
      fullLargeReadFiles: sortPaths(recorder.fullLargeReadFiles),
      bulkReadInvoked: recorder.bulkReadInvoked,
      bulkReadSucceeded: recorder.bulkReadSucceeded,
      bulkReadFiles: sortPaths(recorder.bulkReadFiles),
    },
    validity,
  };
}

function costAggregate(runs: readonly ArmRunResult[]): CostAggregate {
  const costs = runs.flatMap((run) => run.cost ? [run.cost] : []);
  if (costs.length === 0) return null;
  const rawCostCents = costs.reduce((total, cost) => total + cost.rawCostCents, 0);
  const chargedCents = costs.reduce((total, cost) => total + cost.chargedCents, 0);
  return {
    runsWithCost: costs.length,
    rawCostCents,
    chargedCents,
    meanRawCostCents: rawCostCents / costs.length,
    meanChargedCents: chargedCents / costs.length,
  };
}

function aggregateArm(arm: Arm, runs: ArmRunResult[]): ArmAggregate {
  const combined = runs.map((run) => combineUsage(run.parentUsage, run.workerUsage));
  return {
    arm,
    runCount: runs.length,
    validRunCount: runs.filter((run) => run.validity.valid).length,
    meanParentUsage: meanUsage(runs.map((run) => run.parentUsage)),
    totalParentUsage: sumUsage(runs.map((run) => run.parentUsage)),
    meanWorkerUsage: meanUsage(runs.map((run) => run.workerUsage)),
    totalWorkerUsage: sumUsage(runs.map((run) => run.workerUsage)),
    meanTokensIncludingLuna: meanUsage(combined),
    totalTokensIncludingLuna: sumUsage(combined),
    cost: costAggregate(runs),
    runs,
  };
}

function buildSummary(parentModel: string, runsRequested: number, runs: ArmRunResult[]): BenchmarkSummary {
  const baseline = aggregateArm("baseline", runs.filter((run) => run.arm === "baseline"));
  const shunt = aggregateArm("shunt", runs.filter((run) => run.arm === "shunt"));
  return {
    parentModel,
    runsRequested,
    fixtureFiles: [...FIXTURE_FILE_PATHS],
    parentTokenSavingsPercent: percentSavings(
      baseline.totalParentUsage.totalTokens,
      shunt.totalParentUsage.totalTokens,
    ),
    totalParentTokens: {
      baseline: baseline.totalParentUsage.totalTokens,
      shunt: shunt.totalParentUsage.totalTokens,
    },
    totalTokensIncludingLuna: {
      baseline: baseline.totalTokensIncludingLuna.totalTokens,
      shunt: shunt.totalTokensIncludingLuna.totalTokens,
    },
    validity: {
      valid: baseline.validRunCount === runsRequested && shunt.validRunCount === runsRequested,
      baselineValidRuns: baseline.validRunCount,
      shuntValidRuns: shunt.validRunCount,
    },
    arms: { baseline, shunt },
  };
}

function displayTokens(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function displayCost(value: number | undefined): string {
  return value === undefined ? "n/a" : `$${(value / 100).toFixed(4)}`;
}

function displaySavings(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)}%`;
}

function formatMarkdown(summary: BenchmarkSummary): string {
  const { baseline, shunt } = summary.arms;
  const lines = [
    "# cursor-shunt SDK A/B benchmark",
    "",
    `Parent model: \`${summary.parentModel}\` · requested runs: ${summary.runsRequested}`,
    "",
    "| arm | mean input | mean output | mean cache read | mean cache write | mean parent total | mean total incl. Luna | charged cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| baseline | ${displayTokens(baseline.meanParentUsage.inputTokens)} | ${displayTokens(baseline.meanParentUsage.outputTokens)} | ${displayTokens(baseline.meanParentUsage.cacheReadTokens)} | ${displayTokens(baseline.meanParentUsage.cacheWriteTokens)} | ${displayTokens(baseline.meanParentUsage.totalTokens)} | ${displayTokens(baseline.meanTokensIncludingLuna.totalTokens)} | ${displayCost(baseline.cost?.meanChargedCents)} |`,
    `| shunt | ${displayTokens(shunt.meanParentUsage.inputTokens)} | ${displayTokens(shunt.meanParentUsage.outputTokens)} | ${displayTokens(shunt.meanParentUsage.cacheReadTokens)} | ${displayTokens(shunt.meanParentUsage.cacheWriteTokens)} | ${displayTokens(shunt.meanParentUsage.totalTokens)} | ${displayTokens(shunt.meanTokensIncludingLuna.totalTokens)} | ${displayCost(shunt.cost?.meanChargedCents)} |`,
    "",
    `Parent-token savings (baseline → shunt): **${displaySavings(summary.parentTokenSavingsPercent)}**`,
    `Total parent tokens across runs: baseline ${displayTokens(summary.totalParentTokens.baseline)}, shunt ${displayTokens(summary.totalParentTokens.shunt)}`,
    `Total tokens including Luna across runs: baseline ${displayTokens(summary.totalTokensIncludingLuna.baseline)}, shunt ${displayTokens(summary.totalTokensIncludingLuna.shunt)}`,
    "",
    "## Validity",
    "",
    `Overall: **${summary.validity.valid ? "VALID" : "INVALID"}** · baseline ${summary.validity.baselineValidRuns}/${summary.runsRequested} valid · shunt ${summary.validity.shuntValidRuns}/${summary.runsRequested} valid`,
    "",
    "| arm | run | status | full large Reads | bulk-read | worker usage | validity |",
    "| --- | ---: | --- | ---: | --- | ---: | --- |",
  ];

  for (const run of [...baseline.runs, ...shunt.runs]) {
    lines.push(
      `| ${run.arm} | ${run.runNumber} | ${run.status} | ${run.observations.fullLargeReadFiles.length}/${FIXTURE_FILE_PATHS.length} | ${run.observations.bulkReadInvoked ? (run.observations.bulkReadSucceeded ? "yes" : "failed") : "no"} | ${displayTokens(run.workerUsage.totalTokens)} | ${run.validity.valid ? "VALID" : `INVALID: ${run.validity.reasons.join("; ")}`} |`,
    );
  }

  lines.push(
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
  );
  return lines.join("\n");
}

function parseRuns(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: npm run bench:ab -- --runs N");
    console.log("Paid/live benchmark. Requires CURSOR_API_KEY.");
    process.exit(0);
  }

  const index = argv.indexOf("--runs");
  if (index === -1) return 1;
  const value = argv[index + 1];
  const runs = Number(value);
  if (!value || !Number.isSafeInteger(runs) || runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return runs;
}

async function main(): Promise<void> {
  if (!process.env.CURSOR_API_KEY?.trim()) {
    throw new Error("CURSOR_API_KEY is required for the paid SDK benchmark");
  }

  const parentModel = process.env.BENCH_PARENT_MODEL?.trim() || DEFAULT_PARENT_MODEL;
  if (parentModel.toLowerCase().includes("auto")) {
    throw new Error("BENCH_PARENT_MODEL must be a concrete model ID; Auto is not supported");
  }

  const runsRequested = parseRuns(process.argv.slice(2));
  const fixtureDir = await ensureFixture(FIXTURE_DIR);
  const prompt = (await readFile(join(fixtureDir, "PROMPT.md"), "utf8")).trim();
  const results: ArmRunResult[] = [];

  for (let runNumber = 1; runNumber <= runsRequested; runNumber += 1) {
    for (const arm of ["baseline", "shunt"] as const) {
      console.error(`Running ${arm} arm ${runNumber}/${runsRequested} with ${parentModel}...`);
      results.push(await runArm(
        arm,
        runNumber,
        fixtureDir,
        prompt,
        parentModel,
      ));
    }
  }

  const summary = buildSummary(parentModel, runsRequested, results);
  console.log(formatMarkdown(summary));
  if (!summary.validity.valid) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`bench:ab: ${errorMessage(error)}`);
  process.exitCode = 1;
});
