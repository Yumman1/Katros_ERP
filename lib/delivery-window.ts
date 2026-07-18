export type DeliveryWindowState =
  | "NO_DATES"
  | "NOT_STARTED"
  | "IN_WINDOW"
  | "DUE_SOON"
  | "OVERDUE"
  | "FULFILLED";

export type DeliveryWindowInfo = {
  state: DeliveryWindowState;
  label: string;
  /** Whole days from `now` to deliveryEnd (negative = past due). Null if no end date. */
  daysToEnd: number | null;
};

/** Days threshold under which an open, in-window contract is flagged "due soon". */
const DUE_SOON_DAYS = 5;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmt(d: Date): string {
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Delivery-window status shared by trader + execution surfaces so a booked
 * delivery period actually drives fulfilment (a trade must be fulfilled within
 * its delivery dates). Works for both local and international trades.
 */
export function deliveryWindowStatus(
  deliveryStart: Date | string | null | undefined,
  deliveryEnd: Date | string | null | undefined,
  opts?: { now?: Date; fulfilled?: boolean },
): DeliveryWindowInfo {
  if (opts?.fulfilled) {
    return { state: "FULFILLED", label: "Fulfilled", daysToEnd: null };
  }
  if (!deliveryStart && !deliveryEnd) {
    return { state: "NO_DATES", label: "No window", daysToEnd: null };
  }

  const now = startOfDay(opts?.now ?? new Date());
  const start = deliveryStart ? startOfDay(new Date(deliveryStart)) : null;
  const end = deliveryEnd ? startOfDay(new Date(deliveryEnd)) : null;
  const dayMs = 24 * 60 * 60 * 1000;
  const daysToEnd = end ? Math.round((end.getTime() - now.getTime()) / dayMs) : null;

  if (start && now < start) {
    const inDays = Math.round((start.getTime() - now.getTime()) / dayMs);
    return { state: "NOT_STARTED", label: `Opens ${fmt(start)} · in ${inDays}d`, daysToEnd };
  }

  if (end && now > end) {
    const overdue = Math.round((now.getTime() - end.getTime()) / dayMs);
    return { state: "OVERDUE", label: `Overdue ${overdue}d`, daysToEnd };
  }

  if (daysToEnd != null && daysToEnd <= DUE_SOON_DAYS) {
    return {
      state: "DUE_SOON",
      label: daysToEnd <= 0 ? "Due today" : `Due in ${daysToEnd}d`,
      daysToEnd,
    };
  }

  return {
    state: "IN_WINDOW",
    label: end ? `Due ${fmt(end)}` : "In window",
    daysToEnd,
  };
}

export const DELIVERY_WINDOW_TONE: Record<DeliveryWindowState, { bg: string; color: string }> = {
  NO_DATES: { bg: "rgba(255,255,255,0.04)", color: "#71717a" },
  NOT_STARTED: { bg: "rgba(96,165,250,0.12)", color: "#60a5fa" },
  IN_WINDOW: { bg: "rgba(52,211,153,0.12)", color: "#34d399" },
  DUE_SOON: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },
  OVERDUE: { bg: "rgba(239,68,68,0.15)", color: "#f87171" },
  FULFILLED: { bg: "rgba(255,255,255,0.04)", color: "#a1a1aa" },
};
