// Both l and L mean litre. Only normalize this spelling in known concentration
// units; prefix case (for example m versus M) and the numeric value stay intact.
export function normalizeConcentrationUnit(unit: string): string {
  return /^(?:μmol|mmol|nmol|[mpnuμµ]?g|[mM]?IU|U)\/(?:d|m)?l$/.test(unit)
    ? `${unit.slice(0, -1)}L`
    : unit;
}
