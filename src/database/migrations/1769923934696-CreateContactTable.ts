import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContactTable1769923934696 implements MigrationInterface {
  name = 'CreateContactTable1769923934696';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "contacts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "phoneNumber" character varying NOT NULL, "name" character varying, "email" character varying, "notes" character varying, "tags" jsonb, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_34bed11c8b744305e8b008401d0" UNIQUE ("userId", "phoneNumber"), CONSTRAINT "PK_b99cd40cfd66a99f1571f4f72e6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30ef77942fc8c05fcb829dcc61" ON "contacts" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "contacts" ADD CONSTRAINT "FK_30ef77942fc8c05fcb829dcc61d" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contacts" DROP CONSTRAINT "FK_30ef77942fc8c05fcb829dcc61d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30ef77942fc8c05fcb829dcc61"`,
    );
    await queryRunner.query(`DROP TABLE "contacts"`);
  }
}
