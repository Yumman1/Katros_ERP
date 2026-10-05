import { createHmac, timingSafeEqual } from "node:crypto";

function signature(payload: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Gate links require the configured application secret");
  return createHmac("sha256", secret).update(`internal-gate:${payload}`).digest("hex");
}

/** A shareable warehouse link scoped to one commodity, valid for 30 days. */
export function createInternalGateAccess(commodityCode: string) {
  const payload = Buffer.from(JSON.stringify({ commodityCode, expires: Date.now() + 30 * 86400000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function readInternalGateAccess(token: string): string | null {
  try {
    const [payload, supplied, extra] = token.split(".");
    if (!payload || !supplied || extra || !/^[a-f0-9]{64}$/.test(supplied)) return null;
    if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(payload), "hex"))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data.commodityCode === "string" && data.commodityCode.length > 0 && Number.isFinite(data.expires) && data.expires > Date.now() ? data.commodityCode : null;
  } catch { return null; }
}
