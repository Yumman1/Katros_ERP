export const PKE_IMPORT_STAGES = [
  { title: "Supplier purchase", owner: "FZCO", description: "FZCO purchases from the international seller.", fields: ["Supplier contract"], },
  { title: "FZCO sale to Pakistan", owner: "FZCO", description: "Record the Dubai sale contract and Pakistan purchase reference. The vessel goes directly to Pakistan.", fields: ["Dubai sale contract", "Pakistan purchase reference", "Shipping instructions", "Import permit", "L (pending clarification)"] },
  { title: "Vessel and shipping", owner: "FZCO", description: "Record the vessel nomination when required by the contract, and the supplier L/C if applicable.", fields: ["Vessel nomination", "Vessel / voyage", "Supplier L/C"] },
  { title: "Supplier documents", owner: "FZCO", description: "Collect the seller’s shipping and commercial documents.", fields: ["Supplier invoice", "Bill of lading", "Surveyor report", "Weight certificate", "CER (pending clarification)"] },
  { title: "Pakistan import clearance", owner: "PAK", description: "Prepare the import, insurance, clearance and delivery arrangements.", fields: ["Pakistan import permit", "Pakistan L/C", "Marine cover", "Goods declaration", "Surveyor nomination", "Customs clearing agent", "Discharge port", "Transporter nomination"] },
  { title: "Pakistan receipt", owner: "PAK", description: "Record receipt documents. Use Truck Movements to record the actual gate-in and inventory receipt.", fields: ["Arrival / discharge record", "Gate-in / warehouse receipt", "Received weight (MT)"] },
  { title: "Local delivery", owner: "PAK", description: "Link local sale and delivery records. Actual stock and payment updates remain in the existing movement and voucher workflows.", fields: ["Local sale trade reference", "Delivery order", "Gate-out reference", "Local invoice", "Payment receipt"] },
] as const;
export type PkeImportPayload = { references: Record<string,string>; documents: { id:string; field:string; name:string; path:string; uploadedAt:string; uploadedBy:string }[]; history: { at:string; actor:string; action:string }[] };
export const PKE_IMPORT_FIELDS = PKE_IMPORT_STAGES.flatMap(s => [...s.fields]);
export const emptyPkeImport = (): PkeImportPayload => ({ references:{}, documents:[], history:[] });
