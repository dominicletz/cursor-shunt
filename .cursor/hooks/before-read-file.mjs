import { hasTargetedRange, input, isLargeFile, pathFrom, deny, allow } from "./common.mjs";

try {
  const event = await input();
  const inputValue = event.tool_input ?? event.input ?? event;
  const path = pathFrom(inputValue) ?? pathFrom(event);
  const content = inputValue?.content ?? event.content;

  if (hasTargetedRange(inputValue) || !(await isLargeFile(path, content))) {
    allow();
  } else {
    deny(
      `This file is at least SHUNT_MIN_LINES lines. Run: npx tsx scripts/bulk-read.ts --question "your focused question" --paths "${path}". Use a targeted offset/limit read when you only need a small section.`
    );
  }
} catch {
  allow();
}
