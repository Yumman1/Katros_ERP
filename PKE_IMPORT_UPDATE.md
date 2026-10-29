# PKE import workflow update

Based on master 1324447 (PKE specifications).

## Flow
1. Book Dubai FZCO's international supplier purchase and submit it to execution.
2. Book Dubai FZCO's internal sale to Kastros Pakistan. This is stored once as Pakistan's purchase and displayed as Dubai's sale on the trader/FZCO desk.
3. Execution locks the purchase and internal sale. Allocate the Pakistan receiving warehouse when locking the mirrored Pakistan purchase.
4. Create an Import File from the supplier purchase and select the Dubai sale reference.
5. Record Pakistan's import permit. Its reference automatically appears on the phytosanitary certificate field.
6. Add as many Pakistan-to-Dubai and Dubai-to-supplier LCs as needed. Each records the issuing bank, reference, currency, limit and optional attachments.
7. Upload the BL, phytosanitary certificate, fumigation certificate, certificate of analysis, shipping company certificate and certificate of origin. Import permit and LC attachments are also available. Contracts and invoices remain system-generated; no upload is requested for them.
8. Record the physical Pakistan gate-in and allocate it to the mirrored Pakistan purchase in Truck Movements. Select Dubai FZCO as that purchase's counterparty; the international supplier is identified by the import file's source purchase.
9. In Import Files → Triparty gate-in, select that allocated receipt and confirm the link. Partial receipts leave the unreceived quantity open. Duplicate links and receipts above the source purchase's remaining quantity are rejected. Pakistan inventory is counted once; Dubai receives no physical inventory.
10. Sell the Pakistan stock locally through the existing local sale and dispatch flow.

## Payments and quality
Receipt closes operational quantities, not outstanding payments. The shared Internal Trade voucher supports Pakistan paying Dubai, with one trader approval and one finance reference. Supplier payments remain on Dubai's supplier purchase. Quality and Invoice uses PKE Profat, Fibre, Moisture and Sand/Silica fields. Financial deductions do not reduce physical inventory.

PKE has no Processed Goods menu or permitted processing mutations. Sesame and corn retain their existing booking directions and settlement rules.

## Testing and deployment
The receipt-link migration was applied to the connected database. It adds an access-restricted table and changes PKE import contracts to close operationally on receipt. No test trades or receipts were inserted. The migration is also included in this archive for other environments.

Verification: 18 focused tests, TypeScript, production build and database table/constraint/security checks. Authenticated browser testing of document uploads, gate-in allocation and payment approvals remains to be done.

Document uploads and references remain optional during testing. Required trade/receipt identity, positive quantities, eligibility, duplicate prevention and quantity limits remain enforced.
