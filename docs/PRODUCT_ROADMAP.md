# Family Business product roadmap

This roadmap tracks the approved operating model against the current application. “Implemented” describes code found in the repository; it does not mean a feature has been enabled in production. Production changes require the release gates below.

## Approved product decisions

- A marketer account can link one project of each active type: supermarket, restaurant, bakery, and laundry. More than one project of the same type requires another account.
- The merchant pays the marketer directly for earned order commissions, in cash or by transfer. The platform records the parties’ payment confirmation and does not collect or hold this money.
- New marketer accounts get a free 7-day setup period. Linking the first merchant starts a 3-day grace period; the monthly platform subscription is EGP 59. This replaces the EGP 350 initial payment for new accounts only. Existing accounts keep their current billing behavior.
- Merchant recovery, suspension, and reassignment remain under platform-admin control. Do not promise uninterrupted operation after a marketer expires until the recovery path is safely enabled.
- Nearby discovery is opt-in. The approved initial search radius is approximately 2 km, with an optional expansion up to 5 km for shops that deliver farther. Do not request location or run nearby queries until the customer opens the discovery feature.

## Current progress

| Area | Current state | Remaining work |
| --- | --- | --- |
| Four launch project types | Implemented in the project templates. Cleaning and car wash are retired from the launch set. | Confirm the one-project-per-type limit through the customer-visible account flow before broad launch. |
| PWA installation | Installable PWA manifests and installability coverage exist for the app surfaces. | Run the four project types on real phones and verify update/cache behavior. |
| Commission earning | Commission ledger entries are tied to order dispatch and the agreed commission terms. | Keep customer-facing wording aligned with “earned when sent for delivery.” |
| Direct commission settlement | Operator declaration and project-owner receipt confirmation are implemented; platform admin monitors the records. | Complete the operational flow check on the deployed client and Rules before broad launch. |
| Free registration | Client code is on main and Pages; `platformSettings/trialRegistration.enabled=true` was enabled in Firestore on 2026-10-17. New signups do not pay EGP 350 upfront. | Verify one fresh account gets the 7-day setup period, 3-day first-merchant grace, and EGP 59 monthly amount; confirm legacy behavior remains unchanged. |
| Merchant pause/recovery | Admin controls and staged recovery/cutover code exist, but critical recovery and cutover rollout flags remain OFF. | Complete and validate continuity, consent, financial isolation, and Rules checks before enabling recovery or reassignment. |
| Nearby shop discovery | Not implemented. Current merchant records have text addresses/locations, but no normalized coordinates, geospatial index, or customer discovery flow. | Add optional coordinates, on-demand customer location, bounded geohash lookup, category grouping, approximate distance, and privacy/read-cost checks. |
| Production release | GitHub Pages and Firestore Rules/indexes are separate release operations. | Complete operating-flow smoke checks on real phones and prepare paired rollback materials for future Rules/client changes. |

## Execution sequence

### Phase 1 — Free registration enablement and validation

1. Review and merge the client change only after required CI is green. **Complete:** PRs #154 and #155 are merged.
2. Confirm GitHub Pages publishes that exact commit. **Complete:** the registration page is live.
3. Enable `platformSettings/trialRegistration` with `enabled=true`, the existing Admin UID, and a server timestamp. **Complete:** Firestore read-back confirmed the setting.
4. Verify a fresh test account registers without the EGP 350 initial payment, gets the 7-day setup period, receives 3 days after accepting its first merchant, and sees EGP 59 as the monthly amount. Verify an existing account still uses its prior policy. **Pending live account verification.**
5. Keep recovery, transfer, repeat-cycle, and cycle-settlement flags OFF. **Confirmed unchanged.**

### Phase 2 — Launch operating-flow verification — next

1. Walk through registration, project creation, operator invite/claim, commission agreement, customer order, dispatch, commission earning, direct payment declaration, and receipt confirmation.
2. Repeat for supermarket, restaurant, bakery, and laundry.
3. Confirm admin can pause accounts/projects and inspect operations without taking or holding commission money.
4. Confirm PWA update and customer/operator flows on real phones.

### Phase 3 — Nearby shop discovery

1. Add optional latitude/longitude capture to each merchant profile; retain the text address as a fallback.
2. Add one customer action that asks for location only when tapped. If permission is declined, let the customer search by area/address.
3. Use geohash range queries with client-side distance filtering. Query only on demand; show category headings and a short nearby list rather than loading every merchant at app start.
4. Start with an approximate 2 km radius and offer expansion to 5 km where delivery is available. Label distances approximate; do not promise a walking-time estimate.
5. Add indexes, Rules/privacy coverage, read-count checks, and mobile tests before release.

### Phase 4 — Merchant recovery and reassignment

1. Keep recovery and reassignment disabled while pending subscription billing, historical earnings, operator continuity, recipient consent, and admin finance review are not all enforced together.
2. Finish the fail-closed recovery/cutover path and any required backend or Rules changes.
3. Validate that the shop can continue operating, old earnings remain with their original beneficiary, and new earnings go only to the current assignee.
4. Enable each control separately after its own CI, emulator, and production smoke checks pass.

## Release status rule

Mark a feature “live” only after the exact code SHA is on `main`, required CI is green, any required Firestore Rules/indexes are published to Firebase project `business-2a2e0`, and the user-visible flow has been checked. A merged PR or a green workflow alone is not a production launch.
