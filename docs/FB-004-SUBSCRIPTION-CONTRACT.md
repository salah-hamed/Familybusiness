# FB-004 Subscription / Project Activation Contract

## Account subscription

Stored on `users/{uid}`.

- `isActive`: legacy-compatible boolean used as the current account activation flag.
- `subscriptionStatus`: explicit subscription state. Current active value is `active`; newly registered accounts start as `pending`.

An account is treated as subscription-active only when:

```js
user.isActive === true && user.subscriptionStatus === "active"
```

## Project operational status

Stored on `projects/{projectDocId}`.

- `isActive`
- `status`

These fields describe whether the project itself is operational. Admin subscription activation/deactivation must not rewrite project operational status.

## Required behavior

- Inactive/pending accounts cannot create or manage projects from Workspace.
- Project creation re-checks account subscription state before writing a project.
- Dashboard requires both project ownership and an active account subscription.
- Customer-facing project pages require both an operational project and an active owner subscription.
- Activating/deactivating a subscription changes the user subscription fields only; it does not mutate all owned projects.

Firestore Rules remain the future authoritative security layer. FB-004 establishes the application-level contract only.
