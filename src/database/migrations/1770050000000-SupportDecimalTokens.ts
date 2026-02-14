import { MigrationInterface, QueryRunner } from 'typeorm';

export class SupportDecimalTokens1770050000000 implements MigrationInterface {
  name = 'SupportDecimalTokens1770050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Helper function to check if column is already decimal
    const isColumnDecimal = async (
      table: string,
      column: string,
    ): Promise<boolean> => {
      const result = await queryRunner.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = '${table}' AND column_name = '${column}'
      `);
      return result.length > 0 && result[0].data_type === 'numeric';
    };

    // First, set default values for any NULL values
    await queryRunner.query(
      `UPDATE "users" SET "aiTokenBalance" = 0 WHERE "aiTokenBalance" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "ai_token_usage" SET "tokensUsed" = 0 WHERE "tokensUsed" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "ai_token_purchases" SET "tokenAmount" = 0 WHERE "tokenAmount" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "ai_token_packages" SET "tokenAmount" = 0 WHERE "tokenAmount" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "ai_token_packages" SET "bonusTokens" = 0 WHERE "bonusTokens" IS NULL`,
    );

    // 1. Alter users.aiTokenBalance to decimal (if not already)
    if (!(await isColumnDecimal('users', 'aiTokenBalance'))) {
      await queryRunner.query(`
        ALTER TABLE "users"
        ALTER COLUMN "aiTokenBalance" TYPE decimal(12,2) USING COALESCE("aiTokenBalance", 0)::decimal(12,2),
        ALTER COLUMN "aiTokenBalance" SET DEFAULT 0
      `);
    }

    // 2. Alter ai_token_usage.tokensUsed to decimal (if not already)
    if (!(await isColumnDecimal('ai_token_usage', 'tokensUsed'))) {
      await queryRunner.query(`
        ALTER TABLE "ai_token_usage"
        ALTER COLUMN "tokensUsed" TYPE decimal(12,2) USING COALESCE("tokensUsed", 0)::decimal(12,2),
        ALTER COLUMN "tokensUsed" SET DEFAULT 0.01
      `);
    }

    // 3. Alter ai_token_purchases.tokenAmount to decimal (if not already)
    if (!(await isColumnDecimal('ai_token_purchases', 'tokenAmount'))) {
      await queryRunner.query(`
        ALTER TABLE "ai_token_purchases"
        ALTER COLUMN "tokenAmount" TYPE decimal(12,2) USING COALESCE("tokenAmount", 0)::decimal(12,2),
        ALTER COLUMN "tokenAmount" SET DEFAULT 0
      `);
    }

    // 4. Alter ai_token_packages.tokenAmount to decimal (if not already)
    if (!(await isColumnDecimal('ai_token_packages', 'tokenAmount'))) {
      await queryRunner.query(`
        ALTER TABLE "ai_token_packages"
        ALTER COLUMN "tokenAmount" TYPE decimal(12,2) USING COALESCE("tokenAmount", 0)::decimal(12,2),
        ALTER COLUMN "tokenAmount" SET DEFAULT 0
      `);
    }

    // 5. Alter ai_token_packages.bonusTokens to decimal (if not already)
    if (!(await isColumnDecimal('ai_token_packages', 'bonusTokens'))) {
      await queryRunner.query(`
        ALTER TABLE "ai_token_packages"
        ALTER COLUMN "bonusTokens" TYPE decimal(12,2) USING COALESCE("bonusTokens", 0)::decimal(12,2),
        ALTER COLUMN "bonusTokens" SET DEFAULT 0
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert back to integer types
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "aiTokenBalance" TYPE integer USING "aiTokenBalance"::integer
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_token_usage"
      ALTER COLUMN "tokensUsed" TYPE integer USING "tokensUsed"::integer
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_token_purchases"
      ALTER COLUMN "tokenAmount" TYPE integer USING "tokenAmount"::integer
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_token_packages"
      ALTER COLUMN "tokenAmount" TYPE integer USING "tokenAmount"::integer
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_token_packages"
      ALTER COLUMN "bonusTokens" TYPE integer USING "bonusTokens"::integer
    `);
  }
}
