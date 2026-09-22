# FB-R06 — Supermarket Superstar

Status: implemented on GitHub. Firestore Rules remain pending deployment until the final test phase.

## Goal

Make Supermarket Delivery the flagship partner-operated project in Family Business.

The subscriber owns the project and commission relationship. The supermarket operates the orders, products, riders, and delivery workflow.

## Roles

### Subscriber
- creates one supermarket project
- links exactly one supermarket
- proposes the per-completed-order commission
- sees completed-order count and commission balances
- can propose future commission changes
- does not receive the full supermarket orders dashboard

### Supermarket operator
- claims the operator account using the agreed verified email
- accepts or rejects the initial commission
- must accept the first agreement before operations unlock
- keeps the old accepted commission while a future change is pending
- manages store settings
- manages products
- manages riders
- runs the full order lifecycle
- marks delivery complete

### Customer
- does not create an account
- browses products visually
- changes quantities with + / -
- uses cart + checkout
- can share GPS location
- is not asked for a delivery PIN or an extra completion action

## Project setup

Project identity remains:

```text
{ownerUid}_supermarket
```

One project has one operator in V1.

Subscriber setup captures:
- supermarket name
- responsible contact
- verified operator email
- phone / WhatsApp
- address / location
- delivery fee
- proposed commission per completed order

The subscriber dashboard provides:
- counted completed orders
- earned commission
- paid commission
- outstanding commission
- current accepted commission
- agreement state
- operator invite link
- customer order link once operational

## Commission agreement

Initial operation is locked until:
1. subscriber proposes commission
2. supermarket operator claims the account
3. supermarket accepts commission

If the subscriber later proposes another rate:
- current accepted rate stays active
- new rate stays pending
- the new rate applies only after supermarket acceptance
- rejection preserves the previous accepted rate

## Product catalog

Four entry paths are supported:

1. Starter master catalog
   - common supermarket product types are already available
   - supermarket selects an item and enters the price

2. Barcode
   - browser BarcodeDetector is used when supported
   - manual barcode entry is the fallback
   - scanned unknown products can be added immediately

3. Excel / CSV import
   - supported columns include:
     - name / اسم المنتج
     - price / السعر
     - category / التصنيف
     - barcode / الباركود
     - size / الحجم
     - image / الصورة
   - existing barcode products update without rewriting creation identity

4. Manual add
   - fallback for products not found elsewhere

Store products live under:

```text
supermarkets/{projectId}/products/{productId}
```

## Customer storefront

Path:

```text
templates/supermarket/?project={projectDocId}
```

Customer flow:

```text
Search / category
→ product cards
→ quantity +/-
→ cart
→ name / phone / address
→ optional GPS location
→ place order
```

A free-text extra request is available only as a fallback note.

## Price integrity

Customer-submitted price snapshots are not treated as final.

When the supermarket accepts a new order:
- the operator client reloads the live store catalog
- unit prices and subtotals are recalculated
- delivery fee is reloaded
- final order total is recalculated
- pricing becomes locked
- later status changes cannot modify price fields

This avoids relying on a customer-controlled total while keeping the direct Firestore architecture.

## Order lifecycle

```text
new
→ accepted
→ preparing
→ ready
→ assigned
→ out_for_delivery
→ delivered
```

Cancellation is allowed before delivery.

A rider must be assigned before the order can move into delivery completion.

## Rider + WhatsApp

The R05 shared worker engine is reused.

Supermarket workers use:

```text
role = rider
```

At assignment:
- order stores the rider snapshot
- immutable assignment history is created
- WhatsApp is prepared with:
  - order number
  - customer
  - phone
  - address
  - location
  - products
  - amount to collect
  - notes

No WhatsApp Business API is required in V1.

## Delivery confirmation and commission

There is no customer PIN.

The supermarket marks the order delivered after the rider completes delivery.

The delivered transition and commission ledger creation are designed as one atomic Firestore transaction.

The order locks:
- commission eligibility
- commission amount
- agreement version
- delivered timestamp

Ledger id:

```text
project_order_{orderId}
```

This prevents the same order from legitimately generating multiple project commission entries.

## Collections introduced / used

```text
supermarkets/{projectId}
supermarkets/{projectId}/products/{productId}
orders/{orderId}
operators/{projectId}
commissionAgreements/{projectId}
workers/{workerId}
workerAssignments/{assignmentId}
commissionLedger/project_order_{orderId}
```

## Operational separation

For partner-operated projects, worker operations belong to the accepted operator.

Subscriber project owners do not receive the supermarket orders dashboard.

Cleaning remains owner-operated and continues to support owner worker management.

## Security

Pending GitHub Rules include:
- public store/product reads only when the partner project is operational
- public order creation only for an active supermarket project accepting orders
- exact allowed supermarket order create fields
- operator-only supermarket order operations
- authoritative price lock on acceptance
- rider requirement for delivery states
- atomic delivered-order / commission-ledger consistency with getAfter()
- immutable commission ledger amount/source
- verified-email operator claim
- claimed operator email identity lock
- product and store identity field protection

These Rules have NOT been deployed to Firebase yet.

## Explicitly deferred

- live rider tracking
- route optimization
- POS integration
- real inventory synchronization
- automatic WhatsApp Business API sending
- multiple supermarkets per subscriber
- multiple branches
- online payment settlement
- advanced fraud scoring
