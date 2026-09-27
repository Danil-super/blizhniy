import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("../", import.meta.url);
const pageSource = readFileSync(new URL("src/app/rabota/zakazy/[slug]/edit/page.tsx", root), "utf8");
const clientSource = readFileSync(new URL("src/components/WorkRequestEditClient.tsx", root), "utf8");
const privateRequest = {
  id: "17c75a95-4667-47be-9a4d-74a3cdd5446b",
  title: "Private order",
  description: "Synthetic Street, 18; 45.10101, 38.99999",
  address: "Synthetic Street, 18",
  lat: 45.10101,
  lng: 38.99999,
};

async function renderEditPage(showFallbackContent) {
  const js = ts.transpileModule(pageSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const jsx = (type, props) => ({ type: typeof type === "function" ? type.name : type, props });

  vm.runInNewContext(js, {
    exports,
    require: (name) => name === "react/jsx-runtime"
      ? { jsx, jsxs: jsx, Fragment: "Fragment" }
      : name === "@/lib/runtime-mode"
        ? { shouldShowFallbackContent: () => showFallbackContent }
        : name === "@/lib/data"
          ? { workRequests: [privateRequest] }
          : { SiteHeader: () => null, WorkRequestEditClient: () => null, PublicationAuthGate: () => null },
  });

  return {
    dynamic: exports.dynamic,
    rendered: await exports.default({ params: Promise.resolve({ slug: privateRequest.id }) }),
  };
}

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);

  assert.ok(from >= 0 && to > from, `missing source section starting with ${start}`);
  return source.slice(from, to);
}

test("production work-request edit route serializes no static request, while explicit fallback still works", async () => {
  const production = await renderEditPage(false);
  const productionProps = production.rendered.props.children[1].props.children.props;

  assert.equal(production.dynamic, "force-dynamic");
  assert.equal(productionProps.initialRequest, undefined);
  assert.doesNotMatch(JSON.stringify(production.rendered), /Synthetic Street|45\.10101|38\.99999/);

  const fallback = await renderEditPage(true);
  const fallbackProps = fallback.rendered.props.children[1].props.children.props;

  assert.equal(fallbackProps.initialRequest, privateRequest);
});

test("UUID work-request editing is owner-scoped and returns before any demo persistence", () => {
  const requestSelection = section(clientSource, "  const request = isServerRequest", "\n\n  async function handleSubmit");
  const uuidBranch = section(requestSelection, "? (serverRequest?.id === requestId", "    : canUseDemoPublicationsStorage()");
  const submit = section(clientSource, "  async function handleSubmit", "\n\n  if (isServerRequest && loadStatus");
  const serverSave = section(submit, "      if (isServerRequest)", "\n\n      if (!canUseDemoPublicationsStorage())");

  assert.match(clientSource, /fetch\("\/api\/cabinet\/work-requests",\s*\{[\s\S]{0,240}cache: "no-store"/);
  assert.match(clientSource, /setServerRequest\(payload\?\.workRequests\?\.find\(\(item\) => item\.id === requestId\)\)/);
  assert.match(uuidBranch, /serverRequest\?\.id === requestId \? initialToPublication\(serverRequest\) : undefined/);
  assert.doesNotMatch(uuidBranch, /\bstoredRequest\b|\binitialRequest\b/);
  assert.match(serverSave, /method: "PATCH"/);
  assert.match(serverSave, /!response\.ok \|\| !payload\?\.workRequest/);
  assert.match(serverSave, /window\.location\.href = "\/cabinet\/zakazy";\s*return;/);
  assert.doesNotMatch(serverSave, /writeStoredDemoPublications|demoPublicationsUpdatedEvent/);
  assert.match(submit, /if \(!canUseDemoPublicationsStorage\(\)\) \{\s*throw new Error\("Редактирование демо-заказа недоступно\."\);/);
});
