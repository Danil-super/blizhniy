import { runFileWorker } from "./media-file-worker-runtime.mjs";

// No descendants, native codec, DB/network credentials or caller-controlled paths.
const deadline = setTimeout(() => process.exit(1), 5000);
process.stdout.on("error", () => process.exit(1));
let failed = false, reply;
try { reply = await runFileWorker(undefined, process.argv[3] ?? "write"); } catch { failed = true; }
clearTimeout(deadline);
process.stdout.write(failed ? Buffer.from([1]) : reply ?? Buffer.from([0]), () => process.exit(failed ? 1 : 0));
