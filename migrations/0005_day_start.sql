-- A nap indításának ideje (a napi lap fejléce ebből mutatja, hogy fut-e a nap).
ALTER TABLE days ADD COLUMN started_at TEXT;
