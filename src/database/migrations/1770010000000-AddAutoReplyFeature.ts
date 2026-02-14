import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoReplyFeature1770010000000 implements MigrationInterface {
  name = 'AddAutoReplyFeature1770010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create AutoReplyStatus enum
    await queryRunner.query(`
      CREATE TYPE "public"."auto_reply_logs_status_enum" AS ENUM('queued', 'sent', 'failed', 'skipped')
    `);

    // Add auto-reply fields to ai_settings table
    await queryRunner.query(`
      ALTER TABLE "ai_settings"
      ADD COLUMN "autoReplyEnabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN "workingHoursStart" TIME,
      ADD COLUMN "workingHoursEnd" TIME,
      ADD COLUMN "workingHoursEnabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN "autoReplyDelayMin" integer NOT NULL DEFAULT 5,
      ADD COLUMN "autoReplyDelayMax" integer NOT NULL DEFAULT 10,
      ADD COLUMN "autoReplyCooldownMinutes" integer NOT NULL DEFAULT 60,
      ADD COLUMN "autoReplyFallbackMessage" text
    `);

    // Add auto-reply fields to packages table
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN "hasAutoReplyFeature" boolean NOT NULL DEFAULT true,
      ADD COLUMN "autoReplyQuota" integer NOT NULL DEFAULT 0
    `);

    // Add auto-reply quota tracking to subscriptions table
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "usedAutoReplyQuota" integer NOT NULL DEFAULT 0
    `);

    // Create auto_reply_blacklist table
    await queryRunner.query(`
      CREATE TABLE "auto_reply_blacklist" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "phoneNumber" varchar NOT NULL,
        "reason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auto_reply_blacklist" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auto_reply_blacklist_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Create unique index on blacklist
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_auto_reply_blacklist_user_phone" ON "auto_reply_blacklist" ("userId", "phoneNumber")
    `);

    // Create auto_reply_logs table
    await queryRunner.query(`
      CREATE TABLE "auto_reply_logs" (
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
        CONSTRAINT "PK_auto_reply_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auto_reply_logs_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes on auto_reply_logs
    await queryRunner.query(`
      CREATE INDEX "IDX_auto_reply_logs_user_phone_sent" ON "auto_reply_logs" ("userId", "phoneNumber", "sentAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_auto_reply_logs_user_status" ON "auto_reply_logs" ("userId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_auto_reply_logs_user_status"`);
    await queryRunner.query(`DROP INDEX "IDX_auto_reply_logs_user_phone_sent"`);
    await queryRunner.query(`DROP INDEX "IDX_auto_reply_blacklist_user_phone"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE "auto_reply_logs"`);
    await queryRunner.query(`DROP TABLE "auto_reply_blacklist"`);

    // Drop columns from subscriptions
    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN "usedAutoReplyQuota"
    `);

    // Drop columns from packages
    await queryRunner.query(`
      ALTER TABLE "packages"
      DROP COLUMN "autoReplyQuota",
      DROP COLUMN "hasAutoReplyFeature"
    `);

    // Drop columns from ai_settings
    await queryRunner.query(`
      ALTER TABLE "ai_settings"
      DROP COLUMN "autoReplyFallbackMessage",
      DROP COLUMN "autoReplyCooldownMinutes",
      DROP COLUMN "autoReplyDelayMax",
      DROP COLUMN "autoReplyDelayMin",
      DROP COLUMN "workingHoursEnabled",
      DROP COLUMN "workingHoursEnd",
      DROP COLUMN "workingHoursStart",
      DROP COLUMN "autoReplyEnabled"
    `);

    // Drop enum
    await queryRunner.query(`DROP TYPE "public"."auto_reply_logs_status_enum"`);
  }
}
