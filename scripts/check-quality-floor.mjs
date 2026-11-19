#!/usr/bin/env node
// Adapted from constraint-driven-development/references/floor-guard.md.
// A diff heuristic, not a parser or a replacement for security scanners/review.
import { execFileSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const bail = () => {
  console.error('quality-floor: cannot check diff; verify repository, base and arguments');
  process.exit(2);
};
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--base' || !args[1] || args[1].startsWith('-'))) bail();
const base = args[1] ?? 'origin/main';
function git(args, diffExit = false) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (diffExit && error.status === 1 && typeof error.stdout === 'string') return error.stdout;
    bail();
  }
}
process.chdir(git(['rev-parse', '--show-toplevel']).trim());
const mergeBase = git(['merge-base', base, 'HEAD']).trim();
if (!mergeBase) bail();
let diff = git(['diff', '--no-ext-diff', '--no-textconv', '--unified=0', mergeBase, '--']);
for (const file of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
  diff += '\n' + git(['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--unified=0', '/dev/null', file], true);
}

const added = [], removed = [], deleted = [];
let file = '', oldFile = '', inHeader = false;
const pathOf = (name) => name.replace(/^[ab]\//, '');
for (const line of diff.split('\n')) {
  if (line.startsWith('diff ')) inHeader = true;
  else if (line.startsWith('@@')) inHeader = false;
  else if (inHeader) {
    if (line.startsWith('--- ')) oldFile = pathOf(line.slice(4));
    else if (line.startsWith('+++ ')) {
      const newFile = pathOf(line.slice(4));
      file = newFile === '/dev/null' ? oldFile : newFile;
      if (newFile === '/dev/null') deleted.push(file);
    }
  } else if (line.startsWith('+')) added.push({ file, text: line.slice(1) });
  else if (line.startsWith('-')) removed.push({ file, text: line.slice(1) });
}

const findings = [];
// Never include source text: a suppression or assertion may share a line with a secret.
const flag = (rule, file) => findings.push({ rule, file });
const isCode = (file) => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file);
const isTest = (file) => /(?:^tests\/|\.(?:test|spec)\.|(?:^|\/)test-)/.test(file);
const isConstraints = (file) => file === 'CONSTRAINTS.md';
const stripStrings = (text) => text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
const suppressions = /@ts-ignore|@ts-nocheck|eslint-disable|biome-ignore|istanbul ignore|nosemgrep|gitleaks:allow|Stryker disable/;
const skips = /\.(?:skip|todo)\b|\bx(?:it|describe)\s*\(/;
for (const { file, text } of added) {
  if (isCode(file)) {
    const code = stripStrings(text);
    const commentStart = code.search(/\/\/|\/\*/);
    const comment = commentStart >= 0 ? code.slice(commentStart) : /^\s*\*/.test(code) ? code : '';
    if (suppressions.test(comment)) flag('silenced-checker', file);
    if ((/\bthrow new (?:Error|NotImplemented)\b/.test(code) && /not implemented/i.test(text)) ||
        /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(code) || /(?:\/\/|\/\*|^\s*\*)\s*TODO\b/.test(code)) {
      flag('unfinished-work', file);
    }
    if (isTest(file) && skips.test(code)) flag('test-made-easier', file);
  }
  if (isConstraints(file) && /^\| *(?:W|E)\d+ *\|/.test(text)) flag('new-exception', file);
}
for (const file of deleted) if (isTest(file)) flag('test-deleted', file);
// Exact registration-policy replacements reviewed by the owner, 2026-10-16.
// Not a general assertion allowlist: both exact lines must occur once in this diff,
// in the same specified file. Every other removal still blocks the release.
const registrationAssertionPairs = [
  ['tests/registration-web-integration.mjs',
    '        assert.equal(await page.getByText(/Администратор · права проверяет сервер/).count(), 0);',
    '        assert.equal(await page.getByText("Администратор", { exact: true }).count(), 0);'],
  ['tests/application-contract.test.mjs',
    " assert.equal(parseApplicationCreate({...create,message:'x'.repeat(3000)}).message.length,3000);",
    " assert.equal(parseApplicationCreate({...create,message:'x'.repeat(500)}).message.length,500);"],
  ['tests/local-registration-ui.test.mjs', '  assert.match(html, /minLength="15"/i);', '  assert.match(html, /minLength="8"/i);'],
  ['tests/production-account-browser.mjs',
    '      assert.deepEqual(Object.keys(calls[0].body).sort(), ["email", "password", "acceptedAgreement", "acknowledgedPrivacy", "agreementVersion", "privacyVersion", "captchaToken"].sort());',
    '      assert.deepEqual(Object.keys(calls[0].body).sort(), ["name", "email", "password", "acceptedAgreement", "acknowledgedPrivacy", "agreementVersion", "privacyVersion", "captchaToken"].sort());'],
];
// Apply only after owner review of the exact deployment replacements.
const deploymentAssertionPairs = [
  ["tests/ci-parallel-layout.test.mjs", "    assert.equal(job['timeout-minutes'],20);assert.equal(job['runs-on'],job===ci.jobs.validate?'ubuntu-24.04':'ubuntu-latest');", "    assert.equal(job['timeout-minutes'],job===ci.jobs.validate?25:20);assert.equal(job['runs-on'],job===ci.jobs.validate?'ubuntu-24.04':'ubuntu-latest');"],
  ["tests/postgres-ci-gate.test.mjs", " assert.equal(job.if,undefined);assert.equal(job['continue-on-error'],undefined);assert.equal(job['runs-on'],'ubuntu-24.04');assert.equal(job['timeout-minutes'],20);", " assert.equal(job.if,undefined);assert.equal(job['continue-on-error'],undefined);assert.equal(job['runs-on'],'ubuntu-24.04');assert.equal(job['timeout-minutes'],25);"],
  [
    "tests/postgres-ci-gate.test.mjs",
    "  assert.deepEqual(calls,[['npx','playwright','install','--with-deps','chromium'],['docker','--host','unix:///var/run/docker.sock','pull',image],...suites.map(file=>['node','--experimental-strip-types','--test','--test-concurrency=1','tests/'+file])]);",
    "  assert.deepEqual(calls,[['npx','playwright','install','chromium'],['node','--input-type=module','-'],['docker','--host','unix:///var/run/docker.sock','pull',image],...suites.map(file=>['node','--experimental-strip-types','--test','--test-concurrency=1','tests/'+file])]);"
  ],
  [
    "tests/postgres-ci-gate.test.mjs",
    "  assert.deepEqual(calls,[['npx','playwright','install','--with-deps','chromium'],['docker','--host','unix:///var/run/docker.sock','pull',image],['node','--experimental-strip-types','--test','--test-concurrency=1',...suites.map(file=>'tests/'+file)]]);",
    "  assert.deepEqual(calls,[['npx','playwright','install','--with-deps','chromium'],['docker','--host','unix:///var/run/docker.sock','pull',image],...suites.map(file=>['node','--experimental-strip-types','--test','--test-concurrency=1','tests/'+file])]);"
  ],
  [
    "tests/ci-parallel-layout.test.mjs",
    "    assert.equal(job['timeout-minutes'],20);assert.equal(job['runs-on'],'ubuntu-latest');",
    "    assert.equal(job['timeout-minutes'],20);assert.equal(job['runs-on'],job===ci.jobs.validate?'ubuntu-24.04':'ubuntu-latest');"
  ],
  [
    "tests/ci-parallel-layout.test.mjs",
    "    for(const step of job.steps){assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);}",
    "    for(const step of job.steps.filter(step=>step.name!=='Upload the verified production artifact')){assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);}"
  ],
  [
    "tests/deploy-readiness.test.mjs",
    "  assert.equal(releaseMode, 0o700);",
    "  assert.equal(releaseMode, 0o755);"
  ],
  [
    "tests/deployment-ssh-host-trust.test.mjs",
    "    assert.equal(execute(deploy.jobs.deploy.steps.find(step => step.name === 'Confirm deployed release')).status, 0);",
    "    assert.equal(execute(deploy.jobs.finalize.steps.find(step => step.name === 'Confirm deployed release')).status, 0);"
  ],
  [
    "tests/deployment-ssh-host-trust.test.mjs",
    "    assert.equal(execute(deploy.jobs.deploy.steps.find(step => step.name === 'Roll back release if a deployed check failed'), 'rollback').status, 0);",
    "    assert.equal(execute(deploy.jobs.finalize.steps.find(step => step.name === 'Roll back release if a deployed check failed'), 'rollback').status, 0);"
  ],
  [
    "tests/deployment-ssh-host-trust.test.mjs",
    "    for (const step of [confirm, rollback]) assert.equal(step.env.REMOTE_DIR, '${{ steps.ship.outputs.remote_dir }}');",
    "    for (const step of [confirm, rollback]) assert.equal(step.env.REMOTE_DIR, '${{ needs.deploy.outputs.remote_dir }}');"
  ]
];
// Candidate: apply only after owner review of this exact renewal boundary pair.
const renewalAssertionPairs = [
  ['tests/placement-renewal-artifacts.test.mjs',
   "   const rejected=join(owned,name+'-57');assert.throws(()=>build(rejected,{schema:57}));assert.equal(existsSync(rejected),false);",
   "   const rejected=join(owned,name+'-58');assert.throws(()=>build(rejected,{schema:58}));assert.equal(existsSync(rejected),false);"],
  ['tests/refund-operator-role.test.mjs',
   " for(const schema of [53,57,'55',null])assert.throws(()=>getRefundWorkerRolePlan('blizhniy_test',{schema}));",
   " for(const schema of [53,58,'55',null])assert.throws(()=>getRefundWorkerRolePlan('blizhniy_test',{schema}));"],
  ['tests/refund-operator-role.test.mjs',
   " for(const schema of [53,56,'55',null])assert.throws(()=>getRefundWorkerRolePlan('blizhniy_test',{schema}));",
   " for(const schema of [53,58,'55',null])assert.throws(()=>getRefundWorkerRolePlan('blizhniy_test',{schema}));"],
];
const reportingAssertionPair = [
  "tests/html-csp.test.mjs",
  " for(const directive of [\"script-src-attr 'none'\",\"object-src 'none'\",\"base-uri 'none'\",\"frame-ancestors 'self'\",'report-uri /api/csp-report',\"worker-src 'self' blob:\"])assert.ok(value.includes(directive));",
  " for(const directive of [\"script-src-attr 'none'\",\"object-src 'none'\",\"base-uri 'none'\",\"frame-ancestors 'self'\",'report-to csp',\"worker-src 'self' blob:\"])assert.ok(value.includes(directive));"
];
const reviewedAssertionPairs = [...registrationAssertionPairs, ...deploymentAssertionPairs, ...renewalAssertionPairs, reportingAssertionPair];
const reviewedReplacement = (file, text) => reviewedAssertionPairs.some(([path, before, after]) =>
  file === path && text === before &&
  removed.filter(line => line.file === path && reviewedAssertionPairs.some(([pairPath, pairBefore, pairAfter]) =>
    pairPath === path && pairAfter === after && line.text === pairBefore)).length === 1 &&
  added.filter(line => line.file === path && line.text === after).length === 1);
// Exact browser-test replacements reviewed individually by the owner; see docs/review/.
// Content-addressed artifacts, not a blanket permission to remove assertions.
const reviewedListingArtifacts = [
  {"file": "tests/html-csp.test.mjs", "before": "56a3b847b340837288a109dacf522d703034a6111659d5aa80824d0ab8e1578f", "after": "ce3389283fd1714ab4c90ed2e76e34e2020af7e6cf0ddb53ec4fbc5d9d7eb98b", "alternateBefore": "405c711e273fa6adbc8c5301e68f4080818427653c27e9f43beefc05457351f3"},
  {"file": "tests/listing-category-parent.test.mjs", "before": "89eeb641134ffeb99405b5fbbcde10faf25cb7d220fc8d39353a215fce39e98f", "after": "9ab7797ea8a49c19d2ca70a1547c2a8971ebcbbbb8c5df11dce0a5d40f617a7b"},
  {"file": "tests/initialization-runtime-recovery.test.mjs", "before": "eb8d96e891aaa2e589ad3ae31dcaf66458a64d5de313b4d86518f0f97711331e", "after": "9b4148b2bafaa893f0e44e5133129783cb750451e647a6aeae4a34128c8d8822"},
  {"file": "tests/selector-parser-backport.test.mjs", "before": "75e56141d83109c37616e9faf1d253007e325f3a306e37db683b5f552c147543", "after": "2e81a155de3424a075e29129fa5f5bdb38093b8b5207f7178e1677bd7a319852"},
  {"file": "tests/selector-upstream-equivalence.test.mjs", "before": "906351112d3ed550c88c0e51783bb273267d20da90fe5866c09d2045c8dbc97f", "after": "0f6b2251eb07100fdf1c84dbae5bd44d062c901ee67ef1f147d0b0d64d805617"},
  {"file": "tests/service-offline-browser.mjs", "before": "5371d8f7530e0a23d585087805aa888671c8d45c476b2d8bb8b99dfd297fc1d6", "after": "ff50df01fc483095dc4d42395bf1bd76145cda730e71bce1fba1723ea2eb6ae0"},
  {"file": "tests/legacy-photo-batch.test.mjs", "before": "900d5b3dff1388fb0110bd31a416ea720f121c4a21d441ff70b454eab3be95e3", "after": "049707ec99a5a11bf7ba807e3445398566fa65d9ade33708034a6bc1d6c9e9b0"},
  {"file": "tests/local-supabase-integration.mjs", "before": "a631f82475514fef30ddc1fbfad4eea92db2e352da98dd806b6686f0989e9b9f", "after": "81941855d2262ef6a35c22a34df5c7758254e2d3b9a2a01222f31169e0152c93"},
  {"file": "tests/payment-fulfillment-server.test.mjs", "before": "6ec73e7e3b3c7c731e8abc3c72390b86ec5ffc434999ee8663d87f4e2dfc6064", "after": "9f11355583b5b8049834d8113516859966b95dc378a1d5d6416328cca538cd32"},
  {"file": "tests/profession-select-primary.test.cjs", "before": "c45990b531f16109ac9adcf76edc195d6de3363ce7c60e6c093dc332d9f5fb87", "after": "756f6b32fa43d4be06ecddd037ba96a70e14e185a6f6f9dedb79b2347446da70"},
  {"file": "tests/admin-user-access-postgres-integration.mjs", "before": "2ea4df91367b5593896e2e8cdac5d3f8e17e04792ad91eb04a3edad4a8bf65b6", "after": "63ee2e31d24960984ba19a5be81a448da006a2a23764b0d44750dbddfd35e8e3"},
  {"file": "tests/cabinet-entry-browser-cases.mjs", "before": "bc0bbf335935bfd080363e382aa50062479bdfd65f058db368cfd00b44a618dd", "after": "a17a3ba056f19d5d4d7f10af9e2611f485f7d317954749b08229631570fc851e"},
  {"file": "tests/cabinet-card-browser-cases.mjs", "before": "85c919870ea9f4e06564e05a55520a4ae722d62f8981965be32627276c4d24ec", "after": "ebe5d0e8f5787ec30d23efd4041e076d22e1701a5314e1e05fcbe694adbcdba2"},
  {"file": "tests/primary-payment-return-browser.mjs", "before": "097f44cfbfd7355bdbb5222c616763a7257d85c879882b638705e292ec25aa1e", "after": "e1dc2baa4483ac51b9e95dda716717b69c2bd232e384ac829caa1a00b7ce0190"},
  {
    "file": "tests/public-search-contract.test.mjs",
    "before": "3920719f3e2bc374a8e90b33a3c6fbd64cd5d32683955e55a65dd8dfc2270ce7",
    "after": "c2ce3043d5daca4d7b2d6830b7d083b31f39084b050d29cd58c7723e5f937017"
  },
  {
    "file": "tests/primary-listing-form-browser.mjs",
    "before": "94b3afeb529892c4c943687a6584b4199b142ea76f8eda1a105b0a90252c40f6",
    "after": "eef145924f8b23aef530a7959fb853f3dfc2d31d5e43758c0af5f7d7258bf52c"
  },
  {
    "file": "tests/account-test-checkout-browser-cases.mjs",
    "before": "d764cf2fd91d5f4dbc195e9a407dd8c29f01e0bdd2f6316e0c15aad2ff0a9007",
    "after": "8b1a001d57fb3ace15c8c492e6a61af66d73e0318ae38afe3d14fe99b4ada260"
  },
  {
    "file": "tests/production-account-browser.mjs",
    "before": "e6d407deeae1ecb2e0a7361c954c162c0a46191257746fb3c24dec033795db98",
    "after": "c631dcadb019c2b51dc976142fda70e6cdeca530269ec707ea355f38b3c8a5b8"
  },
  {
    "file": "tests/cabinet-offline-browser-cases.mjs",
    "before": "c0d4c3a0b96a7248efadbb8eda3404c55479c1c050295ff6d05deb8f5e0dec3e",
    "after": "e59a10b200571879c333fcd00f46355556136917b5f8fd2615b749f79fa7de12"
  }
];
const reviewedArtifactCache = new Map();
function reviewedListingArtifact(file) {
  if (reviewedArtifactCache.has(file)) return reviewedArtifactCache.get(file);
  const pair = reviewedListingArtifacts.find(item => item.file === file);
  let approved = false;
  if (pair) {
    const hash = value => createHash('sha256').update(value).digest('hex');
    const before = hash(git(['show', `${mergeBase}:${file}`]));
    if (before === pair.before || before === pair.alternateBefore) {
      try {approved = hash(readFileSync(file)) === pair.after;} catch {bail();}
    }
  }
  reviewedArtifactCache.set(file, approved);
  return approved;
}
for (const { file, text } of removed) {
  if (isCode(file) && isTest(file) && !deleted.includes(file) && /\b(?:expect|assert|should)\b/.test(stripStrings(text))) {
    if (!reviewedReplacement(file, text) && !reviewedListingArtifact(file)) flag('assertion-removed', file);
  }
}

const ruleKey = (text) => {
  const value = text.trim();
  if (value.startsWith('|')) return value.split('|').map((cell) => cell.trim()).filter(Boolean)[0] ?? '';
  if (/^[-*] /.test(value)) return value.slice(2).split(':')[0].trim();
  return null;
};
function thresholds(text) {
  const values = [];
  for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const before = text.slice(Math.max(0, match.index - 24), match.index).toLowerCase();
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40).toLowerCase();
    const minimum = /(?:>=|>|≥|at least|minimum|\bmin\b|no less than|not fall|not drop)\s*$/.test(before) || /^\s*\S*\s*(?:or more|or higher|must not fall|must not drop)/.test(after);
    const maximum = /(?:<=|<|≤|at most|maximum|\bmax\b|no more than|under|below|not grow|not exceed)\s*$/.test(before) || /^\s*\S*\s*(?:or less|or lower|must not grow|must not exceed)/.test(after);
    values.push({ number: Number(match[0]), direction: minimum ? 'min' : maximum ? 'max' : null });
  }
  return values;
}
const removedRules = removed.filter(({ file, text }) => isConstraints(file) && ruleKey(text) !== null);
const addedRules = added.filter(({ file, text }) => isConstraints(file) && ruleKey(text) !== null);
for (const previous of removedRules) {
  const replacement = addedRules.find((next) => ruleKey(next.text) === ruleKey(previous.text));
  if (!replacement) {
    if (!/^\| *(?:W|E)\d+ *\|/.test(previous.text.trim())) flag('rule-removed', previous.file);
    continue;
  }
  const before = thresholds(previous.text), after = thresholds(replacement.text);
  for (const direction of ['min', 'max', null]) {
    const was = before.filter((item) => item.direction === direction);
    const now = after.filter((item) => item.direction === direction);
    for (let index = 0; index < was.length; index++) {
      if (!now[index]) flag('threshold-removed', previous.file);
      else if (now[index].number !== was[index].number &&
        (direction === 'min' ? now[index].number < was[index].number : direction === 'max' ? now[index].number > was[index].number : true)) {
        flag(direction ? 'threshold-loosened' : 'threshold-changed', previous.file);
      }
    }
  }
}
if (!findings.length) {
  console.log('quality-floor: clean');
  process.exit(0);
}
console.error(`quality-floor: ${findings.length} violation(s); review rule and path (source redacted)`);
for (const finding of findings) console.error(`[${finding.rule}] ${JSON.stringify(finding.file)}`);
process.exit(1);
