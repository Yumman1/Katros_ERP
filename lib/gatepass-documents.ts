const GATEPASS_DOCS_PREFIX = "gatepass-docs/";

/** True for refs created by saveGatepassDocuments (not gatepass no., builty, invoice, etc.). */
export function isUploadedGatepassDocument(ref: string): boolean {
  return ref.trim().startsWith(GATEPASS_DOCS_PREFIX);
}

export function filterUploadedGatepassDocuments(
  refs: string[] | null | undefined,
): string[] {
  return (refs ?? []).filter(isUploadedGatepassDocument);
}

/** Human-readable upload name from a stored gatepass-docs ref. */
export function gatepassDocumentDisplayName(ref: string): string {
  const stored = ref.split("/").pop() ?? ref;
  const dash = stored.indexOf("-");
  return dash > 0 ? stored.slice(dash + 1) : stored;
}
