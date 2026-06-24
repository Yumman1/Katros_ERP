/**
 * When true, API routes use static dummy data and skip Prisma.
 * Set MOCK_MODE=true in .env (see .env.example).
 */
export function isMockMode(): boolean {
  const m = process.env.MOCK_MODE ?? process.env.SKIP_DATABASE;
  return m === "true" || m === "1";
}
