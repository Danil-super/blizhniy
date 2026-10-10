import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("importing the image contract does not load the native codec into the parent process", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { createRequire } from "node:module";
    import { MediaImageError } from "./src/lib/media-image.ts";
    const require = createRequire(import.meta.url);
    if (Object.keys(require.cache).some(path => path.includes("/node_modules/@img/sharp"))) throw new Error("Native codec loaded in parent");
    if (new MediaImageError("INVALID_IMAGE").code !== "INVALID_IMAGE") throw new Error("Contract changed");
    console.log("contract-only");
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.equal(output.trim(), "contract-only");
});
