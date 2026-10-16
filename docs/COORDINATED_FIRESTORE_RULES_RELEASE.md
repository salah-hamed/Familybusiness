# Family Business — coordinated production release

**Status:** Not approved for production. This guide applies to the integrated release candidate PR #148. Keep #148 and #149 in Draft until each applicable release gate is closed.

## Current release decision

- PR #148 is the integrated candidate. Its current branch keeps `TRIAL_REGISTRATION_ENABLED=false` and the merchant recovery, transfer, cutover, repeat-cycle and settlement rollout flags OFF.
- PR #149 is a separate activation candidate based on an older #148 commit. It switches several rollout flags ON and changes cycle settlements to operator declaration plus beneficiary confirmation without external verification. Do not merge it with the initial cutover; rebase and rerun CI only after the settlement evidence policy is approved.
- GitHub Pages publishes the web application. It does not publish Firestore Rules or indexes. Firebase publication is a separate authenticated action.
- Current candidate CI is evidence for the checked SHA only. Any new commit requires a fresh green workflow.

## Release gates

### 1. Freeze the compatible code and Rules

- Refresh the PR heads immediately before release and choose one immutable SHA for the web app, Rules and indexes.
- Keep all rollout flags OFF for the core cutover, including trial signup.
- Confirm the Security and Regression Tests workflow, including Firestore Emulator, passes on the exact chosen SHA.
- The new payment client writes `subscriptionBillingGuards/{uid}` atomically with each new subscription proof. The new Rules require this guard, while the old client writes only `subscriptionPayments`. Neither side is safe to switch alone while users can submit payment proofs.
- Pause subscription-proof submission and admin payment review during the cutover window. Ask users to reload the app/PWA after the web app and Rules are updated.
- Do not enable image upload. Keep the image provider disabled until a restricted provider, quotas and cost controls are approved.

### 2. Reconcile old proofs and prepare rollback

- Review every pre-release pending proof against the approved payment record.
- Record each proof as reviewed, rejected, migrated or still pending, with its account UID and decision.
- Never set `recoverySafe` automatically. An unresolved payment proof blocks recovery for that account.
- Save the currently deployed Rules, record the current web SHA and capture the approved pre-release finance readings.
- Prepare a paired rollback: prior web SHA **and** prior Rules/indexes. Rolling back just one side may break payment submissions.

### 3. Cut over in one maintenance window

Keep subscription payment submission, payment review and merchant recovery/transfer actions paused for the entire window.

1. Publish the reviewed #148 web code with all rollout flags OFF. Wait for the GitHub Pages update to finish.
2. From the same reviewed checkout, verify the exact SHA and publish Firestore Rules and indexes to `business-2a2e0` once.
3. Verify the Firebase CLI selected the intended project and reported `Deploy complete!`.
4. Have users reload the app/PWA. Do not allow an old open session to submit a payment proof against the new Rules.
5. Run the compatibility checks below before unpausing payment operations.

Commands from the repository root in VS Code PowerShell:

~~~powershell
git status --short --branch
git switch main
git pull --ff-only origin main
git rev-parse HEAD
firebase.cmd login:list
firebase.cmd deploy --only firestore:rules,firestore:indexes --project business-2a2e0
~~~

Run the deploy command only after the reviewed code is on `main`, the SHA is confirmed, old payment proofs are reconciled, the Rules backup exists and the maintenance window is active. Firebase credentials are not available in the current Codex session.

### 4. Compatibility checks with every rollout flag OFF

- Existing paid subscribers can sign in, open workspaces and use their projects.
- Existing operator login, commission agreement and order handling still work.
- A customer can place an order; the operator/rider can receive, dispatch and complete it.
- Admin can submit, approve and reject a new subscription proof using the billing guard.
- A pending proof blocks recovery in the same transaction.
- Existing settlement history and account balances remain unchanged.
- Product rendering, existing product/image URLs and `masterId` inventory remain intact.
- The PWA updates to the reviewed cache version on a real phone.
- Test every activity approved for launch: cleaning, laundry, supermarket, restaurant and bakery if included. Keep car wash hidden/paused unless separately approved.

Stop the release if a permission, payment, order-routing, balance or cache check fails. Use the paired rollback plan.

## Separate activation after the core cutover

Do not use PR #149 as a bundle for the initial launch.

1. **Trial signup:** prepare a separate small change that enables only `TRIAL_REGISTRATION_ENABLED`. Verify the 7-day setup window, 3-day grace after first accepted agreement, 59 EGP new-model payment, old pricing and expiry behavior.
2. **First merchant recovery:** enable only after old proofs are reconciled and an audited overdue/confirmed-violation case passes the operator-continuity and historical-ledger checks.
3. **First assignment:** enable transfer cases and cutover only after operator and recipient consent, accepted commission terms and private finance review pass.
4. **Repeat cycles:** enable after two consecutive reassignment tests and historical privacy checks pass.
5. **Cycle settlements:** leave OFF until the product/finance owner approves whether operator declaration plus beneficiary confirmation is sufficient payment evidence. If independent evidence is required, implement and test that workflow first.

Record the reviewed SHA, active flags, test evidence, approver and monitoring window for each activation.

## Stop conditions

Stop before deployment if the SHA differs from the reviewed SHA; production Rules cannot be saved for rollback; pending proofs remain unreconciled; Firebase targets the wrong project; required CI is missing or red; phone/PWA flows are untested; or the paired rollback is unavailable.

A green CI run or code in a Draft PR does not mean the production release is complete.
