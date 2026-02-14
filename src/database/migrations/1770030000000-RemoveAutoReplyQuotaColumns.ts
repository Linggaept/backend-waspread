import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveAutoReplyQuotaColumns1770030000000
  implements MigrationInterface
{
  name = 'RemoveAutoReplyQuotaColumns1770030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if autoReplyQuota column exists in packages before dropping
    const hasPackageColumn = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'packages' AND column_name = 'autoReplyQuota'
    `);

    if (hasPackageColumn.length > 0) {
      await queryRunner.query(`
        ALTER TABLE "packages" DROP COLUMN "autoReplyQuota"
      `);
    }

    // Check if usedAutoReplyQuota column exists in subscriptions before dropping
    const hasSubscriptionColumn = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'subscriptions' AND column_name = 'usedAutoReplyQuota'
    `);

    if (hasSubscriptionColumn.length > 0) {
      await queryRunner.query(`
        ALTER TABLE "subscriptions" DROP COLUMN "usedAutoReplyQuota"
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add columns if needed to rollback
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN "autoReplyQuota" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "usedAutoReplyQuota" integer NOT NULL DEFAULT 0
    `);
  }
}
