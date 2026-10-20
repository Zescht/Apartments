-- Safe to re-run: tables use IF NOT EXISTS and the seed uses INSERT OR IGNORE.

CREATE TABLE IF NOT EXISTS fields (
  key         TEXT PRIMARY KEY,           -- machine name, e.g. "deposit"
  label       TEXT NOT NULL,              -- column header shown in the UI
  type        TEXT NOT NULL,              -- text | number | date | enum | list | computed
  unit        TEXT,                       -- "CZK" marks a convertible money amount; "m²" etc. are display-only
  instruction TEXT NOT NULL DEFAULT '',   -- what the AI should look for / how to format it
  options     TEXT,                       -- JSON array of allowed values (enum only)
  formula     TEXT,                       -- computed only, e.g. "rent + service_charges + utilities"
  better      TEXT,                       -- lower | higher | NULL (used for best/worst highlighting)
  visible     INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL UNIQUE,
  data       TEXT NOT NULL DEFAULT '{}',  -- JSON: field key -> extracted value
  evidence   TEXT NOT NULL DEFAULT '{}',  -- JSON: field key -> short quote from the page
  favorite   INTEGER NOT NULL DEFAULT 0,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_favorite ON listings (favorite);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Starting fields, based on scrape.md. Everything here is editable from the UI.
INSERT OR IGNORE INTO fields (key, label, type, unit, instruction, options, formula, better, visible, position) VALUES
('title', 'Offering', 'text', NULL,
 'Listing type and layout in English, e.g. "Flat to rent 2+kk".', NULL, NULL, NULL, 1, 10),
('address', 'Address', 'text', NULL,
 'Street and district exactly as published. Do not invent a house number.', NULL, NULL, NULL, 1, 20),
('rent', 'Rent', 'number', 'CZK',
 'Base monthly rent only, excluding service charges and utilities.', NULL, NULL, 'lower', 1, 30),
('service_charges', 'Service charges', 'number', 'CZK',
 'Monthly service charges (poplatky za služby).', NULL, NULL, 'lower', 1, 40),
('utilities', 'Utilities', 'number', 'CZK',
 'Monthly utility advance payments (energie / zálohy).', NULL, NULL, 'lower', 1, 50),
('total_monthly', 'Total monthly', 'computed', 'CZK',
 '', NULL, 'rent + service_charges + utilities', 'lower', 1, 60),
('deposit', 'Deposit', 'number', 'CZK',
 'Deposit (kauce / jistota) as stated. Do not assume it is a multiple of the rent.', NULL, NULL, 'lower', 1, 70),
('area_m2', 'Area', 'number', 'm²',
 'Usable area in square metres.', NULL, NULL, 'higher', 1, 80),
('price_per_m2', 'CZK per m²', 'computed', 'CZK',
 '', NULL, 'total_monthly / area_m2', 'lower', 1, 90),
('min_stay', 'Min. contract', 'text', NULL,
 'Minimum rental period. If the price depends on lease length, say which length it refers to.', NULL, NULL, NULL, 1, 100),
('furnished', 'Furnished', 'enum', NULL,
 'Furnishing level. Put listed items in notes.',
 '["Furnished","Partially furnished","Unfurnished","Not stated"]', NULL, NULL, 1, 110),
('available_from', 'Available from', 'date', NULL,
 'ISO date YYYY-MM-DD. If the page date is ambiguous (e.g. 01/11/2026), flag it in notes.', NULL, NULL, NULL, 1, 120),
('notes', 'Notes', 'list', NULL,
 'One short bullet per item: fees not in the total (one-off or recurring), whole flat vs. room, tenant restrictions, floor/elevator, energy class, delays, tenant requirements. If the listing is not comparable to a normal flat, say so first.',
 NULL, NULL, NULL, 1, 130);

INSERT OR IGNORE INTO settings (key, value) VALUES
('ai_provider', 'openrouter'),
('ai_model', ''),
('display_currency', 'CZK');
