export function executionEntityFor(user: {role: string; executionEntity?: string | null}): "PAK" | "FZCO" | undefined {
  return user.role === "EXECUTION" ? user.executionEntity === "FZCO" ? "FZCO" : "PAK" : undefined;
}
export function isDubaiExecution(user: {role: string; executionEntity?: string | null}) {
  return executionEntityFor(user) === "FZCO";
}

export function executionScope(user: {role:string;executionEntity?:string|null}, headers: Headers) {
  const assigned=executionEntityFor(user);
  const entity=assigned ?? (headers.get("x-execution-entity")==="FZCO"?"FZCO":headers.get("x-execution-entity")==="PAK"?"PAK":undefined);
  const commodity=headers.get("x-execution-commodity")?.trim() || (assigned==="FZCO"?"SES":assigned==="PAK"?"CORN":undefined);
  if(assigned==="FZCO" && commodity && !["SES","SESAME","PKE"].includes(commodity))throw new Error("Commodity not assigned to Dubai execution");
  return {executionEntity:entity,executionCommodityCode:commodity};
}
