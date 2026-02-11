import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackageQuotasAndFeatures1769960000000 implements MigrationInterface {
  name = 'AddPackageQuotasAndFeatures1769960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to packages table
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "aiQuota" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "hasAnalytics" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "hasAiFeatures" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "hasLeadScoring" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "maxBlastsPerDay" integer NOT NULL DEFAULT 0
    `);

    // Add new columns to subscriptions table
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "usedAiQuota" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "todayBlasts" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN IF NOT EXISTS "lastBlastDate" date
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove columns from subscriptions table
    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "lastBlastDate"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "todayBlasts"
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "usedAiQuota"
    `);

    // Remove columns from packages table
    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "maxBlastsPerDay"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "hasLeadScoring"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "hasAiFeatures"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "hasAnalytics"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "aiQuota"
    `);
  }
}
