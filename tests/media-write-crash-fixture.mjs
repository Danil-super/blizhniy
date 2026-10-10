// Test-only child. No SQL/network/credentials. SIGKILL must leave a real partial attempt leaf.
import fs from "node:fs/promises";
import { loadMediaModule } from "./media-module.mjs";

if (process.env.NODE_ENV !== "test" || process.platform !== "linux") throw new Error("Test fixture required");
const [root, attempt] = process.argv.slice(2);
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attempt ?? "")) throw new Error("Test attempt required");
const chunks = []; let length = 0;
for await (const chunk of process.stdin) {
  length += chunk.length; if (length > 4096) throw new Error("Test input bound exceeded"); chunks.push(chunk);
}
const { record, hex } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const { createLocalMediaFileStore } = loadMediaModule("media-files", {}, { ...fs, open: async (...args) => {
  const file = await fs.open(...args);
  if (String(args[0]).endsWith(`/.pending-${attempt}`)) {
    file.writeFile = async bytes => {
      await file.write(bytes.subarray(0, 12)); await file.sync();
      process.stdout.write("partial\n");
      // Keep the child and descriptor alive until the test kills this exact process.
      await new Promise(() => { setInterval(() => {}, 1000); });
    };
  }
  return file;
} });
await (await createLocalMediaFileStore(root)).write(record, Buffer.from(hex, "hex"), attempt);
