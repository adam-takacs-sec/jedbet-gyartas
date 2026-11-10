-- Telek a műholdtérképen: a sarokpontok (lat, lng) és oldalankénti kézi hossz-felülírás (JSON).
ALTER TABLE jobs ADD COLUMN plot TEXT;
-- A szakasz a telek egyik oldalán: melyik oldal (0 = A), hány méterről indul az oldal elejétől,
-- és a kézzel beállított kész hossz (NULL = a napi lap telepítéseiből számolva).
ALTER TABLE job_stages ADD COLUMN side INTEGER;
ALTER TABLE job_stages ADD COLUMN from_m REAL NOT NULL DEFAULT 0;
ALTER TABLE job_stages ADD COLUMN done_manual REAL;
