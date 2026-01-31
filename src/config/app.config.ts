import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.APP_PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'default-secret',
  jwtExpiresIn: parseInt(process.env.JWT_EXPIRES_IN ?? '604800', 10), // 7 days in seconds
}));
