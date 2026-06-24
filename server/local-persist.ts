import fs from "fs";
import path from "path";
import superjson from "superjson";
import { isMockMode } from "@/server/mock-mode";

const DATA_DIR =
  process.env.LOCAL_DATA_DIR?.trim() ||
  path.join(process.cwd(), "data", "local");

export const MASTER_DATA_FILE = "master-data.json";
export const TRADES_FILE = "booked-trades.json";
export const EXECUTION_FILE = "execution-state.json";

/** Persist mock CTRM data to disk (enabled by default in mock mode). */
export function isLocalPersistEnabled(): boolean {
  if (process.env.LOCAL_PERSIST === "false") return false;
  if (process.env.LOCAL_PERSIST === "true") return true;
  return isMockMode();
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function localDataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

export function readPersisted<T>(filename: string): T | null {
  if (!isLocalPersistEnabled()) return null;
  ensureDataDir();
  const filePath = localDataPath(filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return superjson.parse<T>(raw);
  } catch (e) {
    console.error(`[local-persist] Failed to read ${filename}:`, e);
    return null;
  }
}

export function writePersisted(filename: string, data: unknown): void {
  if (!isLocalPersistEnabled()) return;
  ensureDataDir();
  const filePath = localDataPath(filename);
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload = superjson.stringify(data);
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, filePath);
}
