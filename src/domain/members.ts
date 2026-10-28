import type { Member, Report } from './types';
import { validDate } from './metrics';

export const SELF_ID = 'self';
export const selfMember: Member = {
  id: SELF_ID,
  label: '我',
  name: '',
  birth: '',
  tone: 'green',
  createdAt: '',
};
export function validateMember(member: Member): void {
  if (!member.id || !member.label.trim() || member.label.trim().length > 12)
    throw new Error('请填写 1–12 个字的称呼。');
  if (member.name.trim().length > 30) throw new Error('姓名最多 30 个字。');
  if (
    member.birth &&
    (!validDate(member.birth) || member.birth > new Date().toISOString().slice(0, 10))
  )
    throw new Error('请填写有效的出生日期，例如 1990-01-01，也可以留空。');
}
export const normalizedName = (name: string) => name.normalize('NFKC').replace(/\s/g, '');
export function hasNameMismatch(member: Member, patient: string): boolean {
  return !!(
    normalizedName(member.name) &&
    normalizedName(patient) &&
    normalizedName(member.name) !== normalizedName(patient)
  );
}
export function needsIdentityReview(
  member: Member,
  report: Pick<Report, 'patient' | 'identityConfirmation'>,
): boolean {
  return (
    hasNameMismatch(member, report.patient) &&
    (report.identityConfirmation?.memberName !== member.name ||
      report.identityConfirmation.patient !== report.patient.trim())
  );
}
// The existing UNIQUE hash column is a deduplication key. The original content
// hash remains in the document JSON. A composite key avoids rebuilding files/FKs.
export const documentKey = (memberId: string, hash: string) => JSON.stringify([memberId, hash]);
