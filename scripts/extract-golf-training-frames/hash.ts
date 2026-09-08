// Exact-duplicate video detection is done on file content (SHA-256), not
// filename -- a re-exported/re-downloaded copy of the same clip under a new
// name (common with WhatsApp/AirDrop) must still be recognized as a repeat.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
