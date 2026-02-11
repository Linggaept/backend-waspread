import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackagePopularAndDiscount1769970000000
  implements MigrationInterface
{
  name = 'AddPackagePopularAndDiscount1769970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add isPopular column
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "isPopular" boolean NOT NULL DEFAULT false
    `);

    // Add isDiscount column
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "isDiscount" boolean NOT NULL DEFAULT false
    `);

    // Add originalPrice column (nullable, only used when isDiscount is true)
    await queryRunner.query(`
      ALTER TABLE "packages"
      ADD COLUMN IF NOT EXISTS "originalPrice" decimal(12,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "originalPrice"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "isDiscount"
    `);

    await queryRunner.query(`
      ALTER TABLE "packages" DROP COLUMN IF EXISTS "isPopular"
    `);
  }
}
