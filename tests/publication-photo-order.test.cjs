const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadModule(name, dependencies, fetch) {
  const source = readFileSync(join(__dirname, "../src/lib", name + ".ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", "fetch", js)(exports, id => {
    assert.ok(Object.hasOwn(dependencies, id), id);
    return dependencies[id];
  }, fetch);
  return exports;
}

const imageHelpers = loadModule("image-data-url", {});

function fixture(reply) {
  const batches = [];
  const upload = loadModule("client-publication-media", {
    "@/lib/image-data-url": imageHelpers,
    "@/lib/client-media-store": {
      getStoredMediaFile: async source => source.startsWith("local-")
        ? new File([source], source + ".webp", { type: "image/webp" }) : undefined,
    },
  }, async (url, options) => {
    assert.equal(url, "/api/uploads/media");
    assert.equal(options.headers.Authorization, "Bearer fixture");
    const names = options.body.getAll("files").map(file => file.name);
    batches.push(names);
    return Response.json(reply ? reply(names) : { files: names.map(name => ({ path: "vacancies/owner/" + name })) });
  }).uploadPublicationImageSources;
  return { save: sources => upload(sources, "vacancies", "fixture"), batches };
}

test("a new cover and existing vacancy photos retain their positions across two upload batches", async () => {
  const h = fixture();
  const newPhotos = Array.from({ length: 11 }, (_, i) => "local-" + i);
  const stored = "vacancies/owner/existing.webp";
  const sources = [newPhotos[0], "https://images.invalid/storage/v1/object/public/blizhniy-media/" + stored, ...newPhotos.slice(1)];
  assert.deepEqual(await h.save(sources), ["vacancies/owner/local-0.webp", stored, ...newPhotos.slice(1).map(s => "vacancies/owner/" + s + ".webp")]);
  assert.deepEqual(h.batches.map(batch => batch.length), [10, 1]);
});

test("canvas images can be uploaded when connect-src blocks data URLs", async () => {
  const h = fixture();
  const paths = await h.save(["data:image/webp;base64,AQID"]);
  assert.equal(paths.length, 1);
  assert.deepEqual(h.batches, [["publication-photo-1-crop.webp"]]);
});

test("an unavailable photo stops the edit before uploading any files", async () => {
  const h = fixture();
  await assert.rejects(h.save(["local-cover", "missing", "vacancies/owner/old.webp"]));
  assert.deepEqual(h.batches, []);
});

test("an incomplete success response cannot become a saved gallery", async () => {
  for (const files of [[], [{path:"vacancies/owner/a.webp"}, {}], null]) {
    const h = fixture(() => ({files}));
    await assert.rejects(h.save(["local-cover", "local-second"]));
  }
});

for (const [targetType, folder, limit] of [["listing", "listings", 20], ["vacancy", "vacancies", 12], ["workRequest", "work-requests", 6]]) {
  test(targetType + " draft sends every selected photo to checkout in display order", async () => {
    const batches = [];
    const photos = Array.from({ length: limit }, (_, i) => "local-" + i);
    const paths = photos.map(name => folder + "/owner/" + name + ".webp");
    photos[2] = paths[2];
    let submitted;
    const fetch = async (url, init) => {
      assert.equal(init.headers.Authorization, "Bearer fixture");
      if (url === "/api/cabinet/listings") return Response.json({ listings: [] });
      if (url === "/api/uploads/media") {
        assert.equal(init.body.get("folder"), folder);
        const files = init.body.getAll("files");
        batches.push(files.length);
        assert.ok(files.length <= 10);
        return Response.json({ files: files.map(file => ({ path: folder + "/owner/" + file.name })) });
      }
      assert.equal(url, "/api/" + folder);
      submitted = JSON.parse(init.body).mediaPaths;
      throw new Error("fixture captured checkout");
    };
    const media = loadModule("client-publication-media", {
      "@/lib/image-data-url": imageHelpers,
      "@/lib/client-media-store": { getStoredMediaFile: async source => new File([source], source + ".webp", { type: "image/webp" }) },
    }, fetch);
    const payment = loadModule("client-payment-flow", {
      "@/lib/client-publication-media": media,
      "@/lib/listing-price": { normalizeListingPrice: () => "1000" },
      "@/lib/supabase-browser": {
        isSupabaseBrowserConfigured: () => true,
        getSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "fixture" } } }) } }),
      },
      "@/lib/client-runtime-mode": { shouldShowClientFallbackContent: () => true },
      "@/lib/demo-publications": {}, "@/lib/cabinet-data-cache": {}, "@/lib/site-notifications": {},
      "@/lib/client-user-profile": {}, "@/lib/payment-confirmation-outcome": {},
    }, fetch);
    await assert.rejects(payment.createAndConfirmClientPayment({
      targetType, tariffId: "fixture", [targetType + "Draft"]: { id: "local-draft", images: photos, price: "1000" },
    }), /fixture captured checkout/);
    assert.deepEqual(submitted, paths);
    assert.deepEqual(batches, limit > 10 ? [10, limit - 11] : [limit - 1]);
  });
}
