# Family Business — Security Launch Gate

This checklist separates repository-enforced controls from Firebase / Google Cloud controls that cannot be verified from GitHub alone.

## Repository controls

- [x] Firestore unknown paths default-deny.
- [x] Subscriber cannot self-promote to admin.
- [x] Financial ledger / settlement / reversal invariants are enforced in Firestore Rules.
- [x] InstaPay transfer references are normalized and claimed once.
- [x] Operator invites are cryptographically random, expire after 48 hours, are one-time claimable, and are removed from the address bar after claim.
- [x] Public tracking records expire after 30 days.
- [x] Admin uses session-only persistence, idle timeout, and recent-login gates for sensitive actions.
- [x] Browser Firebase SDK imports are pinned to the approved current version.
- [x] Permanent Security CI runs source, Rules, query, E2E, and shipped-dependency audits.
- [x] No service-account private key / client secret material is committed.

## Firebase / Google Cloud launch gates — MUST be completed before public launch

### App Check
- [ ] Create a score-based reCAPTCHA Enterprise Web key for salah-hamed.github.io.
- [ ] Do **not** add localhost to the production reCAPTCHA key.
- [ ] Register the Family Business Web app in Firebase > App Check using the same key.
- [ ] Put the public site key in core/config/security-config.js.
- [ ] Deploy the client and verify App Check metrics show legitimate requests as verified.
- [ ] Enable App Check enforcement for Cloud Firestore.
- [ ] Enable App Check enforcement for Firebase Authentication after metrics confirm normal login traffic.

### Authentication
- [ ] Firebase Authentication password policy is enforced (recommended minimum 10 characters; require upper/lowercase plus a number).
- [ ] Admin account uses a unique long password not reused anywhere else.
- [ ] Only required Authorized Domains remain: Firebase defaults required by Auth, salah-hamed.github.io, and the future official custom domain.
- [ ] Remove obsolete / test authorized domains before launch.
- [ ] Review all accounts with role == admin and keep the minimum necessary.

### API key restrictions
- [ ] Review the Web API key in Google Cloud Console.
- [ ] Restrict browser referrers to the production Family Business origins when compatible with Firebase Auth.
- [ ] Keep only APIs required by the Firebase Web app; verify login, Firestore, password reset and App Check after restrictions.

### Production synchronization
- [ ] Deploy the exact firestore.rules from the release commit.
- [ ] Deploy the exact firestore.indexes.json from the release commit.
- [ ] Confirm all required composite indexes show Enabled, not Building.
- [ ] Run one production smoke test: register -> activate -> create project -> customer order -> dispatch -> commission -> settlement -> tracking.

### Monitoring and recovery
- [ ] Configure Firebase / Google Cloud budget alerts before accepting public traffic.
- [ ] Review Firestore read/write usage daily during the controlled launch.
- [ ] Define the production backup method and perform one restore drill before large-scale rollout.
- [ ] Record an incident contact and a procedure for: stolen admin session, spam-order burst, suspicious payment reference, or unexpected Firebase cost spike.

## Controlled-launch rule

Do not open a large paid campaign until all Firebase / Google Cloud launch gates above are checked. A small controlled pilot can be used only to validate App Check metrics and the production smoke test before enforcement.
