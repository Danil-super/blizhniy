#!/usr/bin/env node
// Adapted from constraint-driven-development/references/floor-guard.md.
// A diff heuristic, not a parser or a replacement for security scanners/review.
import { execFileSync } from 'node:child_process';

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
for (const { file, text } of removed) {
  if (isCode(file) && isTest(file) && !deleted.includes(file) && /\b(?:expect|assert|should)\b/.test(stripStrings(text))) {
    flag('assertion-removed', file);
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
