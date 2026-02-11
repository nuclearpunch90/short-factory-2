import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const TOKEN_PATH = path.join(PROJECT_ROOT, 'youtube-token.json');
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');

// Load credentials
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oAuth2Client.setCredentials(token);

const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

// Get info about the uploaded test video to identify the channel
const videoId = 'j9zn7QEpxhc'; // The test video we just uploaded

youtube.videos.list({
    part: 'snippet',
    id: videoId
}, (err, res) => {
    if (err) {
        console.error('Error fetching video info:', err.message);
        return;
    }

    if (!res.data.items || res.data.items.length === 0) {
        console.log('Video not found.');
        return;
    }

    const video = res.data.items[0];

    console.log('\n=== 연결된 YouTube 채널 정보 ===\n');
    console.log(`채널명: ${video.snippet.channelTitle}`);
    console.log(`채널 ID: ${video.snippet.channelId}`);
    console.log(`채널 URL: https://www.youtube.com/channel/${video.snippet.channelId}`);
    console.log('\n업로드된 테스트 비디오:');
    console.log(`  제목: ${video.snippet.title}`);
    console.log(`  URL: https://www.youtube.com/watch?v=${videoId}`);
    console.log('\n===============================\n');
});
