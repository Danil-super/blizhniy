import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Read-only production smoke check: verify the deployed responsive compositions.
const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");
await mkdir("artifacts/kids-hero", { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [320, 360, 390, 430, 639, 640, 767, 768, 1024, 1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    try {
      const response = await page.goto(new URL("/katalog/tovary-dlya-detey", baseUrl).href, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      const hero = page.locator('[data-category-theme="tovary-dlya-detey"]');
      await hero.locator("picture img").waitFor();
      await hero.locator("picture img").evaluate((img) => img.decode());
      const layout = await hero.evaluate((section) => {
        const img = section.querySelector("picture img");
        const content = section.querySelector("h1").parentElement.parentElement;
        const box = img.getBoundingClientRect();
        const copy = content.getBoundingClientRect();
        const frame = section.getBoundingClientRect();
        const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
        const renderedWidth = img.naturalWidth * scale;
        const renderedHeight = img.naturalHeight * scale;
        const mobile = window.innerWidth < 768;
        const imageLeft = box.left + (mobile ? (box.width - renderedWidth) / 2 : box.width - renderedWidth);
        const imageTop = box.bottom - renderedHeight;
        // Product bounds are deliberately conservative, based on the reviewed assets.
        const products = mobile
          ? { left: imageLeft, right: imageLeft + renderedWidth, top: imageTop + renderedHeight * 0.49, bottom: box.bottom }
          : { left: imageLeft + renderedWidth * 0.365, right: box.right, top: imageTop, bottom: box.bottom };
        return {
          src: img.currentSrc,
          fit: getComputedStyle(img).objectFit,
          overlay: getComputedStyle(img.parentElement).position,
          title: section.querySelector("h1").textContent,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          textInside: copy.left >= frame.left && copy.right <= frame.right && copy.top >= frame.top && copy.bottom <= frame.bottom,
          overlap: copy.left < products.right && copy.right > products.left && copy.top < products.bottom && copy.bottom > products.top,
          actions: [...content.querySelectorAll("a")].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") })),
        };
      });
      await hero.screenshot({ path: `artifacts/kids-hero/${width}.png` });
      assert.equal(layout.title, "Товары для детей", `${width}: category title`);
      assert.ok(layout.src.endsWith(width < 768 ? "kids-category-hero-mobile-v3.webp" : "kids-category-hero-desktop-v3.webp"), `${width}: deployed image`);
      assert.equal(layout.fit, "contain", `${width}: all products must fit without cropping`);
      assert.equal(layout.overlay, "absolute", `${width}: text must overlay the image`);
      assert.equal(layout.overflow, false, `${width}: horizontal overflow`);
      assert.equal(layout.textInside, true, `${width}: text inside banner`);
      assert.equal(layout.overlap, false, `${width}: text overlaps products`);
      assert.ok(layout.actions.some((a) => a.href === "#listings"));
      assert.ok(layout.actions.some((a) => a.href.includes("/razmestit/obyavlenie?category=tovary-dlya-detey")));
      console.log(`PASS ${width}px: correct image, no cropping, no text/product overlap, actions present`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
