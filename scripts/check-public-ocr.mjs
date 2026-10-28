import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Deliberately requires local paths: no medical/source data enters the repo or app bundle.
const root = resolve(import.meta.dirname, '..');
const [corpusArg, extractionArg, outputArg] = process.argv.slice(2);
if (!corpusArg || !extractionArg || !outputArg) {
  console.error('Usage: node scripts/check-public-ocr.mjs <corpus> <native-extractions> <output>');
  process.exit(2);
}
const corpus = resolve(corpusArg),
  extraction = resolve(extractionArg),
  output = resolve(outputArg);
const compiled = resolve(root, 'tmp/public-ocr-compiled');
const compile = spawnSync(
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
    'src/parser/index.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);
const require = createRequire(import.meta.url);
const { parsePages } = require(resolve(compiled, 'parser/index.js'));
const { parseValue } = require(resolve(compiled, 'domain/metrics.js'));
const expected = JSON.parse(readFileSync(resolve(corpus, 'expected-values.json'), 'utf8'));
mkdirSync(output, { recursive: true });
const summaries = [];
for (const file of readdirSync(extraction)
  .filter((n) => /^public-(ios|android)-\d\d-.*\.json$/.test(n))
  .sort()) {
  const [, platform, id] = file.match(/^public-(ios|android)-(\d\d)-/);
  const native = JSON.parse(readFileSync(resolve(extraction, file), 'utf8'));
  const parsed = parsePages(native.pages)[0];
  const actual = parsed.observations;
  const target = expected.samples[id];
  const used = new Set();
  let correct = 0,
    missing = 0;
  const issues = [];
  if (target)
    for (const group of target.columns) {
      for (const [index, value] of group.values.entries()) {
        const y = group.firstCenter + index * group.rowStep;
        const candidate = actual
          .map((o, i) => ({ o, i }))
          .filter(
            ({ o, i }) =>
              !used.has(i) &&
              o.rect &&
              (group.side === 'single' || (o.sourceRect.x > 0.3 ? 'right' : 'left') === group.side),
          )
          .map((v) => ({
            ...v,
            distance: Math.abs(v.o.sourceRect.y + v.o.sourceRect.height / 2 - y),
          }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (!candidate || candidate.distance > group.rowStep * 0.48) {
          missing++;
          continue;
        }
        used.add(candidate.i);
        const equal = parseValue(candidate.o.rawValue)?.value === parseValue(value)?.value;
        if (equal) correct++;
        else
          issues.push({
            side: group.side,
            row: index + 1,
            expected: value,
            actual: candidate.o.rawValue,
            flagged: !!candidate.o.needsReview,
          });
        if (!equal && !candidate.o.needsReview) process.exitCode = 1;
      }
    }
  const summary = {
    platform,
    id,
    template: parsed.template,
    extractedRows: actual.length,
    expectedValues: target?.columns.reduce((n, c) => n + c.values.length, 0) ?? null,
    correctValues: target ? correct : null,
    missingValues: target ? missing : null,
    mismatchedValues: target ? issues.length : null,
    extraRows: target ? actual.length - used.size : null,
    allRowsRequireReview: actual.every((o) => o.needsReview),
    nativeMs: Math.round(native.elapsedMs ?? 0),
    issues,
  };
  summaries.push(summary);
  writeFileSync(resolve(output, file), JSON.stringify(parsed, null, 2));
}
if (summaries.length !== 18) {
  console.error('Expected all 9 sources on each of 2 platforms');
  process.exitCode = 1;
}
writeFileSync(
  resolve(output, 'summary.json'),
  JSON.stringify(
    {
      note: 'Values matched by manually specified source row positions. Decimal formatting normalized. Names, units, ranges and flags are NOT scored; this is not overall OCR accuracy. Sources used during development are not a held-out benchmark.',
      summaries,
    },
    null,
    2,
  ),
);
console.table(
  summaries.map(
    ({
      platform,
      id,
      extractedRows,
      expectedValues,
      correctValues,
      missingValues,
      mismatchedValues,
      extraRows,
    }) => ({
      platform,
      id,
      extractedRows,
      expectedValues,
      correctValues,
      missingValues,
      mismatchedValues,
      extraRows,
    }),
  ),
);
