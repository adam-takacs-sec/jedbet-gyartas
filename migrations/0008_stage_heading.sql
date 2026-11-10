-- Szakasz iránya abszolút (fok: 0 = jobbra, 90 = le, 180 = balra, 270 = fel) és hogy melyik
-- szakasz melyik végéhez csatlakozik (NULL = a kezdőpont, vagy régi szakasznál az előző vége).
ALTER TABLE job_stages ADD COLUMN heading INTEGER;
ALTER TABLE job_stages ADD COLUMN anchor_id INTEGER;
ALTER TABLE job_stages ADD COLUMN anchor_end TEXT;
