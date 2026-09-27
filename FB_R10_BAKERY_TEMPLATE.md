# FB-R10 — Bakery & Pastry Template

## Goal
Add an active public Bakery & Pastry project to Family Business without creating a second operational architecture.

## Architecture
Bakery reuses the existing food-partner engine used by Restaurants:
- partner onboarding and WhatsApp invite
- commission agreements
- restaurant/food business document
- menu/product collection
- riders
- orders
- dispatch
- commission ledger
- customer My Orders and secure live tracking

The project still keeps a distinct template identity:
- templateId: bakery
- projectDocId: {ownerId}_bakery
- order templateType: bakery
- serviceType: bakery_delivery

## Launch portfolio after FB-R10
- Supermarket: active/public
- Restaurants: active/public
- Bakery & Pastry: active/public
- Laundry: active/public
- Cleaning: paused/hidden
- Car Wash: paused/hidden

## Bakery owner flow
Workspace -> Create Bakery project -> Link one bakery -> Set WhatsApp -> Propose commission -> Send operator invite.

## Bakery operator
- activate WhatsApp invite
- accept commission
- customize identity and media
- manage products
- manage riders
- manage orders
- share customer ordering link

## Starter bakery categories
- فينو
- خبز
- بقسماط
- باتيه
- كرواسون
- فطير
- معجنات
- كيك وحلويات
- بوكسات وعروض

## Selling units
Bakery products support:
- قطعة
- كيس
- دستة
- كيلو
- علبة
- صينية

V1 quantities are integer units. Fractional weight quantities are out of scope.

## Customer
- bakery-branded storefront
- category navigation
- menu paging
- images
- cart
- delivery details
- My Orders
- live status tracking
- reorder

## Security
Bakery uses the same partner-operated isolation contract as Restaurants but with templateType=bakery.
Firestore Rules explicitly add Bakery to:
- partner readiness
- rider role
- order create/read/update
- tracking
- commission ledger
- food business collection access

## Compatibility
Restaurant remains templateType=restaurant.
Existing restaurant menu items without a unit remain editable; newly created items receive a default unit.

## Required live validation after merge
1. Publish latest firestore.rules.
2. Create Bakery project from Workspace.
3. Link bakery and send WhatsApp invite.
4. Activate operator and accept commission.
5. Add products using different selling units.
6. Open customer link and place order.
7. Accept -> prepare -> ready -> assign rider -> out for delivery -> delivered.
8. Verify My Orders live tracking.
9. Verify commissionLedger entry.
10. Smoke-test Restaurant menu creation to confirm the shared unit field did not regress restaurant behavior.

## Out of scope
- recurring daily bakery orders
- subscriptions / standing orders
- fractional kilogram quantities
- multiple bakery branches
- delivery-zone pricing
- promo codes
