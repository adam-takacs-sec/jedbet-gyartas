-- Napi lap: munkások, napi feladatok (terv + plusz munka), munkanapló, kifizetések.

CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  pay_type TEXT NOT NULL DEFAULT 'ora',      -- ora | nap | darab
  rate REAL NOT NULL DEFAULT 0,              -- Ft/óra, Ft/nap vagy Ft/db
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Egy munkanap lezárása (a nap maga a dátum, YYYY-MM-DD, helyi idő szerint).
CREATE TABLE IF NOT EXISTS days (
  day TEXT PRIMARY KEY,
  closed_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- ontes | kiforgatas | mosas | telepites | egyeb
  title TEXT NOT NULL DEFAULT '',
  template TEXT,                             -- öntésnél / kiforgatásnál a minta
  job_id INTEGER REFERENCES jobs(id),
  planned_qty REAL,
  done_qty REAL,
  unit TEXT NOT NULL DEFAULT 'db',           -- db | m | ''
  status TEXT NOT NULL DEFAULT 'terv',       -- terv | folyamatban | kesz | reszben | nem
  unplanned INTEGER NOT NULL DEFAULT 0,      -- 1 = plusz munka, utólag beírva
  reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  ended_at TEXT,
  run_id INTEGER REFERENCES curing_runs(id), -- öntés lezárásakor indított / hozzárendelt kötés
  carried_from INTEGER REFERENCES tasks(id),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day, sort, id);
CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_tasks_job ON tasks(job_id);

CREATE TABLE IF NOT EXISTS work_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  start_time TEXT,                           -- HH:MM helyi idő
  end_time TEXT,
  break_min INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'gyartas',      -- gyartas | telepites
  job_id INTEGER REFERENCES jobs(id),
  pay_type TEXT NOT NULL,                    -- a munkás díjazása rögzítéskor (pillanatkép)
  rate REAL NOT NULL DEFAULT 0,
  pieces REAL,                               -- darabbérnél
  amount REAL NOT NULL DEFAULT 0,            -- számolt vagy kézzel megadott bér
  amount_manual INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_work_logs_day ON work_logs(day);
CREATE INDEX IF NOT EXISTS idx_work_logs_worker ON work_logs(worker_id, day);
CREATE INDEX IF NOT EXISTS idx_work_logs_job ON work_logs(job_id);

-- Kifizetések és kölcsönök. Egyenleg = megdolgozott bér − (bér + előleg + kölcsön) + visszafizetés.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  day TEXT NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ber',          -- ber | eloleg | kolcson | visszafizetes
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_worker ON payments(worker_id, day);
