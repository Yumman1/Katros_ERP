/**
 * Environment for standalone scripts, following the precedence `next dev` uses.
 *
 * Import this before anything that touches the database: the Prisma client
 * resolves its connection string when the module is first evaluated, and an
 * import runs before any statement in the file that imports it.
 */
import { config } from "dotenv";

// dotenv keeps the first value it sees for a key, so the file that should win
// is loaded first. `.env.local` holds what `vercel env pull` wrote.
config({ path: ".env.local" });
config();
