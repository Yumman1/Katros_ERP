import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Explicit allowlist: identity, ownership and ledger relationships are never editable. */
export const counterpartyProfilePatchSchema = z.object({
  type: z.enum(["TRADING_PARTNER", "BUYER", "SELLER", "BROKER", "BANK"]).optional(),
  country: z.string().trim().min(1, "Country is required").max(100).optional(),
  contactPerson: optionalText(200),
  contactPhone: optionalText(50),
  companyNameNtn: optionalText(250),
  ntn: optionalText(100),
  address: optionalText(2000),
  bankDetails: optionalText(2000),
  taxFilerStatus: z.enum(["FILER", "NON_FILER"]).optional(),
  kycStatus: z.enum(["VERIFIED", "PENDING", "EXPIRED", "NOT_ON_FILE"]).optional(),
  kycRef: optionalText(250),
  kycExpires: z.iso.date().nullable().optional(),
  creditLimit: z.number().finite().min(0).max(999_999_999_999).nullable().optional(),
}).strict().refine((patch) => Object.values(patch).some((value) => value !== undefined), {
  message: "Change at least one field before saving",
});

export const updateCounterpartyProfileSchema = z.object({
  id: z.string().min(1),
  patch: counterpartyProfilePatchSchema,
}).strict();

export type CounterpartyProfilePatch = z.infer<typeof counterpartyProfilePatchSchema>;
