import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function args(argv: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const values: string[] = [];
    while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) values.push(argv[++index]);
    result.set(key, values);
  }
  return result;
}

export function first(parsed: Map<string, string[]>, name: string): string | undefined {
  return parsed.get(name)?.[0];
}

export async function fileXml(paths: string[]): Promise<string> {
  const files = await Promise.all(paths.map(async (path) => {
    const absolute = resolve(path);
    const body = await readFile(absolute, "utf8");
    return `<file path="${escapeXml(absolute)}">\n${body}\n</file>`;
  }));
  return files.join("\n\n");
}

export function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function ensureApiKey(): string {
  return required(process.env.CURSOR_API_KEY, "CURSOR_API_KEY");
}

export function model() {
  return { id: process.env.SHUNT_MODEL ?? "gpt-5.6-luna", params: [{ id: "reasoning", value: "none" }] };
}

export function usageText(value: unknown): string {
  if (!value) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}
