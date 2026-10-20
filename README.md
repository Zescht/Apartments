# Apartments

Paste a rental listing link, let an AI extract the fields you care about, and compare your favorites side by side.

- **Frontend:** static site on GitHub Pages (coming in phase 3)
- **Backend:** Cloudflare Worker (`worker/`) with a D1 database: passphrase auth, listings, editable field definitions, settings, CZK→EUR/MNT rates
- **AI:** any model via OpenRouter (phase 2)

## Worker setup

```
cd worker
npm install
npx wrangler login
npx wrangler d1 create apartments          # put the id into wrangler.toml
npm run db:init:remote                     # tables + starting fields
npx wrangler secret put APP_PASSPHRASE     # shared passphrase
npm run deploy
```

Local development: put `APP_PASSPHRASE=...` in `worker/.dev.vars`, then `npm run db:init:local` and `npm run dev`.

## API

All routes except `/api/health` need `Authorization: Bearer <passphrase>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| GET | `/api/auth` | Check the passphrase |
| GET / PUT | `/api/fields` | List / replace field definitions |
| GET / POST | `/api/listings` | List (`?favorite=1`) / add by URL |
| GET / PATCH / DELETE | `/api/listings/:id` | Read / update data, favorite, comment / delete |
| GET / PUT | `/api/settings` | AI provider and model, display currency, FX overrides |
| GET | `/api/rates` | CZK→EUR and CZK→MNT (cached 12 h, manual override possible) |
