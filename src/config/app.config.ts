import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const jwtSecret = process.env.JWT_SECRET;

  // Fail fast if JWT_SECRET is not set in production
  if (nodeEnv === 'production' && !jwtSecret) {
    throw new Error('JWT_SECRET must be set in production environment');
  }

  return {
    port: parseInt(process.env.APP_PORT ?? '3000', 10),
    nodeEnv,
    jwtSecret: jwtSecret || 'dev-only-secret-change-in-production',
    jwtExpiresIn: parseInt(process.env.JWT_EXPIRES_IN ?? '604800', 10), // 7 days in seconds
  };
});
