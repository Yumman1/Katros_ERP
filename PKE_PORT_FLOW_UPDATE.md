# PKE vessel, port sale, triparty receipt and payment update

Base: master e7f548b. PKE-specific business behavior; Corn and Sesame payment rules remain unchanged.

## How to use the new flow
1. Book and lock the Dubai supplier purchase and the Dubai sale to Kastros Pakistan.
2. In Dubai > Import Files, create a shipment file for each BL. Several files may use the same purchase and sale contracts. Enter each BL number, quantity, supplier invoice amount and Dubai invoice amount. Each side's invoice amount uses that trade's currency.
3. On Supplier shipping documents, enter vessel name, arrival port, arrival date and actual quantity received at port, then save. This happens before truck movement.
4. Pakistan > Port & Triparty Gate-in shows the arrived vessel/BL stock and its allocation breakdown.
5. For warehouse stock, choose Triparty gate-in to warehouse, destination warehouse, quantity, truck and builty. The system creates the physical inbound truck and receipt once, linked to the supplier purchase and Dubai sale. Only the entered quantity leaves port stock; full supplier quantity is not required.
6. For direct local sales, the trader chooses PKE, Kastros Pakistan, Local Sale, and a Port/vessel/BL under Stock source instead of a warehouse. Booking reserves the port stock. Execution locks the sale without a warehouse split.
7. On Port & Triparty Gate-in, select Local sale directly from port, the locked local contract, quantity, truck and builty. The truck appears in Truck Movements and follows the existing balance, approval and release flow. Port sales do not subtract from warehouse inventory.
8. The same page provides a receipt-voucher form for local port sales, including advances before dispatch. Finance sees the voucher, prints it and enters the payment method, bank and reference before approving. The ordinary voucher history and ledger continue to apply.

## Payments and reconciliation
- LC fields apply only when the linked trade's payment terms are LC. CAD does not require an LC. Supporting uploads remain optional in the testing phase.
- Supplier and shared internal vouchers select the appropriate BL shipment file. Multiple BL files have independent invoice values and balances under the same trade.
- Reusing an LC reference across BL files under the same trade draws on one total limit. Its currency, bank and limit must be consistent. Pending payments reserve capacity, rejected requests release it, and approved payments consume it.
- Execution-head approval remains required for an LC document exception. CAD has no LC bypass stage.
- PKE Ledgers now show amounts paid/received, pending and remaining per trade. Local billed charges are included when higher than the original contract value.
- Dubai's supplier purchase closes when supplier payments clear. Its sale to Pakistan closes when the shared internal payment clears. Physical gate-ins do not close either financial book.
- Combined BL quantities cannot exceed the supplier or internal sale contract. Port-sale movements cannot exceed their local sale contract. Warehouse receipts and direct port sales share the available vessel stock; booked port-sale stock cannot also be received into a warehouse.
- Vessel and source references cannot be silently changed after port sales are booked or movements are recorded.

## Existing records and database
Migration applied and verified on the connected database: PkePortMovement with restricted foreign keys and row-level security; anonymous/client access revoked. Earlier triparty receipts are preserved as warehouse dispositions where present. Previously receipt-closed but unpaid PKE contracts are reopened; paid contracts remain closed. No trade deletion was performed.
The idempotent Prisma migration is included for other environments.

## Verification
26 targeted tests pass, covering partial stock allocation, port reservation limits, CAD/LC selection, shared LC limits, receipt linking, payment closure and existing PKE trade direction behavior. TypeScript passes. Production build passes, with existing unrelated warnings. Authenticated browser/Finance printing smoke testing has not been performed.

## Practical notes
- One shipment file represents one BL. Use another file for another BL on the same trade.
- Historic vouchers are not guessed into BL/LC allocations; their trade payments still count.
- LC and trade currencies must match. Cross-currency LC drawdowns are not supported.
