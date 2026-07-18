import fs from "fs";
import path from "path";
import {
  filterUploadedGatepassDocuments,
  gatepassDocumentDisplayName,
  isUploadedGatepassDocument,
} from "@/lib/gatepass-documents";
import { prisma } from "@/server/db";

export {
  filterUploadedGatepassDocuments,
  gatepassDocumentDisplayName,
  isUploadedGatepassDocument,
};

const GATEPASS_DOCS_PREFIX = "gatepass-docs";

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function storageConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "gatepass-docs";
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key, bucket };
}

async function uploadToSupabase(
  cfg: NonNullable<ReturnType<typeof storageConfig>>,
  objectPath: string,
  file: File,
): Promise<void> {
  const res = await fetch(
    `${cfg.url}/storage/v1/object/${cfg.bucket}/${encodeURI(objectPath)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: Buffer.from(await file.arrayBuffer()),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Document upload failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

/** Local-disk fallback for development without Supabase Storage configured. */
function saveToLocalDisk(objectPath: string, buffer: Buffer) {
  const base = path.join(process.cwd(), "data", "local");
  const dest = path.join(base, objectPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
}

/**
 * Save gatepass document uploads; returns stored file labels for documentRefs.
 * Files go to the private Supabase Storage bucket (metadata recorded in the
 * GatepassDocument table); falls back to data/local in dev when Supabase
 * Storage is not configured.
 */
export async function saveGatepassDocuments(
  files: File[],
  gatepassNo: string,
): Promise<string[]> {
  if (!files.length) return [];
  const cfg = storageConfig();
  const refs: string[] = [];
  for (const file of files) {
    if (!file.size) continue;
    const stamp = Date.now().toString(36);
    const stored = `${stamp}-${safeFileName(file.name)}`;
    const objectPath = `${GATEPASS_DOCS_PREFIX}/${safeFileName(gatepassNo)}/${stored}`;
    if (cfg) {
      await uploadToSupabase(cfg, objectPath, file);
    } else {
      saveToLocalDisk(objectPath, Buffer.from(await file.arrayBuffer()));
    }
    await prisma.gatepassDocument
      .create({
        data: {
          gatepassNo,
          fileName: file.name,
          storagePath: objectPath,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        },
      })
      .catch(() => {
        // The PendingTruck row may not exist yet when documents are uploaded
        // during gatepass creation — the ref list on the truck remains the
        // source of truth in that case.
      });
    refs.push(objectPath);
  }
  return refs;
}

/** Signed URL for privately-stored gatepass documents (1 hour validity). */
export async function getGatepassDocumentUrl(objectPath: string): Promise<string | null> {
  const cfg = storageConfig();
  if (!cfg) return null;
  const res = await fetch(
    `${cfg.url}/storage/v1/object/sign/${cfg.bucket}/${encodeURI(objectPath)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { signedURL?: string } | null;
  return data?.signedURL ? `${cfg.url}/storage/v1${data.signedURL}` : null;
}
