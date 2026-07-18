import { Prisma } from "@prisma/client";

/**
 * Prisma returns DECIMAL columns as Prisma.Decimal objects. The domain layer
 * (lib/ calculations, components) works with plain JS numbers, so every
 * repository converts at the boundary with these helpers. Postgres keeps the
 * exact decimal value; JS numbers are only used for display and in-request
 * arithmetic.
 */

export function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

export function numOrNull(
  value: Prisma.Decimal | number | null | undefined,
): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

/** JSON column → typed value (Prisma stores JsonValue). */
export function json<T>(value: Prisma.JsonValue | null | undefined): T | null {
  if (value == null) return null;
  return value as T;
}
