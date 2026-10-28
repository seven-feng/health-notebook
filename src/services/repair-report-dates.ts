import { LocalPdf } from '../../modules/local-pdf';
import { fillMissingReportDate, getDocuments, getReports, getSetting, setSetting } from '../db';
import { parseZheyiPage } from '../parser/zheyi';
import { validDate } from '../domain/metrics';

let running: Promise<void> | undefined;
export function repairMissingReportDates(): Promise<void> {
  return (running ??= repair().finally(() => {
    running = undefined;
  }));
}
async function repair(): Promise<void> {
  const reports = (await getReports()).filter(
    (report) =>
      !report.date.trim() &&
      report.status !== 'archived' &&
      report.template?.startsWith('fahzu-yh-'),
  );
  if (!reports.length) return;
  for (const doc of await getDocuments()) {
    const targets = reports.filter(
      (report) => report.documentId === doc.id && report.memberId === doc.memberId,
    );
    if (!targets.length || doc.state !== 'ready') continue;
    const key = `report-date-repair-v1:${doc.id}`;
    if (await getSetting(key)) continue;
    try {
      const extracted = await LocalPdf.extract(doc.uri);
      for (const report of targets) {
        const sourcePage =
          report.sourcePage ??
          report.observations[0]?.page ??
          (doc.pageCount === 1 ? 0 : undefined);
        if (sourcePage === undefined || (report.sourcePages?.length ?? 1) > 1) continue;
        const page = extracted.pages.find((page) => page.pageIndex === sourcePage);
        const parsed = page && parseZheyiPage(page);
        if (!parsed || parsed.template !== report.template || !validDate(parsed.date)) continue;
        await fillMissingReportDate(report, {
          date: parsed.date,
          dateKind: parsed.dateKind ?? 'unknown',
          dateSource: parsed.dateSource,
        });
      }
      // Persist a successful attempt even if no reliable date was found. Opening
      // the app again must not rescan the same PDF; manual editing stays available.
      await setSetting(key, 'done');
    } catch {
      // A locked/unavailable original can be retried on a later foreground event.
      // Preserve the records and allow the rest of the app to open normally.
    }
  }
}
