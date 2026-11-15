ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "executionEntity" TEXT NOT NULL DEFAULT 'PAK';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_executionEntity_check') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_executionEntity_check" CHECK ("executionEntity" IN ('PAK', 'FZCO'));
  END IF;
END $$;
