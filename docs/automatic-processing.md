# Automatic Sesame processing

Active processing batches use their saved daily input capacity and expected yield. At midnight in Asia/Karachi, the previous production date closes. The database job `sesame-daily-processing` runs hourly (including 19:00 UTC, midnight Pakistan time) and catches up missed dates idempotently without requiring a browser session. The final day consumes at most the remaining reserved quantity.

Any actual production entry for the batch/date suppresses that day's automatic default. Multiple actual runs are supported. Zero output and zero impurities record an idle day. If a default has already posted, correct that entry through Production history rather than adding the same production again. Existing batches start automation on the migration's Pakistan date; earlier dates are not backfilled. Changing defaults first settles overdue days with the previous settings.

Every history entry can be corrected, including legacy truck-linked entries. Output plus impurities determines source input. Corrections update the grade ledger and reserved balance atomically, preserve an audit history with actor/reason, and reject stale concurrent editors. They cannot remove output already used or reserved elsewhere. Correct downstream activity first in that case. A completed batch reopened by a correction resumes automation from today; a cancelled batch stays cancelled.

The scheduler uses the same per-commodity advisory lock as manual processing, sales and stock movement. If physical source stock is below processing reservations, automation pauses with an error visible in Batch progress. It retries after the underlying stock discrepancy is corrected. Conversion conserves total warehouse weight and does not change cash accounting.

## Deployment

Prisma migration: `20261013010000_automatic_processing`.

This migration has already been applied to the connected production database and registered in Prisma migration history. The pg_cron schedule is active. Local/Postgres environments without pg_cron can call `SELECT public.run_sesame_daily_processing();` from a trusted database role; production requires pg_cron or an equivalent trusted scheduled runner. Browser roles cannot execute the functions.

Verify scheduling with:

```sql
SELECT jobname, schedule, active FROM cron.job
WHERE jobname = 'sesame-daily-processing';
SELECT status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'sesame-daily-processing')
ORDER BY start_time DESC LIMIT 10;
SELECT id, status, "nextProductionDate", "automationError"
FROM "SesameProcessingPlan";
```

Keep `sesame_processing_stock_kg` and `sesame_processing_grade` in sync with `sesameGrades`/`sesameGrade` if physical movement rules change.

## Verification

`npm run build` passed. The expanded `scripts/check-warehouse-processing.ts` passed against a disposable PostgreSQL-compatible database, including scheduling retries, partial batches, manual and zero overrides, correction audit/concurrency, consumed output, cancelled batches, insufficient stock pause/resume, SQL/app grade parity, trader access, reservation checks and existing processing routes. It refuses to run against a non-local database or a database containing users. No production test trades or stock movements were created.

The live migration was verified: pg_cron 1.6.4, active hourly schedule, existing production row count unchanged, both browser roles denied execution. Scheduled execution at an actual future midnight has not yet been observed.
