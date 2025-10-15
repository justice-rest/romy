-- Fix ByteString error by changing user_id from varchar(255) to text
-- This allows for longer user IDs that may contain characters with values > 255

ALTER TABLE "chats" ALTER COLUMN "user_id" TYPE text;
--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "user_id" TYPE text;
