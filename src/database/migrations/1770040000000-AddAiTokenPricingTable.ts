import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddAiTokenPricingTable1770040000000 implements MigrationInterface {
  name = 'AddAiTokenPricingTable1770040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create ai_token_pricing table
    await queryRunner.createTable(
      new Table({
        name: 'ai_token_pricing',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'key',
            type: 'varchar',
            length: '50',
            isUnique: true,
          },
          {
            name: 'divisor',
            type: 'int',
            default: 3450,
          },
          {
            name: 'markup',
            type: 'decimal',
            precision: 3,
            scale: 2,
            default: 1.0,
          },
          {
            name: 'minTokens',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0.01,
          },
          {
            name: 'isActive',
            type: 'boolean',
            default: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Create index on key for fast lookups
    await queryRunner.createIndex(
      'ai_token_pricing',
      new TableIndex({
        name: 'IDX_ai_token_pricing_key',
        columnNames: ['key'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('ai_token_pricing', 'IDX_ai_token_pricing_key');
    await queryRunner.dropTable('ai_token_pricing');
  }
}
