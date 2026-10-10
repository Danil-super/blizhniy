import { runFileWorker } from "./media-file-worker-runtime.mjs";

// No descendants, native codec, DB/network credentials or caller-controlled paths.
const deadline = setTimeout(() => process.exit(1), 5000);
process.stdout.on("error", () => process.exit(1));
let failed = false;
try { await runFileWorker(); } catch { failed = true; }
clearTimeout(deadline);
process.stdout.write(Buffer.from([failed ? 1 : 0]), () => process.exit(failed ? 1 : 0));
