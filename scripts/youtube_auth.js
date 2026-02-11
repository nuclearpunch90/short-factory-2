import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
];
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');

// Parse command line arguments
const args = process.argv.slice(2);
let accountNumber = null;
let authCode = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--account') accountNumber = args[i + 1];
    if (args[i] === '--code') authCode = args[i + 1];
}

if (!accountNumber) {
    console.error('❌ 계정 번호를 지정해주세요.');
    console.log('\n사용법:');
    console.log('  node scripts/youtube_auth.js --account <숫자> [--code <인증코드>]');
    console.log('\n예시:');
    console.log('  node scripts/youtube_auth.js --account 2');
    console.log('  node scripts/youtube_auth.js --account 2 --code "4/0ASc3..."');
    process.exit(1);
}

const TOKEN_PATH = path.join(PROJECT_ROOT, `youtube-token-account${accountNumber}.json`);

// Load credentials
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

if (authCode) {
    // Use provided auth code
    console.log(`🔐 Account ${accountNumber} 인증 중...`);
    oAuth2Client.getToken(authCode, (err, token) => {
        if (err) {
            console.error('❌ 토큰 생성 실패:', err.message);
            process.exit(1);
        }

        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
        console.log(`✅ Account ${accountNumber} 토큰 저장 완료!`);
        console.log(`📁 파일: ${TOKEN_PATH}`);
        process.exit(0);
    });
} else {
    // Generate auth URL
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });

    console.log(`\n🔗 Account ${accountNumber} 인증 URL:`);
    console.log(authUrl);
    console.log('\n📝 다음 단계:');
    console.log('1. 위 URL을 브라우저에서 열기');
    console.log(`2. Account ${accountNumber}로 사용할 Google 계정 선택`);
    console.log('3. 권한 승인');
    console.log('4. 리다이렉트 URL 복사 후 아래 명령어 실행:\n');
    console.log(`   node scripts/youtube_auth.js --account ${accountNumber} --code "인증코드"\n`);
}
