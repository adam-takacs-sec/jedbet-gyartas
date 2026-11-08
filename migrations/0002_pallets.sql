CREATE TABLE IF NOT EXISTS pallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL UNIQUE,
  run_id INTEGER REFERENCES curing_runs(id),
  template TEXT NOT NULL,
  panel_count INTEGER NOT NULL,
  poured_at TEXT NOT NULL,
  demolded_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Raktáron',
  note TEXT NOT NULL DEFAULT '',
  te_at_demold REAL,
  ns_at_demold REAL,
  min_temp REAL,
  governing_sensor TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pallets_status ON pallets(status, template);
CREATE INDEX IF NOT EXISTS idx_pallets_run ON pallets(run_id);
ALTER TABLE print_jobs ADD COLUMN pallet_id INTEGER REFERENCES pallets(id);
