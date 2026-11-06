# PKE port and insurance update

Based on master a6cb386. This package includes the earlier PKE dropdown and Finance-reference/PDF fixes.

- Vessel received quantities count as Pakistan physical stock at port. Port and warehouse locations are displayed separately.
- PKE financial trades require vessel arrival and cleared payment before closing. Insurance receivables do not prevent closure.
- Use the existing gatepass link, Outbound, and select the Port location for local port-sale trucks. Existing payment and DO approvals remain required for release.
- Optional PKE triparty gate-in is alongside the other gate modes. Internal Shifting supports port-to-warehouse movements.
- Port receipts use ordinary Sale vouchers, showing expected value and remaining balance. Finance enters the payment reference. Pending/completed PDFs use distinct filenames, including existing vouchers.
- Import Files provides Claim Insurance for BL-versus-received shortfalls beyond purchase tolerance. Claims use the entire missing weight at the locked PKR-equivalent supplier rate. The assigned trader approves before an insurer debit is posted. Receive claim money through Vouchers / Insurance receipt, selecting the insurer and claim note.
- Default insurer: tes insurance. Execution can register more insurers in Import Files.
- Enter all BLs before requesting a final contract shortfall decision. Approval permits completion with that shortfall; cancellation voids the supplier purchase, linked Dubai/Pakistan trade and linked port sales. Cleared payments and real stock movements remain recorded for reconciliation; pending vouchers are rejected.

No new database schema is required. Existing PKE records are supported without recreating trades. No reset or deletion is included.

Validation: TypeScript, production build, and focused PKE tests. Authenticated browser workflow testing has not been performed.
