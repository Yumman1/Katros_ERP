-- Existing batches start today; do not invent production for historical dates.
ALTER TABLE "SesameProcessingPlan"
 ADD COLUMN "nextProductionDate" TEXT NOT NULL DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date)::text,
 ADD COLUMN "automationError" TEXT;
ALTER TABLE "SesameProcessing"
 ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "editedBy" TEXT,
 ADD COLUMN "editedAt" TIMESTAMP(3),
 ADD COLUMN "editHistory" JSONB NOT NULL DEFAULT '[]';
-- An edited zero day is retained so the scheduler cannot recreate it.
ALTER TABLE "SesameProcessing" DROP CONSTRAINT "SesameProcessing_inputKg_check";
ALTER TABLE "SesameProcessing" ADD CONSTRAINT "SesameProcessing_inputKg_check" CHECK ("inputKg" >= 0);
CREATE UNIQUE INDEX "SesameProcessing_automatic_day_key" ON "SesameProcessing"("planId", "productionDate") WHERE "automatic";

-- Keep this grade normalization aligned with lib/sesame-processing.ts.
CREATE FUNCTION public.sesame_processing_grade(params jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN params->>'sesameType' IN ('Raw','Machine Cleaned','Sortex','Impurities')
 THEN params->>'sesameType' ELSE 'Machine Cleaned' END;
$$;

-- Same physical movements as sesameGrades; unassigned receipts have no usable grade.
CREATE FUNCTION public.sesame_processing_stock_kg(code text, warehouse text, grade text) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
 SELECT coalesce(sum(qty),0) FROM (
  SELECT r."allocatedQtyMt"*1000 AS qty FROM "InboundReceipt" r
   JOIN "Trade" t ON t."tradeRef"=r."tradeRef" JOIN "Commodity" c ON c.id=t."commodityId"
   WHERE c.code=$1 AND lower(trim(r."warehouseName"))=lower(trim($2)) AND r.status<>'DRAFT'
    AND sesame_processing_grade(t."tradeParams")=$3
  UNION ALL
  SELECT -r."allocatedQtyMt"*1000 FROM "OutboundDispatch" r
   JOIN "Trade" t ON t."tradeRef"=r."tradeRef" JOIN "Commodity" c ON c.id=t."commodityId"
   WHERE c.code=$1 AND lower(trim(r."warehouseName"))=lower(trim($2)) AND r.status IN ('WEIGHED','FINANCE_PENDING','RELEASED')
    AND sesame_processing_grade(t."tradeParams")=$3
  UNION ALL
  SELECT -s."dispatchedQtyMt"*1000 FROM "StockTransfer" s
   WHERE s."commodityCode"=$1 AND lower(trim(s."fromWarehouseName"))=lower(trim($2))
    AND s.status NOT IN ('DRAFT','CANCELLED') AND sesame_processing_grade(jsonb_build_object('sesameType',s."sesameType"))=$3
  UNION ALL
  SELECT coalesce(s."receivedQtyMt",s."dispatchedQtyMt")*1000 FROM "StockTransfer" s
   WHERE s."commodityCode"=$1 AND lower(trim(s."toWarehouseName"))=lower(trim($2))
    AND s.status='RECEIVED' AND sesame_processing_grade(jsonb_build_object('sesameType',s."sesameType"))=$3
  UNION ALL
  SELECT (CASE WHEN p."fromType"=$3 THEN -p."inputKg" ELSE 0 END)
    +(CASE WHEN p."toType"=$3 THEN p."outputKg" ELSE 0 END)
    +(CASE WHEN $3='Impurities' THEN p."impuritiesKg" ELSE 0 END)
   FROM "SesameProcessing" p WHERE p."commodityCode"=$1 AND lower(trim(p."warehouseName"))=lower(trim($2))
 ) ledger;
$$;

CREATE FUNCTION public.run_sesame_daily_processing(only_code text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
 candidate record; batch "SesameProcessingPlan"%ROWTYPE;
 today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date;
 day date; amount numeric; output numeric; physical numeric; reserved numeric; posted integer := 0;
BEGIN
 FOR candidate IN SELECT id,"commodityCode" FROM "SesameProcessingPlan"
  WHERE status='ACTIVE' AND "nextProductionDate" < today::text
   AND (only_code IS NULL OR "commodityCode"=only_code)
  ORDER BY "commodityCode","createdAt",id
 LOOP
  -- Same serialization lock used by booking, shifting, ownership and manual processing.
  PERFORM pg_advisory_xact_lock(hashtext('sesame-ownership:' || candidate."commodityCode"));
  SELECT * INTO batch FROM "SesameProcessingPlan" WHERE id=candidate.id FOR UPDATE;
  IF batch.status <> 'ACTIVE' THEN CONTINUE; END IF;
  day := batch."nextProductionDate"::date;
  WHILE day < today AND batch."remainingKg" > 0 LOOP
   IF NOT EXISTS (SELECT 1 FROM "SesameProcessing" WHERE "planId"=batch.id AND "productionDate"=day::text) THEN
    amount := least(batch."dailyCapacityKg",batch."remainingKg");
    physical := sesame_processing_stock_kg(batch."commodityCode",batch."warehouseName",batch."fromType");
    SELECT coalesce(sum("remainingKg"),0) INTO reserved FROM "SesameProcessingPlan"
     WHERE "commodityCode"=batch."commodityCode" AND lower(trim("warehouseName"))=lower(trim(batch."warehouseName"))
      AND "fromType"=batch."fromType" AND status='ACTIVE';
    IF physical < reserved OR physical < amount THEN
     UPDATE "SesameProcessingPlan" SET "automationError"='Insufficient physical source stock for reserved batches',"updatedAt"=CURRENT_TIMESTAMP WHERE id=batch.id;
     EXIT;
    END IF;
    output := round(amount*batch."expectedYieldRatio",3);
    INSERT INTO "SesameProcessing" (id,"requestKey","planId","productionDate","commodityCode","warehouseName","fromType","toType","inputKg","outputKg","impuritiesKg","yieldRatio","recordedBy","automatic")
     VALUES (gen_random_uuid()::text,'auto:'||batch.id||':'||day::text,batch.id,day::text,batch."commodityCode",batch."warehouseName",batch."fromType",batch."toType",amount,output,amount-output,output/amount,'Automatic daily processing',true);
    batch."remainingKg" := batch."remainingKg"-amount;
    posted := posted+1;
   END IF;
   day := day+1;
   UPDATE "SesameProcessingPlan" SET "remainingKg"=batch."remainingKg",
    status=CASE WHEN batch."remainingKg"=0 THEN 'COMPLETED' ELSE 'ACTIVE' END,
    "nextProductionDate"=day::text,"automationError"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=batch.id;
  END LOOP;
 END LOOP;
 RETURN posted;
END;
$$;
REVOKE ALL ON FUNCTION public.sesame_processing_grade(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sesame_processing_stock_kg(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_sesame_daily_processing(text) FROM PUBLIC;

-- Supabase default privileges may include direct grants in addition to PUBLIC.
DO $permissions$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.sesame_processing_grade(jsonb) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION public.sesame_processing_stock_kg(text,text,text) FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION public.run_sesame_daily_processing(text) FROM %I',role_name);
  END IF;
 END LOOP;
END;
$permissions$;

-- Supabase supports pg_cron. Disposable/local PostgreSQL can run the function directly.
-- Runs hourly: 19:00 UTC is midnight Pakistan, later runs retry missed dates idempotently.
DO $schedule$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') THEN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('sesame-daily-processing','0 * * * *','SELECT public.run_sesame_daily_processing();');
 END IF;
END;
$schedule$;
