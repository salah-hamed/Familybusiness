# FB-R07 — Laundry 2.0 Partner Operations

Status: implemented on GitHub. Firestore Rules remain pending live deployment until the final testing phase.

## Goal

Convert Laundry from direct subscriber operation into the approved partner-operated model without losing the existing per-piece pricing/customer experience.

## Operating model

```text
Subscriber
  ↓
One Laundry Partner
  ↓
Laundry Operator Dashboard
  ↓
Pickup / Processing / Delivery Workers
  ↓
Customer
```

The subscriber owns the Family Business project and commercial commission relationship.

The laundry partner owns day-to-day operations.

## Subscriber experience

Dedicated path:

```text
/laundry/?project={projectDocId}
```

The subscriber can:
- link one laundry partner
- enter partner/responsible contact information
- propose initial commission per completed order
- propose future commission changes
- copy the laundry-operator invite link
- copy the customer order link after the partner becomes operational
- see completed commission-bearing orders
- see earned / paid / outstanding project commission

The subscriber does not receive the Laundry operational orders dashboard.

## Legacy Laundry migration

Existing Laundry projects created before the partner model are migrated on owner entry.

Allowed migration is intentionally narrow:

```text
template = laundry
operatingModel -> partner_operated
templateVersion -> 3
operatorId -> ""
partnerSetupStatus -> not_started
```

No order or price data is deleted by this migration.

## Partner account and agreement

Dedicated path:

```text
/laundry-operator/?project={projectDocId}
```

The operator:
1. creates/signs in with the email recorded by the subscriber
2. verifies the email
3. claims the operator record
4. accepts or rejects the pending commission
5. gains the operational dashboard only after the first agreement is accepted

The shared operator claim flow is idempotent for a user who already claimed the same partner account.

Future commission changes preserve the currently accepted rate until the partner accepts a new one.

## Laundry settings

Partner settings live in:

```text
laundries/{projectId}
```

They include:
- laundry name
- responsible contact
- phone
- WhatsApp
- email
- address
- location
- InstaPay link
- accepting-orders toggle

Public access to the laundry business record is allowed only when the partner project is operational and accepting orders.

## Pricing

The existing authoritative 13-key Laundry price model is preserved:

- shirt wash / iron
- trousers wash / iron
- tshirt wash / iron
- dress wash / iron
- galabeya wash / iron
- suit wash / iron
- shoes wash only

Pricing remains on:

```text
projects/{projectId}.priceConfig
```

For Laundry 2.0:
- the subscriber cannot change the partner-operated Laundry priceConfig
- the accepted active Laundry operator can change only priceConfig
- the customer order validator still calculates from project priceConfig

## Customer storefront

The existing Laundry storefront remains:

```text
/templates/laundry/?project={projectDocId}
```

It preserves:
- item selection
- wash / iron / wash+iron
- shoes wash-only
- pickup date/time
- saved customer details
- address
- optional GPS location
- notes
- WhatsApp
- InstaPay

Before rendering the order UI, the storefront now requires the public Laundry partner record to be operational through Security Rules and to be accepting orders.

## Worker roles

R05 shared workers are reused:

```text
pickup_agent
delivery_agent
```

The operator can:
- add workers
- activate/deactivate workers
- assign a pickup worker
- assign a delivery worker
- open pre-filled WhatsApp dispatch after assignment

## Order lifecycle

```text
new
→ accepted
→ pickup_assigned
→ picked_up
→ processing
→ ready_delivery
→ out_for_delivery
→ delivered
```

Cancellation is allowed before delivery.

Rules require:
- pickup_agent for the pickup-assigned stage
- delivery_agent for out-for-delivery and delivered stages

The current assignment snapshot is stored on the order.

Immutable worker assignment events remain in:

```text
workerAssignments
```

## Commission completion

There is no customer PIN.

When the laundry operator moves an order from out_for_delivery to delivered:

- order status becomes `done`
- `laundryStage = delivered`
- commission becomes eligible
- accepted commission amount is locked on the order
- accepted agreement version is locked
- delivery timestamp is stored
- `commissionLedger/project_order_{orderId}` is written in the same transaction

The subscriber commission rate cannot retroactively change completed orders.

## Operational isolation

For Laundry 2.0:
- operator can read operational Laundry orders
- subscriber cannot read the full Laundry order stream
- subscriber sees commission summaries instead
- subscriber cannot assign Laundry workers
- subscriber cannot change partner Laundry pricing
- Admin remains an override

## Rules

GitHub `firestore.rules` now includes pending rules for:

- Laundry partner readiness
- Laundry business record
- public customer availability
- operator-only Laundry lifecycle transitions
- worker role requirements per operational stage
- operator-only partner pricing
- legacy project migration
- atomic delivered-order commission locking
- project commission ledger creation for both Supermarket and Laundry
- partner business read before first commission acceptance

These rules have NOT been deployed live yet.

## Explicitly deferred

- automatic WhatsApp Business API
- live worker tracking
- route optimization
- multi-laundry partners per subscriber
- inventory/garment tagging
- POS/accounting integration
- customer delivery PIN
