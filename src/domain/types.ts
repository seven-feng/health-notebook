export type Rect = { x: number; y: number; width: number; height: number };
export type Span = { text: string; rect: Rect; confidence?: number };
export type LayoutPage = {
  pageIndex: number;
  width: number;
  height: number;
  spans: Span[];
  readingLines?: Span[]; // Original native line order, independent of table geometry.
  numericSpans?: Span[];
  tableSpans?: Span[]; // Alternate-scale Chinese OCR for unfamiliar lab tables.
  cellSpans?: Span[];
  extractionMethod?: 'text' | 'ocr';
};
export type ExtractedPdf = { pages: LayoutPage[]; pageCount: number };
export type OcrRegion = { pageIndex: number; rect: Rect };
export type OcrRegionResult = OcrRegion & { spans: Span[] };
export type Observation = {
  resultKind?: 'numeric' | 'qualified' | 'qualitative' | 'text' | 'missing';
  headerSource?: { page: number; rect: Rect };
  markerStatus?: 'read' | 'unavailable';
  id: string;
  name: string;
  code: string;
  rawValue: string;
  unit: string;
  reference: string;
  specimen: string;
  method: string;
  page: number;
  rect?: Rect;
  sourceRect?: Rect; // Whole printed row, including unit, range and report marker.
  valueRect?: Rect;
  originalValue: string;
  originalName?: string;
  originalUnit?: string;
  reportFlag?: 'high' | 'low'; // The printed report marker, never inferred from the result.
  needsReview?: boolean;
  reviewed?: boolean; // Explicit acknowledgement, persisted when a draft is saved.
  warnings?: string[];
};
export type Member = {
  id: string;
  label: string;
  name: string;
  birth: string;
  tone: string;
  createdAt: string;
};
export type Report = {
  reportType?: 'imaging'; // Narrative exam results; never individual metric measurements.
  memberId: string;
  identityConfirmation?: { memberName: string; patient: string };
  id: string;
  documentId: string;
  title: string;
  patient: string;
  date: string;
  dateKind: 'sample' | 'report' | 'exam' | 'unknown';
  dateSource?: 'header'; // Unlabelled date from the verified report header.
  status: 'review' | 'confirmed' | 'archived';
  template: string | null;
  warnings: string[];
  observations: Observation[];
  createdAt: string;
  confirmedAt?: string;
  sourcePage?: number;
  sourcePages?: number[];
  sectionKey?: string;
  extractionMethod?: 'text' | 'ocr';
};
export type DocumentRecord = {
  recordKind?: 'visit' | 'report' | 'mixed' | 'unknown';
  parsing?: {
    version: number;
    sections: { key: string; pages: number[]; title: string }[];
    unprocessed: { page: number; rect: Rect }[];
  };
  memberId: string;
  sourceType?: 'image'; // Confirmed image pixels stored in a one-page local PDF; absent for PDFs.
  id: string;
  hash: string;
  fileName: string;
  uri: string;
  pageCount: number;
  state: 'queued' | 'extracting' | 'ready' | 'failed';
  error: string | null;
  createdAt: string;
};
export type Visit = {
  memberId: string;
  id: string;
  date: string;
  title: string;
  note: string;
  reportIds?: string[];
  documentId?: string;
  sourcePage?: number;
  patient?: string;
  hospital?: string;
  department?: string;
  status?: 'review' | 'confirmed'; // Absent on legacy manual visits.
  createdAt?: string;
  identityConfirmation?: { memberName: string; patient: string };
  sections?: Partial<Record<VisitSectionKey, string>>;
  original?: VisitExtraction;
};
export type VisitSectionKey = 'chief' | 'present' | 'past' | 'exam' | 'diagnosis' | 'plan';
export type VisitExtraction = {
  version: number;
  date: string;
  patient: string;
  hospital: string;
  department: string;
  sourcePage: number;
  sections: Partial<Record<VisitSectionKey, { text: string; rect: Rect }>>;
  lines: Span[];
};
export type ParsedValue = { operator: '=' | '<' | '>' | '<=' | '>='; value: string } | null;
export type SeriesPoint = {
  reportId: string;
  observationId: string;
  date: string;
  value: string;
  rawValue: string;
  reference: string;
  sourceName?: string;
  sourceUnit?: string;
  reportTitle?: string;
};
export type MetricSeries = {
  kind?: 'numeric';
  key: string;
  name: string;
  unit: string;
  points: SeriesPoint[];
  comparisonNote?: string;
  separationLabel?: string;
};
export type TextSeriesPoint = Omit<SeriesPoint, 'value'>;
export type TextMetricSeries = Omit<MetricSeries, 'kind' | 'points'> & {
  kind: 'text';
  points: TextSeriesPoint[];
};
export type MetricGroup = MetricSeries | TextMetricSeries;
export type UntrendedResult = {
  key: string;
  reportId: string;
  name: string;
  rawValue: string;
  unit: string;
  reference: string;
  date: string;
  reportTitle: string;
  reasons: string[];
};
