import { assertConstrainedMediaRuntime } from "./media-worker-runtime.mjs";
import { encodeMediaFailure, encodeMediaReply, MEDIA_INPUT_TYPES, MEDIA_MAX_INPUT_BYTES } from "../src/lib/media-worker-protocol.ts";

process.stdout.on("error", () => process.exit(1));
let reply;
try {
  assertConstrainedMediaRuntime(process.argv[2]);
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MEDIA_MAX_INPUT_BYTES + 1) throw Object.assign(new Error("Input too large"), { code: "IMAGE_TOO_LARGE" });
    chunks.push(chunk);
  }
  const frame = Buffer.concat(chunks, size);
  if (frame.length < 2 || !MEDIA_INPUT_TYPES[frame[0]]) throw Object.assign(new Error("Invalid input"), { code: "INVALID_IMAGE" });
  // No native addon is loaded until OS limits and the bounded input are checked.
  const { normalizeMediaImage } = await import("../src/lib/media-image.ts");
  reply = encodeMediaReply(await normalizeMediaImage(frame.subarray(1), MEDIA_INPUT_TYPES[frame[0]]));
} catch (error) {
  reply = encodeMediaFailure(error?.code ?? "MEDIA_UNAVAILABLE");
}
process.stdout.write(reply, () => process.exit(0));
