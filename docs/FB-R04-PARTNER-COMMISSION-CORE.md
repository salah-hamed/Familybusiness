# FB-R04 — Partner + Commission Agreement Core

Status: Implementation contract  
Rules deployment: pending until final test phase

## Scope

This task adds the shared foundation for partner-operated projects:

- Supermarket
- Laundry 2.0
- future partner-operated templates

It does not yet build the Supermarket or Laundry operating dashboards.

## One partner per project

V1 uses one deterministic operator per partner-operated project:

```text
operatorId = projectDocId
```

Example:

```text
abc123_supermarket
```

The project stores:

```text
operatorId
partnerSetupStatus
```

## Operator states

```text
pending_invite
pending_agreement
active
```

The operator cannot operate unless:

```text
isActive = true
status = active
agreementStatus = accepted
```

## Secure operator claim

The operating partner must use an authenticated Firebase account whose verified email matches the operator email stored by the subscriber.

The claim operation sets only:

```text
authUid
status
updatedAt
```

A different authenticated user cannot claim an already claimed operator record.

## Commission agreement

One deterministic agreement per project:

```text
agreementId = projectDocId
```

Core fields:

```text
projectId
ownerId
operatorId
templateId
currency = EGP
unit = per_completed_order
currentAmount
pendingAmount
status
pendingStatus
version
acceptedAt
acceptedBy
rejectedAt
lastDecision
```

## Initial proposal

Example:

```text
currentAmount = null
pendingAmount = 1
status = pending
pendingStatus = pending
```

The partner must accept before the operator becomes active.

## Accepted agreement

After acceptance:

```text
currentAmount = 1
pendingAmount = null
status = accepted
pendingStatus = none
lastDecision = accepted
```

The operator becomes:

```text
agreementStatus = accepted
status = active
isActive = true
```

## Commission changes

If a currently accepted rate is 1 EGP and the subscriber proposes 1.5 EGP:

```text
currentAmount = 1
pendingAmount = 1.5
status = accepted
pendingStatus = pending
```

The old accepted rate remains effective and the operator remains active until the partner decides.

If the partner accepts:

```text
currentAmount = 1.5
pendingAmount = null
pendingStatus = none
```

If the partner rejects:

```text
currentAmount = 1
pendingAmount = null
status = accepted
pendingStatus = none
lastDecision = rejected
```

The previous accepted rate continues unchanged.

## Rejected initial proposal

If there is no previously accepted rate and the partner rejects:

```text
currentAmount = null
status = rejected
pendingStatus = none
```

The operating dashboard remains locked.

The subscriber can submit a new proposal later.

## Commission locking

The commission service exposes a builder for immutable project-order ledger entries.

When a future partner-operated order becomes completed, the order flow must lock the currently accepted commission into that order and create a ledger entry.

A later commission change must never change an older completed order's commission.

This actual order-completion integration belongs to the Supermarket / Laundry implementation tasks, not FB-R04.

## Collections

```text
operators/{projectDocId}
commissionAgreements/{projectDocId}
commissionLedger/{entryId}
```

## Security model

Subscriber:
- creates one operator for a project they own
- edits operator contact data
- proposes commission
- cannot accept their own proposal as the partner

Partner:
- claims operator access only with matching verified email
- reads their own operator/agreement
- accepts or rejects pending commission changes
- cannot change project ownership or agreement identity

Admin:
- retains platform oversight

## Important deployment note

`firestore.rules` is updated in GitHub in this task but must not be published to live Firebase yet.

Rules will be reviewed and deployed together during the planned test/deployment phase.
