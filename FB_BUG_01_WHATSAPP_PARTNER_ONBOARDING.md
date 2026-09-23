# FB-BUG-01 — WhatsApp Partner Onboarding Stabilization

Status: implemented on GitHub branch; live runtime validation requires publishing the updated Firestore Rules.

## Goal

Replace the fragile email-verification onboarding for Supermarket and Laundry operators with a no-SMS-cost WhatsApp invitation flow while preserving the existing Firebase Email/Password provider internally.

## User flow

Subscriber:
1. enters partner/store/laundry details
2. enters the responsible person's WhatsApp number
3. proposes the per-completed-order commission
4. saves the setup
5. taps "Send WhatsApp invitation"

Partner/operator:
1. opens the personal WhatsApp invitation URL
2. chooses a password on first activation
3. the app signs in using an internal synthetic Firebase email derived from the secret invite token
4. the operator record is claimed automatically
5. the partner accepts the pending commission
6. the operational dashboard unlocks
7. workers/riders can be created normally

## Security model

- the invite URL contains a cryptographically random token
- the token is transformed into an internal Firebase Auth email
- the internal email is stored on the operator record as authLoginEmail
- Firestore permits pre-claim access only when request.auth.token.email matches authLoginEmail
- knowing only projectId is not sufficient to claim an operator
- legacy verified-email claim remains supported for existing data
- operator authUid remains the durable identity after claim
- worker access remains locked until operator status is active, agreementStatus is accepted, and isActive is true

## Compatibility

- no Phone Auth provider is required
- no SMS OTP is used
- no new paid authentication service is introduced
- existing Email/Password Firebase Auth provider is reused internally
- existing partner-operated project identity remains unchanged
- existing commission architecture remains unchanged
- existing worker/assignment architecture remains unchanged
- unclaimed legacy operators can receive a new WhatsApp invite automatically
- already-claimed legacy operators are not silently rebound to a new account

## Scope

Changed:
- core/partners/partner-service.js
- core/supermarket/supermarket-service.js
- core/laundry/laundry-service.js
- supermarket/app.js
- supermarket/index.html
- laundry/app.js
- laundry/index.html
- supermarket-operator/app.js
- supermarket-operator/index.html
- laundry-operator/app.js
- laundry-operator/index.html
- firestore.rules

Out of scope:
- order lifecycle changes
- commission calculation changes
- Cleaning
- subscriptions/referrals
- Firebase Hosting
- WhatsApp Business API
- SMS/Phone OTP

## Validation performed

- JavaScript syntax compilation check for all modified JS modules after stripping imports/exports
- UI/JS ID consistency check for the four changed pages
- Firestore Rules brace/parenthesis/bracket balance check
- duplicate operator match check
- no remaining operator-page authEmail/emailVerified/verifyPanel UI dependencies
- invite identity remains project-scoped through operators/{projectId}

## Live smoke test after Rules publish

Supermarket:
1. owner opens project
2. save partner using WhatsApp number
3. tap Send WhatsApp invitation
4. open invitation
5. activate invitation with password
6. accept commission
7. confirm operations dashboard unlocks
8. add rider
9. confirm no PROJECT_ACCESS_DENIED

Laundry:
1. repeat partner invitation flow
2. accept commission
3. add pickup_agent
4. add delivery_agent
5. confirm both workers save successfully
6. confirm no PROJECT_ACCESS_DENIED

## Known limitation

The invite URL is a possession credential. It must be treated as personal and should not be forwarded. Password recovery for the hidden synthetic Firebase email is intentionally not implemented in this bug-fix task.
