import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Read-only production smoke check: verify the deployed responsive compositions.
const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");
const scenarios = [
  { slug: "tovary-dlya-detey", title: "Товары для детей", prefix: "kids-category-hero", version: "v5" },
  { slug: "posuda", title: "Посуда", prefix: "dishes-category-hero", version: "v2" },
];
const browser = await chromium.launch();
try {
  for (const scenario of scenarios) {
    const artifactDir = `artifacts/category-heroes/${scenario.slug}`;
    await mkdir(artifactDir, { recursive: true });
    for (const width of [320, 360, 390, 430, 639, 640, 767, 768, 1024, 1440, 1535, 1536, 1920]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      try {
        const response = await page.goto(new URL(`/katalog/${scenario.slug}`, baseUrl).href, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200);
        const hero = page.locator(`[data-category-theme="${scenario.slug}"]`);
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
          const imageLeft = box.right - renderedWidth;
          const imageTop = box.top + (box.height - renderedHeight) / 2;
          // The tight asset is fully contained beside the copy. Products may overlap each other.
          const products = { left: imageLeft, right: box.right, top: imageTop, bottom: imageTop + renderedHeight };
          return {
            src: img.currentSrc,
            fit: getComputedStyle(img).objectFit,
            overlay: getComputedStyle(img.parentElement).position,
            title: section.querySelector("h1").textContent,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            contentOverflow: content.scrollWidth > content.clientWidth + 1,
            topAligned: copy.top - frame.top <= 32,
            height: frame.height,
            composition: copy.right <= products.left && products.top < copy.bottom && products.bottom > copy.top,
            textInside: copy.left >= frame.left && copy.right <= frame.right && copy.top >= frame.top && copy.bottom <= frame.bottom,
            overlap: copy.left < products.right && copy.right > products.left && copy.top < products.bottom && copy.bottom > products.top,
            actions: [...content.querySelectorAll("a")].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") })),
          };
        });
        await hero.screenshot({ path: `${artifactDir}/${width}.png` });
        assert.equal(layout.title, scenario.title, `${width}: category title`);
        assert.ok(layout.src.endsWith(`${scenario.prefix}-${width < 768 ? "mobile" : "desktop"}-${scenario.version}.webp`), `${width}: deployed image`);
        assert.equal(layout.fit, "contain", `${width}: all products must fit without cropping`);
        assert.equal(layout.overlay, "absolute", `${width}: text must overlay the image`);
        assert.equal(layout.overflow, false, `${width}: horizontal overflow`);
        assert.equal(layout.contentOverflow, false, `${width}: text and buttons fit their column`);
        assert.equal(layout.topAligned, true, `${width}: text stays at top left`);
        assert.equal(layout.composition, true, `${width}: products beside the copy on every screen`);
        assert.ok(layout.height <= 380, `${width}: compact hero, got ${layout.height}px`);
        assert.equal(layout.textInside, true, `${width}: text inside banner`);
        assert.equal(layout.overlap, false, `${width}: text overlaps products`);
        assert.ok(layout.actions.some((a) => a.href === "#listings"));
        assert.ok(layout.actions.some((a) => a.href.includes(`/razmestit/obyavlenie?category=${scenario.slug}`)));
        console.log(`PASS ${scenario.slug} ${width}px: ${layout.height}px hero, image beside copy, no cropping or text overlap, actions present`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
