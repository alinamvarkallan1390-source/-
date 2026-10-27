# روان — Ravan Messenger

A Persian-first, RTL messaging product foundation built with Next.js App Router, TypeScript, PostgreSQL, server-side sessions, and a versioned Bot API. The previous single-file building-management UI has been replaced; its Git history remains available.

> **Deployment honesty:** the Vercel account is connected, but this repository currently has no PostgreSQL or email credentials. The application deliberately does not seed or invent conversations. Until `DATABASE_URL` is configured and the migration is run, account, messaging, search, and bot endpoints report that setup is required. A deployment of the UI alone is not a production-ready messenger.

## Stack and boundaries

- Next.js App Router and React; Vercel-compatible request/response handlers (no permanent WebSocket server or worker).
- PostgreSQL via `postgres` (tagged parameterized queries); SQL migrations are explicit and are **not** run automatically during a Vercel build.
- Password hashes use Node.js `scrypt`; sessions use random opaque tokens stored only as SHA-256 hashes and an `HttpOnly`, `SameSite=Lax` cookie.
- Search uses PostgreSQL full-text ranking plus Persian normalization; every message query is scoped to the authenticated user's conversation memberships.
- Bot API v1 uses bearer tokens shown once at creation, hashed at rest, rate-limited in PostgreSQL, with cursor-based polling and idempotent message sends. User code is never evaluated by the server.
- The initial release does not claim end-to-end encryption. File uploads, push notifications, realtime presence, Webhooks, and an isolated user-code runtime are not enabled.

## Requirements

- Node.js 22 or newer (Node 24 is suitable for Vercel).
- PostgreSQL 14+ with a reachable TLS connection in production.
- Optional: a Resend API key and verified `EMAIL_FROM` sender for email verification and password recovery.

## Local development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a PostgreSQL database and copy the environment template:

   ```sh
   cp .env.example .env.local
   ```

   Set `DATABASE_URL` to that database. No demo user or sample message is inserted.

3. Apply the schema, then run the app:

   ```sh
   npm run db:migrate
   npm run dev
   ```

4. Visit `http://localhost:3000`, register an account, and create a conversation. Registration and messaging are unavailable until the database is reachable.

`npm run db:migrate` records applied files in `schema_migrations`, applies each migration transactionally, and can safely be re-run. For production, set `DATABASE_URL` in the deployment environment and run `npm run db:migrate` from a trusted release job or workstation before promoting the application. Do not run migrations from every serverless function or during an ordinary build.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes for backend | PostgreSQL connection string. Keep it server-side; never prefix it with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_APP_URL` | Recommended | Canonical origin used in one-time email links. |
| `RESEND_API_KEY` | Optional | Enables verification and password recovery when used with `EMAIL_FROM`. |
| `EMAIL_FROM` | Optional | Verified sender address for the email provider. |

See `.env.example`. Do not commit `.env.local`, production URLs containing credentials, or provider tokens.

## Implemented product surface

- Persian RTL sign-in and sign-up; hashed passwords, secure server sessions, sign-out, session listing/revocation, password change, account anonymization/deletion, profile editing, rate-limited login/registration, and optional email verification/reset when a mail provider is configured.
- Private one-to-one conversations, groups and channels; membership roles and access checks; time- and use-limited invite links; message pagination; idempotent sends; reply, edit, delete, and read timestamps.
- Global search for public profiles/public conversations and messages in conversations the requester belongs to. Persian/Arabic Yeh and Kaf normalization, ZWNJ handling, diacritics, punctuation, and Persian/Arabic digit normalization are covered by unit tests.
- Bot creation, activation/deactivation, token rotation, membership in a conversation, API v1 identity/send/poll operations, bounded rate limits, stable event IDs, and an API quick-start panel.
- PWA manifest and a minimal offline page. The service worker caches only the offline shell; it does not cache authenticated pages, API responses, messages, or files.

Some schema entities are foundations for later work rather than shipped UI/API capabilities. In particular, the first release does not provide file storage/upload, reactions, forwarding, public channel discovery at scale, report-resolution tools for moderators, webhook delivery, push notifications, or E2EE. These are not represented as working controls.

## API overview

Cookie-authenticated JSON endpoints:

- `GET /api/health`
- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`
- `GET /api/auth/session`, `GET|DELETE /api/auth/sessions`, `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/verify-email`
- `GET|POST /api/conversations`
- `GET|POST /api/conversations/:conversationId/messages`
- `PATCH|DELETE /api/conversations/:conversationId/messages/:messageId`
- `GET /api/search?q=...`
- `GET|POST /api/bots`, `PATCH|DELETE /api/bots/:botId`, `POST /api/bots/:botId/rotate-token`, `/conversations`

Bot API v1 (use `Authorization: Bearer <token>`; never put the token in a URL):

- `GET /api/v1/bot/me`
- `POST /api/v1/bot/messages` with `conversationId`, `text`, and a UUID `clientRequestId`
- `GET /api/v1/bot/updates?offset=<last-event-id>`

Bot polling returns stable, monotonically increasing event IDs. Clients should persist the returned `update_id` and send it as the next offset. Webhook mode is not advertised as implemented.

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The unit suite does not require a database. Database integration tests and production-path testing require a disposable PostgreSQL database and are not silently replaced with mock records. For a deploy, also check `GET /api/health`, register two real accounts, verify membership isolation, and exercise messaging/search/bot polling against the configured database.

## Security notes

- All database values are passed as bound parameters; no user-supplied SQL is interpolated.
- Cookie-backed mutations validate the request origin when an Origin header is present; sessions are server-side and revocable.
- Search and message reads join the current user's membership before returning private content.
- Bot secrets are returned only on create/rotation and stored as hashes. Do not paste them into issue reports or logs.
- No E2EE claim is made. HTTPS and database encryption at rest are not end-to-end encryption.
- Promote an administrator explicitly after verifying the account, e.g. `UPDATE users SET role='admin' WHERE lower(email)=lower('...') AND deleted_at IS NULL;`. Admin access is not granted to the first registrant automatically.

## Vercel

Link the repository as a Next.js project, configure `DATABASE_URL` and optionally the email variables in Vercel's encrypted environment settings, apply migrations from a trusted release job, then deploy. The Vercel project must point to this repository and its production branch deliberately; do not reuse the database or secrets of another project. Without PostgreSQL, the UI can render but protected app operations remain disabled by design.
