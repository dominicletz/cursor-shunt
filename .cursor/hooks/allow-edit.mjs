import { grantAccess, grantTtlMs } from "./common.mjs";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node allow-edit.mjs <file> [file...]");
  process.exit(1);
}
grantAccess(paths);
console.log(`Full reads of ${paths.length} file(s) are allowed for ${grantTtlMs() / 60000} minutes.`);
