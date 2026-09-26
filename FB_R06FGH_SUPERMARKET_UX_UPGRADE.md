# FB-R06F/G/H — Supermarket Catalog & Customer Experience Upgrade

## Scope
This batch improves only the supermarket catalog and customer ordering experience.

## FB-R06F — Catalog cleanup and product manager
- duplicate identity is based on product name + size, not barcode
- conservative fuzzy matching supports spelling/spacing differences
- old master-catalog products can match imported English SKUs using master brand + size + masterId descriptors
- safe merge keeps the existing store price
- missing image/size/category/barcode may be enriched from the duplicate
- imported duplicate rows update/enrich an existing item instead of creating another one
- barcode remains optional and is not the dedupe identity
- product manager:
  - search
  - category/status/image filters
  - 50-item rendering batches
  - bulk activate/pause/change category/delete
  - safe duplicate scan/merge
  - product thumbnails
- starter library:
  - displays product images when a high-confidence image is found from imported products
  - falls back to category-specific visual marker
  - renders 24 items at a time

## FB-R06G — Customer catalog performance
- customer no longer reads every product at page load
- catalog loads 40 Firestore documents per page
- category selection requests that category only
- Load More pagination
- product images use lazy loading
- search checks loaded product name + size + category
- supermarket document stores catalogCategories/catalogProductCount metadata for category navigation

## FB-R06H — Customer order history and live tracking
- new orders get a 192-bit random tracking token
- safe public tracking document contains no customer name, phone or address
- Firestore list access to orderTracking is denied
- direct document get requires possession of the secret token
- operator status changes update tracking in the same batch/transaction as the private order
- customer stores up to 20 tracking tokens on the same device
- My Orders page:
  - current status
  - live timeline
  - order items and total
  - reorder available items
- old orders created before this feature are not retroactively exposed to the device
- temporary backwards-compatible checkout fallback keeps orders working until updated Firestore Rules are published

## Required Firestore Rules publication
This task changes firestore.rules:
- supermarket order schema adds trackingToken
- secure orderTracking collection rules
- supermarket catalog metadata fields

Publish the new rules after merge to enable live tracking and catalog metadata.

## Acceptance tests
1. Open product manager with 2000+ products; only 50 product cards render initially.
2. Filter by Arabic category, active/paused, and image/no-image.
3. Import the same XLSX again; matching products enrich/update instead of duplicating.
4. Run safe duplicate merge and verify store prices are preserved.
5. Starter library shows images for matched imported branded SKUs.
6. Customer opens store and receives only the first 40 docs.
7. Select a category and verify category-specific paging.
8. Submit an order and verify order code returned.
9. Open My Orders and see the new order.
10. Change order status in operator dashboard and verify customer timeline updates live.
11. Complete delivery and verify commission ledger still records normally.
12. Reorder a previous order; unavailable products are skipped with a message.
