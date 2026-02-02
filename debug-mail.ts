
import { DataSource } from 'typeorm';
import { User } from './src/database/entities/user.entity';
import * as nodemailer from 'nodemailer';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.join(__dirname, '.env') });

async function debug() {
  console.log('--- Debugging Forgot Password ---');
  
  // 1. Check DB Connection and User
  console.log('Checking database...');
  const AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [User],
    synchronize: false,
  });

  try {
    await AppDataSource.initialize();
    console.log('Database connected.');

    const email = 'linggaept@gmail.com';
    const user = await AppDataSource.getRepository(User).findOne({ where: { email } });

    if (user) {
      console.log(`User found: ${user.email} (ID: ${user.id})`);
    } else {
      console.log(`User NOT found: ${email}`);
      console.log('This is why the email is not sending (Application Logic).');
      process.exit(0);
    }
    
    await AppDataSource.destroy();
  } catch (error) {
    console.error('Database error:', error);
  }

  // 2. Check SMTP Config
  console.log('\nChecking SMTP Config...');
  console.log('Host:', process.env.MAIL_HOST);
  console.log('Port:', process.env.MAIL_PORT);
  console.log('User:', process.env.MAIL_USER);
  console.log('Pass:', process.env.MAIL_PASS ? '******' : 'MISSING');
  console.log('From:', process.env.MAIL_FROM);

  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.error('SMTP Credentials missing in .env');
      return;
  }

  // 3. Try Sending Test Email
  console.log('\nAsserting SMTP connection and sending test email...');
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_PORT || '587') || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
  
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: 'linggaept@gmail.com',
      subject: 'Debug Test Email - Waspread',
      text: 'If you receive this, SMTP is working correctly.',
      html: '<b>If you receive this, SMTP is working correctly.</b>',
    });

    console.log('Message sent: %s', info.messageId);
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

debug();
