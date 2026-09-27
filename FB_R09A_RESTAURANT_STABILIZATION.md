# FB-R09A — Restaurant Stabilization & Media UX

## Goal
Stabilize restaurant operator settings, permissions-sensitive loading, media URLs, menu reads, and customer post-order experience.

## Root cause fixed
Restaurant orders were queried by projectId only and filtered by templateType in JavaScript. Firestore Rules restrict partner-operated order reads by template, so the query could return Missing or insufficient permissions even after settings had saved successfully.

The settings save handler then called loadOperations inside the same try/catch, causing a post-save order query failure to be shown as if saving settings had failed.

## Changes
### Operator dashboard
- restaurant order query now includes:
  - projectId
  - templateType == restaurant
  - max 50 documents per refresh
- settings save is independent from riders/orders reload
- orders and riders use independent error messages
- identity media preview for logo + cover
- HTTPS-only image URLs
- image URL load test before save
- fallback messaging for blocked/broken hotlinks

### Menu manager
- image thumbnail visible for existing items
- image preview while adding
- image validation before add/update
- active + available menu server filtering
- paged customer menu reads
- menu category metadata stored on restaurant document
- metadata update gracefully degrades before new Rules are published

### Customer app
- 40 menu items per page
- category-scoped paging
- image fallback placeholders
- unavailable item prevents silent partial checkout
- My Orders on same device
- live restaurant order status tracking
- reorder available items

### Tracking security
- 192-bit random secret token
- orderTracking contains no customer name, phone, address or GPS
- orderTracking cannot be listed
- direct read requires possession of token
- supermarket + restaurant share the same secure tracking architecture
- legacy checkout fallback keeps restaurant ordering working before new Rules are published

## Required after merge
Publish the latest firestore.rules to fully enable:
- restaurant order tracking
- restaurant menu category metadata
- latest supermarket tracking Rules from previous work

## Acceptance test
1. Save restaurant settings and confirm success message remains even if another section fails.
2. Use valid HTTPS logo/cover URLs and confirm previews.
3. Use a broken/non-image URL and confirm save is blocked with a clear message.
4. Add menu item with image and see its thumbnail.
5. Open customer app and load first 40 available menu items.
6. Place order.
7. Confirm order appears in operator dashboard.
8. Move through statuses to delivered.
9. Confirm customer My Orders timeline updates live after Rules publish.
