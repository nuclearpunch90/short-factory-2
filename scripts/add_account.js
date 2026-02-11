import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import AccountManager from './account_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');

/**
 * Add a new YouTube account
 */
async function addAccount() {
    const manager = new AccountManager();

    // Get next account ID
    const accountId = manager.getNextAccountId();
    const tokenFile = `youtube-token-${accountId}.json`;
    const tokenPath = path.join(PROJECT_ROOT, tokenFile);

    console.log(`\n🔐 Adding ${accountId}`);
    console.log('━'.repeat(50));

    // Ask for account name
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const accountName = await new Promise((resolve) => {
        rl.question(`Enter a friendly name for this account (e.g., "My Channel 3"): `, resolve);
    });
    rl.close();

    if (!accountName.trim()) {
        console.error('❌ Account name cannot be empty');
        process.exit(1);
    }

    console.log(`\n✅ Account name: ${accountName}`);
    console.log(`📁 Token will be saved to: ${tokenFile}\n`);

    // Load credentials
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error(`❌ client_secret.json not found at ${CREDENTIALS_PATH}`);
        process.exit(1);
    }

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Generate auth URL
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.upload'],
    });

    console.log('🌐 Please authorize this account by visiting this URL:\n');
    console.log(authUrl);
    console.log('');

    // Get auth code
    const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const code = await new Promise((resolve) => {
        rl2.question('Enter the authorization code from the URL: ', resolve);
    });
    rl2.close();

    if (!code.trim()) {
        console.error('❌ Authorization code cannot be empty');
        process.exit(1);
    }

    try {
        // Exchange code for tokens
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);

        // Save token file
        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
        console.log(`\n✅ Token saved to: ${tokenFile}`);

        // Add to account manager
        manager.addAccount(accountId, accountName, tokenFile);

        console.log(`\n🎉 Successfully added ${accountId}: ${accountName}`);
        console.log('\n📊 Updated account list:');
        manager.displayStats();

    } catch (err) {
        console.error('❌ Error getting tokens:', err.message);
        process.exit(1);
    }
}

// Run the script
addAccount().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
