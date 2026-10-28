import type { LayoutPage, VisitExtraction } from '../domain/types';
import { parseDocument } from './document';
import { parseVisitPage } from './visit';

export function parseRecords(pages: LayoutPage[]) {
  // A separate visit requires its own heading. Continuations and ambiguous pages
  // stay accessible in the original; dates never silently merge records.
  const visits: VisitExtraction[] = pages.flatMap((page) => {
    const visit = parseVisitPage(page);
    return visit ? [visit] : [];
  });
  const visitPages = new Set(visits.map((visit) => visit.sourcePage));
  const parsed = parseDocument(pages.filter((page) => !visitPages.has(page.pageIndex)));
  const reports = parsed.reports.filter((report) => report.template && report.observations.length);
  return {
    visits,
    reports,
    parsing: {
      ...parsed.parsing,
      unprocessed: [
        ...parsed.parsing.unprocessed,
        ...visits.map((visit) => ({
          page: visit.sourcePage,
          rect: { x: 0, y: 0, width: 1, height: 1 },
        })),
      ],
      sections: parsed.parsing.sections.filter((section) =>
        reports.some((r) => r.sectionKey === section.key),
      ),
    },
    recordKind: visits.length
      ? reports.length
        ? ('mixed' as const)
        : ('visit' as const)
      : reports.length
        ? ('report' as const)
        : ('unknown' as const),
  };
}
