# FB-R01 — Family Business Architecture Specification

Status: Approved architecture baseline  
Scope: Platform restructure before next implementation wave  
Repository: salah-hamed/Familybusiness  
Source of truth after approval: `main`

---

## 1. Product Definition

Family Business is a SaaS platform that lets a subscriber launch and operate ready-made service businesses without building software from scratch.

The platform must support two operating models:

1. **Owner-operated projects**
   - The subscriber receives and manages orders directly.
   - Example: Home Cleaning.

2. **Partner-operated projects**
   - The subscriber activates one local operating partner.
   - The operating partner manages day-to-day orders.
   - The subscriber earns an agreed commission from completed orders.
   - Examples: Supermarket Delivery and Laundry 2.0.

The platform is not a simple template gallery. It is a business operating system containing:
- project setup
- onboarding
- order operations
- worker assignment
- partner agreements
- commissions
- referrals
- subscription management
- training/guidance

---

## 2. Launch Portfolio

### Public / active
- `cleaning`
- `laundry`
- `supermarket`

### Hidden / paused
- `carwash`

Car Wash must remain available in the codebase and data model but must not be visible to users until explicitly re-enabled.

### Draft / hidden
Any unfinished template must be hidden from:
- public project pages
- workspace project chooser
- onboarding recommendations

No unfinished project may appear simply because its code directory exists.

---

## 3. Template Registry

A central template registry must control visibility and operating behavior.

Suggested fields:

```text
templateId
name
description
status
visibility
operatingModel
version
sortOrder
isFeatured
```

Allowed values:

```text
status:
active
paused
draft

visibility:
public
hidden

operatingModel:
owner_operated
partner_operated
```

Examples:

```text
cleaning:
status = active
visibility = public
operatingModel = owner_operated

laundry:
status = active
visibility = public
operatingModel = partner_operated

supermarket:
status = active
visibility = public
operatingModel = partner_operated

carwash:
status = paused
visibility = hidden
```

The UI must read this registry rather than hard-code visibility.

---

## 4. Core Roles

### Platform Admin
Can manage:
- users
- subscriptions
- project/template visibility
- project activation
- commissions/reconciliation
- referrals
- platform configuration

### Subscriber
A paying Family Business account holder.

Can:
- create permitted projects
- configure their project
- manage their earnings
- invite / configure an operating partner for partner-operated templates
- maintain workers linked to owner-operated projects
- view referral earnings

### Operating Partner
A business such as:
- supermarket
- laundry shop

Can:
- accept/reject the commercial commission agreement
- operate orders
- manage products where applicable
- assign workers/riders
- update operational order status

A partner cannot operate until the initial commission agreement is accepted.

### Worker / Assignee
Operational person such as:
- supermarket rider
- cleaner
- laundry pickup/delivery worker

V1 workers do not require a full app account.

They are managed from the relevant dashboard and receive order details via WhatsApp.

### Customer
Places a service order through a public project/customer link.

The customer must not be required to perform an extra delivery-confirmation PIN step.

---

## 5. Project Identity Contract

Existing identity remains:

```text
ownerId = Firebase Auth UID
templateId = template identifier
projectDocId = {ownerId}_{templateId}
```

Examples:

```text
abc123_cleaning
abc123_laundry
abc123_supermarket
```

For partner-operated projects, the project has exactly one operating partner in V1.

Suggested project relationship:

```text
projects/{projectDocId}
  ownerId
  template
  operatingModel
  operatorId
  status
  isActive
```

No subscriber may attach more than one supermarket to the supermarket template in V1.

---

## 6. Subscription Model

Commercial model:

```text
Initial account activation + first subscription: 220 EGP
Monthly renewal after first period: 59 EGP
```

Pricing must not be hard-coded in UI files.

Suggested platform config:

```text
platformConfig/billing
  initialActivationFee = 220
  monthlyRenewalFee = 59
  currency = "EGP"
```

Suggested subscription state:

```text
subscriptionStatus
subscriptionStartedAt
subscriptionExpiresAt
initialActivationPaid
lastRenewalAt
```

Initial activation and monthly renewal are separate business events.

---

## 7. Referral Engine

Every active subscriber receives a referral code/link.

Example:

```text
/register?ref=ABC123
```

Referral reward:

```text
50 EGP
```

The reward is created once only after the referred account:
1. registers through the valid referral
2. completes required first payment
3. becomes activated

Do not award the commission on registration alone.

Suggested referral record:

```text
referrals/{referralId}
  referrerUserId
  referredUserId
  referralCode
  status
  commissionAmount = 50
  qualifiedAt
  paidAt
```

Possible status values:

```text
registered
qualified
paid
canceled
```

Referral commission must remain separate from project commission.

---

## 8. Earnings Model

Subscriber dashboard must separate:

```text
Project commissions
Referral commissions
Total earnings
Paid
Outstanding
```

Never combine referral and project earnings into one unexplained balance.

---

## 9. Partner Commission Agreement Engine

Used by:
- Supermarket
- Laundry 2.0
- future partner-operated templates

### Initial agreement

The subscriber proposes a commission amount, for example:

```text
1 EGP per completed order
```

The partner sees:

```text
Proposed commission:
1 EGP per completed order

Accept
Reject
```

If rejected:
- partner operational dashboard remains locked
- orders cannot begin operating under that agreement

If accepted:
- the accepted commission becomes active
- the operating dashboard becomes available

### Future commission change

If the subscriber proposes a new amount:
- current accepted commission remains active
- new value becomes pending
- partner must accept the new value
- only after acceptance does the new rate apply to future completed orders

Suggested fields:

```text
commissionCurrent
commissionPending
commissionStatus
commissionAcceptedAt
commissionUpdatedAt
commissionAcceptedBy
```

Suggested statuses:

```text
pending
accepted
rejected
```

### Commission locking

Each completed order must store the commission amount that applied when the order became eligible.

Example:

```text
commissionAmount = 1
commissionLocked = true
commissionEligible = true
```

A later agreement change must never retroactively modify old completed-order commissions.

---

## 10. Order Completion Rule

No customer PIN.

For V1, the operational party marks an order delivered/completed through the operating workflow.

A completed partner-operated order becomes commission-eligible when:

```text
status = delivered
commissionAgreement = accepted
commissionLocked = true
```

The platform must maintain an audit trail of:
- assigned worker
- assignment time
- delivered/completed time
- acting operator where available

This reduces abuse without forcing an extra customer action.

Future fraud controls may be added without changing the customer flow.

---

## 11. Shared Worker Assignment Engine

Use one shared concept instead of separate rider/cleaner implementations.

Suggested collection:

```text
workers/{workerId}
```

Suggested fields:

```text
ownerId
projectId
name
phone
whatsapp
role
isActive
createdAt
```

Roles may include:

```text
rider
cleaner
pickup_agent
delivery_agent
```

Orders may store:

```text
assignedWorkerId
assignedWorkerName
assignedAt
```

The same assignment engine must support:
- Supermarket riders
- Cleaning workers
- Laundry pickup/delivery workers

---

## 12. WhatsApp Dispatch Engine

After assigning a worker, the platform prepares a WhatsApp message.

### Supermarket rider message

Include:
- order number
- customer name
- customer phone
- address
- Google Maps location
- order items
- total collection amount
- notes

### Cleaning worker message

Include:
- order number
- customer name
- customer phone
- address
- Google Maps location
- visit date
- visit time
- rooms
- bathrooms
- kitchen
- stairs
- price
- notes

### Laundry worker message

Include as applicable:
- customer
- pickup address
- location
- pickup time
- item summary
- operational notes

V1 may use a generated WhatsApp deep link rather than WhatsApp Business API automation.

---

## 13. Supermarket — Superstar Project

The supermarket template is the flagship project.

Operating model:

```text
Subscriber
  ↓
One Supermarket Partner
  ↓
Supermarket Operations Dashboard
  ↓
Riders
  ↓
Customers
```

### Subscriber view

Subscriber sees:
- supermarket name
- completed orders
- active agreed commission
- earned commission
- paid commission
- outstanding commission

Subscriber does not need full customer/order operational details.

### Supermarket dashboard

Must include:
- New orders
- Accepted
- Preparing
- Ready
- Assigned
- Out for delivery
- Delivered
- Canceled

Must support:
- view order
- update status
- assign rider
- send WhatsApp
- manage riders
- manage catalog
- manage pricing
- manage availability

### Customer storefront

Must be product-first, not free-text-first.

Customer experience:

```text
Search
Categories
Products
+ / - quantity
Cart
Checkout
Address
Location
Phone
Place order
```

Free-text item request is only a fallback.

---

## 14. Supermarket Product Catalog Strategy

Do not require manual entry for every product.

Support four acquisition methods:

### A. Master Product Catalog
Global Family Business catalog stores:

```text
barcode
name
brand
size
category
image
```

No supermarket-specific price is stored in the global master record.

### B. Barcode Scan
If barcode exists:
- product data pre-fills
- supermarket enters price
- product is activated

### C. CSV / Excel import
Bulk import supports:
- barcode
- product
- price
- category

### D. Manual add
Fallback only.

Suggested supermarket product location:

```text
supermarkets/{supermarketId}/products/{productId}
```

Fields:

```text
catalogProductId
name
price
inStock
isActive
category
image
barcode
```

---

## 15. Laundry 2.0

Laundry changes from direct owner operation to partner operation.

Operating model:

```text
Subscriber
  ↓
One Laundry Partner
  ↓
Laundry Dashboard
  ↓
Pickup / Processing / Delivery
  ↓
Customer
```

Preserve current item/service concepts:

Items:
- shirt
- trousers
- tshirt
- dress
- galabeya
- suit
- shoes

Services:
- wash
- iron
- wash_iron
- shoes wash-only

Operational stages:

```text
new
accepted
pickup_assigned
picked_up
processing
ready_delivery
out_for_delivery
delivered
canceled
```

Laundry partner commission uses the shared commission agreement engine.

---

## 16. Cleaning

Cleaning remains owner-operated.

Existing customer flow and price configuration are preserved.

Add worker assignment:

```text
Customer order
  ↓
Subscriber dashboard
  ↓
Assign cleaner
  ↓
WhatsApp order details
  ↓
Cleaning execution
  ↓
Complete order
```

The cleaner does not need a full app account in V1.

Cleaning must not be converted into a partner-operated template.

---

## 17. Car Wash

Car Wash remains in the repository.

Required state:

```text
status = paused
visibility = hidden
```

Requirements:
- do not delete existing code
- do not destroy existing data
- do not display in project discovery
- do not recommend during onboarding
- preserve ability to reactivate later

---

## 18. Workspace Redesign

Workspace becomes project-centric.

Example:

```text
Welcome

Your Projects

Supermarket Delivery
Partner: El Nour Market
Completed: 327
Commission: 327 EGP
[Manage]

Laundry
Setup incomplete
[Continue setup]

Home Cleaning
Active
[Manage]
```

Below that:

```text
Available Projects
```

Only public/active templates appear.

Hidden, paused, and draft templates must not render.

---

## 19. Guided Onboarding

New-user journey:

```text
Register
  ↓
Understand Family Business
  ↓
Explore active projects
  ↓
Choose project
  ↓
Subscription / activation
  ↓
Guided project setup
  ↓
Launch
```

The platform must explain:
- what the project is
- what the subscriber does
- what the partner does
- how money is earned
- exact setup steps
- what to do after launch

### Supermarket setup wizard

Suggested steps:

1. Understand the model
2. Add supermarket
3. Propose commission
4. Partner accepts agreement
5. Add products
6. Add at least one rider
7. Generate/share customer order link
8. Project ready

### Laundry setup wizard

1. Add laundry partner
2. Set/confirm commission
3. Configure pricing
4. Add pickup/delivery worker if used
5. Generate/share customer link
6. Project ready

### Cleaning setup wizard

1. Business details
2. Pricing
3. WhatsApp
4. Add cleaners
5. Generate/share customer link
6. Project ready

---

## 20. Learning Center

Each project may expose short training modules.

Examples for Supermarket:

```text
What is the project?
How to approach a supermarket
How to agree commission
How to add products
How to add riders
How to get the first order
How earnings work
```

Training completion may be tracked but must not block core operation unless a specific setup requirement is genuinely required.

---

## 21. Public Project Pages

Each active project gets a proper product page.

Required sections:
- what the project does
- who it is for
- what the subscriber does
- who operates it
- how revenue/commission works
- required setup
- whether stock/shop is required
- start project CTA

Only public active templates have discoverable project pages.

---

## 22. Firebase / Hosting Architecture

Target architecture:

```text
GitHub
  ↓
Firebase Hosting
  ↓
Frontend
  ↓
Firebase Auth
Firestore
(optional later: Cloud Functions)
```

GitHub remains the code source of truth.

Firebase is the runtime platform for:
- Auth
- Firestore
- Hosting
- later Cloud Functions if required

Do not move source control into Firestore.

---

## 23. Hosting Migration

Current GitHub Pages URLs contain:

```text
/Familybusiness/
```

Migration must review:
- absolute paths
- relative paths
- template links
- Workspace → Dashboard routing
- customer links
- manifest
- service worker
- assets
- Firebase Auth authorized domains
- redirects

Do not remove GitHub Pages until Firebase Hosting smoke tests pass.

---

## 24. Deployment Model

Target deployment:

```text
GitHub main
  ↓
Automated deployment
  ↓
Firebase Hosting
Firestore Rules
Indexes
```

The goal is to eliminate manual copy/paste rule deployments.

Required safeguards:
- PR before main
- rules review
- deploy only from approved main
- preserve rollback capability

---

## 25. Suggested New Data Domains

Exact schema will be finalized per implementation task, but the architecture anticipates:

```text
users
projects
orders
workers
operators
supermarkets
catalogProducts
referrals
commissionAgreements
commissionLedger
platformConfig
templateRegistry
```

Existing collections must not be destructively migrated without a separate migration task.

---

## 26. Commission Ledger

Do not calculate all historical earnings dynamically from current rates.

Use immutable earning events.

Suggested:

```text
commissionLedger/{entryId}
  userId
  projectId
  orderId
  sourceType
  sourceId
  amount
  currency
  status
  createdAt
  paidAt
```

Source types:

```text
project_order
referral
```

This creates an auditable financial history.

---

## 27. Platform Configuration

Centralize business constants.

Suggested:

```text
platformConfig/billing
platformConfig/referrals
platformConfig/features
```

Example:

```text
billing:
initialActivationFee = 220
monthlyRenewalFee = 59

referrals:
qualifiedReferralReward = 50
```

Do not scatter these values across JavaScript files.

---

## 28. Feature Flags

Use feature flags or template registry fields for:
- project visibility
- onboarding availability
- partner mode
- experimental features

This allows Car Wash and unfinished projects to stay in code without appearing in production.

---

## 29. Implementation Milestones

### M1 — Core Platform Restructure
- template registry
- visibility/status
- operating model
- shared project metadata
- hide paused/draft projects
- preserve existing routes

### M2 — Subscription + Referral Core
- 220 initial
- 59 renewal
- 50 qualified referral
- platform configuration
- referral tracking

### M3 — Commission + Partner Core
- operator entity
- commission proposal
- accept/reject
- pending commission changes
- commission locking
- commission ledger

### M4 — Shared Worker / WhatsApp Engine
- worker CRUD
- assignment
- role types
- message generation

### M5 — Supermarket Superstar
- partner setup
- supermarket dashboard
- product catalog
- customer storefront
- rider assignment
- order lifecycle
- commissions

### M6 — Laundry 2.0
- partner model
- commission agreement
- operational dashboard
- pickup/delivery assignment
- preserve current pricing concepts

### M7 — Cleaning Upgrade
- preserve current business model
- add cleaners
- assignment
- WhatsApp dispatch

### M8 — Workspace + Onboarding UX
- new workspace
- setup wizards
- learning center
- public project pages

### M9 — Firebase Hosting Migration
- path audit
- Hosting config
- URL migration
- Auth domain review
- smoke tests

### M10 — Automated Deployment
- GitHub → Firebase
- Hosting
- Rules
- indexes

### M11 — Admin / Finance Center
- template visibility
- subscriptions
- referrals
- commission ledger
- partner/project oversight

### M12 — Production Launch Gate
- end-to-end testing
- security validation
- mobile UX validation
- onboarding validation
- three active templates smoke test

---

## 30. Non-Goals for Initial Restructure

Do not add yet:
- live rider tracking
- advanced route optimization
- inventory ERP
- POS integrations
- automatic WhatsApp Business API sending
- multiple supermarket branches
- multiple supermarkets per subscriber
- complex fraud scoring
- marketplace discovery between subscribers and partners

These can be future phases.

---

## 31. Implementation Principles

1. Do not break Cleaning while restructuring.
2. Car Wash stays intact but hidden.
3. Unfinished templates stay hidden.
4. Shared engines must be built once and reused.
5. GitHub stays the code source of truth.
6. Firestore stores runtime state/data, not source code.
7. No financial amount should depend on a mutable current rate after the earning event.
8. Customer flows must stay simple.
9. Avoid unnecessary operational steps.
10. Mobile-first UI is required.
11. Every major architectural change must be isolated into a scoped task.
12. Production Rules and GitHub Rules must remain synchronized.

---

## 32. First Implementation Task After FB-R01

Start with:

**FB-R02 — Template Registry + Visibility + Operating Model**

Scope:
- introduce central registry
- mark Cleaning active/public/owner-operated
- mark Laundry active/public/partner-operated
- introduce Supermarket active/public/partner-operated
- mark Car Wash paused/hidden
- hide unfinished templates
- update project listing/discovery only
- do not yet rebuild Laundry or Supermarket operations
- do not yet migrate Hosting
- do not alter order schemas in this task

This creates the safe foundation for every later milestone.
