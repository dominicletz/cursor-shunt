import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repository root that owns these hooks: <root>/.cursor/hooks/common.mjs.
export const shuntRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Command line that runs a helper script from any working directory.
export function absoluteHelperCommand(name, root = shuntRoot) {
  return `"${join(root, "node_modules", ".bin", "tsx")}" "${join(root, "scripts", `${name}.ts`)}"`;
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

export function deny(message) {
  process.stdout.write(JSON.stringify({ permission: "deny", agent_message: message }));
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
