import { writeFile } from "node:fs/promises";
import { Agent } from "@cursor/sdk";
import { args, ensureApiKey, first, model, required, stripFences, usageText } from "./cli.js";

const parsed = args(process.argv.slice(2));
if (parsed.has("help") || parsed.has("h")) {
  console.log("Usage: npx tsx scripts/code-write.ts --spec \"...\" --reference path/to/example [--target path/to/output]");
  process.exit(0);
}

async function main() {
  const spec = required(first(parsed, "spec"), "--spec");
  const reference = required(first(parsed, "reference"), "--reference");
  const target = first(parsed, "target");
  const agent = await Agent.create({
    apiKey: ensureApiKey(),
    local: { cwd: process.cwd() },
    model: model(),
    tools: ["read"],
    systemPrompt: "You are a disciplined code generator. Match the supplied reference's conventions exactly. Output only the requested code, with no markdown fences, explanation, or preamble."
  });
  try {
    const run = await agent.send(`Specification:\n${spec}\n\nReference file to inspect:\n${reference}`);
    const response = await run.wait();
    if (response.status === "error") throw new Error(response.error?.message ?? "agent run failed");
    const code = stripFences(response.result ?? "");
    if (target) {
      await writeFile(target, code, "utf8");
      console.log(JSON.stringify({ path: target, bytes: Buffer.byteLength(code) }));
    } else {
      process.stdout.write(code);
    }
    const usage = response.usage;
    if (usage) console.error(`token_usage=${usageText(usage)}`);
  } finally {
    agent.close();
  }
}

main().catch((error) => {
  console.error(`code-write: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
