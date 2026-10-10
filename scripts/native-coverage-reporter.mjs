// Consume documented Node test events, not unstable TAP/spec text.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const percentage = (covered, total) => total ? Math.round(covered / total * 10000) / 100 : null;

export function summarizeCoverage(files, inventory, root = repository) {
  if (!Array.isArray(files) || !files.length) throw new Error('Native source coverage is missing');
  const totals = Object.fromEntries(['lines', 'branches', 'functions'].map(key => [key, { covered: 0, total: 0 }]));
  const observed = new Set();
  const reports = files.map(file => {
    if (!path.isAbsolute(file.path)) throw new Error('Unexpected coverage source');
    const relative = path.relative(root, file.path).split(path.sep).join('/');
    if (!inventory.includes(relative) || observed.has(relative)) throw new Error('Unexpected or duplicate coverage source');
    observed.add(relative);
    const report = { path: relative };
    for (const [metric, field] of [['lines', 'Line'], ['branches', 'Branch'], ['functions', 'Function']]) {
      const total = file[`total${field}Count`], covered = file[`covered${field}Count`];
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(covered) || covered < 0 || total < covered) {
        throw new Error('Invalid native coverage counts');
      }
      report[metric] = { covered, total, percent: percentage(covered, total) };
      totals[metric].covered += covered; totals[metric].total += total;
    }
    report.uncoveredLines = file.lines.filter(line => line.count === 0).map(line => line.line);
    return report;
  }).sort((a, b) => a.path.localeCompare(b.path));
  for (const metric of Object.values(totals)) metric.percent = percentage(metric.covered, metric.total);
  return { scope: 'native-backend-subset', changedLineGate: false, sourceFiles: inventory.length,
    measuredFiles: observed.size, totals, files: reports, unmeasuredFiles: inventory.filter(file => !observed.has(file)).sort() };
}

function sourceInventory(directory = path.join(repository, 'src')) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceInventory(file);
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [path.relative(repository, file).split(path.sep).join('/')] : [];
  });
}

export default async function* reporter(events) {
  let coverage, summary;
  for await (const event of events) {
    if (event.type === 'test:coverage') {
      if (coverage) throw new Error('Duplicate native coverage summary');
      coverage = event.data.summary.files;
    }
    if (event.type === 'test:summary' && event.data.file === undefined) summary = event.data;
  }
  const counts = summary?.counts;
  if (!summary?.success || !Number.isSafeInteger(counts?.tests) || counts.tests <= 0 || counts.passed !== counts.tests ||
      ['failed', 'cancelled', 'skipped', 'todo'].some(key => counts[key] !== 0)) {
    throw new Error('Coverage requires a successful, nonempty test run without skips');
  }
  const report = summarizeCoverage(coverage, sourceInventory());
  yield JSON.stringify({ nodeVersion: process.version, tests: counts, ...report }, null, 2) + '\n';
}
