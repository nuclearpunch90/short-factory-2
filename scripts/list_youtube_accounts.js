import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');

console.log('📊 등록된 YouTube 계정 정보\n');
console.log('━'.repeat(80));

// Load credentials
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

async function getChannelInfo(accountNumber) {
    const tokenPath = path.join(PROJECT_ROOT, `youtube-token-account${accountNumber}.json`);

    if (!fs.existsSync(tokenPath)) {
        return null;
    }

    try {
        const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
        oAuth2Client.setCredentials(token);

        const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

        // Get channel info
        const response = await youtube.channels.list({
            part: 'snippet,contentDetails,statistics',
            mine: true
        });

        if (response.data.items && response.data.items.length > 0) {
            const channel = response.data.items[0];
            return {
                title: channel.snippet.title,
                customUrl: channel.snippet.customUrl || 'N/A',
                channelId: channel.id,
                subscriberCount: channel.statistics.subscriberCount || '0',
                videoCount: channel.statistics.videoCount || '0'
            };
        }
        return null;
    } catch (error) {
        return { error: error.message };
    }
}

// Process all accounts
(async () => {
    for (let i = 1; i <= 8; i++) {
        const info = await getChannelInfo(i);

        if (!info) {
            console.log(`Account ${i}: ⬜ 미등록`);
        } else if (info.error) {
            console.log(`Account ${i}: ⚠️  에러 - ${info.error}`);
        } else {
            console.log(`Account ${i}: ✅ ${info.title}`);
            console.log(`           채널 ID: ${info.channelId}`);
            console.log(`           URL: https://youtube.com/${info.customUrl}`);
            console.log(`           구독자: ${parseInt(info.subscriberCount).toLocaleString()}명 | 영상: ${info.videoCount}개`);
        }
        console.log('━'.repeat(80));
    }
})();
