import { LocalPdf } from '../../modules/local-pdf';
import * as db from '../../src/db';
import { repairMissingReportDates } from '../../src/services/repair-report-dates';
import { parseZheyiPage } from '../../src/parser/zheyi';
import type { DocumentRecord, LayoutPage, Report } from '../../src/domain/types';
jest.mock('../../modules/local-pdf', () => ({ LocalPdf: { extract: jest.fn() } }));
jest.mock('../../src/db', () => ({
  getReports: jest.fn(),
  getDocuments: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  fillMissingReportDate: jest.fn(),
}));
jest.mock('../../src/parser/zheyi', () => ({ parseZheyiPage: jest.fn() }));
const report = {
  id: 'r',
  documentId: 'd',
  memberId: 'self',
  date: '',
  template: 'fahzu-yh-cbc-single-v3',
  sourcePage: 0,
  status: 'confirmed',
  observations: [],
} as unknown as Report;
const doc = {
  id: 'd',
  memberId: 'self',
  state: 'ready',
  uri: 'file:///current/reports/d.pdf',
  pageCount: 1,
} as DocumentRecord;
const page = { pageIndex: 0 } as LayoutPage;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(db.getReports).mockResolvedValue([report]);
  jest.mocked(db.getDocuments).mockResolvedValue([doc]);
  jest.mocked(db.getSetting).mockResolvedValue(null);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [page] });
  jest
    .mocked(parseZheyiPage)
    .mockReturnValue({
      ...report,
      date: '2024-05-04',
      dateKind: 'sample',
      dateSource: 'header',
      warnings: [],
      patient: '',
      title: '',
    });
});
test('repairs once, coalesces simultaneous startup events, and preserves the saved review state', async () => {
  await Promise.all([repairMissingReportDates(), repairMissingReportDates()]);
  expect(LocalPdf.extract).toHaveBeenCalledTimes(1);
  expect(db.fillMissingReportDate).toHaveBeenCalledWith(report, {
    date: '2024-05-04',
    dateKind: 'sample',
    dateSource: 'header',
  });
  expect(db.setSetting).toHaveBeenCalledWith('report-date-repair-v1:d', 'done');
  jest.mocked(db.getSetting).mockResolvedValue('done');
  await repairMissingReportDates();
  expect(LocalPdf.extract).toHaveBeenCalledTimes(1);
});
test('does not rescan a successful attempt that found no date', async () => {
  jest.mocked(parseZheyiPage).mockReturnValue(null);
  await repairMissingReportDates();
  expect(db.fillMissingReportDate).not.toHaveBeenCalled();
  expect(db.setSetting).toHaveBeenCalledWith('report-date-repair-v1:d', 'done');
});
test('an unavailable original is retryable and does not break startup', async () => {
  jest.mocked(LocalPdf.extract).mockRejectedValue(new Error('protected'));
  await expect(repairMissingReportDates()).resolves.toBeUndefined();
  expect(db.setSetting).not.toHaveBeenCalled();
  expect(db.fillMissingReportDate).not.toHaveBeenCalled();
});
test('existing dates, unrelated templates and other members are untouched', async () => {
  jest.mocked(db.getReports).mockResolvedValue([
    { ...report, date: '2024-05-01' },
    { ...report, id: 'unknown', template: 'lab-table-v1' },
    { ...report, id: 'mom', memberId: 'mom' },
  ]);
  await repairMissingReportDates();
  expect(LocalPdf.extract).not.toHaveBeenCalled();
  expect(db.fillMissingReportDate).not.toHaveBeenCalled();
});
