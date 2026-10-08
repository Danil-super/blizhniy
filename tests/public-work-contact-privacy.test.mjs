import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const publicationId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const applicantId = "33333333-3333-4333-8333-333333333333";
const contactKeys = new Set([
  "phone", "email", "messengerUrl", "contactPerson", "website", "contacts",
  "contact_phone", "messenger_url", "contact_person", "specialist_phone",
]);
const privatePhone = "+79995550123";
const privateEmail = "private-contact@example.test";
const privateMessenger = "https://t.me/private_contact";

// Execute complete source modules and their real dependencies. Only the REST
// transport is replaced; mapping, fallback content, React and page code are real.
function harness(rest, { fallback = false, configured = true } = {}) {
  const modules = new Map();
  const context = vm.createContext({
    console,
    Error,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    process: { env: {
      NODE_ENV: fallback ? "development" : "production",
      ENABLE_DEMO_CONTENT: String(fallback),
      ...(configured ? {
        NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-offline-service-key",
      } : {}),
    } },
    fetch() { throw new Error("These privacy tests must never use the network"); },
  });

  function load(filename) {
    const modulePath = resolve(root, filename);
    if (modules.has(modulePath)) return modules.get(modulePath).exports;
    const module = { exports: {} };
    modules.set(modulePath, module);
    const javascript = ts.transpileModule(readFileSync(modulePath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: modulePath,
    }).outputText;
    const execute = vm.runInContext(
      `(function(require, module, exports) { ${javascript}\n})`,
      context,
      { filename: modulePath },
    );
    execute((specifier) => {
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
      const base = specifier.startsWith("@/")
        ? resolve(root, "src", specifier.slice(2))
        : resolve(dirname(modulePath), specifier);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]
        .find((candidate) => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate));
      assert.ok(dependency, `Cannot resolve source dependency ${specifier}`);
      return load(dependency);
    }, module, module.exports);
    if (modulePath === resolve(root, "src/lib/supabase-rest.ts")) {
      module.exports.supabaseRest = rest;
    }
    return module.exports;
  }
  return { load };
}

function row(exact) {
  return {
    id: publicationId,
    author_id: ownerId,
    employer_type: "organization",
    organization_name: "ООО Публичный работодатель",
    inn: "2300123456",
    ogrn: "1232300000001",
    contact_person: "Private contact person",
    website: "https://private-contact.example.test",
    title: "Публичная работа",
    description: "Описание опубликованной работы без личных контактов.",
    region_id: ownerId,
    city_id: ownerId,
    district: "Центральный",
    address: "Synthetic Street, 18",
    latitude: "45.10101",
    longitude: "38.99999",
    show_exact_address: exact,
    contact_phone: privatePhone,
    email: privateEmail,
    messenger_url: privateMessenger,
    status: "published",
    is_paid: true,
    created_at: "2026-10-01T10:00:00.000Z",
    published_at: "2026-10-01T10:00:00.000Z",
    expires_at: "2099-10-01T10:00:00.000Z",
    cities: { name: "Краснодар", slug: "krasnodar" },
    profiles: { display_name: "Заказчик" },
    specialist_categories: { name: "Сантехник", slug: "santehnik" },
  };
}

function assertNoContacts(value) {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.equal(contactKeys.has(key), false, `Public serialization contains contact field ${key}`);
      assertNoContacts(child);
    }
  }
  assert.doesNotMatch(JSON.stringify(value) ?? "", /79995550123|private-contact|private_contact|Private contact person/);
}

for (const [requirements, responsibilities] of [
  [undefined, undefined],
  ["Опыт работы", undefined],
  [undefined, "Помощь клиентам"],
  ["Опыт работы", "Помощь клиентам"],
]) {
  test(`stored vacancy omits empty optional sections (${Boolean(requirements)}, ${Boolean(responsibilities)})`, async () => {
    const runtime = harness(async () => [{ ...row(true), requirements, responsibilities }]);
    const page = runtime.load("src/app/vakansiya/[slug]/page.tsx");
    const tree = await page.default({ params: Promise.resolve({ slug: publicationId }) });
    const headings = [];
    function inspect(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "h2") headings.push(node.props.children);
      for (const child of Object.values(node)) inspect(child);
    }
    inspect(tree);
    assert.equal(headings.includes("Требования"), Boolean(requirements));
    assert.equal(headings.includes("Обязанности"), Boolean(responsibilities));
  });
}

function assertLocation(value, exact) {
  assert.equal(value.showExactAddress, exact);
  assert.equal(value.address, exact ? "Synthetic Street, 18" : undefined);
  assert.equal(value.lat, exact ? 45.10101 : undefined);
  assert.equal(value.lng, exact ? 38.99999 : undefined);
}

const stores = [
  {
    kind: "vacancy", filename: "src/lib/vacancy-store.ts", table: "vacancies",
    list: "listStoredVacancies", detail: "getStoredVacancyById",
    admin: "listStoredVacanciesForAdmin", owner: "listStoredVacanciesForUser",
    merge: "listVacanciesWithStored", dataKey: "vacancies",
    page: "src/app/vakansiya/[slug]/page.tsx",
  },
  {
    kind: "work request", filename: "src/lib/work-request-store.ts", table: "work_requests",
    list: "listStoredWorkRequests", detail: "getStoredWorkRequestById",
    admin: "listStoredWorkRequestsForAdmin", owner: "listStoredWorkRequestsForUser",
    merge: "listWorkRequestsWithStored", dataKey: "workRequests",
    page: "src/app/rabota/zakazy/[slug]/page.tsx",
  },
];

for (const entry of stores) {
  for (const exact of [false, true]) {
    test(`public ${entry.kind} detail and list hide all contacts with exact location ${exact}`, async () => {
      const requests = [];
      const raw = row(exact);
      const runtime = harness(async (path) => { requests.push(path); return [raw]; });
      const store = runtime.load(entry.filename);
      for (const value of [
        await store[entry.detail](publicationId, { publicOnly: true }),
        ...(await store[entry.list]()),
      ]) {
        assertNoContacts(value);
        assertLocation(value, exact);
        if (entry.kind === "vacancy") {
          assert.equal(value.organization, raw.organization_name);
          assert.equal(value.inn, raw.inn);
          assert.equal(value.ogrn, raw.ogrn);
        }
      }
      for (const path of requests) {
        const select = new URL(path, "https://offline.invalid").searchParams.get("select");
        assert.doesNotMatch(select, /contact_phone|messenger_url|\bemail\b|contact_person|website/);
      }
      assert.equal(raw.contact_phone, privatePhone, "public mapping must not mutate private data");
    });
  }

  test(`${entry.kind} owner, admin and internal detail retain private contacts`, async () => {
    const raw = row(false);
    const runtime = harness(async () => [raw]);
    const store = runtime.load(entry.filename);
    const privateValues = [
      await store[entry.detail](publicationId),
      ...(await store[entry.owner](ownerId)),
      ...(await store[entry.admin]()),
    ];
    if (entry.kind === "vacancy") {
      privateValues.push(await store.getStoredVacancyForUser(publicationId, ownerId));
    }
    for (const value of privateValues) {
      assert.equal(value.phone, privatePhone);
      assert.equal(value.messengerUrl, privateMessenger);
      assert.equal(value.address, raw.address);
      if (entry.kind === "vacancy") {
        assert.equal(value.email, privateEmail);
        assert.equal(value.contactPerson, raw.contact_person);
        assert.equal(value.website, raw.website);
      }
    }
  });

  for (const fallback of [false, true]) {
    test(`public ${entry.kind} merged/fallback DTOs discard nested contacts (fallback ${fallback})`, async () => {
      const runtime = harness(async () => [row(true)], { fallback });
      const store = runtime.load(entry.filename);
      const privateValue = await store[entry.detail](publicationId);
      privateValue.contacts = { phone: privatePhone, email: privateEmail };
      // The real fallback arrays remain full private models for owner/admin demo use.
      const data = runtime.load("src/lib/data.ts");
      data[entry.dataKey].splice(0, data[entry.dataKey].length, { ...privateValue, id: "demo-contact" });
      const merged = store[entry.merge]([privateValue]);
      assert.equal(merged.length, fallback ? 2 : 1);
      merged.forEach((value) => { assertNoContacts(value); assertLocation(value, true); });
      const onlyFallback = store[entry.merge]([]);
      assert.equal(onlyFallback.length, fallback ? 1 : 0);
      onlyFallback.forEach(assertNoContacts);
      assert.equal(data[entry.dataKey][0].phone, privatePhone);
    });
  }

  for (const fallback of [false, true]) {
    test(`${entry.kind} page serializes only map fields in ${fallback ? "fallback" : "stored"} detail`, async () => {
      const runtime = harness(async () => fallback ? [] : [row(true)], { fallback });
      if (fallback) {
        const store = runtime.load(entry.filename);
        const privateRuntime = harness(async () => [row(true)]);
        const privateValue = await privateRuntime.load(entry.filename)[entry.detail](publicationId);
        privateValue.contacts = { phone: privatePhone };
        runtime.load("src/lib/data.ts")[entry.dataKey].splice(0, Infinity, privateValue);
        assert.ok(store);
      }
      const page = runtime.load(entry.page);
      const tree = await page.default({ params: Promise.resolve({ slug: publicationId }) });
      const mapProps = [];
      function inspect(node) {
        if (!node || typeof node !== "object") return;
        if (node.props?.location) mapProps.push(node.props.location);
        for (const child of Object.values(node)) inspect(child);
      }
      inspect(tree);
      assert.equal(mapProps.length, 1, "an opted-in map must remain available");
      assert.deepEqual(Object.keys(mapProps[0]).sort(), ["address", "city", "district", "hasMapPoint", "lat", "lng", "showExactAddress"]);
      assertLocation(mapProps[0], true);
      assertNoContacts(tree);
    });
  }
}

test("work landing secondary fallback removes contacts before client serialization", async () => {
  const runtime = harness(async () => [], { fallback: true });
  const privateRuntime = harness(async () => [row(true)]);
  const privateValue = await privateRuntime.load("src/lib/work-request-store.ts").getStoredWorkRequestById(publicationId);
  privateValue.contacts = { phone: privatePhone };
  // Exercise the secondary fallback with an existing mock publication and an
  // empty static demo catalog, rather than stubbing either fallback function.
  runtime.load("src/lib/mock-store.ts").getMockStore().workRequests = [privateValue];
  runtime.load("src/lib/data.ts").workRequests.splice(0, Infinity);
  const page = runtime.load("src/app/rabota/page.tsx");
  const tree = await page.default();
  const client = tree.props.children[2].props.children;
  assert.equal(client.type.name, "CanonicalWorkPage");
  assert.equal(client.props.workRequests.length, 1);
  assertNoContacts(client.props.workRequests);
  assertLocation(client.props.workRequests[0], true);
  assert.equal(privateValue.phone, privatePhone, "owner demo data stays intact");
});

for (const [filename, modelName] of [
  ["src/components/VacancyDetailClient.tsx", "vacancy"],
  ["src/components/WorkRequestDetailClient.tsx", "request"],
]) {
  test(`${modelName} local demo map receives only location props`, () => {
    const source = readFileSync(resolve(root, filename), "utf8");
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const locationExpressions = [];
    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "LocationMap") {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "location") {
            locationExpressions.push(attribute.initializer.expression.getText(ast));
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(locationExpressions.length, 1);
    // Execute the actual JSX prop expression without replacing React hooks or
    // local storage. This test covers precisely the component-to-map boundary.
    const javascript = ts.transpileModule(
      `export function serialize(${modelName}, hasPoint) { return ${locationExpressions[0]}; }`,
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const exports = {};
    vm.runInNewContext(javascript, { exports });
    const publication = {
      id: "local-demo",
      city: "Краснодар",
      address: "Synthetic Street, 18",
      lat: 45.10101,
      lng: 38.99999,
      showExactAddress: true,
      phone: privatePhone,
      email: privateEmail,
      messengerUrl: privateMessenger,
      contactPerson: "Private contact person",
      website: "https://private-contact.example.test",
      contacts: { phone: privatePhone },
    };
    const location = exports.serialize(publication, true);
    assertNoContacts(location);
    assert.deepEqual(Object.keys(location).sort(), ["address", "city", "district", "hasMapPoint", "lat", "lng", "showExactAddress"]);
    assertLocation(location, true);
    assert.equal(publication.phone, privatePhone);
  });
}

test("public work-request legacy image fallback still uses a contact-free projection and DTO", async () => {
  const requests = [];
  const runtime = harness(async (path) => {
    requests.push(path);
    if (path.includes("work_request_images(")) throw new Error("work_request_images relationship unavailable");
    return [row(true)];
  });
  const store = runtime.load("src/lib/work-request-store.ts");
  const detail = await store.getStoredWorkRequestById(publicationId, { publicOnly: true });
  const list = await store.listStoredWorkRequests();
  assert.ok(detail);
  assert.equal(list.length, 1);
  assertNoContacts(detail);
  list.forEach(assertNoContacts);
  assert.equal(requests.length, 4);
  requests.forEach((path) => {
    assert.doesNotMatch(new URL(path, "https://offline.invalid").searchParams.get("select"), /contact_phone|messenger_url|\bemail\b/);
  });
});

for (const target of ["vacancy", "workRequest"]) {
  test(`paid ${target} application keeps specialist contacts for its owner only`, async () => {
    const application = {
      id: "44444444-4444-4444-8444-444444444444",
      applicant_user_id: applicantId,
      ...(target === "vacancy"
        ? { vacancy_id: publicationId, vacancies: { author_id: ownerId, title: "Вакансия" } }
        : { work_request_id: publicationId, work_requests: { author_id: ownerId, title: "Заказ" } }),
      specialist_name: "Исполнитель",
      specialist_phone: privatePhone,
      specialist_email: privateEmail,
      specialist_messenger_url: privateMessenger,
      status: "sent",
      is_paid: true,
      created_at: "2026-10-01T10:00:00.000Z",
    };
    const runtime = harness(async (path) => {
      const query = new URL(path, "https://offline.invalid");
      if (query.pathname === "/rest/v1/payments") return [];
      assert.equal(query.pathname, "/rest/v1/applications");
      const params = query.searchParams;
      const ownerField = target === "vacancy" ? "vacancies.author_id" : "work_requests.author_id";
      if (params.get(ownerField) === `eq.${ownerId}` || params.get("applicant_user_id") === `eq.${applicantId}`) {
        return [application];
      }
      return [];
    });
    const store = runtime.load("src/lib/application-store.ts");
    const [authorized] = await store.listStoredApplicationsForUser(ownerId);
    assert.equal(authorized.phone, privatePhone);
    assert.equal(authorized.email, privateEmail);
    assert.equal(authorized.messengerUrl, privateMessenger);
    const [own] = await store.listStoredApplicationsForUser(applicantId);
    assert.equal(own.phone, undefined);
    assert.equal(own.email, undefined);
    assert.equal(own.messengerUrl, undefined);
    assert.equal((await store.listStoredApplicationsForUser("55555555-5555-4555-8555-555555555555")).length, 0);
    application.is_paid = false;
    const [unpaid] = await store.listStoredApplicationsForUser(ownerId);
    assert.equal(unpaid.phone, undefined);
    assert.equal(unpaid.email, undefined);
    assert.equal(unpaid.messengerUrl, undefined);
  });
}
