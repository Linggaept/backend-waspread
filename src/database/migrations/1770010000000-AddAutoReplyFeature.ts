import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoReplyFeature1770010000000 implements MigrationInterface {
  name = 'AddAutoReplyFeature1770010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create AutoReplyStatus enum (IF NOT EXISTS)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."auto_reply_logs_status_enum" AS ENUM('queued', 'sent', 'failed', 'skipped');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    // Add auto-reply fields to ai_settings table
    await queryRunner.query(`
      ALTER TABLE "ai_settings"
      ADD COLUMN IF NOT EXISTS "autoReplyEnabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "workingHoursStart" TIME,
      ADD COLUMN IF NOT EXISTS "workingHoursEnd" TIME,
      ADD COLUMN IF NOT EXISTS "workingHoursEnabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "autoReplyDelayMin" integer NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS "autoReplyDelayMax" integer NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS "autoReplyCooldownMinutes" integer NOT NULL DEFAULT 60,
      ADD COLUMN IF NOT EXISTS "autoReplyFallbackMessage" text
    `);

    // Add auto-reply fields to packages table
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "hasAutoReplyFeature" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "autoReplyQuota" integer NOT NULL DEFAULT 0
    `);

    // Add auto-reply quota tracking to subscriptions table
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "usedAutoReplyQuota" integer NOT NULL DEFAULT 0
    `);

    // Create auto_reply_blacklist table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auto_reply_blacklist" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "phoneNumber" varchar NOT NULL,
        "reason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auto_reply_blacklist" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "auto_reply_blacklist"
        ADD CONSTRAINT "FK_auto_reply_blacklist_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    // Create unique index on blacklist
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_auto_reply_blacklist_user_phone" ON "auto_reply_blacklist" ("userId", "phoneNumber")
    `);

    // Create auto_reply_logs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auto_reply_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "phoneNumber" varchar NOT NULL,
        "incomingMessageId" varchar,
        "incomingMessageBody" text,
        "replyMessage" text,
        "whatsappMessageId" varchar,
        "status" "public"."auto_reply_logs_status_enum" NOT NULL DEFAULT 'queued',
        "skipReason" varchar,
        "delaySeconds" integer,
        "queuedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "sentAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_auto_reply_logs" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "auto_reply_logs"
        ADD CONSTRAINT "FK_auto_reply_logs_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    // Create indexes on auto_reply_logs
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auto_reply_logs_user_phone_sent" ON "auto_reply_logs" ("userId", "phoneNumber", "sentAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auto_reply_logs_user_status" ON "auto_reply_logs" ("userId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auto_reply_logs_user_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auto_reply_logs_user_phone_sent"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auto_reply_blacklist_user_phone"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS "auto_reply_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auto_reply_blacklist"`);

    // Drop columns from subscriptions
    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "usedAutoReplyQuota"
    `);

    // Drop columns from packages
    await queryRunner.query(`
      ALTER TABLE "packages"
      DROP COLUMN IF EXISTS "autoReplyQuota",
      DROP COLUMN IF EXISTS "hasAutoReplyFeature"
    `);

    // Drop columns from ai_settings
    await queryRunner.query(`
      ALTER TABLE "ai_settings"
      DROP COLUMN IF EXISTS "autoReplyFallbackMessage",
      DROP COLUMN IF EXISTS "autoReplyCooldownMinutes",
      DROP COLUMN IF EXISTS "autoReplyDelayMax",
      DROP COLUMN IF EXISTS "autoReplyDelayMin",
      DROP COLUMN IF EXISTS "workingHoursEnabled",
      DROP COLUMN IF EXISTS "workingHoursEnd",
      DROP COLUMN IF EXISTS "workingHoursStart",
      DROP COLUMN IF EXISTS "autoReplyEnabled"
    `);

    // Drop enum
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."auto_reply_logs_status_enum"`);
  }
}
