import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const COORDS_FILE = path.join(PROJECT_ROOT, 'instagram-click-coords.json');
const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'outputs');

/**
 * Setup mode: Record click coordinates for Instagram Reels upload
 */
async function setupClickCoordinates() {
    console.log('━'.repeat(80));
    console.log('📋 Instagram Reels 클릭 좌표 설정 모드');
    console.log('━'.repeat(80));
    console.log('');
    console.log('이 모드에서는 Instagram Reels 업로드 시 필요한 클릭 좌표를 기록합니다.');
    console.log('');
    console.log('진행 순서:');
    console.log('1. 브라우저가 열리고 Instagram 자르기 화면까지 자동으로 이동');
    console.log('2. 화면이 빨간색 오버레이로 변경됨 (클릭 감지 모드)');
    console.log('3. 왼쪽 하단의 "비율 변경 버튼" 클릭');
    console.log('4. 메뉴에서 "9:16" 버튼 클릭');
    console.log('5. 좌표가 자동으로 저장됨');
    console.log('');
    console.log('━'.repeat(80));
    console.log('');

    // Find a test video
    const testVideo = findTestVideo();
    if (!testVideo) {
        console.error('❌ outputs 폴더에 테스트용 비디오를 찾을 수 없습니다.');
        return;
    }

    console.log(`✅ 테스트 비디오: ${testVideo}`);
    console.log('');
    console.log('🚀 브라우저 실행 중...');
    console.log('');

    // Launch browser
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1280,900'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    try {
        // Navigate to Instagram first
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(2000);

        // Load cookies from any available account
        const cookieFiles = fs.readdirSync(PROJECT_ROOT).filter(f => f.startsWith('instagram-cookies-') && f.endsWith('.json'));
        let cookiesLoaded = false;

        if (cookieFiles.length > 0) {
            const COOKIES_PATH = path.join(PROJECT_ROOT, cookieFiles[0]);
            try {
                const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
                await page.setCookie(...cookies);
                console.log(`✅ 쿠키 로드: ${cookieFiles[0]}`);

                // Reload page to apply cookies
                console.log('🔄 페이지 새로고침 중...');
                await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
                await delay(3000);

                cookiesLoaded = true;
                console.log('✅ 쿠키 적용 완료');
            } catch (e) {
                console.log('⚠️  쿠키 로드 실패');
            }
        }

        // Check if logged in only if cookies were not loaded
        if (!cookiesLoaded) {
            let isLoggedIn = false;
            try {
                isLoggedIn = await page.evaluate(() => {
                    // Check for various logged-in indicators
                    const homeIcon = document.querySelector('svg[aria-label="홈"], svg[aria-label="Home"]');
                    const newPostIcon = document.querySelector('svg[aria-label="새로운 게시물"], svg[aria-label="New post"]');
                    const searchIcon = document.querySelector('svg[aria-label="검색"], svg[aria-label="Search"]');

                    return homeIcon !== null || newPostIcon !== null || searchIcon !== null;
                });
            } catch (e) {
                isLoggedIn = false;
            }

            if (!isLoggedIn) {
                console.log('');
                console.log('⚠️  Instagram 로그인 확인');
                console.log('━'.repeat(80));
                console.log('브라우저에서 Instagram에 로그인해주세요.');
                console.log('로그인 완료 후 Enter 키를 누르면 계속됩니다...');
                console.log('━'.repeat(80));
                console.log('');
                await waitForEnter();
                console.log('✅ 로그인 확인 완료!');
                console.log('');
            } else {
                console.log('✅ 로그인 확인 완료!');
                console.log('');
            }
        } else {
            console.log('✅ 쿠키 세션 사용!');
            console.log('');
        }

        // Click Create button
        console.log('📸 Create 버튼 클릭...');
        const createBtn = await page.$('svg[aria-label="새로운 게시물"], svg[aria-label="New post"]');
        if (createBtn) {
            await createBtn.click();
            await delay(2000);
        }

        // Upload file
        console.log('📤 파일 업로드...');
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            await fileInput.uploadFile(testVideo);
            await delay(5000);
        }

        // Close popups
        console.log('📋 팝업 닫기...');
        await page.keyboard.press('Escape');
        await delay(1500);
        await page.mouse.click(100, 450);
        await delay(1500);

        // Wait for crop screen
        console.log('⏳ 자르기 화면 로딩 대기...');
        try {
            await page.waitForFunction(() => {
                const allText = Array.from(document.querySelectorAll('*'))
                    .map(el => el.textContent?.trim())
                    .filter(text => text && text.length < 20);
                return allText.some(text => text === '자르기' || text.includes('Crop'));
            }, { timeout: 15000 });
            console.log('✅ 자르기 화면 로드 완료!');
        } catch (e) {
            console.log('⚠️  자르기 화면 감지 실패, 계속 진행...');
        }

        await delay(2000);

        // NOW: Setup click recording
        console.log('');
        console.log('━'.repeat(80));
        console.log('🎯 클릭 좌표 기록 모드 시작');
        console.log('━'.repeat(80));
        console.log('');
        console.log('브라우저에서 원하는 만큼 클릭하세요.');
        console.log('');
        console.log('추천 순서:');
        console.log('1. 비율 변경 버튼');
        console.log('2. 9:16 선택');
        console.log('3. 다음 버튼 (자르기)');
        console.log('4. 다음 버튼 (필터)');
        console.log('5. 기타 필요한 버튼들...');
        console.log('');
        console.log('━'.repeat(80));
        console.log('✋ 녹화를 종료하려면 터미널에서 Enter 키를 누르세요');
        console.log('━'.repeat(80));
        console.log('');

        // Start click recording in browser
        await page.evaluate(() => {
            window.recordedClicks = [];
            let clickCount = 0;

            // Add red overlay to indicate recording mode
            const overlay = document.createElement('div');
            overlay.id = 'click-recorder-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 0, 0, 0.1);
                pointer-events: none;
                z-index: 999999;
                border: 3px solid red;
            `;
            document.body.appendChild(overlay);

            // Add instruction text
            const instruction = document.createElement('div');
            instruction.id = 'click-recorder-instruction';
            instruction.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(255, 0, 0, 0.9);
                color: white;
                padding: 15px 30px;
                border-radius: 10px;
                font-size: 18px;
                font-weight: bold;
                z-index: 1000000;
                text-align: center;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            `;
            instruction.textContent = '🎯 클릭 기록 중... 0개 기록됨';
            document.body.appendChild(instruction);

            // Record clicks
            const clickHandler = (e) => {
                clickCount++;
                window.recordedClicks.push({
                    x: e.clientX,
                    y: e.clientY,
                    target: e.target.tagName,
                    timestamp: Date.now()
                });

                console.log(`클릭 ${clickCount}: (${e.clientX}, ${e.clientY})`);
                instruction.textContent = `🎯 클릭 기록 중... ${clickCount}개 기록됨`;
            };

            document.addEventListener('click', clickHandler);
            window.clickRecorderHandler = clickHandler;
        });

        console.log('클릭 기록 시작! 브라우저에서 클릭하세요...');
        console.log('');

        // Wait for user to press Enter
        await waitForEnter();

        // Stop recording and get clicks
        const clicks = await page.evaluate(() => {
            // Remove event listener
            if (window.clickRecorderHandler) {
                document.removeEventListener('click', window.clickRecorderHandler);
            }

            // Update UI
            const instruction = document.getElementById('click-recorder-instruction');
            if (instruction) {
                instruction.textContent = '✅ 녹화 종료! 저장 중...';
                instruction.style.background = 'rgba(0, 255, 0, 0.9)';
            }

            return window.recordedClicks || [];
        });

        console.log('');
        console.log('━'.repeat(80));
        console.log('📊 기록된 클릭 좌표:');
        console.log('━'.repeat(80));

        if (clicks.length === 0) {
            console.log('❌ 클릭이 기록되지 않았습니다.');
            console.log('');
        } else {
            clicks.forEach((click, i) => {
                console.log(`${i + 1}. (${click.x}, ${click.y}) - ${click.target}`);
            });

            // Save all clicks
            const coords = {
                clicks: clicks.map((click, i) => ({
                    index: i,
                    x: click.x,
                    y: click.y,
                    target: click.target
                })),
                recordedAt: new Date().toISOString(),
                screenSize: { width: 1280, height: 900 },
                totalClicks: clicks.length
            };

            fs.writeFileSync(COORDS_FILE, JSON.stringify(coords, null, 2));
            console.log('');
            console.log('✅ 좌표가 저장되었습니다:');
            console.log(`   ${COORDS_FILE}`);
            console.log(`   총 ${clicks.length}개 클릭 기록됨`);
            console.log('');
            console.log('이제 일반 업로드 시 이 좌표를 사용합니다!');
        }

    } catch (error) {
        console.error('❌ 오류:', error.message);
    } finally {
        console.log('');
        console.log('브라우저를 5초 후 닫습니다...');
        await delay(5000);
        await browser.close();
    }
}

function findTestVideo() {
    if (!fs.existsSync(OUTPUTS_DIR)) return null;

    const folders = fs.readdirSync(OUTPUTS_DIR).filter(item => {
        const fullPath = path.join(OUTPUTS_DIR, item);
        return fs.statSync(fullPath).isDirectory() && !item.startsWith('.');
    });

    for (const folder of folders) {
        const folderPath = path.join(OUTPUTS_DIR, folder);
        const files = fs.readdirSync(folderPath);

        for (const file of files) {
            if (file.endsWith('.mp4')) {
                return path.join(folderPath, file);
            }
        }
    }

    return null;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForEnter() {
    return new Promise(resolve => {
        process.stdin.once('data', () => resolve());
    });
}

// Run setup
setupClickCoordinates().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
