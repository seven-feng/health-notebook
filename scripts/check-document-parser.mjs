import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// All input and detailed output paths are local/explicit. Stdout has no medical
// values or identity data; use an ignored directory for the detailed comparison.
const [goldPath, nativePath, outputPath] = process.argv.slice(2);
if (!goldPath || !nativePath || !outputPath) {
  console.error(
    'Usage: node scripts/check-document-parser.mjs <private-gold.json> <native.json> <private-output-directory>',
  );
  process.exit(2);
}
const root = resolve(import.meta.dirname, '..');
const compiled = resolve(root, 'tmp/document-parser-compiled');
const build = spawnSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    '--module',
    'commonjs',
    '--esModuleInterop',
    '--outDir',
    compiled,
    '--target',
    'ES2022',
    '--skipLibCheck',
    'src/parser/document.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const require = createRequire(import.meta.url);
const { parseDocument } = require(resolve(compiled, 'parser/document.js'));
const { normalizedText, resultKind } = require(resolve(compiled, 'parser/sections.js'));
const gold = JSON.parse(readFileSync(resolve(goldPath), 'utf8'));
const native = JSON.parse(readFileSync(resolve(nativePath), 'utf8'));
const started = performance.now();
const result = parseDocument(native.pages);
const parseMs = performance.now() - started;
const summary = {
  pages: native.pageCount,
  sections: result.reports.length,
  expected: 0,
  actual: result.reports.reduce((n, r) => n + r.observations.length, 0),
  matchedCoreRows: 0,
  matchedIncludingMarkers: 0,
  missing: 0,
  extra: 0,
  sourcePageErrors: 0,
  headerPageErrors: 0,
  resultTypeErrors: 0,
  sourceSectionErrors: 0,
  markerMismatches: 0,
  fields: { name: 0, rawValue: 0, unit: 0, reference: 0 },
  nativeExtractionMs: native.elapsedMs ?? null,
  parseMs: Math.round(parseMs * 10) / 10,
};
const issues = [];
const used = new Set();
for (const expected of gold.sections) {
  const report = result.reports.find((r) => r.title === expected.title);
  if (JSON.stringify(report?.sourcePages) !== JSON.stringify(expected.sourcePages))
    summary.sourceSectionErrors++;
  for (const [row, o] of expected.observations.entries()) {
    summary.expected++;
    const candidates =
      report?.observations.filter(
        (v) => normalizedText(v.name) === normalizedText(o.name) && !used.has(v),
      ) ?? [];
    const actual = candidates.find((v) => v.page === o.page) ?? candidates[0];
    if (!actual) {
      summary.missing++;
      issues.push({ section: expected.title, row, missing: true, expected: o });
      continue;
    }
    used.add(actual);
    let core = true;
    for (const field of ['name', 'rawValue', 'unit', 'reference']) {
      if (normalizedText(actual[field]) === normalizedText(o[field])) summary.fields[field]++;
      else {
        core = false;
        issues.push({
          section: expected.title,
          row,
          field,
          expected: o[field],
          actual: actual[field],
        });
      }
    }
    if (actual.page !== o.page) {
      summary.sourcePageErrors++;
      core = false;
    }
    if (actual.headerSource?.page !== expected.headerPage) {
      summary.headerPageErrors++;
      core = false;
    }
    if (actual.resultKind !== resultKind(o.rawValue)) {
      summary.resultTypeErrors++;
      core = false;
    }
    if (core) summary.matchedCoreRows++;
    if ((actual.reportFlag ?? null) !== o.reportFlag) {
      summary.markerMismatches++;
      issues.push({
        section: expected.title,
        row,
        field: 'reportFlag',
        expected: o.reportFlag,
        actual: actual.reportFlag ?? null,
        status: actual.markerStatus,
      });
    } else if (core) summary.matchedIncludingMarkers++;
  }
}
summary.extra = result.reports.flatMap((r) => r.observations).filter((o) => !used.has(o)).length;
mkdirSync(resolve(outputPath), { recursive: true });
writeFileSync(resolve(outputPath, 'parsed.json'), JSON.stringify(result, null, 2));
writeFileSync(resolve(outputPath, 'issues.json'), JSON.stringify(issues, null, 2));
writeFileSync(resolve(outputPath, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
// Unlike the older numeric-only regression helper, incomplete full-field gold
// is a failing check even if the UI correctly requests review.
if (
  summary.matchedIncludingMarkers !== summary.expected ||
  summary.extra ||
  summary.sourceSectionErrors
)
  process.exitCode = 1;
