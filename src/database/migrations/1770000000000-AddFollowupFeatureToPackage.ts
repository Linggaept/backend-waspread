import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFollowupFeatureToPackage1770000000000
  implements MigrationInterface
{
  name = 'AddFollowupFeatureToPackage1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "hasFollowupFeature" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "packages" DROP COLUMN "hasFollowupFeature"`,
    );
  }
}
