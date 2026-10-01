-- Existing warehouses retain lease-basis behavior.
CREATE TYPE "WarehouseBasis" AS ENUM ('LEASE', 'USE');
ALTER TABLE "Location" ADD COLUMN "warehouseBasis" "WarehouseBasis" NOT NULL DEFAULT 'LEASE';

-- Register the four sesame storage locations from the 25-Sep-2026 summary.
-- Preserve IDs/names used by trades and movements; recognise existing WH/Warehouse
-- aliases (including K-code prefixes). Never import dated stock as current stock.
-- Grain divisions below are estimates from rounded utilization percentages.
-- Gama's mixed cotton/grain stock cannot determine a grain division: preserve
-- an existing setting, otherwise leave it unconfigured for execution to confirm.
DO $$
DECLARE
  spec RECORD;
  existing_id TEXT;
  actor_id TEXT;
  next_code INTEGER;
BEGIN
  SELECT id INTO actor_id FROM "User" ORDER BY "createdAt" ASC LIMIT 1;
  FOR spec IN SELECT * FROM (VALUES
    ('Gama WH', 'gama', 'Seagold', 'Vehari', 'Punjab', 'LEASE', 47000::NUMERIC, NULL::NUMERIC),
    ('Umar WH', 'umar', 'Seagold', 'Tiba Sultan Pur', 'Punjab', 'LEASE', 37000::NUMERIC, 9.01::NUMERIC),
    ('Silver WH', 'silver', 'GodamTech', 'Port Qasim', 'Sindh', 'LEASE', 20000::NUMERIC, 6.24::NUMERIC),
    ('MA oil', 'maoil', 'MA Oil', 'Port Qasim', 'Sindh', 'USE', NULL::NUMERIC, NULL::NUMERIC)
  ) AS s(name, match_key, lsp, city, province, basis, area, division)
  LOOP
    SELECT id INTO existing_id FROM "Location"
    WHERE regexp_replace(
      regexp_replace(lower(name), '^k[0-9]+[- .]*', ''),
      '(warehouse|wh|[^a-z0-9])', '', 'g'
    ) IN (spec.match_key, CASE WHEN spec.match_key = 'umar' THEN 'umer' ELSE spec.match_key END)
    ORDER BY "createdAt" ASC LIMIT 1;

    IF existing_id IS NOT NULL THEN
      UPDATE "Location" SET
        "warehouseBasis" = spec.basis::"WarehouseBasis",
        "capacitySqFt" = spec.area,
        "grainDivisionSqFt" = CASE WHEN spec.basis = 'USE' THEN NULL
          ELSE COALESCE("grainDivisionSqFt", spec.division) END,
        "balesDivisionSqFt" = CASE WHEN spec.basis = 'USE' THEN NULL ELSE "balesDivisionSqFt" END,
        lsp = COALESCE(lsp, spec.lsp), city = COALESCE(city, spec.city),
        province = COALESCE(province, spec.province), "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = existing_id;
    ELSIF actor_id IS NOT NULL THEN
      SELECT COALESCE(MAX(substring(code FROM '^K([0-9]+)$')::INTEGER), 0) + 1
        INTO next_code FROM "Location" WHERE code ~ '^K[0-9]+$';
      INSERT INTO "Location" (id, name, code, type, country, lsp, city, province,
        "warehouseBasis", "capacitySqFt", "grainDivisionSqFt", "createdById", "createdAt", "updatedAt")
      VALUES ('sesame-warehouse-' || spec.match_key, spec.name,
        'K' || lpad(next_code::TEXT, GREATEST(3, length(next_code::TEXT)), '0'),
        'WAREHOUSE', 'Pakistan', spec.lsp, spec.city, spec.province,
        spec.basis::"WarehouseBasis", spec.area, spec.division, actor_id,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    END IF;
  END LOOP;
END $$;
