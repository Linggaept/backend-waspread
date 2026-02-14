import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorQuotaFields1769980000000 implements MigrationInterface {
  name = 'RefactorQuotaFields1769980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========== PACKAGES TABLE ==========

    // Add new blast quota fields (replaces monthlyQuota, dailyLimit, maxBlastsPerDay)
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "blastMonthlyQuota" integer NOT NULL DEFAULT 1000
    `);

    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "blastDailyLimit" integer NOT NULL DEFAULT 100
    `);

    // Migrate data from old columns to new columns (only if old columns exist)
    const hasOldColumns = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'packages' AND column_name = 'monthlyQuota'
    `);

    if (hasOldColumns.length > 0) {
      await queryRunner.query(`
        UPDATE "packages"
        SET "blastMonthlyQuota" = COALESCE("monthlyQuota", 1000),
            "blastDailyLimit" = COALESCE("dailyLimit", 100)
        WHERE "blastMonthlyQuota" = 1000 AND "blastDailyLimit" = 100
      `);
    }

    // Drop old columns from packages
    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "monthlyQuota"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "dailyLimit"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "maxBlastsPerDay"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "messageMonthlyQuota"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "messageDailyLimit"
    `);

    // ========== SUBSCRIPTIONS TABLE ==========

    // Add new blast tracking fields
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "usedBlastQuota" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "todayBlastUsed" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "lastBlastDate" date
    `);

    // Migrate data from old columns to new columns (only if old columns exist)
    const hasOldSubColumns = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'subscriptions' AND column_name = 'usedQuota'
    `);

    if (hasOldSubColumns.length > 0) {
      await queryRunner.query(`
        UPDATE "subscriptions"
        SET "usedBlastQuota" = COALESCE("usedQuota", COALESCE("usedMessageQuota", 0)),
            "todayBlastUsed" = COALESCE("todayUsed", COALESCE("todayMessageUsed", 0)),
            "lastBlastDate" = COALESCE("lastUsedDate", COALESCE("lastMessageDate", NULL))
        WHERE "usedBlastQuota" = 0
      `);
    }

    // Drop old columns from subscriptions
    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "usedQuota"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "todayUsed"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "lastUsedDate"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "usedMessageQuota"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "todayMessageUsed"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "lastMessageDate"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "todayBlasts"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ========== SUBSCRIPTIONS TABLE - Restore old columns ==========

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "usedQuota" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "todayUsed" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "lastUsedDate" date
    `);

    // Migrate data back
    await queryRunner.query(`
      UPDATE "subscriptions"
      SET "usedQuota" = COALESCE("usedBlastQuota", 0),
          "todayUsed" = COALESCE("todayBlastUsed", 0),
          "lastUsedDate" = "lastBlastDate"
    `);

    // Drop new columns
    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "usedBlastQuota"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "todayBlastUsed"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "lastBlastDate"
    `);

    // ========== PACKAGES TABLE - Restore old columns ==========

    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "monthlyQuota" integer NOT NULL DEFAULT 1000
    `);

    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "dailyLimit" integer NOT NULL DEFAULT 100
    `);

    // Migrate data back
    await queryRunner.query(`
      UPDATE "packages"
      SET "monthlyQuota" = COALESCE("blastMonthlyQuota", 1000),
          "dailyLimit" = COALESCE("blastDailyLimit", 100)
    `);

    // Drop new columns
    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "blastMonthlyQuota"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "blastDailyLimit"
    `);
  }
}
