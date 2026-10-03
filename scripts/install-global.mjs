import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { absoluteHelperCommand, shuntRoot } from "../.cursor/hooks/common.mjs";

const SKILLS = ["bulk-reader", "code-writer"];
const OWN_HOOK = /before-(?:read-file|shell-execution)\.mjs/;

/** Point the repo's hook commands at absolute paths so they work in every project. */
export function globalHooks(template, root) {
  const hooksDir = join(root, ".cursor", "hooks");
  const result = {};
  for (const [event, entries] of Object.entries(template.hooks ?? {})) {
    result[event] = entries.map((entry) => ({
      ...entry,
      command: entry.command.replace(/\.cursor\/hooks\/(\S+)/, (_, file) => `"${join(hooksDir, file)}"`),
    }));
  }
  return result;
}

/** Merge shunt hooks into an existing hooks.json, replacing older shunt entries and keeping all others. */
export function mergeHooks(existing, ours) {
  const hooks = {};
  for (const [event, entries] of Object.entries(existing.hooks ?? {})) {
    const kept = entries.filter((entry) => !OWN_HOOK.test(entry.command ?? ""));
    if (kept.length > 0) hooks[event] = kept;
  }
  for (const [event, entries] of Object.entries(ours)) hooks[event] = [...(hooks[event] ?? []), ...entries];
  return { ...existing, version: existing.version ?? 1, hooks };
}

/** Rewrite relative helper invocations in a skill so they run from any project. */
export function globalSkill(text, root) {
  return text.replace(/npx tsx scripts\/([\w-]+)\.ts/g, (_, name) => absoluteHelperCommand(name, root));
}

export async function installGlobal({ root = shuntRoot, cursorDir = join(homedir(), ".cursor"), skipNpm = false } = {}) {
  if (!skipNpm) {
    const npm = spawnSync("npm", ["install"], { cwd: root, stdio: "inherit" });
    if (npm.status !== 0) throw new Error("npm install failed");
  }

  const template = JSON.parse(await readFile(join(root, ".cursor", "hooks.json"), "utf8"));
  const hooksPath = join(cursorDir, "hooks.json");
  let existing = {};
  try {
    existing = JSON.parse(await readFile(hooksPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`cannot parse ${hooksPath}: ${error.message}`);
  }
  await mkdir(cursorDir, { recursive: true });
  if (Object.keys(existing).length > 0) await copyFile(hooksPath, `${hooksPath}.bak`);
  await writeFile(hooksPath, `${JSON.stringify(mergeHooks(existing, globalHooks(template, root)), null, 2)}\n`, "utf8");

  const written = [hooksPath];
  for (const name of SKILLS) {
    const target = join(cursorDir, "skills", name, "SKILL.md");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, globalSkill(await readFile(join(root, ".cursor", "skills", name, "SKILL.md"), "utf8"), root), "utf8");
    written.push(target);
  }
  return written;
}

async function main(argv) {
  const option = (name) => argv[argv.indexOf(name) + 1];
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/install-global.mjs [--cursor-dir ~/.cursor] [--skip-npm]");
    return;
  }
  const cursorDir = argv.includes("--cursor-dir") ? resolve(option("--cursor-dir")) : undefined;
  const written = await installGlobal({ cursorDir, skipNpm: argv.includes("--skip-npm") });
  console.log(`Installed cursor-shunt globally from ${shuntRoot}. Files written:`);
  for (const file of written) console.log(`  ${file}`);
  console.log("Set CURSOR_API_KEY in the environment Cursor uses, then reload Cursor.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`install-global: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
