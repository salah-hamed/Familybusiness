# Family Business — One coordinated Firebase Rules cutover

**Status:** Not yet approved for production activation. Follow this after all remaining code, Rules and Firestore Emulator tests are complete.

## Safety contract

1. `main` contains backward-compatible trial Rules and merchant transfer consent-case Rules, but GitHub Pages does **not** deploy Firestore Rules. Firebase Rules must be manually deployed once from the final approved `main`.
2. Live registration remains the legacy model because `core/subscriptions/trial-rollout.js` sets `TRIAL_REGISTRATION_ENABLED=false`. Draft PR #129 contains the new 7+3 day marketing/signup activation and must remain **unmerged** until the Rules deploy succeeds and the older flows have been smoke-tested.
3. `core/merchants/transfer-case-rollout.js` is **false**; transfer-consent case creation remains unavailable until operator and incoming-subscriber UI, legal consent and historical finance closeout are reviewed. Even consent cases do not reassign order routing or commissions.
4. `core/images/image-upload-config.js` has `provider:"disabled"`. Local photo upload must not be enabled without a configured restricted provider, upload quota/abuse protection and cost review.
5. Preserve all existing `ownerId`, `projectDocId`, operator links, existing ledger/settlement records, QR/URLs and the 2,000 original product image URLs and `masterId` values. Removal of visible Carrefour branding does not grant rights to third-party images.

## Final release sequence

### A. Code freeze and regression proof

- Review final `main` SHA and merged PRs; archive/close superseded stale drafts.
- Confirm `TRIAL_REGISTRATION_ENABLED=false`, `MERCHANT_TRANSFER_CASES_ENABLED=false`, image provider `disabled`.
- Verify latest GitHub CI **Security and Regression Tests** and **Pages** workflows are green. CI runs the Firestore Emulator. Do not bypass failing tests.
- Verify the new trial rules respect existing subscriptions and operator agreements and the new transfer consent records cannot cut over `ownerId`.
- Recheck the catalog image+masterId checksum regression and check product image rendering on one live supermarket before enabling anything.

### B. Publish the Rules ONE time (Windows VS Code PowerShell)

In the repository directory, with no uncommitted changes that could be lost:

```powershell
git status
git switch main
git pull --ff-only origin main
firebase.cmd login:list
firebase.cmd deploy --only firestore:rules --project business-2a2e0
```

If Firebase credentials expired, run `firebase.cmd login --reauth` first. Check the **exact Firebase project** and the terminal's `Deploy complete!` result. This command only deploys `firestore.rules`; it does not delete user/project data or automatically deploy indexes.

If indexes were changed in later PRs, separately review and publish them once as part of the same final release; do not guess that indexes were deployed.

### C. Compatibility smoke checks BEFORE switching signup

With the **old registration still enabled**, test:

- Legacy active subscriber login; existing project and operator pages load.
- Operator can accept an ordinary commission agreement without reading the subscriber's private user document.
- Customer creates an order, operator receives it, dispatch and settlement history remain intact.
- The first 2,000 catalog image URLs and products still render where their external CDN allows it.
- Subscription payment/renewal review works, and Admin overview/transfer preflight do not perform unintended writes.

### D. Enable trial AFTER successful Rules publication

- Review the fresh activation Draft PR #129 against the latest `main`, reconcile new merges and rerun CI.
- Only then merge the activation PR, deploying the PWA/cache updates.
- Test a clean new-user signup with the 7-day server-anchored setup window, then first physical operator claimed + accepted commission agreement in an **atomic** write starting the 3-day grace window.
- Verify first monthly charge is 59 EGP for trial accounts, whereas legacy subscription contracts remain unchanged. Check approved payment and first referral eligibility, expired access, and hostile client permission tests.
- No new-user activation claim should appear until a real approval is recorded.

### E. Unilateral recovery comes before optional merchant reassignment

- A paid subscriber who fails to renew or commits a verified policy violation **cannot veto recovery**. The physical operator must stay online while central platform administration takes responsibility. See docs/MERCHANT_PLATFORM_RECOVERY_POLICY.md.
- No browser-side reassignment, ownership metadata-only change or timed logout can substitute for tested Rules, atomic audit, historical commission protection and future beneficiary routing.
- Do not enable reassignment merely because a preflight or consent case exists.
- Transfer consent UI now exists at `merchant-transfer/` and is still **off** via MERCHANT_TRANSFER_CASES_ENABLED=false. Only the physical operator and incoming subscriber can get new consent cases; the departing subscriber cannot view, accept, reject or veto them. Do not enable until accepted-epoch cutover and accounting tests pass.
- Complete historical unsettled balance closeout, future incoming beneficiary routing, and actual transaction/permissions cutover; consent alone never changes project assignment.
- Design and regression-test future-order beneficiary/routing cutover without changing historical `ownerId`, ledgers or prior settlements. Test consent withdrawal, double assignment and stale/broken old subscribers.
- Until that is complete, keep the case rollout and cutover disabled.

## Emergency recovery

If the new signup causes trouble, turn the signup rollout switch off in a reviewed hotfix and redeploy the web app. The additive Rules alone should not switch old users to trial mode. Keep the prior stable release SHA available. Never delete/recreate projects or products as a rollback shortcut.

The final manual Rules deployment should be triggered **once only** after the team and administrator have verified the full release gate.
