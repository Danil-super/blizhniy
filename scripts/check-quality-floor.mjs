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
  ['tests/local-registration-ui.test.mjs', '  assert.match(html, /minLength="15"/i);', '  assert.match(html, /minLength="8"/i);'],
  ['tests/production-account-browser.mjs',
    '      assert.deepEqual(Object.keys(calls[0].body).sort(), ["email", "password", "acceptedAgreement", "acknowledgedPrivacy", "agreementVersion", "privacyVersion", "captchaToken"].sort());',
    '      assert.deepEqual(Object.keys(calls[0].body).sort(), ["name", "email", "password", "acceptedAgreement", "acknowledgedPrivacy", "agreementVersion", "privacyVersion", "captchaToken"].sort());'],
];
const reviewedReplacement = (file, text) => registrationAssertionPairs.some(([path, before, after]) =>
  file === path && text === before &&
  removed.filter(line => line.file === path && line.text === before).length === 1 &&
  added.filter(line => line.file === path && line.text === after).length === 1);
// Exact complete browser-test replacements approved by the owner, 2026-10-20.
// Content-addressed artifacts, not a blanket permission to remove assertions.
const reviewedListingArtifacts = [
  {
    "file": "tests/primary-listing-form-browser.mjs",
    "before": "107b019ad1e6dcd5c1d323a179d8ef34a4666aec11746bf6a4bdeca76c1a3b2f",
    "after": "94b3afeb529892c4c943687a6584b4199b142ea76f8eda1a105b0a90252c40f6"
  },
  {
    "file": "tests/account-test-checkout-browser-cases.mjs",
    "before": "d764cf2fd91d5f4dbc195e9a407dd8c29f01e0bdd2f6316e0c15aad2ff0a9007",
    "after": "8b1a001d57fb3ace15c8c492e6a61af66d73e0318ae38afe3d14fe99b4ada260"
  },
  {
    "file": "tests/production-account-browser.mjs",
    "before": "5254b6e61d8d990150c165b4ee2fe7fce21a7af520c6082c7696ebdfce632698",
    "after": "e6d407deeae1ecb2e0a7361c954c162c0a46191257746fb3c24dec033795db98"
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
    if (hash(git(['show', `${mergeBase}:${file}`])) === pair.before) {
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
