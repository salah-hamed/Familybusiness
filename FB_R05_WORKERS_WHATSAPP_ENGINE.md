# FB-R05 — Shared Workers + WhatsApp Assignment Engine

Status: implemented on GitHub; Firestore Rules pending deployment until the final testing phase.

## Purpose

Provide one reusable worker/assignee engine for all active operating models instead of building separate rider, cleaner, and pickup/delivery systems.

## Supported worker roles

- Supermarket: `rider`
- Cleaning: `cleaner`
- Laundry: `pickup_agent`, `delivery_agent`

## Core services

### `core/workers/worker-service.js`

Supports:
- create worker
- list workers for a project
- update worker
- activate/deactivate worker
- project actor authorization
- template/role compatibility

Project owners can manage their workers.

For partner-operated projects, an authenticated active operator with an accepted commission agreement can also manage workers.

### `core/workers/assignment-service.js`

Supports:
- assign an active worker to an order
- clear/reassign an order
- store the current assignment snapshot on the order
- create an immutable assignment event in `workerAssignments`

Order assignment snapshot fields:

```text
assignedWorkerId
assignedWorkerName
assignedWorkerRole
assignedWorkerWhatsapp
assignedAt
assignmentUpdatedAt
```

Assignment events contain:
- project
- order
- worker
- actor
- actor type
- event type
- timestamp

### `core/whatsapp/dispatch-service.js`

Builds WhatsApp dispatch messages and links.

Template-aware message support:
- Supermarket
- Cleaning
- Laundry

The V1 behavior is a WhatsApp deep link. It does not require WhatsApp Business API automation.

### `core/workers/worker-dispatch-service.js`

Combines:
1. worker assignment
2. order assignment persistence
3. WhatsApp message preparation
4. optional opening of WhatsApp

This is the integration entry point for R06, R07, and R08.

## Security model

Pending `firestore.rules` includes:

- `workers/{workerId}`
- `workerAssignments/{assignmentId}`
- isolated assignment-field updates on `orders/{orderId}`
- owner authorization
- active accepted partner/operator authorization
- project-worker matching
- worker role validation
- immutable assignment event history

These rules are intentionally NOT deployed live yet.

## Scope boundaries

FB-R05 does not add worker UI to existing dashboards.

UI integration is deferred to:
- FB-R06 Supermarket
- FB-R07 Laundry 2.0
- FB-R08 Cleaning upgrade

This avoids changing the current Cleaning/Laundry runtime before each template receives its dedicated workflow.
