import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");

const browser = await chromium.launch();
try {
  const artifactDir = "artifacts/category-heroes/instrumenty";
  await mkdir(artifactDir, { recursive: true });

  const assetResponse = await fetch(new URL("/images/categories/tools.webp", baseUrl));
  assert.equal(assetResponse.status, 200, "tools background asset must load");
  assert.ok((assetResponse.headers.get("content-type") ?? "").startsWith("image/"), "tools asset must be an image");
  const asset = new Uint8Array(await assetResponse.arrayBuffer());
  assert.ok(asset.length > 1000, "tools image must not be an empty or placeholder asset");

  for (const width of [320, 390, 430, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    try {
      const response = await page.goto(new URL("/katalog/instrumenty", baseUrl).href, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      const hero = page.locator('[data-category-theme="instrumenty"]');
      await hero.waitFor();

      const layout = await hero.evaluate((section) => {
        const style = getComputedStyle(section);
        const frame = section.getBoundingClientRect();
        const title = section.querySelector("h1");
        const description = section.querySelector("p");
        const actions = [...section.querySelectorAll("a")];
        const actionContainer = actions[0]?.parentElement;
        const titleRect = title.getBoundingClientRect();
        const descriptionRect = description.getBoundingClientRect();
        const actionRects = actions.map((action) => action.getBoundingClientRect());
        const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

        return {
          backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          height: frame.height,
          titleInside: titleRect.left >= frame.left && titleRect.right <= frame.right && titleRect.top >= frame.top && titleRect.bottom <= frame.bottom,
          descriptionInside: descriptionRect.left >= frame.left && descriptionRect.right <= frame.right && descriptionRect.top >= frame.top && descriptionRect.bottom <= frame.bottom,
          actionPosition: actionContainer ? getComputedStyle(actionContainer).position : null,
          actionsInside: actionRects.every((rect) => rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom),
          textOverlap: actionRects.some((rect) => overlaps(rect, titleRect) || overlaps(rect, descriptionRect)),
          actionsClickable: actions.every((action) => {
            const rect = action.getBoundingClientRect();
            return action.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }),
        };
      });

      await hero.screenshot({ path: `${artifactDir}/${width}.png` });
      assert.ok(layout.backgroundImage.includes("tools.webp"), `${width}: tools photo is the deployed background`);
      assert.equal(layout.backgroundSize, "cover", `${width}: photo fills the hero`);
      assert.equal(layout.overflow, false, `${width}: no horizontal overflow`);
      assert.equal(layout.titleInside, true, `${width}: title stays inside hero`);
      assert.equal(layout.descriptionInside, true, `${width}: description stays inside hero`);
      assert.equal(layout.actionsInside, true, `${width}: buttons stay inside hero`);
      assert.equal(layout.textOverlap, false, `${width}: buttons do not overlap title or description`);
      assert.equal(layout.actionsClickable, true, `${width}: buttons remain clickable`);
      if (width <= 430) assert.equal(layout.actionPosition, "static", `${width}: mobile buttons use normal layout flow`);
      assert.ok(layout.height <= 470, `${width}: hero remains compact, got ${layout.height}px`);
      console.log(`PASS instrumenty ${width}px: real full-bleed photo, no text/button overlap`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
