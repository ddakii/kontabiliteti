# API

Bazë: `/api`. Kërkesat që ndryshojnë të dhëna kërkojnë krye `X-Kontabiliteti-Request: 1`. Sesioni është cookie `HttpOnly`.

Përgjigjja e suksesshme është `{ "data": ... }`. Listat e faqosura shtojnë `meta.page`, `meta.pageSize`, `meta.total`. Gabimi është `{ "error": { "code", "message", "details" } }`.

Për të dhënat e zyrës dërgohet `X-Firm-Id`. Për të dhënat e kompanisë dërgohet edhe `X-Company-Id`. Të dyja kontrollohen në server.

## Autentifikimi

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/2fa/verify`
- `POST /api/auth/logout` dhe `/logout-all`
- `POST /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/me`

## Zyra dhe kompanitë

- `GET /api/dashboard`
- `GET/POST /api/companies`
- `GET/PATCH /api/companies/:id`
- `POST /api/companies/:id/opening-balances`
- `GET/POST /api/members`, `POST /api/invitations`
- `GET /api/subscription`, `POST /api/subscription/cancel`

## Kontabiliteti i kompanisë

Këto kërkojnë kompaninë aktive.

- `GET/POST /api/customers`, `/api/suppliers`
- `GET/POST /api/invoices`, `POST /api/invoices/:id/finalize`, `GET /api/invoices/:id/pdf`
- `GET/POST /api/purchases`, `POST /api/purchases/:id/post`
- `GET/POST /api/payments`, `POST /api/payments/:id/reverse`
- `GET/POST /api/journal-entries`, `POST /api/journal-entries/:id/post`
- `GET /api/reports/:type`, `/export.xlsx`, `/export.csv`
- `GET /api/tax/summary`, `POST /api/tax-rates/:id/confirm`
- `GET/POST /api/documents`, `GET /api/documents/:id/file`

Finalizimi dhe pagesa pranojnë `Idempotency-Key`.

## Fiskalizimi ATK

Kërkon kompaninë aktive dhe lejet `fiscal.read`, `fiscal.configure` ose `fiscal.submit`.

- `GET /api/fiscal`
- `PUT /api/fiscal/settings`
- `POST /api/fiscal/branches`, `POST /api/fiscal/terminals`
- `POST /api/fiscal/terminals/:id/onboard`
- `POST /api/fiscal/check` — nuk krijon kupon
- `GET /api/fiscal/invoices`
- `POST /api/fiscal/invoices/:invoiceId/submit`
- `GET /api/fiscal/receipts`, `GET /api/fiscal/receipts/:id`, `GET /api/fiscal/receipts/:id/pdf`
- `POST /api/fiscal/receipts/:id/adjust`
- `POST /api/fiscal/receipts/:id/unknown`

Çelësi privat nuk kthehet. Numri i fiskalizimit nuk kthehet pasi ruhet.

## Platforma

`/api/platform/*` kërkon administrator platforme. Metrikat janë numër zyrash, kompanish, provash dhe punësh të dështuara. Nuk kthejnë shuma të faturave të klientëve.

Portali i klientit është te `/api/portal/*` dhe sheh vetëm anëtarësimin e kompanisë.
