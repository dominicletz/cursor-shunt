const BULK_READ_INVOCATION = /(?:^|[\s"'`=:/\\])(?:[\w.-]+[\\/])*bulk[-_]read(?:\.ts)?(?=$|[\s"'`;&|?])/i;

/**
 * Detect a bulk-read helper invocation anywhere in serialized tool arguments.
 *
 * The SDK can represent shell arguments as different nested shapes, so this
 * intentionally does not depend on a top-level `command` property.
 */
export function isBulkReadInvocation(args: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(args) ?? "";
  } catch {
    return false;
  }
  return BULK_READ_INVOCATION.test(serialized);
}
