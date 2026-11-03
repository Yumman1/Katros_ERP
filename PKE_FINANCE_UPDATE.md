# PKE finance update

Based on master ecbdfc1 (PKE truck movement and LC bypass approvals).

## Changes
- Fully received supplier purchases remain selectable until approved payments cover the trade. Pending vouchers reserve the amount, while rejected vouchers release it.
- The PKE purchase voucher reads BL and LC references from Import Files rather than the Sesame export-shipment selector.
- Both supplier payments and the shared Pakistan/Dubai internal voucher can select an import file, its BL, and an LC for the correct side.
- Record Supplier BL invoice amount and Dubai BL invoice amount under Supplier shipping documents, in each linked trade's currency. These are financial limits for BL-linked vouchers; they do not themselves post payments or additional invoice ledger entries.
- The LC selector shows approved payments, pending reservations and remaining capacity. Separate vouchers can draw on different LCs.
- Finance checks balances again on approval. Pending/rejected document bypasses retain the existing execution-head approval requirement.
- References and LC terms used by non-rejected vouchers cannot be silently edited. BL/LC references appear in voucher notes and downstream ledger notes.
- Triparty gate-in still closes goods quantities independently of payment. Shared internal approval and the single Finance payment reference remain unchanged.

## Use
1. Save BL reference and invoice values in the import file. Add LC references and limits for each payment leg.
2. Under Vouchers, choose Purchase for the supplier, or Internal Trade for Pakistan/Dubai.
3. Select the trade and import file, check Pay against BL if applicable, and choose an LC for LC payments.
4. Enter the amount and generate the voucher. Supplier payments go to Finance; internal payments go through Trader then Finance.
5. Finance enters the bank/payment reference and approves as usual.

Documents remain optional in testing. A trade advance without BL/LC allocation remains possible. Existing historical vouchers are not automatically assigned to an LC or BL; their trade balances still count. LC and trade currencies must match; cross-currency LC conversion is not implemented.

## Database
Applied and verified on the connected database: nullable Voucher.pkePayment JSONB allocation snapshot.
The idempotent Prisma migration is included. No trades or existing payment rows were changed.

## Validation
17 targeted tests passed; TypeScript passed; production build passed. Existing unrelated lint warnings remain. Authenticated browser smoke testing was not performed.
