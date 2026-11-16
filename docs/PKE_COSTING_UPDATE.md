# PKE costing update

Source: Book1.xlsx, “Provisional Costing”, detailed rows 15–52. Rates are supplied business assumptions, not independently verified current statutory tax rates.

## Defaults
- Customs duty, additional customs duty, regulatory duty: 0%.
- Sales tax: 18%; additional sales tax: 3%.
- Income tax: 2%; additional income tax: 1.5%.
- Infrastructure cess: 0.8%.
- Insurance: 0.06% of CFR value.
- Hypothetical landing allowance: 1%, used only in tax assessment.
- Per MT in PKR: wharfage 35.80, surveyor 36, customs clearance/DPP 30, fumigation 0, terminal handling 1,966.50, bags 1,180, transport 2,000, three-month warehouse 225, delivery 600.
- Estimate USD/PKR: 278.5; editable in Finance policies and overridable for an individual estimate.

## Bases and reconciliation
Customs assessment = (CFR + insurance) × (1 + landing allowance).
Duties apply to customs assessment. Sales taxes apply to assessment plus duties. Income taxes apply to assessment plus duties and sales taxes. Cess applies to customs assessment before duties. The hypothetical landing allowance itself is excluded from the payable cost total; insurance remains included, matching the detailed formulas.

The top of the source sheet lists 1.85% excise but no formula uses it; it is not included. The summary omits customs clearance/DPP of PKR 30/MT, while the detailed total includes it. The implementation follows the detailed total. Row 37's description says insurance, but its formula subtracts landing; the implementation follows the formula. Unlinked demurrage notes and figures below row 52 are not added.

At 24,200 MT × USD 227.50/MT × 278.5:
- Ex port: PKR 2,016,234,290.78.
- Ex warehouse: PKR 2,070,079,290.78.
- Delivered: PKR 2,084,599,290.78.
- Delivered per MT: PKR 86,140.47.
- Delivered per 50 kg: PKR 4,307.02.

## Scope
Finance → Policies → PKE import costing uses the existing Finance-head/CEO authorization. Booking shows a separate Pakistan landed-cost estimate for PKE purchases and Dubai-to-Pakistan internal sales. Dubai seller payments remain tax-free as previously requested. Local sales retain their existing sale tax behavior.

Pakistan PKE execution includes Costing Estimate, accepting total CFR value or rate per MT, quantity, currency and estimate FX. This calculator does not create a trade, invoice, ledger entry or payment. Existing financial records are not recalculated.

Original Inter font is applied directly with sans-serif fallbacks. Removed the screenshot's insurance description and additional import guidance, preserving actionable errors and labels.

Database migration: FinancePolicy.pkeCosting JSONB. Applied and seeded on the connected database; no user migration command is required. No trade data was changed.
