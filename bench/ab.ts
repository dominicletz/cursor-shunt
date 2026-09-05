import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Agent, type AgentUsage } from "@cursor/sdk";
import { DEFAULT_OUTPUT_DIRECTORY, FIXTURE_FILE_SPECS, SHUNT_MIN_LINES, writeFixture } from "./generate-fixture.js";
import {
  percentageSavings,
  sumCost,
  sumTokenUsage,
  type TokenUsage,
  type UsageCost,
} from "./summary.js";
import { isBulkReadInvocation } from "./routing.js";

export { isBulkReadInvocation };

const DEFAULT_PARENT_MODEL = "gpt-5.6-sol";
const REPO_ROOT = resolve(process.cwd());
const FIXTURE_ROOT = resolve(REPO_ROOT, "bench/fixture");
const PROMPT_PATH = join(FIXTURE_ROOT, "PROMPT.md");
const EXPECTED_LARGE_FILE_COUNT = FIXTURE_FILE_SPECS.length;
const GENERATED_PATHS = FIXTURE_FILE_SPECS.map((spec) => `generated/${spec.relativePath}`);
const BULK_READ_QUESTION = "Find every db.query and authenticate occurrence by file, symbol, and line number.";
const SHUNT_REQUIRED_INSTRUCTION = [
  "Mandatory shunt routing: after any denied large read (or instead of broad reads), you MUST run exactly:",
  `npx tsx scripts/bulk-read.ts --question "${BULK_READ_QUESTION}" --paths ${GENERATED_PATHS.join(" ")}`,
  "Do not finish without that helper call.",
].join("\n");
const DEFAULT_FAILURE_OUTPUT = resolve(REPO_ROOT, "bench/results/bench-failure.json");

type Arm = "baseline" | "shunt";

interface Options {
  runs: number;
  output?: string;
}

interface ToolCall {
  name: string;
  args: unknown;
  result: unknown;
}

interface RoutingEvidence {
  toolCallCount: number;
  toolNames: string[];
  largeReadCallCount: number;
  largeReadFiles: string[];
  deniedLargeReadCallCount: number;
  successfulLargeReadCallCount: number;
  bulkReadCallCount: number;
}

interface ArmReport {
  arm: Arm;
  run: number;
  parentResultUsage: TokenUsage | null;
  parentAgentUsage: TokenUsage | null;
  parentTokens: number | null;
  lunaWorkerUsage: TokenUsage | null;
  lunaWorkerTokens: number | null;
  parentCost: UsageCost | null;
  getUsageError: string | null;
  routing: RoutingEvidence;
}

interface BenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  parentModel: string;
  runs: number;
  fixtureFiles: string[];
  arms: ArmReport[];
  failure?: {
    arm: Arm | null;
    run: number | null;
    error: string;
    routing: RoutingEvidence | null;
  };
  summary: {
    baselineParentTokens: number | null;
    shuntParentTokens: number | null;
    parentSavingsPercent: number | null;
    baselineLunaWorkerTokens: number | null;
    shuntLunaWorkerTokens: number | null;
    parentChargedCents: number | null;
    totalChargedCents: number | null;
    costNote: string;
  };
}

class RoutingCheckError extends Error {
  constructor(
    message: string,
    readonly evidence: RoutingEvidence,
  ) {
    super(`${message}; routing evidence: ${JSON.stringify(evidence)}`);
    this.name = "RoutingCheckError";
  }
}

class BenchmarkRunError extends Error {
  constructor(
    readonly arm: Arm,
    readonly runNumber: number,
    message: string,
    readonly routing: RoutingEvidence | null,
  ) {
    super(`bench:ab ${arm} run ${runNumber}: ${message}`);
    this.name = "BenchmarkRunError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secret = process.env.CURSOR_API_KEY;
  return secret ? message.replaceAll(secret, "[REDACTED]") : message;
}

function parseOptions(argv: string[]): Options {
  let runs = 1;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm run bench:ab -- --runs N [--output bench/results/summary.json]");
      process.exit(0);
    }
    if (argument === "--runs" || argument.startsWith("--runs=")) {
      const value = argument === "--runs" ? argv[++index] : argument.slice("--runs=".length);
      if (!value || !/^[1-9]\d*$/.test(value)) throw new Error("--runs must be a positive integer");
      runs = Number(value);
      continue;
    }
    if (argument === "--output" || argument.startsWith("--output=")) {
      output = argument === "--output" ? argv[++index] : argument.slice("--output=".length);
      if (!output) throw new Error("--output requires a path");
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return { runs, output };
}

function requireApiKey(): string {
  const value = process.env.CURSOR_API_KEY;
  if (!value) {
    throw new Error(
      "CURSOR_API_KEY is required for the live benchmark. Export your own key locally or configure the GitHub Actions repository secret.",
    );
  }
  return value;
}

function parentModel(): string {
  return process.env.BENCH_PARENT_MODEL?.trim() || DEFAULT_PARENT_MODEL;
}

function promptForArm(arm: Arm, prompt: string): string {
  if (arm === "baseline") return prompt;
  return `${prompt.trimEnd()}\n\n${SHUNT_REQUIRED_INSTRUCTION}\n`;
}

async function verifyShuntWorkspace(workspace: string): Promise<void> {
  const hooks = JSON.parse(await readFile(join(workspace, ".cursor", "hooks.json"), "utf8")) as unknown;
  const configuredHooks = isRecord(hooks) && isRecord(hooks.hooks) ? hooks.hooks.beforeReadFile : undefined;
  const hasBeforeReadFile = Array.isArray(configuredHooks)
    && configuredHooks.some((entry: unknown) => (
      isRecord(entry)
      && typeof entry.command === "string"
      && entry.command.includes("before-read-file.mjs")
    ));
  if (!hasBeforeReadFile) {
    throw new Error("shunt workspace is missing the .cursor beforeReadFile hook");
  }
  await readFile(join(workspace, ".cursor", "hooks", "before-read-file.mjs"), "utf8");
}

async function prepareWorkspace(arm: Arm, fixtureDirectory: string, runNumber: number): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), `cursor-shunt-bench-${arm}-${runNumber}-`));
  try {
    await cp(join(FIXTURE_ROOT, "PROMPT.md"), join(workspace, "PROMPT.md"));
    await cp(fixtureDirectory, join(workspace, "generated"), { recursive: true });

    if (arm === "shunt") {
      await cp(join(REPO_ROOT, ".cursor"), join(workspace, ".cursor"), { recursive: true });
      await cp(join(REPO_ROOT, "scripts"), join(workspace, "scripts"), { recursive: true });
      await cp(join(REPO_ROOT, "package.json"), join(workspace, "package.json"));
      await symlink(join(REPO_ROOT, "node_modules"), join(workspace, "node_modules"), "dir");
      await verifyShuntWorkspace(workspace);
    }

    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

function tokenUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const fields = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"];
  if (!fields.every((field) => typeof value[field] === "number" && Number.isFinite(value[field]))) return undefined;
  return {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    cacheReadTokens: value.cacheReadTokens as number,
    cacheWriteTokens: value.cacheWriteTokens as number,
    totalTokens: value.totalTokens as number,
    ...(typeof value.reasoningTokens === "number" ? { reasoningTokens: value.reasoningTokens } : {}),
  };
}

function toolCallFrom(value: Record<string, unknown>): ToolCall | undefined {
  if (value.type === "tool_call" && typeof value.name === "string") {
    return { name: value.name, args: value.args, result: value.result };
  }
  if (value.type === "toolCall" && isRecord(value.message) && typeof value.message.type === "string") {
    return {
      name: value.message.type,
      args: value.message.args,
      result: value.message.result,
    };
  }
  return undefined;
}

function collectToolCalls(value: unknown, calls: ToolCall[], seen: Set<object>): void {
  if (!isRecord(value) && !Array.isArray(value)) return;
  const objectValue = value as object;
  if (seen.has(objectValue)) return;
  seen.add(objectValue);

  if (isRecord(value)) {
    const call = toolCallFrom(value);
    if (call) calls.push(call);
    for (const child of Object.values(value)) collectToolCalls(child, calls, seen);
  } else {
    for (const child of value) collectToolCalls(child, calls, seen);
  }
}

function collectStrings(value: unknown, strings: string[], seen: Set<object>): void {
  if (typeof value === "string") {
    strings.push(value);
    return;
  }
  if (!isRecord(value) && !Array.isArray(value)) return;
  const objectValue = value as object;
  if (seen.has(objectValue)) return;
  seen.add(objectValue);
  if (isRecord(value)) {
    for (const child of Object.values(value)) collectStrings(child, strings, seen);
  } else {
    for (const child of value) collectStrings(child, strings, seen);
  }
}

function pathFrom(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  for (const key of ["path", "file_path", "filePath"]) {
    if (typeof args[key] === "string") return args[key];
  }
  return undefined;
}

function fixturePathKey(path: string): string | undefined {
  for (const spec of FIXTURE_FILE_SPECS) {
    if (
      path === `generated/${spec.relativePath}`
      || path.endsWith(`/generated/${spec.relativePath}`)
      || path.endsWith(`\\generated\\${spec.relativePath.replaceAll("/", "\\")}`)
    ) {
      return spec.relativePath;
    }
  }
  return undefined;
}

function isDeniedLargeRead(call: ToolCall): boolean {
  const text = JSON.stringify(call).toLowerCase();
  return text.includes("permission\":\"deny")
    || text.includes("large-file")
    || text.includes("shunt_min_lines")
    || text.includes("large file");
}

function inspectRouting(transcript: unknown[]): RoutingEvidence {
  const calls: ToolCall[] = [];
  collectToolCalls(transcript, calls, new Set<object>());
  const largeReadFiles = new Set<string>();
  let largeReadCallCount = 0;
  let deniedLargeReadCallCount = 0;
  let bulkReadCallCount = 0;

  for (const call of calls) {
    const name = call.name.toLowerCase();
    if (name === "read" || name.includes("read_file")) {
      const path = pathFrom(call.args);
      const fixturePath = path ? fixturePathKey(path) : undefined;
      if (fixturePath) {
        largeReadCallCount += 1;
        largeReadFiles.add(fixturePath);
        if (isDeniedLargeRead(call)) deniedLargeReadCallCount += 1;
      }
    }
    if ((name === "shell" || name.includes("shell")) && isBulkReadInvocation(call.args)) {
      bulkReadCallCount += 1;
    }
  }

  return {
    toolCallCount: calls.length,
    toolNames: [...new Set(calls.map((call) => call.name))],
    largeReadCallCount,
    largeReadFiles: [...largeReadFiles].sort(),
    deniedLargeReadCallCount,
    successfulLargeReadCallCount: largeReadCallCount - deniedLargeReadCallCount,
    bulkReadCallCount,
  };
}

function workerUsages(transcript: unknown[]): TokenUsage[] {
  const strings: string[] = [];
  collectStrings(transcript, strings, new Set<object>());
  const usages: TokenUsage[] = [];
  for (const text of strings) {
    for (const match of text.matchAll(/token_usage=(\{[^\n]*\})/g)) {
      try {
        const usage = tokenUsage(JSON.parse(match[1]));
        if (usage) usages.push(usage);
      } catch {
        // Ignore unrelated command output; routing and parent usage remain useful.
      }
    }
  }
  return usages;
}

function assertRouting(arm: Arm, routing: RoutingEvidence): void {
  if (arm === "baseline") {
    if (
      routing.largeReadFiles.length !== EXPECTED_LARGE_FILE_COUNT
      || routing.successfulLargeReadCallCount < EXPECTED_LARGE_FILE_COUNT
    ) {
      throw new RoutingCheckError(
        `baseline routing check failed: expected successful reads of ${EXPECTED_LARGE_FILE_COUNT} large files, observed ${routing.largeReadFiles.length} files and ${routing.successfulLargeReadCallCount} successful reads`,
        routing,
      );
    }
    return;
  }

  if (routing.bulkReadCallCount === 0) {
    throw new RoutingCheckError("shunt routing check failed: no bulk-read helper call was present in the parent transcript", routing);
  }
  if (routing.successfulLargeReadCallCount !== 0) {
    throw new RoutingCheckError(
      `shunt routing check failed: observed ${routing.successfulLargeReadCallCount} successful large-file reads`,
      routing,
    );
  }
}

function aggregateComplete(values: ReadonlyArray<number | null>): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function reportUsage(usage: AgentUsage | undefined): TokenUsage | null {
  return usage?.usage ? tokenUsage(usage.usage) ?? null : null;
}

async function runArm(
  arm: Arm,
  runNumber: number,
  prompt: string,
  fixtureDirectory: string,
  apiKey: string,
): Promise<ArmReport> {
  const workspace = await prepareWorkspace(arm, fixtureDirectory, runNumber);
  const previousThreshold = process.env.SHUNT_MIN_LINES;
  if (arm === "shunt") process.env.SHUNT_MIN_LINES = String(SHUNT_MIN_LINES);
  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  const agentPrompt = promptForArm(arm, prompt);

  try {
    agent = await Agent.create({
      apiKey,
      model: { id: parentModel() },
      tools: ["read", "shell", "glob", "grep"],
      local: {
        cwd: workspace,
        dirs: [workspace],
        settingSources: arm === "shunt" ? ["project"] : [],
      },
      name: `cursor-shunt-benchmark-${arm}-${runNumber}`,
    });
    const run = await agent.send(agentPrompt);
    const response = await run.wait();
    const transcript = await run.conversation();
    let usage: AgentUsage | undefined;
    let getUsageError: string | null = null;
    try {
      usage = await agent.getUsage();
    } catch (error) {
      getUsageError = errorMessage(error);
    }

    if (response.status === "error") {
      throw new Error(response.error?.message ?? "parent agent run failed");
    }

    const routing = inspectRouting(transcript);
    assertRouting(arm, routing);
    const workerUsage = sumTokenUsage(workerUsages(transcript));
    const parentResultUsage = tokenUsage(response.usage) ?? null;
    const parentAgentUsage = reportUsage(usage);
    const selectedParentUsage = parentResultUsage ?? parentAgentUsage;

    return {
      arm,
      run: runNumber,
      parentResultUsage,
      parentAgentUsage,
      parentTokens: selectedParentUsage?.totalTokens ?? null,
      lunaWorkerUsage: workerUsage ?? null,
      lunaWorkerTokens: workerUsage?.totalTokens ?? null,
      parentCost: usage?.cost ?? null,
      getUsageError,
      routing,
    };
  } catch (error) {
    const routing = error instanceof RoutingCheckError ? error.evidence : null;
    throw new BenchmarkRunError(arm, runNumber, errorMessage(error), routing);
  } finally {
    agent?.close();
    if (previousThreshold === undefined) {
      delete process.env.SHUNT_MIN_LINES;
    } else {
      process.env.SHUNT_MIN_LINES = previousThreshold;
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

function summarize(arms: ArmReport[]): BenchmarkReport["summary"] {
  const baseline = arms.filter((report) => report.arm === "baseline");
  const shunt = arms.filter((report) => report.arm === "shunt");
  const baselineParentTokens = aggregateComplete(baseline.map((report) => report.parentTokens));
  const shuntParentTokens = aggregateComplete(shunt.map((report) => report.parentTokens));
  const baselineLunaWorkerTokens = aggregateComplete(baseline.map((report) => report.lunaWorkerTokens));
  const shuntLunaWorkerTokens = aggregateComplete(shunt.map((report) => report.lunaWorkerTokens));
  const parentCosts = sumCost(
    arms.map((report) => report.parentCost ?? undefined),
  );

  return {
    baselineParentTokens,
    shuntParentTokens,
    parentSavingsPercent: percentageSavings(baselineParentTokens ?? undefined, shuntParentTokens ?? undefined) ?? null,
    baselineLunaWorkerTokens,
    shuntLunaWorkerTokens,
    parentChargedCents: parentCosts?.chargedCents ?? null,
    totalChargedCents: null,
    costNote: "Total cost is null because the helper worker's billed cost is not exposed by its parent transcript.",
  };
}

async function writeReport(report: BenchmarkReport, outputPath: string | undefined): Promise<string> {
  const serialized = JSON.stringify(report, null, 2);
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${serialized}\n`, "utf8");
  }
  return serialized;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  let fixturePaths: string[] = [];
  const arms: ArmReport[] = [];

  try {
    const apiKey = requireApiKey();
    fixturePaths = await writeFixture(DEFAULT_OUTPUT_DIRECTORY);
    const prompt = await readFile(PROMPT_PATH, "utf8");

    for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
      arms.push(await runArm("baseline", runNumber, prompt, DEFAULT_OUTPUT_DIRECTORY, apiKey));
      arms.push(await runArm("shunt", runNumber, prompt, DEFAULT_OUTPUT_DIRECTORY, apiKey));
    }

    const report: BenchmarkReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      parentModel: parentModel(),
      runs: options.runs,
      fixtureFiles: fixturePaths.map((path) => path.replace(`${DEFAULT_OUTPUT_DIRECTORY}/`, "")),
      arms,
      summary: summarize(arms),
    };
    const outputPath = options.output ? resolve(process.cwd(), options.output) : undefined;
    const serialized = await writeReport(report, outputPath);
    console.log(serialized);
  } catch (error) {
    const runError = error instanceof BenchmarkRunError ? error : undefined;
    const failureReport: BenchmarkReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      parentModel: parentModel(),
      runs: options.runs,
      fixtureFiles: fixturePaths.map((path) => path.replace(`${DEFAULT_OUTPUT_DIRECTORY}/`, "")),
      arms,
      failure: {
        arm: runError?.arm ?? null,
        run: runError?.runNumber ?? null,
        error: errorMessage(error),
        routing: runError?.routing ?? null,
      },
      summary: summarize(arms),
    };
    const failureOutput = options.output
      ? resolve(process.cwd(), options.output)
      : DEFAULT_FAILURE_OUTPUT;
    try {
      await writeReport(failureReport, failureOutput);
      console.error(`bench:ab: failure summary written to ${failureOutput}`);
    } catch (writeError) {
      console.error(`bench:ab: could not write failure summary: ${errorMessage(writeError)}`);
    }
    throw error;
  }
}

if (process.argv[1]?.endsWith("bench/ab.ts")) {
  main().catch((error) => {
    console.error(`bench:ab: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
