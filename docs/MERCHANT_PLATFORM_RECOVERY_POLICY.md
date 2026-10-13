# Family Business — Unilateral Platform Merchant Recovery (C4)

**Status: Product decision approved; live recovery cutover NOT YET ENABLED.**

## What belongs to whom
The physical merchant and its shop-operating account are managed centrally by the platform. A subscriber receives only a time-limited allocation and commission entitlement. On an expired monthly renewal or a proven policy violation, the platform may revoke that allocation **without seeking the departing subscriber's consent**. There is no old-subscriber veto.

The operator still owns and runs the physical shop; its customer app, customer links, QR, products and images, riders, history and orders must remain online. The platform's administrator gains operational oversight until the shop is assigned again.

## Qualified reasons
1. **overdue_renewal** — a previously paid monthly subscription's verified expiration has passed. Pending renewal proofs must be reviewed first. Missing dates, trial onboarding and free grants do not constitute proof of an overdue paid renewal.
2. **unpaid_first_month** — first real merchant agreement was accepted, its 3-day payment grace has elapsed, and the new subscriber has not made a validated first payment. A pending first-month payment proof requires review before reclaiming the merchant. Merely creating a trial account or inviting an operator cannot trigger this.
3. **confirmed_violation** — a distinct admin-confirmed, timestamped violation with category and evidence reference. An unchecked complaint or a self-reported reason is not sufficient.
4. All reasons require an audit entry and transparent notice (notice is not an approval request). Future fully automated sweeps require a trusted scheduler; browsers/Firestore Rules alone cannot run a reliable periodic job.

## Mandatory safeguards for actual takeover (C4b)
- Read current project, current assignee, operator, agreement and verified cause in a single protected transaction; write a tamper-resistant audit entry.
- Keep the original projectDocId, historical ownerId, merchantId, operator identity and customer routing unchanged. Platform ownership/assignment is a separate concept from the original Firestore ownerId.
- Mark the project platformManaged and assignmentStatus platform_managed with an assignment epoch. Immediately revoke the old subscriber's current operating rights; keep their access to prior financial entitlements.
- **Shop must stay online** after the former subscriber expires; service eligibility must no longer depend on that person's paid subscription once platform takeover is verified.
- All commissions EARNED before cutover stay with the old subscriber. Only commissions earned under the new epoch may be posted to a separate platform beneficiary. No old commission may be overwritten, reset, reassigned or duplicated.
- Existing unsettled and pending payments remain under the old beneficiary. Administrator monitors, but does not become the routine settlement confirmer. Resolve in-flight orders according to frozen commission attribution.
- Future reassignment requires consent from the physical operator and NEW subscriber for their new roles; **not from the departing subscriber**. Retain the same customer links and historical identities.
- Enforcement must be in Firestore Rules and transaction checks; hiding a button does not revoke permissions.

## Why the switch is still locked
The current Rules' projectAvailable() is gated on subscriptionActive(project.ownerId). The 3 order services still save new ledgers to agreement.ownerId, and settlement-service uses project.ownerId. Changing platformManaged by itself would disrupt shop ordering or pay post-recovery commissions to a departed subscriber. No live recovery switch or write is enabled until these are redesigned and tested end to end.

**Release order:** implement and test operating permissions, future commission beneficiary and settlement isolation, audited atomic recovery, incoming-assignment routing; run all emulator/CI tests; only then do the one final manual Firebase Rules deployment. Never merge a live switch that requires unpublished Rules.
