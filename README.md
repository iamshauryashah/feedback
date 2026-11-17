# Shaurya's Websites — Feedback

A shared feedback platform for sites under `*.shauryaswebsites.com` and `*.shauryaswebsite.com`, served at `https://feedback.shauryaswebsites.com`.

## Features

- Friendly floating widget: feedback message + private email address, automatically identifies the originating site
- Public Kanban board: Inbox, Planned, In Progress, Done, Not Planned
- Emails excluded from unauthenticated board responses; admin-only status changes and email visibility
- Administrator access through the central Shaurya's Websites account role (Better Auth), with no separate Feedback sign-in
- Exponential per-IP submission throttling, server-side validation, honeypot
- Cloudflare Worker + **one SQLite-backed Durable Object**, not D1

## Cloudflare deployment

The Worker is named **`feedback`** and its custom domain is **`feedback.shauryaswebsites.com`**.

1. Connect the GitHub repository `iamshauryashah/feedback` to a Cloudflare Worker named `feedback`.
2. Use `npm install` for dependencies and `npx wrangler deploy` for deployment. You can also deploy locally using `npm install && npm run deploy`.
3. Set the **secret** Worker environment variable `SESSION_SECRET` for rate-limit key hashing (generate using `openssl rand -hex 32`). This is no longer used for admin login.
4. The deployment binds the existing `user-management` Worker using `AUTH_SERVICE` to authorize administrators through the platform session. Deploy that Worker first, in the same Cloudflare account.
5. Deploy from Cloudflare using the Wrangler configuration in the repository. Wrangler creates the SQLite-backed Durable Object class `FeedbackStore` through migration `v1` and binds it as `FEEDBACK_STORE`.
6. The domain `feedback.shauryaswebsites.com` must belong to a zone in the same Cloudflare account. The custom domain is specified in `wrangler.jsonc`.

**There is no D1 database to create, no database ID to provide, and no separate SQL migration command.** Tables are initialized automatically when the Durable Object starts.

### Local development

Add a `.dev.vars` file (ignored by Git) containing `SESSION_SECRET`. For local tests that need administrator privileges, run the identity Worker with a compatible service binding. Without the identity Worker, the public board still works but privileged operations fail closed. Run `npm install` and `npm run dev`. Local development uses a local Durable Object instance.

### Optional GitHub Actions deployment

Use **Actions → Deploy Feedback to Cloudflare → Run workflow** after configuring GitHub Actions secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SESSION_SECRET`.
The workflow deploys the Worker and Durable Object, sets the rate-limit hashing secret and checks the widget URL. It does not require a D1 database or `FEEDBACK_DATABASE_ID`.

## First integration: Message Board

The first widget is already included in `iamshauryashah/message-board`. Once the feedback Worker is deployed, its embedded widget loads automatically from `https://feedback.shauryaswebsites.com/widget.js`.

To add the widget to other websites later, include:

```html
<script defer src="https://feedback.shauryaswebsites.com/widget.js"></script>
```

## Admin

Sign in through the existing account widget (served by `auth.shauryaswebsites.com`), using a platform account with `isAdmin: true`. On the Feedback board, your authenticated session automatically enables drag-and-drop, the status dropdown, and private email visibility. Non-admins can view the public board and submit feedback, but never receive email fields from its listing API. There is no separate Feedback admin login.

## Security and operations

- The public board's address is an open secret, not an authorization boundary.
- The Worker validates the request's Origin for cross-site submissions. Both `shauryaswebsites.com` and `shauryaswebsite.com` (and their subdomains) are accepted, plus localhost in local development.
- A single global Durable Object stores all sites' feedback, its Kanban statuses, and rate-limit records. This design is suitable for a lightweight shared platform. Large-scale usage may call for data partitioning and periodic cleanup.
- Feedback forwards the same-site session cookie to the `user-management` Worker using the private `AUTH_SERVICE` service binding and checks its authoritative `/api/me` response. Frontend flags alone cannot grant administrative access. If identity verification is unavailable, admin operations fail closed and public browsing continues.
- `SESSION_SECRET` only salts hashed rate-limit keys; account sessions are owned by the central identity service.
- Feedback is stored persistently. Email access is protected by server-side authentication, not by hiding the field in frontend JavaScript.
- For additional spam protection, consider Cloudflare Turnstile or WAF rules.

## Existing D1 installations

This change replaces the old D1 implementation. If you deployed an earlier D1 version **with actual submissions**, those records are **not automatically migrated** into the Durable Object. Export and transfer that data before retiring D1. If you never deployed the D1 version, no migration is required.
