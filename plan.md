# Plan

What this project is for, what exists, and what to build next. Read this before changing anything.

## What the user wants

A small private website for comparing rental flats, mostly in Prague. It replaces a manual workflow (see [scrape.md](scrape.md)) where an AI was handed a list of listing links and asked to produce an Excel comparison sheet.

The new flow:

1. Paste a listing link (mostly Czech sites: bezrealitky, sreality, idnes reality).
2. An AI reads the full page, including the free-text description, and pulls out the fields the user cares about, translated into English.
3. The listing is saved. The user can mark it as a favorite and add a comment.
4. Favorites are shown side by side in a comparison table, with the best and worst values highlighted.

Requirements and preferences:

- **Two users, one shared passphrase.** The user and their partner both use it, and favorites sync across their devices. No accounts.
- **Fields are editable.** The user wants to change what the AI extracts and how, over time, from the UI: labels, instructions to the AI, types, units, computed fields such as total monthly cost, and which direction counts as "better". The starting set comes from scrape.md.
- **Accuracy over completeness.** The rules in scrape.md still apply: only record what the page says, write "Not stated" otherwise, never guess market values, flag ambiguous fees instead of adding them to the total. Each extracted value keeps a short quote from the page as evidence, so it can be checked.
- **UI in English. Prices in CZK**, with an optional view in EUR or MNT using live exchange rates (and a manual override).
- **No Excel output needed.** The comparison table on the site replaces the spreadsheet.
- **Do not use the Claude / Anthropic API for extraction.** The user has ruled this out. Use another model through OpenRouter. Paid models are fine, since the cost per listing is a fraction of a cent. The model should be selectable in settings rather than hard-coded.
- **Cheap to run.** Free tiers only: GitHub Pages for the frontend, Cloudflare Workers and D1 for the backend.

## Architecture

```
GitHub Pages (static frontend)  ──HTTPS + Bearer passphrase──>  Cloudflare Worker  ──>  D1 database
                                                                      │
                                                                      ├──> listing page (fetch HTML)
                                                                      ├──> OpenRouter (LLM extraction)
                                                                      └──> open.er-api.com (CZK→EUR/MNT)
```

The OpenRouter key and the passphrase are Worker secrets. They never reach the browser.

## Repository contents

| Path | What it is |
|---|---|
| [scrape.md](scrape.md) | The original manual extraction prompt. It defines the fields, the translation glossary and the extraction rules. Use it as the spec for the AI prompt in phase 2. |
| [README.md](README.md) | Setup steps and API reference for the Worker. |
| [worker/src/index.js](worker/src/index.js) | The Worker: auth, CORS, fields, listings, settings, exchange rates. |
| [worker/schema.sql](worker/schema.sql) | D1 tables and the seed fields taken from scrape.md. Safe to re-run. |
| [worker/wrangler.toml](worker/wrangler.toml) | Worker config: D1 binding and the allowed origin `https://zescht.github.io`. |
| `worker/.dev.vars` | Local passphrase. Gitignored. Do not commit. |

## Status and next steps

### Phase 1: Worker API (done, 2026-10-20)

The passphrase auth, CRUD for fields, listings and settings, and the cached CZK→EUR/MNT rates are built. `POST /api/listings` currently only stores a URL, plus any data sent with it. It does not extract anything yet.

### Phase 2: AI extraction (next)

1. **Fetch the listing page** in the Worker and reduce it to readable text (description included). Check each target site: some may render listings client-side or block plain fetches, so a site-specific path (for example a site's own JSON endpoint) may be needed. Test against real listings and do not assume.
2. **Build the prompt** from the current `fields` table (each field's `instruction`, `type`, `options`) and the general rules and glossary from scrape.md. Ask for JSON only: one value and one short evidence quote per field.
3. **Call OpenRouter** with the model from `settings.ai_model`. Store the key as a Worker secret (`npx wrangler secret put OPENROUTER_API_KEY`). Pick the default model from live OpenRouter pricing and test results on real listings, not from memory.
4. **Validate the output** against the field types (number, ISO date, enum options) and save it to `listings.data` and `listings.evidence`. Computed fields (`total_monthly`, `price_per_m2`) are calculated by the app, not the AI.
5. **Re-extract**: add a way to run extraction again for an existing listing, for example after the fields have been changed.
6. Add tests under `worker/test/`. The `npm test` script already points there, but the folder does not exist yet.

### Phase 3: Frontend on GitHub Pages

A static site (in the repo root or a `docs/` folder) that:

- asks for the passphrase once and stores it on the device;
- has a box for pasting a link, and shows progress and errors from the extraction;
- lists all listings, with favorite toggle, comment, edit, delete and a link to the original page;
- shows a comparison table of favorites, with columns from `fields` (visible ones, in `position` order), computed fields, best and worst highlighting based on `better`, and evidence shown on hover;
- has a currency switch for CZK, EUR and MNT;
- has a field editor (add, remove, reorder, edit instructions) and settings (model, currency, exchange-rate override).

Then set `ALLOWED_ORIGIN` to the final Pages origin, if it changes, and deploy.

### Later / optional

- Public-transport travel time to a chosen destination (the optional add-on in scrape.md).
- Spotting listings that are not comparable (rooms in shared flats, short-term rentals) and marking them.

## Working notes

- Measure rather than assume: open the real pages, check live model prices, test extraction on real listings.
- Keep the AI's scope and the field list easy to change. The user expects to refine them as they go.
