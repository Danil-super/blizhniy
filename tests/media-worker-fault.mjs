import { assertConstrainedMediaRuntime } from "../scripts/media-worker-runtime.mjs";
import { encodeMediaFailure } from "../src/lib/media-worker-protocol.ts";

// Only the opt-in integration runner substitutes this executable, never application config.
assertConstrainedMediaRuntime(process.argv[2]);
switch (process.argv[3]) {
  case "environment": {
    const safe = Object.keys(process.env).sort().join(",") === "NODE_ENV,UV_THREADPOOL_SIZE,VIPS_CONCURRENCY";
    process.stdout.write(encodeMediaFailure(safe ? "INVALID_IMAGE" : "UNSUPPORTED_IMAGE"), () => process.exit(0));
    break;
  }
  case "crash": process.exit(55); break;
  case "overflow": process.stdout.write(Buffer.alloc(3 * 1024 * 1024)); setInterval(() => {}, 1000); break;
  case "memory": {
    const held = [];
    while (true) held.push(Buffer.alloc(16 * 1024 * 1024, 7));
    break;
  }
  case "hang": setInterval(() => {}, 1000); break;
  default: process.exit(1);
}
