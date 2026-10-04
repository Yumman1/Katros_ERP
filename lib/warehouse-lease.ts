/** Calendar-month lease end, clamped for dates such as 31 January. */
export function leaseReminder(startValue: string | Date | null | undefined, months: number | null | undefined, now = new Date()) {
  if (!startValue || !months || months <= 0) return null;
  const start = new Date(startValue);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  const day = start.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth()+months);
  const last = new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
  end.setUTCDate(Math.min(day,last));
  const halfway = new Date(start.getTime()+(end.getTime()-start.getTime())/2);
  return now >= halfway ? { start, end, halfway, expired: now >= end } : null;
}
