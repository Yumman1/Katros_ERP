import fs from "fs";
import path from "path";
import {
  filterUploadedGatepassDocuments,
  gatepassDocumentDisplayName,
  isUploadedGatepassDocument,
} from "@/lib/gatepass-documents";
import { localDataPath } from "@/server/local-persist";

export {
  filterUploadedGatepassDocuments,
  gatepassDocumentDisplayName,
  isUploadedGatepassDocument,
};

const GATEPASS_DOCS_DIR = "gatepass-docs";

function ensureGatepassDocsDir() {
  const dir = localDataPath(GATEPASS_DOCS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/** Save gatepass document uploads; returns stored file labels for documentRefs. */
export async function saveGatepassDocuments(
  files: File[],
  gatepassNo: string,
): Promise<string[]> {
  if (!files.length) return [];
  const baseDir = ensureGatepassDocsDir();
  const folder = path.join(baseDir, safeFileName(gatepassNo));
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  const refs: string[] = [];
  for (const file of files) {
    if (!file.size) continue;
    const stamp = Date.now().toString(36);
    const stored = `${stamp}-${safeFileName(file.name)}`;
    const dest = path.join(folder, stored);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    refs.push(`gatepass-docs/${safeFileName(gatepassNo)}/${stored}`);
  }
  return refs;
}
