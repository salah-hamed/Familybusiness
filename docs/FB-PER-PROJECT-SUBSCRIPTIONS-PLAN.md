# Per-project subscriptions — implementation plan

Status: approved product requirements; implementation must remain staged and must not be enabled by a price-only change.

## Accepted product rules

- Monthly price: 35 EGP per project.
- A subscriber may create an unlimited number of projects, including multiple projects of the same template type.
- Every project has its own subscription state, billing anchor, trial/activation deadline, paid-through date, and renewal status.
- A newly added project receives its own 7-day setup/linking window and then a 3-day payment grace period beginning at its own link timestamp. Existing projects' deadlines must not move.
- The same subscriber account can manage all projects; each project's orders, operators, customer URL/QR, pricing, commissions, and settlements remain scoped to that project.
- Apply the new model to existing test accounts and new accounts. Existing order, commission, settlement, operator, merchant identity, and customer-link records must be preserved.
- Do not deploy Firestore rules, mutate production data, or merge an incomplete rollout as part of planning.

## Current architecture findings (main at 29cab050d2d14629a465bbe1570cd69afd795e40)

- `core/config/platform-config.js` has `monthlyRenewalFee: 59`.
- `core/subscriptions/trial-policy.js` has `MONTHLY_TRIAL_SUBSCRIPTION_AMOUNT = 59`; the current 7-day and 3-day policy is anchored to account fields `createdAt` and `firstMerchantLinkedAt`.
- `core/subscriptions/payment-service.js` creates subscription payment documents keyed by user and timestamp; the payment document and `subscriptionBillingGuards/{uid}` gate are account-scoped.
- `core/projects/project-service.js` returns project IDs as `{ownerId}_{templateId}`, which prevents multiple projects of one type for one owner.
- `templates/engine/project-engine.js` checks account-level `isSubscriptionActive(userData)` before creating a project.
- `templates/projects.js` descriptions currently imply one shop/project per type.
- Firestore rules are a security boundary; changing client checks alone would not securely enforce per-project billing.

## Required implementation phases

### Phase A — data contract and compatibility
1. Define a stable unique project ID for new projects while retaining lookup/access for historical `{ownerId}_{templateId}` IDs.
2. Define project-scoped billing fields (e.g. billing status, linked/created anchor, trial deadline, paid-through date, last approved payment ID, and schema version) and document the single source of truth.
3. Define project-scoped payment records with `projectId`, `subscriberId`, amount 35 EGP, status, payment reference/code, and review audit fields.
4. Keep account-level payment records readable and auditable; do not silently reinterpret old account payments as payments for every project.

### Phase B — server-enforced access
1. Update Firestore rules and the write/read predicates for project creation, subscriber project access, payment submission, and admin approval together.
2. Ensure a payment approval can only activate/extend the exact project named in that payment, atomically with the payment status change.
3. Ensure one project's expiry cannot deactivate, extend, or otherwise alter any other project.
4. Preserve platform-managed/recovered project rules and historical subscriber financial access; do not weaken rules with broad owner-only conditions.
5. Keep rule deployment separate for explicit review and manual deployment.

### Phase C — project identity and UI
1. Allow repeated template types using unique project IDs and preserve all existing IDs/links.
2. Update the workspace to list projects and their individual subscription status/deadline, plus total monthly amount = 35 EGP × billable projects.
3. Show payment amount and payment status for the selected project; payment references must identify the project unambiguously.
4. Update project catalog copy to remove "one shop" limitations.
5. Ensure creating a project never resets any existing project's trial or renewal clock.

### Phase D — tests and rollout
Add regression coverage for:
- repeated projects of the same template;
- 7-day setup window per new project;
- 3-day grace window per project's own link time;
- no deadline changes to existing projects when another is added;
- 35 EGP exact-project payment and approval;
- expired project A does not block active project B;
- project A payment cannot activate project B;
- old project IDs, customer links, orders, operators, commission ledger and settlements remain intact;
- authorization remains denied for forged project/payment fields and non-admin approvals.

Run the full existing security/regression workflow and review the diff before merging. Do not merge or deploy until all checks pass.

## Rollout guardrails

- No bulk data migration is required merely to create the feature branch.
- Do not change only the visible price or constants before the project-scoped billing flow and rules are implemented; that could display one price while the existing account-level payment logic still charges/activates at account scope.
- Do not deploy `firestore.rules` or Firebase indexes as part of a GitHub merge.
