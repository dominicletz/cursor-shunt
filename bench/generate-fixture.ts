import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const DEFAULT_OUTPUT_DIRECTORY = resolve(process.cwd(), "bench/fixture/generated");
export const RECORD_COUNT = 180;
export const SHUNT_MIN_LINES = 350;

export const FIXTURE_FILE_SPECS = [
  {
    relativePath: "apps/api/src/data/user-repository.ts",
    symbol: "userRepository",
    domain: "users",
    patterns: ["db.query", "authenticate"],
  },
  {
    relativePath: "apps/api/src/auth/session-service.ts",
    symbol: "sessionService",
    domain: "sessions",
    patterns: ["authenticate", "db.query"],
  },
  {
    relativePath: "packages/billing/src/invoice-ledger.ts",
    symbol: "invoiceLedger",
    domain: "invoices",
    patterns: ["db.query", "authenticate"],
  },
  {
    relativePath: "packages/search/src/search-index.ts",
    symbol: "searchIndex",
    domain: "search",
    patterns: ["authenticate", "db.query"],
  },
] as const;

export type FixtureFileSpec = (typeof FIXTURE_FILE_SPECS)[number];

function hasPattern(spec: FixtureFileSpec, pattern: string): boolean {
  return spec.patterns.includes(pattern as (typeof spec.patterns)[number]);
}

export function fixtureLineCount(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r?\n/).length;
}

export function renderFixtureFile(spec: FixtureFileSpec, recordCount = RECORD_COUNT): string {
  const lines = [
    `// Generated synthetic source file for the cursor-shunt token benchmark.`,
    `// Domain: ${spec.domain}; repeated records make broad reads intentionally expensive.`,
    `// Discoverable patterns in this file: ${spec.patterns.join(", ")}.`,
    `type QueryResult = { rows: Array<Record<string, unknown>> };`,
    `declare const db: { query(sql: string, params: unknown[]): Promise<QueryResult> };`,
    `declare function authenticate(subject: string): { userId: string };`,
    "",
  ];

  for (let index = 1; index <= recordCount; index += 1) {
    const recordName = `${spec.symbol}Record${index}`;
    const subject = `${spec.domain}-subject-${index}`;
    const queryLine = hasPattern(spec, "db.query")
      ? `  const result = await db.query("SELECT * FROM ${spec.domain} WHERE id = $1", [${index}]);`
      : "  const result = { rows: [] };";
    const authLine = hasPattern(spec, "authenticate")
      ? `  const identity = authenticate("${subject}");`
      : `  const identity = { userId: "${subject}" };`;

    lines.push(
      `export const ${recordName} = {`,
      `  id: ${index},`,
      `  domain: "${spec.domain}",`,
      `  subject: "${subject}",`,
      `  status: ${index % 3 === 0 ? '"archived"' : '"active"'},`,
      "};",
      "",
      `export async function load${spec.symbol[0].toUpperCase()}${spec.symbol.slice(1)}${index}(): Promise<Record<string, unknown>> {`,
      queryLine,
      authLine,
      `  return { ...${recordName}, rows: result.rows, userId: identity.userId };`,
      "}",
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function writeFixture(outputDirectory = DEFAULT_OUTPUT_DIRECTORY): Promise<string[]> {
  await rm(outputDirectory, { recursive: true, force: true });
  const paths: string[] = [];

  for (const spec of FIXTURE_FILE_SPECS) {
    const path = resolve(outputDirectory, spec.relativePath);
    await mkdir(dirname(path), { recursive: true });
    const content = renderFixtureFile(spec);
    if (fixtureLineCount(content) < SHUNT_MIN_LINES) {
      throw new Error(`${spec.relativePath} must be at least ${SHUNT_MIN_LINES} lines`);
    }
    await writeFile(path, content, "utf8");
    paths.push(path);
  }

  return paths;
}

function usage(): void {
  console.log("Usage: npm run bench:fixture [-- --output path/to/generated]");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    return;
  }

  const outputIndex = argv.indexOf("--output");
  const outputDirectory = outputIndex === -1
    ? DEFAULT_OUTPUT_DIRECTORY
    : argv[outputIndex + 1];
  if (outputIndex !== -1 && !outputDirectory) {
    throw new Error("--output requires a directory");
  }

  const paths = await writeFixture(outputDirectory);
  console.log(`Generated ${paths.length} benchmark files in ${outputDirectory}`);
}

if (process.argv[1]?.endsWith("bench/generate-fixture.ts")) {
  main().catch((error) => {
    console.error(`bench:fixture: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
