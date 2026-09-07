# FB-006 — Firestore Security Rules

## Scope

This task moves the core authorization boundary into Firestore Rules for the current MVP collections:

- `users`
- `projects`
- `orders`

Any other collection is denied by default until it receives an explicit rule.

## Security contract

### users

- A newly authenticated user may create only `users/{theirUid}`.
- New accounts must start `isActive: false` and `subscriptionStatus: pending` and cannot self-assign `role`.
- A user may read their own user document.
- Only an admin may list all users or change subscription/admin-sensitive fields.
- A normal user can only update their own `name` through the current rule set.

### projects

- Owners can read their own projects.
- Public customer reads are allowed only when the project is operational and the owner subscription is active.
- Project creation requires an authenticated active subscriber and enforces `{uid}_{templateId}` identity.
- Owners cannot change ownership/template identity fields through updates.
- Current owner updates are limited to business settings, branding and `priceConfig`.

### orders

- Customers may create an order without authentication only for an available project.
- New orders must use `status: new` and `providerId == projectId`.
- Only the project owner or an admin can read project orders.
- Only the project owner or an admin can change an order, and the current rule set allows status-only updates.

## Customer application change

The Cleaning customer application no longer reads `users/{ownerId}` directly. Subscription enforcement is performed inside Firestore Rules while evaluating project access. This avoids exposing user-account documents to unauthenticated customers.

## Deployment

Merging `firestore.rules` into GitHub does **not** publish the rules to Firebase automatically.

Deploy with Firebase CLI from the repository root:

```bash
firebase deploy --only firestore:rules
```

Or copy the exact contents of `firestore.rules` into Firebase Console → Firestore Database → Rules and publish.

Do not publish partially copied rules.

## Runtime smoke tests after publishing

1. Logged-out customer can open an active Cleaning project and create a new order.
2. Customer cannot query/read the `users` collection.
3. Customer cannot read existing orders.
4. Project owner can open Dashboard, read only their project orders, and change order status.
5. Project owner can save project settings and pricing.
6. Project owner cannot open another user's Dashboard project.
7. Normal logged-in user cannot list all users or mutate subscription/role fields.
8. Admin with `role: admin` can open Admin and activate/deactivate users.
9. Deactivated user's customer project link becomes unavailable.
10. Reactivation restores access without rewriting the project document.

## Important

These rules secure the current MVP contract. Input/schema validation beyond identity/status constraints remains FB-007.
