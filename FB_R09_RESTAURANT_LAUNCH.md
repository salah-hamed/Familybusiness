# FB-R09 — Restaurant Launch Portfolio Update

## Goal
Pause Cleaning from the launch portfolio and add Restaurants as an active partner-operated project alongside Supermarket and Laundry.

## Launch portfolio
- Supermarket: active/public
- Restaurants: active/public
- Laundry: active/public
- Cleaning: paused/hidden
- Car Wash: paused/hidden

## Restaurant operating model
Subscriber links one restaurant to the project and proposes a commission per completed order.

Restaurant operator:
- activates invite from WhatsApp
- accepts commission
- customizes restaurant identity
- manages menu and prices
- manages riders
- receives and fulfills orders

Customer:
- opens restaurant-specific public link
- sees restaurant identity and menu
- adds/removes items and edits quantities
- submits delivery order

## Restaurant identity
- restaurant name
- cuisine type
- slogan
- phone
- WhatsApp
- address
- location link
- delivery fee
- logo URL
- cover image URL
- primary color
- accepting-orders toggle

## Menu controls
- item name
- category
- description
- price
- image
- temporary stop/re-activate
- permanent delete

## Order lifecycle
new -> accepted -> preparing -> ready -> assigned -> out_for_delivery -> delivered

Commission is locked and written to commissionLedger only on delivered orders.

## Security
- restaurants/{projectId}
- restaurants/{projectId}/menu/{itemId}
- restaurant is partner_operated
- only the active accepted restaurant operator can manage menu, riders, orders, and restaurant settings after activation
- project owner can adjust restaurant setup only before partner activation
- customer reads require an active project, active accepted partner, and active commission agreement
- rider must belong to the same project

## Files
New:
- core/restaurant/restaurant-service.js
- core/restaurant/menu-service.js
- core/restaurant/order-service.js
- restaurant/*
- restaurant-operator/*
- templates/restaurant/*

Changed:
- templates/projects.js
- workspace/app.js
- core/workers/worker-service.js
- core/whatsapp/dispatch-service.js
- firestore.rules

## Out of scope
- multi-branch restaurants
- dine-in/table booking
- scheduled orders
- restaurant chains
- promo codes
- restaurant-specific payment gateway
- delivery-zone distance pricing

## Required live validation after merge
1. Publish updated Firestore Rules.
2. Create Restaurant project from Workspace.
3. Link restaurant + WhatsApp + commission.
4. Activate operator invite and accept commission.
5. Customize logo/cover/color/name.
6. Add menu items and test edit/stop/delete.
7. Add rider.
8. Open customer link and place order.
9. Accept -> prepare -> ready -> assign rider -> deliver.
10. Confirm commissionLedger entry.
11. Confirm Cleaning no longer appears in available projects.
