import { grantTtlMs, hasTargetedRange, helperCommand, hookCommand, input, isGranted, isLargeFile, minLines, pathFrom, deny, allow } from "./common.mjs";

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

  if (targetedRange || isGranted(path) || !(await isLargeFile(path, content))) {
    allow();
  } else {
    deny(
      `This file has at least ${minLines()} lines. To understand it, run: ${helperCommand("bulk-read")} --question "your focused question" --paths "${path}". For a small section, run: sed -n 'START,ENDp' "${path}" (the Read tool does not send offset and limit to hooks, so a ranged Read is blocked too). To edit it, run: ${hookCommand("allow-edit")} "${path}" and then edit (edit tools read the whole file first, and the hook cannot tell that from a read). The allow-edit command allows full reads of this file for ${grantTtlMs() / 60000} minutes.`
    );
  }
} catch {
  allow();
}
