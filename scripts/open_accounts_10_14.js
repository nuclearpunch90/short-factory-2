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
        console.log(`✅ [account${accountNum}] 브라우저 창이 열렸습니다. (수동 확인/로그인용)`);
    }).catch(err => {
        console.error(`❌ 프로필 ${accountNum} 열기 실패:`, err.message);
    });
}

async function main() {
    console.log('--- 10~14번 프로필 브라우저 열기 시작 ---');
    for (let i = 10; i <= 14; i++) {
        openProfile(i);
        await delay(2000); // 창들이 한 번에 뜨면 겹치므로 약간의 텀을 둡니다.
    }
    console.log('✅ 모든 프로필 실행 명령 전달이 완료되었습니다.');
    console.log('브라우저 창이 열리면 수동으로 인스타그램 연결 상태(로그인 유지 등)를 확인할 수 있습니다.');
}

main();
