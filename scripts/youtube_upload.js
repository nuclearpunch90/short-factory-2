import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first time.
const TOKEN_PATH = path.join(PROJECT_ROOT, 'youtube-token.json');
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    // Check if auth code was provided as command line argument
    const args = process.argv.slice(2);
    let authCode = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--code') authCode = args[i + 1];
    }

    if (authCode) {
        // Use provided auth code directly
        console.log('Using provided authorization code...');
        oAuth2Client.getToken(authCode, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
        return;
    }

    // Original interactive flow
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

/**
 * Detects which account number is currently active by comparing token files
 */
function detectCurrentAccount() {
    try {
        const currentToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

        for (let i = 1; i <= 8; i++) {
            const accountTokenPath = path.join(PROJECT_ROOT, `youtube-token-account${i}.json`);
            if (fs.existsSync(accountTokenPath)) {
                const accountToken = JSON.parse(fs.readFileSync(accountTokenPath, 'utf8'));
                // Compare refresh tokens as they are unique per account
                if (currentToken.refresh_token === accountToken.refresh_token) {
                    return i;
                }
            }
        }
        return null; // No match found
    } catch (error) {
        return null;
    }
}

/**
 * Uploads a video to YouTube.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function uploadVideo(auth) {
    const youtube = google.youtube({ version: 'v3', auth });

    // Parse command line arguments
    const args = process.argv.slice(2);
    let filePath = '';
    let title = '';
    let description = '';
    let privacyStatus = 'private'; // default

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--file') filePath = args[i + 1];
        if (args[i] === '--title') title = args[i + 1];
        if (args[i] === '--desc') description = args[i + 1];
        if (args[i] === '--privacy') privacyStatus = args[i + 1];
    }

    if (!filePath) {
        console.error('Error: Please provide a file path using --file');
        console.log('Usage: node scripts/youtube_upload.js --file <path> [--title <title>] [--desc <description>] [--privacy <private|unlisted|public>]');
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found at ${filePath}`);
        process.exit(1);
    }

    // Try to read info.txt from the same directory as the video file
    const videoDir = path.dirname(filePath);
    const infoFilePath = path.join(videoDir, 'info.txt');

    if (fs.existsSync(infoFilePath)) {
        try {
            const infoContent = fs.readFileSync(infoFilePath, 'utf8');
            const lines = infoContent.split('\n').map(line => line.trim()).filter(line => line);

            // Parse info.txt format:
            // 제목: <title>
            // 설명: <description>
            for (const line of lines) {
                if (line.startsWith('제목:') && !title) {
                    title = line.replace('제목:', '').trim();
                    console.log(`📄 Loaded title from info.txt: ${title}`);
                } else if (line.startsWith('설명:') && !description) {
                    description = line.replace('설명:', '').trim();
                    console.log(`📄 Loaded description from info.txt: ${description}`);
                }
            }
        } catch (err) {
            console.warn(`⚠️  Could not read info.txt: ${err.message}`);
        }
    }

    // Fallback to filename if title still not set
    if (!title) {
        title = path.basename(filePath, path.extname(filePath));
    }

    // Detect current account
    const currentAccount = detectCurrentAccount();
    const accountDisplay = currentAccount ? `Account ${currentAccount}` : '알 수 없음 (youtube-token.json)';

    // Display upload information
    console.log('\n📋 업로드 정보 확인');
    console.log('━'.repeat(80));
    console.log(`계정: ${accountDisplay}`);
    console.log(`비디오: ${filePath}`);
    console.log(`제목: ${title}`);
    console.log(`설명: ${description || '(없음)'}`);
    console.log(`공개 설정: ${privacyStatus}`);
    console.log('━'.repeat(80));

    // Prompt for confirmation
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('\n업로드를 진행하시겠습니까? (y/n): ', (answer) => {
        rl.close();

        if (answer.toLowerCase() !== 'y') {
            console.log('\n❌ 업로드가 취소되었습니다.');
            process.exit(0);
        }

        console.log('\n⏫ 업로드를 시작합니다...\n');

        const fileSize = fs.statSync(filePath).size;

        youtube.videos.insert(
        {
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title: title,
                    description: description,
                    tags: ['shorts', 'api_upload'], // You can add dynamic tags if needed
                },
                status: {
                    privacyStatus: privacyStatus,
                },
            },
            media: {
                body: fs.createReadStream(filePath),
            },
        },
        {
            // Use the `onUploadProgress` event from axios if available, but googleapis handles it differently.
            // We can use a custom request setup or just wait.
            // For simple feedback, we can just await the result.
        },
        (err, res) => {
            if (err) {
                console.error('The API returned an error: ' + err);
                return;
            }
            console.log('Video uploaded successfully!');
            console.log('Video ID:', res.data.id);
            console.log('Watch URL: https://www.youtube.com/watch?v=' + res.data.id);
        }
    );
    });
}

// Load client secrets from a local file.
fs.readFile(CREDENTIALS_PATH, (err, content) => {
    if (err) {
        console.log('Error loading client secret file:', err);
        console.log(`Please ensure you have placed 'client_secret.json' in ${PROJECT_ROOT}`);
        return;
    }
    // Authorize a client with credentials, then call the YouTube API.
    authorize(JSON.parse(content), uploadVideo);
});
