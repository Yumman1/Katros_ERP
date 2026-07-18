-- CEO becomes the top authority (ADMIN role retired from use) and the
-- CEO Users page needs account state + presence tracking.
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
