import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILES_DIR = path.join(__dirname, '..', '.instagram-profiles');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openProfile(accountNum) {
    const profilePath = path.join(PROFILES_DIR, `account${accountNum}`);
    console.log(`프로필 ${accountNum} 브라우저 연결 중... (${profilePath})`);

    puppeteer.launch({
        headless: false,
        userDataDir: profilePath,
        args: [
            '--window-size=1280,800',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        defaultViewport: null
    }).then(async browser => {
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();
        await page.goto('https://www.instagram.com/');
        console.log(`✅ [account${accountNum}] 브라우저 창이 열렸습니다. 로그인을 완료해주세요!`);
    }).catch(err => {
        console.error(`❌ 프로필 ${accountNum} 열기 실패:`, err.message);
    });
}

async function main() {
    console.log('--- 14~18번 프로필 로그인 화면 열기 시작 ---');
    for (let i = 14; i <= 18; i++) {
        openProfile(i);
        await delay(2000);
    }
    console.log('✅ 브라우저들이 열리면 각 계정에 로그인해주세요.');
}

main();
