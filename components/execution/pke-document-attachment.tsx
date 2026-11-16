"use client";

import { Download, ExternalLink, FileText } from "lucide-react";

export function PkeDocumentAttachment({ fileId, document }: {
  fileId: string;
  document: { id: string; name: string; uploadedAt: string };
}) {
  const href = `/api/pke-imports?id=${encodeURIComponent(fileId)}&document=${encodeURIComponent(document.id)}`;
  const extension = document.name.split(".").pop()?.toUpperCase() || "FILE";
  const date = new Date(document.uploadedAt);
  return <div className="flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-lg bg-indigo-500/10 px-4 py-3">
    <span className="rounded-lg bg-indigo-500/15 p-2 text-indigo-300"><FileText aria-hidden="true" className="h-5 w-5" /></span>
    <div className="min-w-0 flex-1 basis-40">
      <p className="break-words text-sm font-medium">{document.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{extension}{!Number.isNaN(date.getTime()) && ` · Uploaded ${date.toLocaleDateString("en-GB", { timeZone: "Asia/Karachi" })}`}</p>
    </div>
    <div className="flex items-center gap-2">
      <a className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs" aria-label={`Open ${document.name}`} href={href} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />Open</a>
      <a className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs" aria-label={`Download ${document.name}`} href={`${href}&download=1`}><Download aria-hidden="true" className="h-3.5 w-3.5" />Download</a>
    </div>
  </div>;
}
