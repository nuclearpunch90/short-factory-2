import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import AccountManager from './account_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');

/**
 * Test upload for accounts 3-8 without incrementing counter
 */
async function testAccounts() {
    const manager = new AccountManager();
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

    // Find a test video
    const args = process.argv.slice(2);
    let testVideoPath = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--file') {
            testVideoPath = args[i + 1];
        }
    }

    if (!testVideoPath || !fs.existsSync(testVideoPath)) {
        console.error('❌ Please provide a test video file with --file');
        console.log('Usage: node scripts/test_accounts.js --file <path_to_test_video>');
        process.exit(1);
    }

    console.log('\n🧪 Testing Accounts 3-8 (Private, No Counter Update)\n');
    console.log('='.repeat(60));

    const accountsToTest = ['account3', 'account4', 'account5', 'account6', 'account7', 'account8'];
    const results = [];

    for (const accountId of accountsToTest) {
        console.log(`\n📤 Uploading to ${accountId}...`);

        try {
            const account = manager.getAccount(accountId);
            const tokenPath = path.join(PROJECT_ROOT, account.token_file);

            if (!fs.existsSync(tokenPath)) {
                console.log(`   ⚠️  Token file not found: ${account.token_file}`);
                continue;
            }

            const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
            oAuth2Client.setCredentials(token);

            const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

            const videoTitle = `Test Upload - ${account.name}`;
            const videoDescription = 'Test upload - DO NOT COUNT';

            const result = await new Promise((resolve, reject) => {
                youtube.videos.insert(
                    {
                        part: 'snippet,status',
                        requestBody: {
                            snippet: {
                                title: videoTitle,
                                description: videoDescription,
                                tags: ['test', 'do_not_count'],
                            },
                            status: {
                                privacyStatus: 'private',
                            },
                        },
                        media: {
                            body: fs.createReadStream(testVideoPath),
                        },
                    },
                    (err, res) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(res.data);
                    }
                );
            });

            const videoId = result.id;
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

            console.log(`   ✅ Success!`);
            console.log(`   📹 Video ID: ${videoId}`);
            console.log(`   🔗 URL: ${videoUrl}`);
            console.log(`   ⚠️  Counter NOT updated (test upload)`);

            results.push({
                accountId,
                accountName: account.name,
                videoId,
                videoUrl,
                success: true
            });

        } catch (err) {
            console.log(`   ❌ Failed: ${err.message}`);
            results.push({
                accountId,
                success: false,
                error: err.message
            });
        }
    }

    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 Test Upload Summary');
    console.log('='.repeat(60));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`Total tested: ${accountsToTest.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
        console.log('\n✅ Successful uploads:');
        for (const result of successful) {
            console.log(`   - ${result.accountName}: ${result.videoUrl}`);
        }
    }

    if (failed.length > 0) {
        console.log('\n❌ Failed uploads:');
        for (const result of failed) {
            console.log(`   - ${result.accountId}: ${result.error}`);
        }
    }

    console.log('\n⚠️  REMINDER: Upload counters were NOT updated for these test uploads');
    console.log('');
}

testAccounts().catch(err => {
    console.error('\n❌ Error:', err);
    process.exit(1);
});
