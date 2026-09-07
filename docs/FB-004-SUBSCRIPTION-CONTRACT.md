# FB-004 — Subscription / Project Activation Contract

## Account subscription

Stored on `users/{uid}`.

- `isActive`: current account activation boolean.
- `subscriptionStatus`: explicit subscription state (`pending`, `active`, `inactive`).

An account is subscription-active only when:

```js
user.isActive === true && user.subscriptionStatus === "active"
```

New registrations start with `isActive: false` and `subscriptionStatus: "pending"`.

## Project operational status

Stored independently on `projects/{projectDocId}`.

- `isActive`
- `status`

These fields describe the project's own operational state. Admin subscription activation/deactivation does not rewrite project status.

## Application behavior

- Pending/inactive accounts cannot create or manage projects from Workspace.
- `createProject()` re-checks subscription state before writing.
- Dashboard requires project ownership plus an active account subscription.
- Customer-facing Cleaning requires both an operational project and an active owner subscription.
- Admin Activate/Deactivate changes subscription fields only.

## Security boundary

These are application-level checks. Firestore Security Rules remain the authoritative future enforcement layer and are intentionally outside FB-004.
