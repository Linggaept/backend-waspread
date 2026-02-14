import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFollowupTables1769990000000 implements MigrationInterface {
  name = 'CreateFollowupTables1769990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types (IF NOT EXISTS)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "followup_trigger_enum" AS ENUM (
          'no_reply',
          'stage_replied',
          'stage_interested',
          'stage_negotiating'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "followup_status_enum" AS ENUM (
          'active',
          'paused',
          'completed'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "followup_message_status_enum" AS ENUM (
          'scheduled',
          'queued',
          'sent',
          'failed',
          'skipped',
          'cancelled'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    // Create followup_campaigns table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "followup_campaigns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "originalBlastId" uuid NOT NULL,
        "trigger" "followup_trigger_enum" NOT NULL DEFAULT 'no_reply',
        "delayHours" integer NOT NULL DEFAULT 24,
        "messages" jsonb NOT NULL DEFAULT '[]',
        "maxFollowups" integer NOT NULL DEFAULT 1,
        "isActive" boolean NOT NULL DEFAULT true,
        "status" "followup_status_enum" NOT NULL DEFAULT 'active',
        "totalScheduled" integer NOT NULL DEFAULT 0,
        "totalSent" integer NOT NULL DEFAULT 0,
        "totalSkipped" integer NOT NULL DEFAULT 0,
        "totalFailed" integer NOT NULL DEFAULT 0,
        "totalReplied" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_followup_campaigns" PRIMARY KEY ("id")
      )
    `);

    // Create followup_messages table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "followup_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "followupCampaignId" uuid NOT NULL,
        "originalBlastMessageId" uuid NOT NULL,
        "phoneNumber" character varying NOT NULL,
        "step" integer NOT NULL DEFAULT 1,
        "message" text NOT NULL,
        "status" "followup_message_status_enum" NOT NULL DEFAULT 'scheduled',
        "scheduledAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "sentAt" TIMESTAMP WITH TIME ZONE,
        "queuedAt" TIMESTAMP WITH TIME ZONE,
        "whatsappMessageId" character varying,
        "errorMessage" character varying,
        "retryCount" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_followup_messages" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraints (with IF NOT EXISTS check)
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "followup_campaigns"
        ADD CONSTRAINT "FK_followup_campaigns_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "followup_campaigns"
        ADD CONSTRAINT "FK_followup_campaigns_blast"
        FOREIGN KEY ("originalBlastId") REFERENCES "blasts"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "followup_messages"
        ADD CONSTRAINT "FK_followup_messages_campaign"
        FOREIGN KEY ("followupCampaignId") REFERENCES "followup_campaigns"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "followup_messages"
        ADD CONSTRAINT "FK_followup_messages_blast_message"
        FOREIGN KEY ("originalBlastMessageId") REFERENCES "blast_messages"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);

    // Create indexes (IF NOT EXISTS)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_campaigns_userId_status"
      ON "followup_campaigns" ("userId", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_campaigns_userId_originalBlastId"
      ON "followup_campaigns" ("userId", "originalBlastId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_campaigns_userId_createdAt"
      ON "followup_campaigns" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_messages_campaignId_status"
      ON "followup_messages" ("followupCampaignId", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_messages_campaignId_scheduledAt"
      ON "followup_messages" ("followupCampaignId", "scheduledAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_messages_phoneNumber_campaignId"
      ON "followup_messages" ("phoneNumber", "followupCampaignId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_messages_originalBlastMessageId"
      ON "followup_messages" ("originalBlastMessageId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_followup_messages_status_scheduledAt"
      ON "followup_messages" ("status", "scheduledAt")
      WHERE "status" = 'scheduled'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes for followup_messages
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_messages_status_scheduledAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_messages_originalBlastMessageId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_messages_phoneNumber_campaignId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_messages_campaignId_scheduledAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_messages_campaignId_status"`);

    // Drop indexes for followup_campaigns
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_campaigns_userId_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_campaigns_userId_originalBlastId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followup_campaigns_userId_status"`);

    // Drop foreign keys
    await queryRunner.query(`ALTER TABLE "followup_messages" DROP CONSTRAINT IF EXISTS "FK_followup_messages_blast_message"`);
    await queryRunner.query(`ALTER TABLE "followup_messages" DROP CONSTRAINT IF EXISTS "FK_followup_messages_campaign"`);
    await queryRunner.query(`ALTER TABLE "followup_campaigns" DROP CONSTRAINT IF EXISTS "FK_followup_campaigns_blast"`);
    await queryRunner.query(`ALTER TABLE "followup_campaigns" DROP CONSTRAINT IF EXISTS "FK_followup_campaigns_user"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS "followup_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "followup_campaigns"`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "followup_message_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "followup_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "followup_trigger_enum"`);
  }
}
