-- Felülnézet: a szakasz fordulása az előzőhöz képest (fok; + = jobbra), és a telepítés szakaszhoz köthető.
ALTER TABLE job_stages ADD COLUMN turn INTEGER NOT NULL DEFAULT 90;
ALTER TABLE tasks ADD COLUMN stage_id INTEGER REFERENCES job_stages(id);
