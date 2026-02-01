import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTemplateTable1769940910829 implements MigrationInterface {
    name = 'CreateTemplateTable1769940910829'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "templates" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" uuid NOT NULL,
                "name" character varying NOT NULL,
                "message" text NOT NULL,
                "imageUrl" character varying,
                "category" character varying,
                "variables" jsonb,
                "isActive" boolean NOT NULL DEFAULT true,
                "usageCount" integer NOT NULL DEFAULT 0,
                "lastUsedAt" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_templates_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_templates_userId" ON "templates" ("userId")`);
        await queryRunner.query(`CREATE INDEX "IDX_templates_userId_category" ON "templates" ("userId", "category")`);
        await queryRunner.query(`
            ALTER TABLE "templates"
            ADD CONSTRAINT "FK_templates_userId"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "templates" DROP CONSTRAINT "FK_templates_userId"`);
        await queryRunner.query(`DROP INDEX "IDX_templates_userId_category"`);
        await queryRunner.query(`DROP INDEX "IDX_templates_userId"`);
        await queryRunner.query(`DROP TABLE "templates"`);
    }
}
