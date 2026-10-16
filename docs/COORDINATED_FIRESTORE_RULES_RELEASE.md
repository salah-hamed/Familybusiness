# Family Business — coordinated production release

**Status:** The core Firestore Rules/index release was deployed previously. This guide now tracks the separate free-registration trial activation. Trial access stays protected by both a client rollout switch and an admin-controlled Firestore setting. Merchant recovery, transfer, cutover, repeat-cycle and cycle-settlement flags remain OFF.

## Current release decision

- `TRIAL_REGISTRATION_ENABLED` enables the new-account client flow. Firestore independently requires `platformSettings/trialRegistration` with `enabled=true`; only an admin can create or update this setting. Do not enable the Firestore setting until the matching web version has passed CI and GitHub Pages deployment.
- New accounts receive a free 7-day setup window, then a 3-day grace window after the first accepted merchant agreement, followed by a 59 EGP monthly subscription. Existing accounts without `accessModel: merchant_trial_v1` keep their legacy billing behavior; no account or payment records are migrated by this activation.
- The former PR #149 activation bundle is not part of this change. Merchant recovery, transfer, cutover, repeat-cycle and cycle-settlement flags remain OFF.
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

- No historical balance reconciliation is required for existing accounts and settlements; the owner confirmed they are test data. Do not delete or rewrite them as part of this release.
- Check only whether any pending subscription proof needs a `subscriptionBillingGuards/{uid}` migration for the new Rules. Migrate only through the guarded admin path, or keep payment review paused for that proof; no financial reconciliation is needed for test records.
- Never set `recoverySafe` automatically. A pending proof must remain blocked from recovery until its technical guard state is handled.
- Save the currently deployed Rules and indexes, record the current web SHA, and keep the paired rollback materials together.
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
- Test the four active launch activities: supermarket, restaurant, bakery and laundry. Cleaning and car wash remain hidden/paused; other draft templates stay unavailable.

Stop the release if a permission, payment, order-routing, balance or cache check fails. Use the paired rollback plan.

## Trial activation procedure

Do not use PR #149 as a bundle for the initial launch.

1. Publish the reviewed client version with `TRIAL_REGISTRATION_ENABLED=true`; wait for green CI and successful GitHub Pages deployment.
2. Using an authenticated platform admin, create `platformSettings/trialRegistration` with `enabled=true`, `updatedBy` set to that admin UID, and `updatedAt` set to server time. The setting must be enabled before the public free-registration flow is exposed.
3. Verify a fresh test account can register without the 350 EGP initial activation payment and has `accessModel: merchant_trial_v1`, `subscriptionStatus: trial`, and a server-created signup time.
4. Verify project creation and the 7-day setup window, then accept a first merchant agreement and verify that Firestore records the first merchant time and the 3-day grace window.
5. Verify the first invoice for that new account is 59 EGP, payment approval extends the subscription, and a legacy account without the new access model retains its prior policy.
6. Verify expired trial access is denied by Rules as well as by the UI. Do not change merchant recovery, transfer, cutover, repeat-cycle or settlement flags in this activation.

Record the reviewed SHA, whether the Firestore setting is enabled, test evidence, approver and monitoring window for the activation.

## Stop conditions

Stop before deployment if the SHA differs from the reviewed SHA; production Rules cannot be saved for rollback; pending proofs remain technically unhandled; Firebase targets the wrong project; required CI is missing or red; phone/PWA flows are untested; or the paired rollback is unavailable.

A green CI run or code in a Draft PR does not mean the production release is complete.
