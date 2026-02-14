import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixAiTokenPackageAmounts1739570000000
  implements MigrationInterface
{
  name = 'FixAiTokenPackageAmounts1739570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fix packages with tokenAmount = 0 based on price
    // These values match the default seeder in ai-token.service.ts

    await queryRunner.query(`
      UPDATE ai_token_packages
      SET "tokenAmount" = 50, "bonusTokens" = 0
      WHERE price = 25000 AND "tokenAmount" = 0
    `);

    await queryRunner.query(`
      UPDATE ai_token_packages
      SET "tokenAmount" = 100, "bonusTokens" = 10
      WHERE price = 45000 AND "tokenAmount" = 0
    `);

    await queryRunner.query(`
      UPDATE ai_token_packages
      SET "tokenAmount" = 250, "bonusTokens" = 30
      WHERE price = 100000 AND "tokenAmount" = 0
    `);

    await queryRunner.query(`
      UPDATE ai_token_packages
      SET "tokenAmount" = 500, "bonusTokens" = 75
      WHERE price = 175000 AND "tokenAmount" = 0
    `);

    await queryRunner.query(`
      UPDATE ai_token_packages
      SET "tokenAmount" = 1000, "bonusTokens" = 200
      WHERE price = 300000 AND "tokenAmount" = 0
    `);

    // Also fix any purchases that were created with tokenAmount = 0
    // by looking up the correct amount from the package
    await queryRunner.query(`
      UPDATE ai_token_purchases p
      SET "tokenAmount" = (
        SELECT COALESCE(pkg."tokenAmount", 0) + COALESCE(pkg."bonusTokens", 0)
        FROM ai_token_packages pkg
        WHERE pkg.id = p."packageId"
      )
      WHERE p."tokenAmount" = 0
        AND p.status = 'success'
        AND EXISTS (
          SELECT 1 FROM ai_token_packages pkg
          WHERE pkg.id = p."packageId" AND pkg."tokenAmount" > 0
        )
    `);

    // Add tokens to users who had successful purchases but got 0 tokens
    // This recalculates user balance based on successful purchases minus usage
    await queryRunner.query(`
      UPDATE users u
      SET "aiTokenBalance" = COALESCE((
        SELECT SUM(p."tokenAmount")
        FROM ai_token_purchases p
        WHERE p."userId" = u.id AND p.status = 'success'
      ), 0) - COALESCE((
        SELECT SUM(tu."tokensUsed")
        FROM ai_token_usage tu
        WHERE tu."userId" = u.id
      ), 0)
      WHERE EXISTS (
        SELECT 1 FROM ai_token_purchases p
        WHERE p."userId" = u.id AND p.status = 'success'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot safely revert this migration as it fixes data corruption
    // The original corrupted state should not be restored
  }
}
