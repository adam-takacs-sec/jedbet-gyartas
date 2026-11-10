-- Elemenként jelölt készültség: "oszlopok|panelek", pl. "1100|110" (1 = kész). NULL = hossz alapján (napi lap / kézi).
ALTER TABLE job_stages ADD COLUMN done_map TEXT;
