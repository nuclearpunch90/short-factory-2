import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import AccountManager from './account_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');

async function processOAuthCode(authCode, accountId, accountName) {
    const tokenFile = `youtube-token-${accountId}.json`;
    const tokenPath = path.join(PROJECT_ROOT, tokenFile);

    console.log(`\n🔐 Processing OAuth code for ${accountId}`);
    console.log(`📁 Token will be saved to: ${tokenFile}`);
    console.log(`✅ Account name: ${accountName}\n`);

    // Load credentials
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error(`❌ client_secret.json not found at ${CREDENTIALS_PATH}`);
        process.exit(1);
    }

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
        // Exchange code for tokens
        console.log('🔄 Exchanging code for tokens...');
        const { tokens } = await oAuth2Client.getToken(authCode);
        oAuth2Client.setCredentials(tokens);

        // Save token file
        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
        console.log(`✅ Token saved to: ${tokenFile}`);

        // Add to account manager
        const manager = new AccountManager();
        manager.addAccount(accountId, accountName, tokenFile);

        console.log(`\n🎉 Successfully added ${accountId}: ${accountName}`);
        console.log('\n📊 Updated account list:');
        manager.displayStats();

        return true;
    } catch (err) {
        console.error('❌ Error getting tokens:', err.message);
        process.exit(1);
    }
}

// Parse arguments
const args = process.argv.slice(2);
if (args.length < 3) {
    console.error('Usage: node process_oauth_code.js <auth_code> <account_id> <account_name>');
    process.exit(1);
}

const [authCode, accountId, accountName] = args;
processOAuthCode(authCode, accountId, accountName);
