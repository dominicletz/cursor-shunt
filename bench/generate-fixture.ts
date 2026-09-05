import { cp, access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(BENCH_DIR, "..");
export const FIXTURE_DIR = join(BENCH_DIR, "fixture");
export const FIXTURE_MIN_LINES = 1_800;

export const FIXTURE_FILE_PATHS = [
  "packages/catalog/src/catalog-service.ts",
  "packages/accounts/src/auth-service.ts",
  "packages/billing/src/billing-service.ts",
] as const;

type SourceDefinition = {
  path: (typeof FIXTURE_FILE_PATHS)[number];
  service: string;
  domain: string;
  queryMethods: readonly number[];
};

const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  {
    path: FIXTURE_FILE_PATHS[0],
    service: "CatalogService",
    domain: "catalog",
    queryMethods: [2, 11, 23, 37, 52, 68, 79],
  },
  {
    path: FIXTURE_FILE_PATHS[1],
    service: "AuthService",
    domain: "accounts",
    queryMethods: [4, 16, 29, 43, 58, 71, 80],
  },
  {
    path: FIXTURE_FILE_PATHS[2],
    service: "BillingService",
    domain: "billing",
    queryMethods: [1, 14, 27, 41, 56, 69, 82],
  },
];

const METHOD_COUNT = 84;

function sourceLines(definition: SourceDefinition): string[] {
  const prefix = definition.service.replace(/Service$/, "").toLowerCase();
  const lines = [
    "// GENERATED FIXTURE. Do not edit; run npm run bench:fixture.",
    `// Synthetic ${definition.service} source for the SDK A/B benchmark.`,
    "",
    "type QueryResult = { rows: unknown[] };",
    "type Database = { query(sql: string, params?: unknown[]): Promise<QueryResult> };",
    "",
    `export class ${definition.service} {`,
    `  constructor(private readonly domain: string = "${definition.domain}") {}`,
    "",
  ];

  for (let index = 0; index < METHOD_COUNT; index += 1) {
    const methodName = `${prefix}Method${String(index).padStart(3, "0")}`;
    const callsDatabase = definition.queryMethods.includes(index);
    lines.push(
      `  async ${methodName}(`,
      "    db: Database,",
      "    value: string,",
      "  ): Promise<string> {",
      `    const requestId = \`${definition.domain}-\${value.length}-${index}\`;`,
      "    const normalized = value.trim().toLowerCase();",
      "    const trace = `${requestId}:${normalized.length}`;",
      "    const feature = this.domain.length + trace.length;",
      "    const attempt = feature % 3;",
      "    const metadata = { requestId, feature, attempt };",
      "    if (metadata.attempt < 0) {",
      "      return normalized;",
      "    }",
      "    const checksum = `${metadata.requestId}:${metadata.feature}`.length;",
      "    const marker = `${this.domain}:${checksum}`;",
      ...(callsDatabase
        ? [
            `    const result = await db.query("SELECT * FROM ${definition.domain} WHERE value = $1", [normalized]);`,
            "    return `${marker}:${result.rows.length}`;",
          ]
        : ["    return `${this.domain}:${marker}`;"]),
      "  }",
      "",
    );
  }

  while (lines.length < FIXTURE_MIN_LINES) {
    lines.push(`  // Deterministic filler line ${String(lines.length).padStart(4, "0")}.`);
  }

  lines.push("}");
  return lines;
}

async function writeSourceFiles(fixtureDir: string): Promise<void> {
  await rm(join(fixtureDir, "packages"), { force: true, recursive: true });

  await Promise.all(SOURCE_DEFINITIONS.map(async (definition) => {
    const target = join(fixtureDir, definition.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${sourceLines(definition).join("\n")}\n`, "utf8");
  }));

  await writeFile(
    join(fixtureDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cursor-shunt-benchmark-fixture",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function copyProjectIntegration(fixtureDir: string, repositoryRoot: string): Promise<void> {
  await rm(join(fixtureDir, ".cursor"), { force: true, recursive: true });
  await rm(join(fixtureDir, "scripts"), { force: true, recursive: true });
  await cp(join(repositoryRoot, ".cursor"), join(fixtureDir, ".cursor"), { recursive: true });
  await cp(join(repositoryRoot, "scripts"), join(fixtureDir, "scripts"), { recursive: true });
}

export async function ensureFixture(
  fixtureDir: string = FIXTURE_DIR,
  repositoryRoot: string = REPOSITORY_ROOT,
): Promise<string> {
  await mkdir(fixtureDir, { recursive: true });

  const promptSource = join(FIXTURE_DIR, "PROMPT.md");
  const promptTarget = join(fixtureDir, "PROMPT.md");
  if (resolve(promptSource) === resolve(promptTarget)) {
    await access(promptSource);
  } else {
    await cp(promptSource, promptTarget);
  }

  await writeSourceFiles(fixtureDir);
  await copyProjectIntegration(fixtureDir, repositoryRoot);
  return fixtureDir;
}

async function main(): Promise<void> {
  await ensureFixture();
  console.log(`Fixture ready at ${relative(REPOSITORY_ROOT, FIXTURE_DIR)}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`bench:fixture: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
