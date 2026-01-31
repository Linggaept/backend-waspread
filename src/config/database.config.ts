import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME || 'waspread',
  password: process.env.DB_PASSWORD || 'waspread_secret',
  database: process.env.DB_DATABASE || 'waspread',
}));
