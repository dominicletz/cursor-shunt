import { access, readFile } from "node:fs/promises";
import { constants, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repository root that owns these hooks: <root>/.cursor/hooks/common.mjs.
export const shuntRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Command line that runs a helper script from any working directory.
export function absoluteHelperCommand(name, root = shuntRoot) {
  return `"${join(root, "node_modules", ".bin", "tsx")}" "${join(root, "scripts", `${name}.ts`)}"`;
}

// Command line that runs a hook-side script (for example allow-edit) from any working directory.
export function hookCommand(name, root = shuntRoot) {
  return `node "${join(root, ".cursor", "hooks", `${name}.mjs`)}"`;
}

// Short form when the project is the shunt root itself, absolute form otherwise.
export function helperCommand(name, cwd = process.cwd()) {
  return resolve(cwd) === shuntRoot ? `npx tsx scripts/${name}.ts` : absoluteHelperCommand(name);
}

export const minLines = () => {
  const value = Number.parseInt(process.env.SHUNT_MIN_LINES ?? "350", 10);
  return Number.isFinite(value) && value > 0 ? value : 350;
};

export function lineCount(body) {
  return body.length === 0 ? 0 : body.split(/\r?\n/).length;
}

export async function input() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

export function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
}

// beforeReadFile only reads `user_message`, preToolUse only reads `agent_message`.
// Send both, so the agent sees the route to the helper whichever hook denies.
export function deny(message) {
  process.stdout.write(JSON.stringify({ permission: "deny", user_message: message, agent_message: message }));
}

// Edit tools (StrReplace, Write) read the whole file first. That read reaches the hook as a
// plain Read, so the hook cannot tell an edit from a read. A short-lived grant lets the
// agent open a file in full after it ran bulk-read or allow-edit on it.
export const grantTtlMs = () => {
  const value = Number.parseInt(process.env.SHUNT_GRANT_SECONDS ?? "600", 10);
  return (Number.isFinite(value) && value > 0 ? value : 600) * 1000;
};

const grantsFile = () => process.env.SHUNT_GRANTS_FILE ?? join(tmpdir(), "cursor-shunt-grants.json");

function readGrants() {
  try {
    return JSON.parse(readFileSync(grantsFile(), "utf8"));
  } catch {
    return {};
  }
}

export function grantAccess(paths, now = Date.now()) {
  const grants = Object.fromEntries(Object.entries(readGrants()).filter(([, expires]) => expires > now));
  for (const path of paths) grants[resolve(path)] = now + grantTtlMs();
  writeFileSync(grantsFile(), JSON.stringify(grants), "utf8");
}

export function isGranted(path, now = Date.now()) {
  return typeof path === "string" && (readGrants()[resolve(path)] ?? 0) > now;
}

export function pathFrom(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.path === "string") return value.path;
  if (value && typeof value.file_path === "string") return value.file_path;
  if (value && typeof value.filePath === "string") return value.filePath;
  return undefined;
}

export async function isLargeFile(path, content) {
  if (typeof content === "string") return lineCount(content) >= minLines();
  if (!path) return false;
  try {
    await access(path, constants.R_OK);
    const body = await readFile(path, "utf8");
    return lineCount(body) >= minLines();
  } catch {
    return false;
  }
}

export function hasTargetedRange(value) {
  const text = JSON.stringify(value ?? {});
  return /(?:^|["'\s])(?:offset|startLine|start_line|lineStart|limit|endLine|end_line|lineEnd)(?:["'\s:=]|$)/i.test(text);
}

// head/tail with a count only show a slice, so they count as a targeted read.
export function hasShellRange(command) {
  return /\b(?:head|tail)\b[^|;&]*\s-(?:[nc]\s*\+?\d+|\d+)/.test(command) || hasTargetedRange(command);
}
