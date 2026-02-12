import { registerAs } from '@nestjs/config';

export default registerAs('database', () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  // Fail fast if DB credentials are not set in production
  if (isProduction) {
    if (!process.env.DB_HOST) {
      throw new Error('DB_HOST must be set in production environment');
    }
    if (!process.env.DB_USERNAME) {
      throw new Error('DB_USERNAME must be set in production environment');
    }
    if (!process.env.DB_PASSWORD) {
      throw new Error('DB_PASSWORD must be set in production environment');
    }
    if (!process.env.DB_DATABASE) {
      throw new Error('DB_DATABASE must be set in production environment');
    }
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'waspread',
    ssl: process.env.DB_SSL || 'false',
  };
});
