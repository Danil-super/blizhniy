import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");

const browser = await chromium.launch();
try {
  const artifactDir = "artifacts/category-heroes/instrumenty";
  await mkdir(artifactDir, { recursive: true });

  const assetPath = "/images/categories/tools-category-hero-clean-v2.webp";
  const assetResponse = await fetch(new URL(assetPath, baseUrl));
  assert.equal(assetResponse.status, 200, `${assetPath}: asset must load`);
  assert.ok((assetResponse.headers.get("content-type") ?? "").startsWith("image/"), `${assetPath}: asset must be an image`);
  const asset = new Uint8Array(await assetResponse.arrayBuffer());
  assert.ok(asset.length > 150_000, `${assetPath}: full source image must be deployed`);

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
        const title = section.querySelector("h1");
        const description = section.querySelector("p");
        const actions = [...section.querySelectorAll("a")];
        const titleRect = title.getBoundingClientRect();
        const descriptionRect = description.getBoundingClientRect();
        const actionRects = actions.map((action) => action.getBoundingClientRect());
        return {
          backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize,
          backgroundPosition: style.backgroundPosition,
          photoHasNoGradient: !style.backgroundImage.includes("gradient"),
          backgroundRepeat: style.backgroundRepeat,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          height: frame.height,
          title: title.textContent,
          titleVisible: titleRect.width > 20 && titleRect.height > 20,
          descriptionVisible: descriptionRect.width > 20 && descriptionRect.height > 20,
          textInside:
            titleRect.left >= frame.left &&
            titleRect.right <= frame.right &&
            titleRect.top >= frame.top &&
            titleRect.bottom <= frame.bottom &&
            descriptionRect.left >= frame.left &&
            descriptionRect.right <= frame.right &&
            descriptionRect.top >= frame.top &&
            descriptionRect.bottom <= frame.bottom,
          actionsInside: actionRects.every((rect) => rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom),
          actionsAtBottom: actionRects.every((rect) => frame.bottom - rect.bottom >= 0 && frame.bottom - rect.bottom <= 32),
          actionsClickable: actions.every((action) => {
            const rect = action.getBoundingClientRect();
            return action.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }),
          actions: actions.map((action) => ({ text: action.textContent.trim(), href: action.getAttribute("href") })),
        };
      });

      await hero.screenshot({ path: `${artifactDir}/${width}.png` });
      assert.equal(layout.title, "Инструменты", `${width}: category title`);
      assert.ok(layout.backgroundImage.includes("tools-category-hero-full.png"), `${width}: full instruments photo is deployed`);
      assert.equal(layout.backgroundSize, "contain", `${width}: full source image remains visible`);
      assert.equal(layout.photoHasNoGradient, true, `${width}: photo must not be faded`);
      assert.equal(layout.backgroundRepeat, "no-repeat", `${width}: source image must not repeat`);
      assert.equal(layout.overflow, false, `${width}: no horizontal overflow`);
      assert.equal(layout.titleVisible, true, `${width}: title is visible over the photo`);
      assert.equal(layout.descriptionVisible, true, `${width}: description is visible over the photo`);
      assert.equal(layout.textInside, true, `${width}: text remains inside the banner`);
      assert.equal(layout.actionsInside, true, `${width}: buttons remain inside the banner`);
      assert.equal(layout.actionsAtBottom, true, `${width}: buttons remain at the bottom of the banner`);
      assert.equal(layout.actionsClickable, true, `${width}: buttons remain clickable`);
      assert.ok(layout.actions.some((a) => a.href === "#listings"), `${width}: listings action exists`);
      assert.ok(layout.actions.some((a) => a.href?.includes("/razmestit/obyavlenie?category=instrumenty")), `${width}: create action exists`);
      assert.ok(layout.height >= 300 && layout.height <= 660, `${width}: hero height remains reasonable, got ${layout.height}px`);
      console.log(`PASS instrumenty ${width}px: full clear source photo, readable copy and bottom actions`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
