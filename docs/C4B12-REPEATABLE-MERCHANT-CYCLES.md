# C4B12 — Repeatable merchant recovery and reassignment (STAGED / OFF)

Dependency: draft PR #146 (C4B11 first atomic platform → incoming subscriber handover).
Implementation branch: `feat/c4b12-repeatable-merchant-recovery-staged`, stacked PR #147.

## Business invariant

The physical merchant never closes merely because a subscribing marketer lapses or loses
management rights. The platform may recover assignment independently of the previous
subscriber (no veto) only when **genuine unpaid renewal / unpaid first-month grace or a
confirmed violation** is evidenced. Old subscribers keep every *earned* commission and
settlement receipt; old historical earnings are never reassigned or reset.

`projects/{projectDocId}` and its immutable `merchantId`, `ownerId`,
`originalSubscriberId`, `operatorId`, customer URL, workers, orders, products, commission
agreement and historical ledgers remain the same.

## Versioned assignment sequence

- Cycle **1**: original platform recovery + first merchant assignment (C4B11),
  with frozen records `merchantRecoveries/{projectId}`,
  `merchantTransferCases/{projectId}`,
  `merchantTransferFinanceReviews/{projectId}`, and
  `merchantAssignmentCutovers/{projectId}`.
- Cycle **2+**: after verified expiry/violation of the currently assigned subscriber,
  increment `projects.assignmentCycle` and write immutable
  `merchantRecoveryCycles/{projectId}_{cycle}`.
  The previous recipient's historical read-only entitlement is
  `merchantHistoricalAccess/{projectId}_{previousUid}`.
  No single previous recipient gets permission to approve or veto recovery.
- New allocation of the *same cycle* requires a NEW
  `merchantTransferCycles/{projectId}_{cycle}` with accepted shop-operator and
  incoming-recipient consents, frozen commission terms, an admin-private
  `merchantTransferCycleFinanceReviews/{projectId}_{cycle}`, and an immutable
  `merchantAssignmentCycles/{projectId}_{cycle}` witness.
  The original four first-cycle records are never overwritten.
- The earlier `cutoverAuditId` remains unchanged while the shop is recovered;
  it changes only when a new atomic assignment completes.
- **Never reassign the same previously recovered recipient UID**. Otherwise,
  historical `commissionLedger.userId` totals and settlements can overlap
  multiple assignments; `merchantHistoricalAccess/{projectId}_{uid}` is the
  unique durable anti-reuse witness.

## Commission epoch boundary

Commission is earned at actual rider/delivery assignment, NOT order creation.
An order created before the recovery but assigned later earns for the *new current*
beneficiary. Ledger entries after cycle 1 have `assignmentCycle`, and the order
has `commissionAssignmentCycle`. Firestore Rules must require equality to the
project's current cycle before accepting the immutable ledger write.
The operator's current-cycle statement filters both ledger and payment queries
by cycle; previously earned rows and receipts are untouched.

## Security and release blockers — MUST NOT enable flags yet

1. **Trusted billing synchronization**: a preliminary query for pending
   subscription-payment screenshots is not atomic. Build and verify an
   independently authenticated billing-state/lock document updated in every
   payment-submission and payment-review transaction; read the lock in the
   merchant recovery transaction and enforce it in Firestore Rules. While
   this isn't done, `executeRepeatMerchantRecovery()` intentionally throws
   `MERCHANT_REPEAT_RECOVERY_TRUSTED_BILLING_GATE_REQUIRED` even if a feature
   flag is accidentally switched on.
2. **No insecure writes**: all five new cycle collections currently deny
   Firestore client-side create/update/delete. Until admin-only atomic
   cross-document Rules and new consent/review services pass the Emulator,
   `executeRepeatMerchantAssignment()` must remain flag-OFF and cannot
   authorize a production transfer.
3. Former recipient financial access is read-only and individually scoped;
   operator and other subscribers cannot read a previous UID's finance review,
   receipts or historical grant. The platform admin observes money but never
   creates payment confirmations.
4. Complete full consent UX and finance-review workflow for cycles 2+;
   settlement protocol for incoming recipients remains disabled until
   operator declaration + recipient confirmation is independently verified.
5. Review indexes, source tests, Firestore Emulator permissions, PWA cached
   assets and end-to-end supermarket/restaurant/bakery/laundry tests.
6. One final *coordinated manual* Firebase Rules/index release after PR #146
   and PR #147 are reviewed; flags stay OFF until explicit rollout approval.

No code in this staged PR starts a second live recovery, changes a shop's
stored subscriber, or declares/settles a payment on production.
