import { Agent } from "@cursor/sdk";
import { args, ensureApiKey, fileXml, first, model, required, usageText, withInstructions } from "./cli.js";

const parsed = args(process.argv.slice(2));
if (parsed.has("help") || parsed.has("h")) {
  console.log("Usage: npx tsx scripts/bulk-read.ts --question \"...\" --paths file-a file-b");
  process.exit(0);
}

const INSTRUCTIONS = "You are a precise code analyst. Return structured bullets only. Lead with the name, type, and line number for every finding. Answer the question from the supplied files; do not speculate or add a preamble.";

async function main() {
  const question = required(first(parsed, "question"), "--question");
  const paths = parsed.get("paths") ?? [];
  if (paths.length === 0) throw new Error("--paths requires one or more files");
  const corpus = await fileXml(paths);
  const agent = await Agent.create({
    apiKey: ensureApiKey(),
    local: { cwd: process.cwd() },
    model: model(),
    tools: []
  });
  try {
    const run = await agent.send(withInstructions(INSTRUCTIONS, `<question>${question}</question>\n${corpus}`));
    const response = await run.wait();
    if (response.status === "error") throw new Error(response.error?.message ?? "agent run failed");
    console.log(response.result ?? "");
    if (response.usage) console.error(`token_usage=${usageText(response.usage)}`);
  } finally {
    agent.close();
  }
}

main().catch((error) => {
  console.error(`bulk-read: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
