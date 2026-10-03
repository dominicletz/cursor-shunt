import { hasShellRange, helperCommand, input, isGranted, isLargeFile, deny, allow } from "./common.mjs";

const viewer = /\b(?:cat|head|tail|less|more)\b/;
const pipeOrRedirect = /(?:\||>>?)/;

try {
  const event = await input();
  const command = event.command ?? event.tool_input?.command ?? event.input?.command;
  if (typeof command !== "string" || !viewer.test(command) || pipeOrRedirect.test(command)) {
    allow();
  } else {
    const candidates = [...command.matchAll(/\b(?:cat|head|tail|less|more)\s+(?:-[^\s]+\s+)*["']?([^"'|;&\s]+)["']?/g)]
      .map((match) => match[1]);
    const large = (await Promise.all(candidates.map(async (path) => !isGranted(path) && (await isLargeFile(path)) ? path : undefined))).filter(Boolean);
    if (large.length === 0 || hasShellRange(command)) {
      allow();
    } else {
      deny(`Large-file shell display blocked. Run: ${helperCommand("bulk-read")} --question "your focused question" --paths ${large.map((path) => `"${path}"`).join(" ")}.`);
    }
  }
} catch {
  allow();
}
