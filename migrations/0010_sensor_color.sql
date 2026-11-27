-- Szenzoronként választható szín a grafikonokhoz (#rrggbb), üresen az automatikus paletta.
ALTER TABLE sensors ADD COLUMN color TEXT;
