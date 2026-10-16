# Family Business product roadmap

This roadmap tracks the approved operating model against the current application. “Implemented” describes code found in the repository; it does not mean a feature has been enabled in production. Production changes require the release gates below.

## Approved product decisions

- A marketer account can link one project of each active type: supermarket, restaurant, bakery, and laundry. More than one project of the same type requires another account.
- The merchant pays the marketer directly for earned order commissions, in cash or by transfer. The platform records the parties’ payment confirmation and does not collect or hold this money.
- New marketer accounts get a free 7-day setup period. Linking the first merchant starts a 3-day grace period; the monthly platform subscription is EGP 59. This replaces the EGP 350 initial payment for new accounts only. Existing accounts keep their current billing behavior.
- Merchant recovery, suspension, and reassignment remain under platform-admin control. Do not promise uninterrupted operation after a marketer expires until the recovery path is safely enabled.
- Nearby discovery is opt-in. The proposed initial search is a 2 km approximate radius, with an optional expansion up to 5 km for shops that deliver farther. Do not request location or run nearby queries until the customer opens the discovery feature.

## Current progress

| Area | Current state | Remaining work |
| --- | --- | --- |
| Four launch project types | Implemented in the project templates. Cleaning and car wash are retired from the launch set. | Confirm the one-project-per-type limit through the customer-visible account flow before broad launch. |
| PWA installation | Installable PWA manifests and installability coverage exist for the app surfaces. | Run the four project types on real phones and verify update/cache behavior. |
| Commission earning | Commission ledger entries are tied to order dispatch and the agreed commission terms. | Keep customer-facing wording aligned with “earned when sent for delivery.” |
| Direct commission settlement | Operator declaration and project-owner receipt confirmation are implemented; platform admin monitors the records. | Confirm the deployed Firestore Rules match the current client before enabling this flow to new production users. |
| Free registration | Client trial policy, signup fields, and Firestore admin gate are implemented. This change opens the client gate for new signups. | A platform admin must enable `platformSettings/trialRegistration` before the updated public signup flow is exposed. Then verify 7 days, first-merchant grace, EGP 59, and legacy-account behavior. |
| Merchant pause/recovery | Admin controls and staged recovery/cutover code exist, but critical recovery and cutover rollout flags remain OFF. | Complete and validate continuity, consent, financial isolation, and Rules checks before enabling recovery or reassignment. |
| Nearby shop discovery | Not implemented. Current merchant records have text addresses/locations, but no normalized coordinates, geospatial index, or customer discovery flow. | Add merchant coordinate capture, a consent-driven customer location request, bounded geohash lookup, category grouping, distance display, and Rules/privacy tests. |
| Production release | GitHub Pages and Firestore Rules/indexes are separate release operations. | Publish only the reviewed SHA; check CI and Pages; verify production Rules/indexes; perform mobile smoke checks and prepare rollback. |

## Execution sequence

### Phase 1 — Free registration activation

1. Review and merge the client change only after required CI is green.
2. Confirm GitHub Pages publishes that exact commit.
3. Before exposing the new signup flow, an authenticated platform admin enables `platformSettings/trialRegistration` using the Firestore Rules-approved fields: `enabled`, `updatedBy` (admin UID), and server time `updatedAt`.
4. Verify a new test account registers with no EGP 350 charge, gets the 7-day setup trial, receives 3 days after accepting its first merchant, and sees EGP 59 as the monthly amount. Verify an existing account still uses its prior policy.
5. Record the released commit and setting state. Keep recovery, transfer, repeat-cycle, and cycle-settlement flags OFF.

### Phase 2 — Launch operating-flow verification

1. Walk through registration, project creation, operator invite/claim, commission agreement, customer order, dispatch, commission earning, direct payment declaration, and receipt confirmation.
2. Repeat for supermarket, restaurant, bakery, and laundry.
3. Confirm admin can pause accounts/projects and inspect operations without taking or holding commission money.
4. Confirm PWA update and customer/operator flows on real phones.

### Phase 3 — Nearby shop discovery

1. Add optional latitude/longitude capture to each merchant profile; retain the text address as a fallback.
2. Add one customer action that asks for location only when tapped. If permission is declined, let the customer search by area/address.
3. Use geohash range queries with client-side distance filtering. Query only on demand; show category headings and a short nearby list rather than loading every merchant at app start.
4. Start with a 2 km radius and offer expansion to 5 km where delivery is available. Label distances approximate; do not promise a walking-time estimate.
5. Add indexes, Rules/privacy coverage, read-count checks, and mobile tests before release.

### Phase 4 — Merchant recovery and reassignment

1. Keep recovery and reassignment disabled while pending subscription billing, historical earnings, operator continuity, recipient consent, and admin finance review are not all enforced together.
2. Finish the fail-closed recovery/cutover path and any required backend or Rules changes.
3. Validate that the shop can continue operating, old earnings remain with their original beneficiary, and new earnings go only to the current assignee.
4. Enable each control separately after its own CI, emulator, and production smoke checks pass.

## Release status rule

Mark a feature “live” only after the exact code SHA is on `main`, required CI is green, any required Firestore Rules/indexes are published to Firebase project `business-2a2e0`, and the user-visible flow has been checked. A merged PR or a green workflow alone is not a production launch.

