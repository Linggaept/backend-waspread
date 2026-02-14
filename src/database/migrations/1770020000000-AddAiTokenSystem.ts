import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiTokenSystem1770020000000 implements MigrationInterface {
  name = 'AddAiTokenSystem1770020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add aiTokenBalance to users table
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "aiTokenBalance" integer NOT NULL DEFAULT 0
    `);

    // Create ai_token_packages table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_token_packages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "description" text,
        "tokenAmount" integer NOT NULL,
        "bonusTokens" integer NOT NULL DEFAULT 0,
        "price" decimal(12,2) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "isPopular" boolean NOT NULL DEFAULT false,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_token_packages" PRIMARY KEY ("id")
      )
    `);

    // Create enum for purchase status
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ai_token_purchases_status_enum" AS ENUM('pending', 'success', 'failed', 'expired');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create ai_token_purchases table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_token_purchases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "packageId" uuid NOT NULL,
        "paymentId" uuid,
        "tokenAmount" integer NOT NULL,
        "price" decimal(12,2) NOT NULL,
        "status" "public"."ai_token_purchases_status_enum" NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_ai_token_purchases" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_token_purchases_payment" UNIQUE ("paymentId"),
        CONSTRAINT "FK_ai_token_purchases_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_token_purchases_package" FOREIGN KEY ("packageId") REFERENCES "ai_token_packages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_token_purchases_payment" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL
      )
    `);

    // Create index on ai_token_purchases
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_token_purchases_user_created" ON "ai_token_purchases" ("userId", "createdAt")
    `);

    // Create enum for feature type
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ai_token_usage_feature_enum" AS ENUM('auto_reply', 'suggest', 'copywriting', 'knowledge_import');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create ai_token_usage table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_token_usage" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "feature" "public"."ai_token_usage_feature_enum" NOT NULL,
        "tokensUsed" integer NOT NULL DEFAULT 1,
        "referenceId" varchar,
        "metadata" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_token_usage" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_token_usage_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes on ai_token_usage
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_token_usage_user_created" ON "ai_token_usage" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_token_usage_user_feature" ON "ai_token_usage" ("userId", "feature")
    `);

    // Seed default token packages
    await queryRunner.query(`
      INSERT INTO "ai_token_packages" ("name", "description", "tokenAmount", "bonusTokens", "price", "isPopular", "sortOrder")
      VALUES
        ('50 Token', 'Paket hemat untuk coba-coba', 50, 0, 25000, false, 1),
        ('100 Token', 'Paket populer untuk penggunaan harian', 100, 10, 45000, true, 2),
        ('250 Token', 'Paket bisnis dengan bonus token', 250, 50, 100000, false, 3),
        ('500 Token', 'Paket premium dengan bonus besar', 500, 150, 175000, false, 4),
        ('1000 Token', 'Paket enterprise untuk volume tinggi', 1000, 500, 300000, false, 5)
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_token_usage"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_token_purchases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_token_packages"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ai_token_usage_feature_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ai_token_purchases_status_enum"`);

    // Drop column from users
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "aiTokenBalance"`);
  }
}
