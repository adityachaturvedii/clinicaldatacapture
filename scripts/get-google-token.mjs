#!/usr/bin/env node
/**
 * Helper script to obtain Google OAuth2 refresh token for Sheets API access.
 *
 * Usage:
 *   1. Create OAuth 2.0 Desktop credentials in Google Cloud Console
 *   2. Run from backend folder: node ../scripts/get-google-token.mjs <client_id> <client_secret>
 *   3. Open the URL in your browser and authorize
 *   4. Paste the authorization code when prompted
 *   5. Copy the refresh_token to your .env file
 */

import { google } from 'googleapis';
import * as readline from 'node:readline';

const clientId = process.argv[2];
const clientSecret = process.argv[3];

if (!clientId || !clientSecret) {
  console.log('Usage: node ../scripts/get-google-token.mjs <client_id> <client_secret>');
  console.log('\nRun this from the backend/ directory.');
  console.log('Get credentials from Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client IDs');
  process.exit(1);
}

// Use out-of-band redirect for desktop apps
const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  'http://localhost'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/spreadsheets'],
  prompt: 'consent',
});

console.log('\n=== Google Sheets OAuth Setup ===\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Sign in and authorize the application.');
console.log('3. You will be redirected to localhost (it will fail to load - that is OK).');
console.log('4. Copy the "code" value from the URL bar.');
console.log('   Example: http://localhost/?code=4/0AXXXXXX...&scope=...');
console.log('   Copy everything between "code=" and "&scope"\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Paste the authorization code here: ', async (code) => {
  rl.close();

  try {
    const { tokens } = await oauth2Client.getToken(decodeURIComponent(code.trim()));
    console.log('\n=== SUCCESS ===\n');
    console.log('Add these to your backend/.env file:\n');
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\nMake sure GOOGLE_USE_ADC=false is set.');
  } catch (error) {
    console.error('\nError getting tokens:', error.message);
    process.exit(1);
  }
});
