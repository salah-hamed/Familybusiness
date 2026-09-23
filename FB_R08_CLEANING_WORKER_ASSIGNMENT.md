# FB-R08 — Cleaning Worker Assignment + WhatsApp Dispatch

Status: implemented on GitHub; runtime validation pending Firestore Rules deployment and live smoke testing.

## Goal

Connect the existing FB-R05 shared worker and WhatsApp assignment engine to the owner-operated Cleaning project without changing Cleaning into a partner-operated template.

## Scope

Cleaning subscriber can:

- add a cleaner
- list active and inactive cleaners
- activate/deactivate cleaners
- assign an active cleaner to an open Cleaning order
- reassign the order to another active cleaner
- persist the current assignment snapshot on the order
- create immutable worker assignment events through the shared assignment service
- prepare and open a pre-filled WhatsApp dispatch with Cleaning order details

## Reused shared services

- `core/workers/worker-service.js`
- `core/workers/assignment-service.js`
- `core/workers/worker-dispatch-service.js`
- `core/whatsapp/dispatch-service.js`

No duplicate Cleaning-only worker engine was introduced.

## Cleaning operating model

Cleaning remains:

```text
owner_operated
```

No operator, commission agreement, or partner workflow is introduced by this task.

## Dashboard integration

The existing subscriber dashboard now exposes a Cleaning-only team section.

For open Cleaning orders the dashboard shows:

- currently assigned cleaner, when present
- active cleaner selector
- assign/reassign action
- WhatsApp dispatch action

Completed and canceled orders do not expose assignment controls.

## Firestore Rules

FB-R08 requires no new Firestore rule family.

The existing pending rules already support:

- owner-operated project worker management
- Cleaning `cleaner` role validation
- assignment-only order field updates
- immutable `workerAssignments` events

Live deployment of the accumulated rules remains a separate deployment action.

## Out of scope

- Supermarket changes
- Laundry changes
- Car Wash changes
- order schema redesign
- WhatsApp Business API automation
- live worker tracking
- Firebase Hosting migration
- CI/CD

## Smoke test

1. Open an active Cleaning project as its subscriber.
2. Add a cleaner with WhatsApp number.
3. Confirm the cleaner appears active.
4. Create/open a Cleaning order.
5. Assign the cleaner.
6. Confirm WhatsApp opens with the order details.
7. Confirm the order stores the assignment snapshot.
8. Reassign to another active cleaner.
9. Deactivate a cleaner and confirm it is no longer selectable.
10. Confirm Supermarket and Laundry flows are unchanged.
