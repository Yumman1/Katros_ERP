# Warehouse utilization, purchase vouchers and lab review

## Warehouse capacity
- Shared warehouse capacity includes all commodities, irrespective of the selected desk.
- Corn and Sesame use the same warehouse grain division (sq ft per MT). Baled stock uses its own division and shares the same floor space.
- Inventory, booking and utilization show commodity contributions and total utilization. Pending outbound trucks continue occupying space until dispatch.
- Sesame processing conserves total mass including impurities; output grades are not added twice.
- Use-basis warehouses retain the agreed 100% reporting convention with no fixed capacity.

## Purchase voucher workflow
1. Execution selects the supplier and trade, enters builty, truck number, transporter and advance weight. The trade advance percentage defaults automatically and may be overridden, as may the calculated amount.
2. Generate slip creates a pending Finance voucher; Execution does not enter a payment reference for an advance request.
3. Finance downloads the PDF, reconciles and makes payment externally, then enters the payment reference and approves. Approval posts the ledger payment once and marks the advance complete.
4. The paid advance is available to the public gatepass page. The selection identifies both builty and truck; an incorrect truck cannot claim the payment.
5. The existing remaining-payment and excess-advance carry-forward workflows remain in place.

Builty numbers can repeat for different trucks. Duplicate active vouchers for the same trade + builty + truck remain blocked, including concurrent submissions. Legacy vouchers with no stored truck retain their existing linkage.

## Quality review
- Gate-in collects seller and warehouse weights without deduction or lab result inputs.
- Execution → Quality Review selects the truck/builty and purchase trade, displays agreed quality and records measured lab results.
- Delivered: payable quantity is warehouse weight less the reviewed deduction, including zero.
- Spot: payable quantity is seller loading/builty weight; deductions are rejected.
- Save quality review, then assign the truck and enter its invoice through the existing workflow.
- Reviewed trade must match assigned trade. Changes to an unassigned gate entry invalidate its previous review. Assigned and invoiced entries cannot be re-reviewed silently.
- Existing assigned trucks and posted payments are preserved. Pending trucks need quality review before their next assignment.

## Migration and validation
Migration: `20261007130000_voucher_truck_quality` adds nullable voucher and quality fields, replaces the old builty-only unique index, and backfills the purchase basis for existing advance vouchers. No records are deleted. Run `npm run db:migrate` before deploying this code. The migration has not been run on production.

Validation: disposable PostgreSQL-compatible integration tests cover advance approval/reference, delivered deductions, remaining payments, excess carry-forward, repeat builty with different truck, wrong-truck rejection, spot seller-weight billing/no deductions, and shared Corn/Sesame utilization. PDF rendered and visually checked. Production build validated. No signed-in browser end-to-end test was performed.
