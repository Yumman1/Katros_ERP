# Dubai execution access

Based on origin/master 8caa077; no changes pushed.

- Execution accounts are assigned PAK or FZCO in User.executionEntity. Requests use the database assignment, not a browser-provided entity. Existing accounts default to PAK.
- Suleiman Khwaja's new login is `suleiman.khwaja.db.co`. The account was created with the same password hash as his existing `khawaja.suleman@kastros.co` account; the existing account was not changed. Passwords are not included in this package.
- Dubai execution offers SES and PKE. Execution entity switching is removed. Trader and Finance approvals remain; Dubai direct shipments skip the execution-head stage.
- Pakistan manages PKE import creation, permits, shipping documents, arrivals, insurance requests and Pakistan bank LCs. Dubai manages its supplier LCs and attachments on the same file. Multiple LCs remain supported.
- LC supplier purchases cannot complete their import file until every Dubai supplier LC has a reference and attachment. CAD does not require an LC. Existing files show an incomplete stage if the Dubai LC is missing.
- Dubai trade booking hides 236G; settlement and outbound calculations exclude it. Pakistan calculations are unchanged.
- Removed lengthy import, movement, voucher and position guidance while retaining input labels, validation messages and trade information.

Database: migration `20261115000000_execution_entity_access` is additive and idempotent; already applied to the connected database. Keep the migration for other environments. No trade, stock or ledger entries were deleted.

Verification: TypeScript, production build and nine focused access/document/payment/insurance/tax tests. Authenticated browser workflow testing has not been performed.
