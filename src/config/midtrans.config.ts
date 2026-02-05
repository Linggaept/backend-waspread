import { registerAs } from '@nestjs/config';

export default registerAs('midtrans', () => {
  const envValue = process.env.MIDTRANS_IS_PRODUCTION;
  const isProduction = envValue === 'true';

  console.log(
    '[midtrans.config.ts] RAW process.env.MIDTRANS_IS_PRODUCTION:',
    envValue,
  );
  console.log('[midtrans.config.ts] Computed isProduction:', isProduction);

  return {
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
    isProduction: isProduction,
  };
});
