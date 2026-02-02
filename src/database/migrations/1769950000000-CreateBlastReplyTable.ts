import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateBlastReplyTable1769950000000 implements MigrationInterface {
    name = 'CreateBlastReplyTable1769950000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add replyCount column to blasts table (if not exists)
        const hasReplyCount = await queryRunner.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'blasts' AND column_name = 'replyCount'
        `);
        if (hasReplyCount.length === 0) {
            await queryRunner.query(`
                ALTER TABLE "blasts" ADD "replyCount" integer NOT NULL DEFAULT 0
            `);
        }

        // Create blast_replies table (if not exists)
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "blast_replies" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "blastId" uuid NOT NULL,
                "blastMessageId" uuid,
                "phoneNumber" character varying NOT NULL,
                "messageContent" text NOT NULL,
                "whatsappMessageId" character varying,
                "mediaUrl" character varying,
                "mediaType" character varying,
                "receivedAt" TIMESTAMP NOT NULL,
                "isRead" boolean NOT NULL DEFAULT false,
                "readAt" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_blast_replies_id" PRIMARY KEY ("id")
            )
        `);

        // Create indexes (if not exists)
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_blast_replies_blastId_createdAt" ON "blast_replies" ("blastId", "createdAt")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_blast_replies_blastMessageId" ON "blast_replies" ("blastMessageId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_blast_replies_phoneNumber_receivedAt" ON "blast_replies" ("phoneNumber", "receivedAt")`);

        // Add foreign key constraints (check if not exists)
        const fkBlastId = await queryRunner.query(`
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_name = 'blast_replies' AND constraint_name = 'FK_blast_replies_blastId'
        `);
        if (fkBlastId.length === 0) {
            await queryRunner.query(`
                ALTER TABLE "blast_replies"
                ADD CONSTRAINT "FK_blast_replies_blastId"
                FOREIGN KEY ("blastId") REFERENCES "blasts"("id")
                ON DELETE CASCADE ON UPDATE NO ACTION
            `);
        }

        const fkBlastMessageId = await queryRunner.query(`
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_name = 'blast_replies' AND constraint_name = 'FK_blast_replies_blastMessageId'
        `);
        if (fkBlastMessageId.length === 0) {
            await queryRunner.query(`
                ALTER TABLE "blast_replies"
                ADD CONSTRAINT "FK_blast_replies_blastMessageId"
                FOREIGN KEY ("blastMessageId") REFERENCES "blast_messages"("id")
                ON DELETE SET NULL ON UPDATE NO ACTION
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove foreign key constraints (if exists)
        await queryRunner.query(`ALTER TABLE "blast_replies" DROP CONSTRAINT IF EXISTS "FK_blast_replies_blastMessageId"`);
        await queryRunner.query(`ALTER TABLE "blast_replies" DROP CONSTRAINT IF EXISTS "FK_blast_replies_blastId"`);

        // Drop indexes (if exists)
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_blast_replies_phoneNumber_receivedAt"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_blast_replies_blastMessageId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_blast_replies_blastId_createdAt"`);

        // Drop table (if exists)
        await queryRunner.query(`DROP TABLE IF EXISTS "blast_replies"`);

        // Remove replyCount column from blasts (if exists)
        await queryRunner.query(`ALTER TABLE "blasts" DROP COLUMN IF EXISTS "replyCount"`);
    }
}
