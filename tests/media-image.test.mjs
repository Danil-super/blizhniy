import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { MediaImageError, normalizeMediaImage } from "../src/lib/media-image.ts";

const photo = (width = 40, height = 20) => sharp({ create: { width, height, channels: 3, background: "red" } });
const rejects = (promise, code) => assert.rejects(promise, error => {
  assert.ok(error instanceof MediaImageError);
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(error.message, /vips|jpeg|png|webp|Exif|\/home|synthetic/i);
  return true;
});

test("real JPEG, PNG, WebP and static GIF become bounded independent WebP bytes with output digest", async () => {
  for (const [format, mime] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"], ["gif", "image/gif"]]) {
    const input = await photo()[format]().toBuffer();
    const result = await normalizeMediaImage(input, mime);
    const actual = await sharp(result.bytes).metadata();
    assert.equal(actual.format, "webp");
    assert.equal(result.mimeType, "image/webp");
    assert.equal(result.width, 40); assert.equal(result.height, 20);
    assert.equal(actual.width, result.width); assert.equal(actual.height, result.height);
    assert.equal(result.size, result.bytes.length);
    assert.equal(result.sha256, createHash("sha256").update(result.bytes).digest("hex"));
    assert.notEqual(result.bytes, input);
    assert.deepEqual(Object.keys(result).sort(), ["bytes", "height", "mimeType", "sha256", "size", "width"]);
    const raw = await sharp(result.bytes).raw().toBuffer();
    assert.equal(raw.length, 40 * 20 * 3);
  }
});

test("only byte arrays are accepted, never filenames, URLs, empty or oversized input", async () => {
  for (const value of ["/etc/passwd", "https://localhost/image.png", null, {}, new ArrayBuffer(10), Buffer.alloc(0)]) {
    await rejects(normalizeMediaImage(value, "image/png"), "INVALID_IMAGE");
  }
  await rejects(normalizeMediaImage(Buffer.alloc(10 * 1024 * 1024 + 1), "image/png"), "IMAGE_TOO_LARGE");
  const input = await photo().png().toBuffer();
  // Use a precisely bounded view, not the backing slab (which may contain unrelated bytes).
  const storage = new Uint8Array(input.length + 12); storage.set(input, 6);
  const result = await normalizeMediaImage(storage.subarray(6, 6 + input.length), "image/png");
  assert.equal(result.width, 40);
});

test("claimed MIME must match the signature; SVG, PDF, TIFF and unsupported containers are rejected", async () => {
  const png = await photo().png().toBuffer();
  for (const mime of ["image/jpeg", "image/svg+xml", "IMAGE/PNG", "image/png; charset=utf-8", "", null, {}]) {
    await rejects(normalizeMediaImage(png, mime), "UNSUPPORTED_IMAGE");
  }
  for (const bytes of [Buffer.from("<svg><script>synthetic</script></svg>"), Buffer.from("%PDF-1.7"), await photo().tiff().toBuffer(), Buffer.from("<html>synthetic</html>")]) {
    await rejects(normalizeMediaImage(bytes, "image/png"), "UNSUPPORTED_IMAGE");
  }
});

test("full pixel decoding rejects damaged payloads, even when header metadata succeeds", async () => {
  const input = await photo(800, 400).png().toBuffer();
  const broken = input.subarray(0, Math.floor(input.length / 2));
  assert.equal((await sharp(broken).metadata()).width, 800);
  await rejects(normalizeMediaImage(broken, "image/png"), "INVALID_IMAGE");
  for (const [bytes, mime] of [[Buffer.from([255, 216, 255, 0]), "image/jpeg"], [Buffer.from("GIF89a"), "image/gif"], [Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP"), "image/webp"]]) {
    await rejects(normalizeMediaImage(bytes, mime), "INVALID_IMAGE");
  }
  assert.equal((await normalizeMediaImage(await photo().png().toBuffer(), "image/png")).width, 40);
});

test("large photos retain aspect ratio, stay inside 2048px and do not enlarge small photos", async () => {
  const result = await normalizeMediaImage(await photo(4096, 2048).png().toBuffer(), "image/png");
  assert.equal(result.width, 2048); assert.equal(result.height, 1024);
  const portrait = await normalizeMediaImage(await photo(1000, 3000).jpeg().toBuffer(), "image/jpeg");
  assert.equal(portrait.height, 2048); assert.ok(Math.abs(portrait.width - 2048 / 3) <= 1);
});

test("pixel budget rejects a compressed image above 24 million pixels", async () => {
  const input = await photo(6000, 4001).png().toBuffer();
  assert.ok(input.length < 10 * 1024 * 1024);
  await rejects(normalizeMediaImage(input, "image/png"), "INVALID_IMAGE");
  const boundary = await normalizeMediaImage(await photo(6000, 4000).png().toBuffer(), "image/png");
  assert.equal(boundary.width, 2048);
});

test("animated GIF and WebP are rejected rather than silently keeping the first frame", async () => {
  const raw = Buffer.from([...Array(12).fill(255), ...Array(12).fill(0)]);
  for (const [format, mime] of [["gif", "image/gif"], ["webp", "image/webp"]]) {
    const input = await sharp(raw, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } })[format]({ loop: 0, delay: [30, 40] }).toBuffer();
    assert.equal((await sharp(input).metadata()).pages, 2);
    await rejects(normalizeMediaImage(input, mime), "UNSUPPORTED_IMAGE");
  }
});

test("APNG control chunks are rejected even when the decoder reports only a default PNG frame", async () => {
  const png = await photo().png().toBuffer();
  const chunk = (type, payload) => {
    const body = Buffer.concat([Buffer.from(type), payload]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2);
  const control = sequence => {
    const payload = Buffer.alloc(26);
    payload.writeUInt32BE(sequence); payload.writeUInt32BE(40, 4); payload.writeUInt32BE(20, 8);
    payload.writeUInt16BE(1, 20); payload.writeUInt16BE(10, 22);
    return chunk("fcTL", payload);
  };
  const compressed = [];
  for (let offset = 8; offset + 12 <= png.length; offset += png.readUInt32BE(offset) + 12) {
    const length = png.readUInt32BE(offset);
    if (png.toString("latin1", offset + 4, offset + 8) === "IDAT") compressed.push(png.subarray(offset + 8, offset + 8 + length));
  }
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  const apng = Buffer.concat([png.subarray(0, 33), chunk("acTL", animation), control(0), png.subarray(33, -12), control(1), chunk("fdAT", Buffer.concat([sequence, ...compressed])), png.subarray(-12)]);
  const metadata = await sharp(apng).metadata();
  assert.equal(metadata.format, "png"); assert.equal(metadata.pages, undefined);
  assert.equal((await sharp(apng).raw().toBuffer()).length, 40 * 20 * 3);
  await rejects(normalizeMediaImage(apng, "image/png"), "UNSUPPORTED_IMAGE");
});

test("orientation is applied to pixels and EXIF including GPS, XMP and ICC are not retained", async () => {
  const input = await photo().withMetadata({ orientation: 6 })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 45/1 0/1" } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">synthetic</x:xmpmeta>').jpeg().toBuffer();
  const before = await sharp(input).metadata();
  assert.equal(before.orientation, 6); assert.ok(before.exif); assert.ok(before.icc); assert.ok(before.xmp);
  // TIFF IFD0 GPS pointer tag 0x8825 establishes that this is a GPS-bearing fixture.
  assert.ok(before.exif.includes(Buffer.from([0x25, 0x88, 0x04, 0x00])));
  const result = await normalizeMediaImage(input, "image/jpeg");
  assert.equal(result.width, 20); assert.equal(result.height, 40);
  const after = await sharp(result.bytes).metadata();
  for (const field of ["orientation", "exif", "icc", "xmp", "iptc"]) assert.equal(after[field], undefined);
  assert.ok(!result.bytes.includes(Buffer.from("synthetic")));
});

test("appended HTML is discarded by re-encoding; input is copied before the first await", async () => {
  const input = Buffer.concat([await photo().png().toBuffer(), Buffer.from("<html>synthetic</html>")]);
  const pending = normalizeMediaImage(input, "image/png");
  input.fill(0);
  const result = await pending;
  assert.equal(result.width, 40);
  assert.ok(!result.bytes.includes(Buffer.from("synthetic")));
});

test("one active decode is allowed per module instance, with no queue and capacity released on failure", async () => {
  const input = await photo().png().toBuffer();
  const first = normalizeMediaImage(input, "image/png");
  await rejects(normalizeMediaImage(input, "image/png"), "MEDIA_BUSY");
  await first;
  const damaged = normalizeMediaImage(input.subarray(0, 40), "image/png");
  await rejects(normalizeMediaImage(input, "image/png"), "MEDIA_BUSY");
  await rejects(damaged, "INVALID_IMAGE");
  assert.equal((await normalizeMediaImage(input, "image/png")).width, 40);
});

test("output above 2 MiB is rejected even when the source fits the input and pixel limits", async () => {
  let state = 12345;
  const raw = Buffer.alloc(2048 * 2048 * 3);
  for (let i = 0; i < raw.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; raw[i] = state & 255; }
  const input = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  assert.ok(input.length < 10 * 1024 * 1024);
  await rejects(normalizeMediaImage(input, "image/jpeg"), "IMAGE_TOO_LARGE");
});

test("browser execution is refused without entering the decoder", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  try { await rejects(normalizeMediaImage(Buffer.from("not an image"), "image/png"), "MEDIA_UNAVAILABLE"); }
  finally { if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else delete globalThis.window; }
});
