import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");

const browser = await chromium.launch();
try {
  const artifactDir = "artifacts/category-heroes/instrumenty";
  await mkdir(artifactDir, { recursive: true });

  for (const assetPath of [
    "/images/categories/tools-hero-mobile-v4.webp",
    "/images/categories/tools-hero-desktop-v4.webp",
  ]) {
    const assetResponse = await fetch(new URL(assetPath, baseUrl));
    assert.equal(assetResponse.status, 200, `${assetPath}: asset must load`);
    assert.ok((assetResponse.headers.get("content-type") ?? "").startsWith("image/"), `${assetPath}: asset must be an image`);
    const asset = new Uint8Array(await assetResponse.arrayBuffer());
    assert.ok(asset.length > 20_000, `${assetPath}: asset must not be a placeholder`);
  }

  for (const width of [320, 390, 430, 639, 640, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    try {
      const response = await page.goto(new URL("/katalog/instrumenty", baseUrl).href, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      const hero = page.locator('[data-category-theme="instrumenty"]');
      await hero.waitFor();

      const layout = await hero.evaluate((section) => {
        const style = getComputedStyle(section);
        const frame = section.getBoundingClientRect();
        const actions = [...section.querySelectorAll("a")];
        const actionRects = actions.map((action) => action.getBoundingClientRect());
        return {
          backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize,
          backgroundPosition: style.backgroundPosition,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          width: frame.width,
          height: frame.height,
          actionsInside: actionRects.every((rect) => rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom),
          actionsClickable: actions.every((action) => {
            const rect = action.getBoundingClientRect();
            return action.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }),
        };
      });

      await hero.screenshot({ path: `${artifactDir}/${width}.png` });
      const mobile = width < 640;
      assert.ok(
        layout.backgroundImage.includes(mobile ? "tools-hero-mobile-v4.webp" : "tools-hero-desktop-v4.webp"),
        `${width}: correct full hero artwork`,
      );
      assert.equal(layout.backgroundSize, "contain", `${width}: entire artwork remains visible`);
      assert.equal(layout.backgroundPosition, "50% 50%", `${width}: artwork stays centered`);
      assert.equal(layout.overflow, false, `${width}: no horizontal overflow`);
      assert.equal(layout.actionsInside, true, `${width}: clickable areas stay inside hero`);
      assert.equal(layout.actionsClickable, true, `${width}: baked-in buttons remain clickable`);

      const expectedRatio = mobile ? 4 / 5 : 3 / 2;
      const actualRatio = layout.width / layout.height;
      assert.ok(Math.abs(actualRatio - expectedRatio) < 0.03, `${width}: hero ratio preserves the complete artwork`);
      console.log(`PASS instrumenty ${width}px: full ${mobile ? "mobile" : "desktop"} artwork visible, no fade, clickable actions`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
