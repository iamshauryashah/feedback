# Shaurya's Websites — Feedback

A shared feedback platform for sites under `*.shauryaswebsites.com` and `*.shauryaswebsite.com`, served at `https://feedback.shauryaswebsites.com`.

## Features

- Friendly floating widget: feedback message + private email address, automatically identifies the originating site
- Public Kanban board: Inbox, Planned, In Progress, Done, Not Planned
- Emails excluded from unauthenticated board responses; admin-only status changes and email visibility
- Passcode login with signed HttpOnly session cookie (8-hour maximum)
- Exponential per-IP feedback and login throttling, server-side validation, honeypot
- Cloudflare Worker + **one SQLite-backed Durable Object**, not D1

## Cloudflare deployment

The Worker is named **`feedback`** and its custom domain is **`feedback.shauryaswebsites.com`**.

1. Connect the GitHub repository `iamshauryashah/feedback` to a Cloudflare Worker named `feedback`.
2. Use `npm install` for dependencies and `npx wrangler deploy` for deployment. You can also deploy locally using `npm install && npm run deploy`.
3. Create two **secret** Worker environment variables (not plaintext variables and never committed to source):
   - `ADMIN_PASSCODE`: a strong passcode of your choice
   - `SESSION_SECRET`: independent random secret; generate using `openssl rand -hex 32`
4. Deploy from Cloudflare using the Wrangler configuration in the repository. Wrangler creates the SQLite-backed Durable Object class `FeedbackStore` through migration `v1` and binds it as `FEEDBACK_STORE`.
5. The domain `feedback.shauryaswebsites.com` must belong to a zone in the same Cloudflare account. The custom domain is specified in `wrangler.jsonc`.

**There is no D1 database to create, no database ID to provide, and no separate SQL migration command.** Tables are initialized automatically when the Durable Object starts.

### Local development

Add a `.dev.vars` file (ignored by Git) containing the two secrets. Run `npm install` and `npm run dev`. Local development uses a local Durable Object instance.

### Optional GitHub Actions deployment

Use **Actions → Deploy Feedback to Cloudflare → Run workflow** after configuring GitHub Actions secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_PASSCODE`, `SESSION_SECRET`.
The workflow deploys the Worker and Durable Object, sets secrets and checks the widget URL. It does not require a D1 database or `FEEDBACK_DATABASE_ID`.

## First integration: Message Board

The first widget is already included in `iamshauryashah/message-board`. Once the feedback Worker is deployed, its embedded widget loads automatically from `https://feedback.shauryaswebsites.com/widget.js`.

To add the widget to other websites later, include:

```html
<script defer src="https://feedback.shauryaswebsites.com/widget.js"></script>
```

## Admin

Visit `https://feedback.shauryaswebsites.com` and select **Admin sign in**. Once authenticated, you can see feedback email addresses and drag cards between columns, or change statuses using the dropdown. Public visitors never receive email fields from the listing endpoint.

## Security and operations

- The public board's address is an open secret, not an authorization boundary.
- The Worker validates the request's Origin for cross-site submissions. Both `shauryaswebsites.com` and `shauryaswebsite.com` (and their subdomains) are accepted, plus localhost in local development.
- A single global Durable Object stores all sites' feedback, its Kanban statuses, and rate-limit records. This design is suitable for a lightweight shared platform. Large-scale usage may call for data partitioning and periodic cleanup.
- Admin sessions are signed using `SESSION_SECRET`; changing either secret invalidates existing sessions.
- Feedback is stored persistently. Email access is protected by server-side authentication, not by hiding the field in frontend JavaScript.
- For additional spam protection, consider Cloudflare Turnstile or WAF rules.

## Existing D1 installations

This change replaces the old D1 implementation. If you deployed an earlier D1 version **with actual submissions**, those records are **not automatically migrated** into the Durable Object. Export and transfer that data before retiring D1. If you never deployed the D1 version, no migration is required.
