import assert from "node:assert/strict";
import { copyFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Read-only production smoke check: verify the deployed responsive compositions.
const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, "BASE_URL is required");
const scenarios = [
  { slug: "tovary-dlya-detey", title: "Товары для детей", prefix: "kids-category-hero", version: "v5", breakpoint: 768, backdrop: false },
  { slug: "posuda", title: "Посуда", prefix: "dishes-category-hero", version: "v2", breakpoint: 640, backdrop: true },
];
const responsiveImageHeroScenarios = [
  { slug: "sad-i-rasteniya", mobileMode: "cover" },
  {
    slug: "ritualnye-uslugi",
    mobileMode: "cover",
    fullBleed: true,
    clearPhoto: true,
    copyOnTop: true,
    mobileSource: "/images/categories/ritual-category-hero.webp",
    desktopSource: "/images/categories/ritual-category-hero-desktop-v2.webp",
    desktopBreakpoint: 1024,
    desktopAspect: 3,
    desktopHeroAspect: 3,
    desktopHeroBreakpoint: 1024,
  },
  { slug: "nedvizhimost", mobileMode: "cover" },
  { slug: "tovary-dlya-detey", mobileMode: "contained" },
  {
    slug: "zhivotnye",
    mobileMode: "cover",
    fullBleed: true,
    clearPhoto: true,
    copyOnTop: true,
    mobileSource: "/images/categories/animals-category-hero.png",
    desktopSource: "/images/categories/animals-category-hero-desktop-v2.webp",
    desktopBreakpoint: 1024,
    desktopAspect: 3,
    desktopHeroAspect: 3,
    desktopHeroBreakpoint: 1024,
  },
  {
    slug: "krasota-i-uhod",
    mobileMode: "cover",
    fullBleed: true,
    clearPhoto: true,
    whiteCopy: true,
    mobileSource: "/images/categories/beauty-health-category-hero-v2.webp",
    desktopSource: "/images/categories/beauty-health-category-hero-desktop-v1.webp",
    desktopBreakpoint: 1024,
    desktopAspect: 8 / 3,
  },
  {
    slug: "instrumenty",
    mobileMode: "cover",
    fullBleed: true,
    clearPhoto: true,
    whiteCopy: true,
    mobileSource: "/images/categories/tools-category-hero-clean-v3.webp",
    desktopSource: "/images/categories/tools-category-hero-desktop-v1.webp",
    desktopBreakpoint: 768,
    desktopAspect: 8 / 3,
  },
  {
    slug: "transport",
    mobileMode: "cover",
    fullBleed: true,
    clearPhoto: true,
    preserveFullPhoto: true,
    oneLineActions: true,
    actionsAtBottom: true,
    copyOnTop: true,
    breakpoint: 768,
    mobileSource: "/images/categories/transport-category-hero-mobile-v5.webp",
    desktopSource: "/images/categories/transport-category-hero-desktop-v4.webp",
  },
  {
    slug: "biznes",
    mobileMode: "cover",
    fullBleed: true,
    clearPhoto: true,
    oneLineActions: true,
    actionsAtBottom: true,
    copyOnTop: true,
    whiteCopy: true,
    source: "/images/categories/business-category-hero-v2.webp",
    desktopHeroAspect: 3,
    desktopHeroBreakpoint: 768,
  },
  { slug: "posuda", mobileMode: "cover" },
  { slug: "biznes", mobileMode: "cover" },
  { slug: "elektronika", mobileMode: "cover" },
  { slug: "dlya-doma-i-dachi", mobileMode: "cover" },
  { slug: "menyayu-ili-otdam-darom", mobileMode: "cover" },
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
          const actions = [...section.querySelectorAll("[data-hero-actions] a")];
          return {
            fullBleed: Math.abs(box.left - frame.left) <= 1 && Math.abs(box.top - frame.top) <= 1 && Math.abs(box.right - frame.right) <= 1 && Math.abs(box.bottom - frame.bottom) <= 1,
            clearPhoto: !section.querySelector("[data-hero-scrim]") && getComputedStyle(img).filter === "none" && getComputedStyle(img).opacity === "1" && getComputedStyle(img).maskImage === "none",
            visibleFraction: Math.min(box.width / box.height / (img.naturalWidth / img.naturalHeight), (img.naturalWidth / img.naturalHeight) / (box.width / box.height)),
            copyAbovePhoto: Number(getComputedStyle(content).zIndex) > 0,
            actionsUnobscured: actions.every((a) => {
              const rect = a.getBoundingClientRect();
              return a.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
            }),
            actionsBottomOffset: actions.length ? frame.bottom - Math.max(...actions.map((a) => a.getBoundingClientRect().bottom)) : Number.POSITIVE_INFINITY,
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
            actions: actions.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") })),
          };
        });
        await hero.screenshot({ path: `${artifactDir}/${width}.png` });
        assert.equal(layout.title, scenario.title, `${width}: category title`);
        assert.ok(layout.src.endsWith(`${scenario.prefix}-${width < scenario.breakpoint ? "mobile" : "desktop"}-${scenario.version}.webp`), `${width}: deployed image`);
        assert.equal(layout.fit, scenario.backdrop ? "cover" : "contain", `${width}: correct image scaling`);
        assert.equal(layout.overlay, "absolute", `${width}: text must overlay the image`);
        assert.equal(layout.overflow, false, `${width}: horizontal overflow`);
        assert.equal(layout.contentOverflow, false, `${width}: text and buttons fit their column`);
        assert.equal(layout.topAligned, true, `${width}: text stays at top left`);
        if (scenario.backdrop) {
          assert.equal(layout.fullBleed, true, `${width}: photo fills the entire banner`);
          assert.equal(layout.clearPhoto, true, `${width}: photo has no fog, filters or mask`);
          assert.equal(layout.copyAbovePhoto, true, `${width}: copy sits above the photo`);
          assert.ok(layout.visibleFraction >= 0.9, `${width}: at least 90% of the photo must remain visible, got ${layout.visibleFraction}`);
        } else {
          assert.equal(layout.composition, true, `${width}: products beside the copy on every screen`);
          assert.equal(layout.overlap, false, `${width}: text overlaps products`);
        }
        if (!scenario.backdrop) assert.ok(layout.height <= 380, `${width}: compact kids hero, got ${layout.height}px`);
        assert.equal(layout.textInside, true, `${width}: text inside banner`);
        assert.equal(layout.actionsUnobscured, true, `${width}: action buttons remain clickable`);
        assert.ok(layout.actionsBottomOffset >= 0 && layout.actionsBottomOffset <= 36, `${width}: actions stay at the bottom of the hero, got ${layout.actionsBottomOffset}px`);
        assert.ok(layout.actions.some((a) => a.href === "#listings"));
        assert.ok(layout.actions.some((a) => a.href.includes(`/razmestit/obyavlenie?category=${scenario.slug}`)));
        console.log(`PASS ${scenario.slug} ${width}px: ${layout.height}px hero, ${scenario.backdrop ? "clear full-bleed photo, at least 90% visible, text overlaid" : "image beside copy without cropping or text overlap"}, actions clickable`);
      } finally {
        await page.close();
      }
    }
  }

  const electronicsSlug = "elektronika";
  const electronicsArtifactDir = `artifacts/category-heroes/${electronicsSlug}`;
  const electronicsSourceDir = `artifacts/category-heroes/electronics-source-variants`;
  await mkdir(electronicsArtifactDir, { recursive: true });
  await mkdir(electronicsSourceDir, { recursive: true });
  await copyFile("category/Электроника.png", `${electronicsSourceDir}/category-electronics.png`);
  await copyFile("public/images/categories/electronics.webp", `${electronicsSourceDir}/electronics-thumbnail.webp`);
  await copyFile("public/images/categories/electronics-category-hero.png", `${electronicsSourceDir}/electronics-current-hero.png`);

  for (const width of [320, 360, 390, 430, 640, 768, 1024, 1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    try {
      const response = await page.goto(new URL(`/katalog/${electronicsSlug}`, baseUrl).href, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      const hero = page.locator(`[data-category-theme="${electronicsSlug}"]`);
      const image = hero.locator("img:visible").first();
      await image.waitFor();
      await image.evaluate((img) => img.decode());
      const layout = await hero.evaluate((section) => {
        const img = [...section.children].find((child) => child.tagName === "IMG" && getComputedStyle(child).display !== "none");
        const content = section.querySelector("h1").parentElement.parentElement;
        const frame = section.getBoundingClientRect();
        const box = img.getBoundingClientRect();
        const copy = content.getBoundingClientRect();
        const directFogLayers = [...section.children].filter(
          (child) => child.tagName === "DIV" && child !== content && getComputedStyle(child).display !== "none",
        );
        return {
          title: section.querySelector("h1").textContent,
          src: img.currentSrc,
          fit: getComputedStyle(img).objectFit,
          position: getComputedStyle(img).objectPosition,
          filter: getComputedStyle(img).filter,
          opacity: getComputedStyle(img).opacity,
          mask: getComputedStyle(img).maskImage,
          fogLayers: directFogLayers.length,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          contentOverflow: content.scrollWidth > content.clientWidth + 1,
          textInside: copy.left >= frame.left && copy.right <= frame.right && copy.top >= frame.top && copy.bottom <= frame.bottom,
          imageInside: box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1,
          fullBleedBox: Math.abs(box.left - frame.left) <= 1 && Math.abs(box.top - frame.top) <= 1 && Math.abs(box.right - frame.right) <= 1 && Math.abs(box.bottom - frame.bottom) <= 1,
          copyWidthFraction: copy.width / frame.width,
          desktopWidthFraction: box.width / frame.width,
          actionsUnobscured: [...content.querySelectorAll("a")].every((a) => {
            const rect = a.getBoundingClientRect();
            return a.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }),
          actions: [...content.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href") })),
        };
      });
      await hero.screenshot({ path: `${electronicsArtifactDir}/${width}.png` });
      assert.equal(layout.title, "Электроника", `${width}: category title`);
      assert.ok(decodeURIComponent(layout.src).includes("/images/categories/electronics-category-hero.png"), `${width}: deployed electronics image`);
      assert.equal(layout.filter, "none", `${width}: no image filter`);
      assert.equal(layout.opacity, "1", `${width}: full image opacity`);
      assert.equal(layout.mask, "none", `${width}: no fade mask`);
      assert.equal(layout.fogLayers, 0, `${width}: no fog or whitening overlays`);
      assert.equal(layout.overflow, false, `${width}: no horizontal overflow`);
      assert.equal(layout.contentOverflow, false, `${width}: copy and actions fit`);
      assert.equal(layout.textInside, true, `${width}: copy remains inside hero`);
      assert.equal(layout.imageInside, true, `${width}: image stays inside hero`);
      if (width < 1024) {
        assert.equal(layout.fit, "cover", `${width}: mobile photo fills the hero`);
        assert.equal(layout.fullBleedBox, true, `${width}: mobile image box fills the whole hero`);
        assert.ok(layout.position.startsWith("100%"), `${width}: mobile composition stays anchored to the right`);
        assert.ok(layout.copyWidthFraction <= 0.62, `${width}: mobile copy leaves the electronics visible`);
      } else {
        assert.equal(layout.fit, "contain", `${width}: desktop keeps the full composition visible`);
        assert.ok(layout.desktopWidthFraction <= 0.73, `${width}: desktop image stays to the right of copy`);
      }
      assert.equal(layout.actionsUnobscured, true, `${width}: actions remain clickable`);
      assert.ok(layout.actions.some((a) => a.href === "#listings"));
      assert.ok(layout.actions.some((a) => a.href.includes("/razmestit/obyavlenie?category=elektronika")));
      console.log(`PASS elektronika ${width}px: ${width < 1024 ? "full-bleed cover image with compact copy" : "full composition contained on desktop"}, no fog or mask, actions clickable`);
    } finally {
      await page.close();
    }
  }

  for (const scenario of responsiveImageHeroScenarios) {
    const artifactDir = `artifacts/category-heroes/${scenario.slug}`;
    await mkdir(artifactDir, { recursive: true });

    const widths = scenario.desktopAspect ? [320, 360, 390, 430, 640, 768, 1024, 1280, 1440, 1920] : [320, 360, 390, 430, 640, 1024];

    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      try {
        const response = await page.goto(new URL(`/katalog/${scenario.slug}`, baseUrl).href, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200);

        const hero = page.locator(`[data-category-theme="${scenario.slug}"]`);
        await hero.waitFor();
        const layout = await hero.evaluate((section) => {
          const frame = section.getBoundingClientRect();
          const title = section.querySelector("h1");
          const copy = section.querySelector("[data-hero-copy]") ?? title?.parentElement?.parentElement;
          const copyBox = copy.getBoundingClientRect();
          const actions = [...section.querySelectorAll("[data-hero-actions] a")].filter((action) => {
            const style = getComputedStyle(action);
            const rect = action.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
          });
          const actionRects = actions.map((action) => action.getBoundingClientRect());
          const photos = [...section.querySelectorAll("img")]
            .map((img) => {
              const box = img.getBoundingClientRect();
              const style = getComputedStyle(img);
              return {
                box,
                visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 1 && box.height > 1,
                fit: style.objectFit,
                filter: style.filter,
                opacity: style.opacity,
                mask: style.maskImage,
                src: img.currentSrc,
                visibleFraction: Math.min(
                  (box.width / box.height) / (img.naturalWidth / img.naturalHeight),
                  (img.naturalWidth / img.naturalHeight) / (box.width / box.height),
                ),
                coversHero:
                  Math.abs(box.left - frame.left) <= 2 &&
                  Math.abs(box.top - frame.top) <= 2 &&
                  Math.abs(box.right - frame.right) <= 2 &&
                  Math.abs(box.bottom - frame.bottom) <= 2,
                insideHero:
                  box.left >= frame.left - 2 &&
                  box.right <= frame.right + 2 &&
                  box.top >= frame.top - 2 &&
                  box.bottom <= frame.bottom + 2,
              };
            })
            .filter((photo) => photo.visible);
          const directFogLayers = [...section.children].filter(
            (child) => child.tagName === "DIV" && child !== copy && child.getAttribute("data-hero-actions") === null && getComputedStyle(child).display !== "none",
          );

          return {
            imageHero: section.getAttribute("data-image-hero"),
            titleVisible: Boolean(title) && title.getBoundingClientRect().width > 10 && title.getBoundingClientRect().height > 10,
            photoCount: photos.length,
            fullBleedCover: photos.some((photo) => photo.fit === "cover" && photo.coversHero),
            containedPhoto: photos.some((photo) => photo.fit === "contain" && photo.insideHero),
            clearPhoto: photos.every((photo) => photo.filter === "none" && photo.opacity === "1" && photo.mask === "none"),
            fogLayers: directFogLayers.length,
            sources: photos.map((photo) => photo.src),
            titleColor: title ? getComputedStyle(title).color : "",
            descriptionColor: section.querySelector("p") ? getComputedStyle(section.querySelector("p")).color : "",
            copyAbovePhoto: Number(getComputedStyle(copy).zIndex) > 0,
            visiblePhotoFraction: Math.max(...photos.map((photo) => photo.visibleFraction)),
            heroAspect: frame.width / frame.height,
            actionsOneLine: actionRects.length >= 2 && Math.abs(actionRects[0].top - actionRects[1].top) <= 2,
            actionsBottomOffset: actionRects.length ? frame.bottom - Math.max(...actionRects.map((rect) => rect.bottom)) : Number.POSITIVE_INFINITY,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            copyInside:
              copyBox.left >= frame.left &&
              copyBox.right <= frame.right &&
              copyBox.top >= frame.top &&
              copyBox.bottom <= frame.bottom,
            actionsInside: actionRects.every(
              (rect) =>
                rect.left >= frame.left &&
                rect.right <= frame.right &&
                rect.top >= frame.top &&
                rect.bottom <= frame.bottom,
            ),
            actionsClickable: actions.every((action) => {
              const rect = action.getBoundingClientRect();
              return action.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
            }),
            actionCount: actions.length,
          };
        });

        await hero.screenshot({ path: `${artifactDir}/${width}.png` });
        assert.equal(layout.imageHero, "true", `${scenario.slug} ${width}: shared responsive image-hero contract`);
        assert.equal(layout.titleVisible, true, `${scenario.slug} ${width}: title remains visible`);
        assert.ok(layout.photoCount > 0, `${scenario.slug} ${width}: hero photo remains rendered`);
        assert.equal(layout.overflow, false, `${scenario.slug} ${width}: no horizontal overflow`);
        assert.equal(layout.copyInside, true, `${scenario.slug} ${width}: copy stays inside hero`);
        assert.equal(layout.actionsInside, true, `${scenario.slug} ${width}: actions stay inside hero`);
        assert.equal(layout.actionsClickable, true, `${scenario.slug} ${width}: actions stay clickable`);
        assert.ok(layout.actionCount >= 2, `${scenario.slug} ${width}: both hero actions exist`);
        if (scenario.fullBleed) {
          assert.equal(layout.fullBleedCover, true, `${scenario.slug} ${width}: clear photo fills the whole banner`);
        }
        if (scenario.clearPhoto) {
          assert.equal(layout.clearPhoto, true, `${scenario.slug} ${width}: photo has no blur, opacity or mask`);
          assert.equal(layout.fogLayers, 0, `${scenario.slug} ${width}: no fog layer covers the photo`);
          if (scenario.source) {
            assert.ok(layout.sources.some((src) => decodeURIComponent(src).includes(scenario.source)), `${scenario.slug} ${width}: cleaned hero photo is deployed`);
          }
        }
        if (scenario.preserveFullPhoto) {
          const expectedSource = width < (scenario.breakpoint ?? 640) ? scenario.mobileSource : scenario.desktopSource;
          assert.ok(layout.sources.some((src) => decodeURIComponent(src).includes(expectedSource)), `${scenario.slug} ${width}: breakpoint selects the uncropped vehicle photo`);
          assert.ok(layout.visiblePhotoFraction >= 0.98, `${scenario.slug} ${width}: all four vehicles remain in frame, got ${layout.visiblePhotoFraction}`);
        }
        if (scenario.desktopHeroAspect && width >= (scenario.desktopHeroBreakpoint ?? 1024)) {
          assert.ok(
            Math.abs(layout.heroAspect - scenario.desktopHeroAspect) <= 0.04,
            `${scenario.slug} ${width}: desktop hero keeps the shared compact aspect ratio, got ${layout.heroAspect}`,
          );
        }
        if (scenario.desktopSource) {
          const breakpoint = scenario.desktopBreakpoint ?? 1024;
          const expectedSource = width < breakpoint ? scenario.mobileSource : scenario.desktopSource;
          assert.ok(layout.sources.some((src) => decodeURIComponent(src).includes(expectedSource)), `${scenario.slug} ${width}: the source matches its responsive layout`);
          if (width >= breakpoint) {
            assert.ok(layout.visiblePhotoFraction >= 0.98, `${scenario.slug} ${width}: desktop photo is not meaningfully cropped, got ${layout.visiblePhotoFraction}`);
            if (scenario.desktopAspect) {
              assert.ok(Math.abs(layout.heroAspect - scenario.desktopAspect) <= 0.04, `${scenario.slug} ${width}: desktop hero keeps the intended responsive aspect ratio, got ${layout.heroAspect}`);
            }
          }
        }
        if (scenario.oneLineActions) {
          assert.equal(layout.actionsOneLine, true, `${scenario.slug} ${width}: both actions stay on one row`);
        }
        assert.ok(layout.actionsBottomOffset >= 0 && layout.actionsBottomOffset <= 36, `${scenario.slug} ${width}: actions stay at the bottom of the hero, got ${layout.actionsBottomOffset}px`);
        if (scenario.copyOnTop) {
          assert.equal(layout.copyAbovePhoto, true, `${scenario.slug} ${width}: title and description stay above the photo`);
        }
        if (scenario.whiteCopy) {
          assert.equal(layout.titleColor, "rgb(255, 255, 255)", `${scenario.slug} ${width}: heading remains white over the photo`);
          assert.equal(layout.descriptionColor, "rgb(255, 255, 255)", `${scenario.slug} ${width}: description remains white over the photo`);
          assert.equal(layout.copyAbovePhoto, true, `${scenario.slug} ${width}: copy stays above the photo`);
        }
        if (width <= 640) {
          if (scenario.mobileMode === "cover") {
            assert.equal(layout.fullBleedCover, true, `${scenario.slug} ${width}: mobile photo fills the banner without blank bands`);
          } else {
            assert.equal(layout.containedPhoto, true, `${scenario.slug} ${width}: mobile photo remains contained inside the banner`);
          }
        }
        console.log(`PASS ${scenario.slug} ${width}px: responsive hero photo, copy and actions remain inside the banner`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
