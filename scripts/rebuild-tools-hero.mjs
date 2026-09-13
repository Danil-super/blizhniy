import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const parts = [
  "assets/tools-hero/part-00.b64",
  "assets/tools-hero/part-01.b64",
  "assets/tools-hero/part-02.b64",
  "assets/tools-hero/part-03.b64",
];
const target = resolve(root, "public/images/categories/tools-category-hero-v3.jpg");

const encoded = (await Promise.all(parts.map((part) => readFile(resolve(root, part), "utf8")))).join("");
const image = Buffer.from(encoded, "base64");

if (image.length < 10_000 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
  throw new Error("Reconstructed tools hero is not a valid JPEG");
}

await mkdir(dirname(target), { recursive: true });
await writeFile(target, image);
console.log(`Rebuilt tools hero: ${image.length} bytes`);
