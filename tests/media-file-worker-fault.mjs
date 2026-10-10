// Owned test child only. Real fence/protocol and file primitive, stalled after partial file sync.
import fs from "node:fs/promises";
import { runFileWorker } from "../scripts/media-file-worker-runtime.mjs";
import { loadMediaModule } from "./media-module.mjs";

if (process.env.NODE_ENV !== "test") throw new Error("Test fixture required");
const deadline = setTimeout(() => process.exit(1), 7000);
const { createLocalMediaFileStore } = loadMediaModule("media-files", {}, { ...fs, open: async (...args) => {
  const file = await fs.open(...args);
  if (/\/.pending-[a-f0-9-]{36}$/.test(String(args[0]))) file.writeFile = async bytes => {
    await file.write(bytes.subarray(0, 12)); await file.sync();
    await new Promise(() => { setInterval(() => {}, 1000); });
  };
  return file;
} });
try { await runFileWorker(createLocalMediaFileStore); } finally { clearTimeout(deadline); }
