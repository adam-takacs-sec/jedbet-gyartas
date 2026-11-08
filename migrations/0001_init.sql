CREATE TABLE IF NOT EXISTS mixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cement REAL NOT NULL DEFAULT 0,
  viz REAL NOT NULL DEFAULT 0,
  kavics REAL NOT NULL DEFAULT 0,
  folyosito REAL NOT NULL DEFAULT 0,
  kalcidur REAL NOT NULL DEFAULT 0,
  roskadas REAL NOT NULL DEFAULT 0,
  terules REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS pours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mix_id INTEGER NOT NULL REFERENCES mixes(id),
  serial TEXT NOT NULL UNIQUE,
  template TEXT NOT NULL,
  extra_water_dl REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Kötés alatt',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pours_status ON pours(status, template);
CREATE INDEX IF NOT EXISTS idx_pours_mix ON pours(mix_id);

CREATE TABLE IF NOT EXISTS stock (
  material TEXT PRIMARY KEY,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL
);
INSERT OR IGNORE INTO stock (material, quantity, unit) VALUES
  ('Cement', 0, 'kg'),
  ('Víz', 0, 'liter'),
  ('Kavics', 0, 'lapát'),
  ('Folyósító', 0, 'ml'),
  ('Kalcidur', 0, 'ml');

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Aktív',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS job_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL,
  length_m REAL NOT NULL,
  template TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sensors (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'specimen',
  offset_c REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO sensors (id, label, role) VALUES
  ('28-09239badc481', 'Szenzor 1', 'specimen'),
  ('28-0623a2603da8', 'Szenzor 2', 'specimen'),
  ('28-0623b021910e', 'Szenzor 3', 'specimen');

CREATE TABLE IF NOT EXISTS readings (
  sensor_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  temp REAL NOT NULL,
  PRIMARY KEY (sensor_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);

CREATE TABLE IF NOT EXISTS curing_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mix_id INTEGER REFERENCES mixes(id),
  sensor_ids TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  target_te_h REAL NOT NULL DEFAULT 48,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pour_id INTEGER REFERENCES pours(id),
  png BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
