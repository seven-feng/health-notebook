import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const folder = resolve(root, process.argv[2] || 'private-fixtures/ocr');
const compile = spawnSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    '--module',
    'commonjs',
    '--esModuleInterop',
    '--outDir',
    'tmp/ocr/compiled',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'src/parser/index.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);
const require = createRequire(import.meta.url);
const { parsePages } = require(resolve(root, 'tmp/ocr/compiled/parser/index.js'));
const expected = JSON.parse(readFileSync(resolve(folder, 'expected.json'), 'utf8'));
const sources = process.argv.slice(3);
if (!sources.length) sources.push('ios-simulator', 'android');
const summaries = [];
for (const source of sources)
  for (const name of ['a', 'b']) {
    const extraction = JSON.parse(readFileSync(resolve(folder, `${source}-${name}.json`), 'utf8'));
    const cellPath = resolve(folder, `${source}-${name}-cells.json`);
    const cells = existsSync(cellPath) ? JSON.parse(readFileSync(cellPath, 'utf8')) : [];
    for (const page of extraction.pages)
      page.cellSpans = cells.filter((c) => c.pageIndex === page.pageIndex).flatMap((c) => c.spans);
    const parsed = parsePages(extraction.pages)[0];
    const target = expected[name];
    const issues = [];
    let exact = 0,
      values = 0,
      suggestions = 0;
    for (const [index, row] of target.observations.entries()) {
      const actual = parsed?.observations[index];
      const different = ['name', 'rawValue', 'unit', 'reference'].filter(
        (key) => actual?.[key] !== row[key],
      );
      if (!different.length) exact++;
      if (actual?.rawValue === row.rawValue) values++;
      if (actual?.needsReview) suggestions++;
      if (different.length)
        issues.push({ row: index + 1, fields: different, flagged: !!actual?.needsReview });
    }
    const metadata = parsed?.patient === target.patient && parsed?.date === target.date;
    const complete = parsed?.observations.length === target.observations.length;
    const summary = {
      source,
      report: name,
      regionalRetries: cells.length,
      expectedRows: target.observations.length,
      exactRows: exact,
      correctValues: values,
      reviewRows: suggestions,
      metadataCorrect: metadata,
      rowCountCorrect: complete,
      issues,
    };
    summaries.push(summary);
    // Detailed health data remains only in the ignored private fixture directory.
    writeFileSync(
      resolve(folder, `${source}-parsed-${name}.json`),
      JSON.stringify(parsed, null, 2),
    );
    if (!metadata || !complete || issues.some((issue) => !issue.flagged)) process.exitCode = 1;
  }
mkdirSync(resolve(root, 'tmp/ocr'), { recursive: true });
writeFileSync(resolve(root, 'tmp/ocr/field-validation.json'), JSON.stringify(summaries, null, 2));
console.log(JSON.stringify(summaries, null, 2));
