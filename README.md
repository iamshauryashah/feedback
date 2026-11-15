# Shaurya's Websites — Feedback

One shared feedback platform for every website under `*.shauryaswebsites.com`.

## Features
- Floating, friendly feedback widget: message + email, automatically identifies the submitting site
- Public Kanban at `https://feedback.shauryaswebsites.com`
- Inbox / Planned / In Progress / Done / Not Planned columns
- Emails never included in unauthenticated API responses
- Admin passcode login, signed HttpOnly session cookie, and admin-only drag-and-drop / status changes
- Exponential per-IP submission throttling, login throttling, server-side input validation, honeypot
- Cloudflare Workers + D1; no AI integration required

## Cloudflare setup

1. Install dependencies: `npm install`.
2. Create a D1 database: `npx wrangler d1 create feedback-db`.
3. Copy its `database_id` into `wrangler.jsonc` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
4. Apply schema: `npm run db:remote` (for local testing, `npm run db:local`).
5. Set two independent, strong secrets (never commit them):
   - `npx wrangler secret put ADMIN_PASSCODE`
   - `npx wrangler secret put SESSION_SECRET` (generate a random 32+ byte value)
6. Deploy: `npm run deploy`.
7. In Cloudflare Workers **Custom Domains**, attach `feedback.shauryaswebsites.com` and ensure your DNS/domain is managed in the correct Cloudflare account.

For local development create an ignored `.dev.vars` containing `ADMIN_PASSCODE=...` and `SESSION_SECRET=...`, run `npm run db:local` and `npm run dev`. Local requests from localhost are allowed only when the worker itself is running on localhost.

## Embed on each website

Place this before `</body>` on your website:

```html
<script defer src="https://feedback.shauryaswebsites.com/widget.js"></script>
```

The widget automatically uses the parent site's hostname (the browser's Origin header is independently validated by the API). It works with any subdomain of `shauryaswebsites.com`; the feedback domain itself is also allowed.

## Admin

Visit `https://feedback.shauryaswebsites.com`, click **Admin sign in**, and enter your configured passcode. An authenticated admin sees contributor emails and can drag cards between columns or change a card's status from a dropdown. Everyone else sees the board but never sees emails.

## Operations and security

- The public board is intentionally discoverable: the URL is an open secret, **not** an access-control mechanism.
- Email is stored in D1; only admin-authenticated reads include it. Do not put admin secrets in GitHub, client-side JS, or Wrangler configuration.
- The server allows cross-origin submissions from `*.shauryaswebsites.com` only. To use other domains, change `isTrustedSite()` in `src/index.js` explicitly.
- Submission and login backoff is exponential per hashed IP key. Distributed abuse may still require Cloudflare WAF or Turnstile.
- If Cloudflare deployment runs a build command, use `npm install` as install step and `npx wrangler deploy` as deploy command. Do not set an asset-only deployment command; this project requires a Worker and D1 binding.
- Rotate passcode/session secret by updating Worker secrets. Existing sessions are invalidated when either secret changes.
