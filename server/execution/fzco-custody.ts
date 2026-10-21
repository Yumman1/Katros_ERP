import type { Prisma } from '@prisma/client';
import { sesameGrade } from '@/lib/sesame-processing';
import { tradeEntity, internalEntity, FZCO_NO_PAKISTAN_WAREHOUSE } from '@/lib/sesame-entity';
import { quantityUnitToKg } from '@/lib/unit-conversion';
type DB = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);

/** Supplier-held goods are derived from locked purchases, independently of payment. */
export async function custodyRows(db: DB, code: string) {
 const [purchases, shipments] = await Promise.all([
  db.trade.findMany({ where: { direction: 'BUY', tradeStatus: { in: ['LOCKED','CONFIRMED','EXECUTED'] }, commodity: { code }, contract: { isNot: null } }, include: { contract: true, counterparty: true } }),
  db.sesameExportShipment.findMany({ where: { directThirdParty: true, status: { not: 'REJECTED' }, trade: { direction: 'SELL', commodity: { code } } }, include: { trade: { select: { tradeParams: true } } } }),
 ]);
 const rows = new Map<string, { warehouseName: null; holderId: string; holder: string; location: string; grade: ReturnType<typeof sesameGrade>; ownedMt: number; reservedMt: number; availableMt: number }>();
 const key = (holder: string, grade: string) => JSON.stringify([holder, grade]);
 for (const t of purchases) {
  if (tradeEntity(t.tradeParams) !== 'FZCO' || internalEntity(t.tradeParams)) continue;
  const grade = sesameGrade(t.tradeParams), k = key(t.counterpartyId, grade);
  const row = rows.get(k) ?? { warehouseName: null, holderId: t.counterpartyId, holder: t.counterparty.name, location: '', grade, ownedMt: 0, reservedMt: 0, availableMt: 0 };
  row.ownedMt += quantityUnitToKg(n(t.contract!.contractualQtyMt), t.contract!.quantityUnit) / 1000;
  rows.set(k, row);
 }
 for (const s of shipments) {
  if (!s.holderId || tradeEntity(s.trade.tradeParams) !== 'FZCO') continue;
  const row = rows.get(key(s.holderId, sesameGrade(s.trade.tradeParams)));
  if (!row) continue;
  if (s.status === 'RELEASED' || s.status === 'BL_RECORDED') row.ownedMt -= n(s.totalWeightKg) / 1000;
  else row.reservedMt += n(s.totalWeightKg) / 1000;
 }
 return [...rows.values()].map(r => ({ ...r, availableMt: r.ownedMt - r.reservedMt }));
}
export async function assertCustody(db: DB, code: string, grade: ReturnType<typeof sesameGrade>, qtyMt: number, source: { warehouseName?: string; holderId?: string; location?: string }, release = false) {
 if (source.warehouseName) throw new Error(FZCO_NO_PAKISTAN_WAREHOUSE);
 const row = (await custodyRows(db, code)).find(r => r.grade === grade && r.holderId === source.holderId);
 if (!row || (release ? row.ownedMt : row.availableMt) + .000001 < qtyMt) throw new Error(`Insufficient ${grade} stock held by this supplier`);
}
