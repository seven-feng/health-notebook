import type { Observation, Rect, Report } from './types';
import { sourceRegion } from './source-region';
import { reviewCopy, reviewMessages } from './review-messages';

export type ReviewGroup = { indices: number[]; page: number; rect?: Rect };

// Recognition and explicit user acknowledgement are separate states. Older
// confirmed reports and previously acknowledged warnings retain their status.
export function isReviewed(report: Report, item: Observation): boolean {
  if (item.needsReview) return false;
  if (item.reviewed !== undefined) return item.reviewed;
  return (
    report.status === 'confirmed' ||
    !!report.confirmedAt ||
    (item.needsReview === false && !!item.warnings?.length)
  );
}

export function needsIndividualReview(item: Observation): boolean {
  if (!item.name.trim() || !item.rawValue.trim()) return true;
  if (!item.needsReview) return false;
  // An edited or manually added value needs its own acknowledgement, even
  // when the only message is the generic reminder.
  if (item.reviewed === false) return true;
  const messages = reviewMessages(item.warnings ?? []);
  // Generic reminders are covered by the final report confirmation. Unknown
  // warnings and concrete recognition issues still need an individual check.
  return (
    !messages.length ||
    messages.some((message) => message !== reviewCopy.item && message !== reviewCopy.text)
  );
}

export function reviewGroups(report: Report): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  report.observations.forEach((item, index) => {
    const rect = sourceRegion(report, item);
    const previous = groups.at(-1);
    const sameColumn =
      previous?.rect && rect
        ? Math.abs(previous.rect.x - rect.x) < 0.08 &&
          Math.abs(previous.rect.width - rect.width) < 0.12 &&
          rect.y >= previous.rect.y
        : !previous?.rect && !rect;
    if (!previous || previous.indices.length === 5 || previous.page !== item.page || !sameColumn) {
      groups.push({ indices: [index], page: item.page, rect });
      return;
    }
    previous.indices.push(index);
    if (previous.rect && rect) {
      const x = Math.min(previous.rect.x, rect.x);
      const y = Math.min(previous.rect.y, rect.y);
      previous.rect = {
        x,
        y,
        width: Math.max(previous.rect.x + previous.rect.width, rect.x + rect.width) - x,
        height: Math.max(previous.rect.y + previous.rect.height, rect.y + rect.height) - y,
      };
    }
  });
  return groups;
}
