import { hasTargetedRange, input, isLargeFile, pathFrom, deny, allow } from "./common.mjs";

try {
  const event = await input();
  const nestedInput = event?.tool_input ?? event?.input;
  const inputValue = nestedInput && typeof nestedInput === "object" ? nestedInput : event;
  const path = pathFrom(inputValue) ?? pathFrom(event);
  const content = typeof inputValue?.content === "string"
    ? inputValue.content
    : typeof event?.content === "string" ? event.content : undefined;
  const targetedRange = hasTargetedRange(inputValue)
    || (inputValue !== event && hasTargetedRange(event));

  if (targetedRange || !(await isLargeFile(path, content))) {
    allow();
  } else {
    deny(
      `This file is at least SHUNT_MIN_LINES lines. Run: npx tsx scripts/bulk-read.ts --question "your focused question" --paths "${path}". Use a targeted offset/limit read when you only need a small section.`
    );
  }
} catch {
  allow();
}
