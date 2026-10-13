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

## Implementation status (code complete, flags OFF)

- Per-user `subscriptionBillingGuards/{uid}` are now created/advanced
  atomically with new proof submissions, approvals and rejections. Both first
  recovery and all repeat recoveries read the same guard INSIDE the merchant
  transaction. No unreviewed payment may coexist with an authorized recovery.
- Pre-rollout historical pending screenshots can be migrated to the billing
  gate; an administrator must reconcile the full old payment history before
  granting `recoverySafe`. This is never automatic.
- The service now writes the repeat recovery, immutable audit and
  read-only former subscriber grant atomically; repeat assignment independently
  writes the consent-case closeout, project state and immutable witness.
- Admin has guarded tools for repeat recovery, new WhatsApp consent requests,
  private financial reviews, and verified reassignment.
- `merchant-transfer/?project=<id>&cycle=<n>` supports a new independent
  operator+recipient approval for each cycle. The prior subscriber has no veto.
- Operator declares a per-cycle payment; the correct subscriber independently
  confirms or rejects it. The platform Admin never settles and a former
  recipient can confirm an earlier-cycle receipt without operating access.
- Commission ledger and order are stamped with the active assignment cycle
  in the same delivery assignment transaction. Financial aggregates isolate
  the current cycle and retain all historical ledgers.

## Production blockers — do NOT enable flags or publish yet

1. **Firebase authorization/connection**: the repository is on GitHub Pages,
   but GitHub access alone cannot deploy Firestore Rules or indexes to
   `business-2a2e0`. Complete a connected authenticated Firebase deploy.
2. **Latest head must pass all GitHub tests**, including Rules Emulator,
   payment+recovery races, cutover witnesses and settlement isolation.
3. **Old account reconciliations**: every pre-release pending proof must be
   reviewed or migrated. Confirm billing guard `recoverySafe` for all existing
   candidate subscriptions before any automatic reclaim.
4. **Pilot and PWA**: validate at least one supermarket, restaurant, bakery,
   and laundry customer/order/rider/operator session, installed PWAs and
   offline cache refresh. Confirm no customer-facing interruption.
5. **Explicit live rollout**: first publish the combined final Rules and
   indexes once, coordinate web code deployment, then enable the three
   recovery/cutover flags plus the settlement flag in a deliberate, independently
   reviewed follow-up release.
6. **Keep a rollback**: retain last production Rules and main SHA, a record
   of before/after project IDs and finance readings. Never roll back
   financial ledgers or erase historic audit documents.

### Flags that must remain OFF until deployment

- `PLATFORM_MERCHANT_RECOVERY_ENABLED`
- `MERCHANT_TRANSFER_CASES_ENABLED`
- `MERCHANT_CUTOVER_ENABLED`
- `MERCHANT_REPEAT_RECOVERY_ENABLED`
- `MERCHANT_REPEAT_ASSIGNMENT_ENABLED`

Not yet completed: synchronized Firebase production publish, approved rollout,
live merchant smoke tests, PWA cache verification, and confirmed active
billing reconciliations. Those are real activation conditions, NOT optional
documentation. Current GitHub commits have not changed actual shops or payments.
