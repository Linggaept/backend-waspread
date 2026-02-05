import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImageUrlToBlast1769920761923 implements MigrationInterface {
  name = 'AddImageUrlToBlast1769920761923';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blasts" ADD "imageUrl" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "blasts" DROP COLUMN "imageUrl"`);
  }
}
