import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'outputs');
const COOKIES_PATH = path.join(PROJECT_ROOT, 'instagram-cookies.json');

/**
 * Find all videos in outputs folder
 */
function findAllVideos() {
    const videos = [];
    const folders = fs.readdirSync(OUTPUTS_DIR).filter(item => {
        const fullPath = path.join(OUTPUTS_DIR, item);
        return fs.statSync(fullPath).isDirectory() && !item.startsWith('.');
    });

    for (const folder of folders) {
        const folderPath = path.join(OUTPUTS_DIR, folder);
        const files = fs.readdirSync(folderPath);

        for (const file of files) {
            if (file.endsWith('.mp4')) {
                const videoPath = path.join(folderPath, file);
                const infoPath = path.join(folderPath, 'info.txt');

                let title = path.basename(file, '.mp4');
                let description = '';
                let hashtags = '';

                // Read info.txt for metadata
                if (fs.existsSync(infoPath)) {
                    try {
                        const infoContent = fs.readFileSync(infoPath, 'utf8');
                        const lines = infoContent.split('\n');

                        for (const line of lines) {
                            if (line.startsWith('제목:')) {
                                title = line.replace('제목:', '').trim();
                            } else if (line.startsWith('설명:')) {
                                description = line.replace('설명:', '').trim();
                            } else if (line.startsWith('#')) {
                                hashtags += line.trim() + ' ';
                            }
                        }
                    } catch (err) {
                        console.error(`⚠️  info.txt 읽기 실패: ${folder}`);
                    }
                }

                // Build Instagram caption
                const caption = `${title}\n\n${description}\n\n${hashtags}`.trim();

                videos.push({
                    path: videoPath,
                    folder: folder,
                    title: title,
                    caption: caption
                });
            }
        }
    }

    return videos;
}

/**
 * Upload a single video to Instagram Reels
 */
async function uploadToInstagram(page, video, index, total) {
    try {
        console.log(`\n${'━'.repeat(80)}`);
        console.log(`📤 업로드 중 [${index}/${total}]`);
        console.log('━'.repeat(80));
        console.log(`제목: ${video.title}`);
        console.log(`비디오: ${path.basename(video.path)}`);
        console.log(`폴더: ${video.folder}`);

        // Navigate to Instagram
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(2000);

        // Click on "Create" button (+ icon)
        console.log('📸 Create 버튼 클릭...');
        const createButton = await page.$('svg[aria-label="New post"], a[href="#"]');
        if (createButton) {
            await createButton.click();
        } else {
            // Try alternative selector
            await page.click('a[href="#"]');
        }
        await delay(2000);

        // Upload file
        console.log('📁 파일 선택...');
        const fileInput = await page.$('input[type="file"]');
        if (!fileInput) {
            throw new Error('파일 업로드 입력을 찾을 수 없습니다');
        }

        await fileInput.uploadFile(video.path);
        await delay(3000);

        // Click "Next" button
        console.log('➡️  다음 단계...');
        await clickButtonByText(page, 'Next');
        await delay(2000);

        // Click "Next" again (filters page)
        await clickButtonByText(page, 'Next');
        await delay(2000);

        // Add caption
        console.log('✍️  캡션 입력...');
        const captionTextarea = await page.$('textarea[aria-label*="caption"], textarea[placeholder*="Write a caption"]');
        if (captionTextarea) {
            await captionTextarea.type(video.caption);
        }
        await delay(1000);

        // Click "Share" button
        console.log('🚀 게시 중...');
        await clickButtonByText(page, 'Share');
        await delay(5000);

        // Wait for success
        console.log('✅ 업로드 완료!');
        await delay(3000);

        return true;
    } catch (error) {
        console.error(`❌ 업로드 실패: ${error.message}`);
        return false;
    }
}

/**
 * Click button by text content
 */
async function clickButtonByText(page, text) {
    const buttons = await page.$$('button');
    for (const button of buttons) {
        const buttonText = await page.evaluate(el => el.textContent, button);
        if (buttonText.includes(text)) {
            await button.click();
            return true;
        }
    }
    return false;
}

/**
 * Delay helper
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Save cookies
 */
async function saveCookies(page) {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log('🍪 쿠키 저장 완료');
}

/**
 * Load cookies
 */
async function loadCookies(page) {
    if (fs.existsSync(COOKIES_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
        await page.setCookie(...cookies);
        console.log('🍪 쿠키 로드 완료');
        return true;
    }
    return false;
}

/**
 * Main batch upload function
 */
async function batchUpload() {
    console.log('🔍 outputs 폴더에서 비디오 검색 중...\n');

    const videos = findAllVideos();

    if (videos.length === 0) {
        console.log('❌ 업로드할 비디오를 찾을 수 없습니다.');
        return;
    }

    console.log(`✅ ${videos.length}개의 비디오를 찾았습니다.\n`);

    // Display video list
    console.log('📋 업로드 예정 비디오:');
    videos.forEach((video, idx) => {
        console.log(`   ${idx + 1}. ${video.title}`);
    });
    console.log('');

    // Parse command line arguments
    const args = process.argv.slice(2);
    let headless = true;
    let limit = videos.length;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--headless') headless = args[i + 1] !== 'false';
        if (args[i] === '--limit') limit = parseInt(args[i + 1]) || limit;
    }

    const videosToUpload = videos.slice(0, limit);

    console.log('━'.repeat(80));
    console.log(`📱 Instagram Reels 업로드 시작 (${videosToUpload.length}개)`);
    console.log(`🖥️  Headless 모드: ${headless ? 'ON' : 'OFF'}`);
    console.log('━'.repeat(80));
    console.log('');

    // Launch browser
    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
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
        // Load cookies if available
        const cookiesLoaded = await loadCookies(page);

        // Navigate to Instagram
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(3000);

        // Check if logged in
        const isLoggedIn = await page.$('svg[aria-label="Home"]') !== null;

        if (!isLoggedIn) {
            console.log('⚠️  로그인이 필요합니다!');
            console.log('');
            console.log('브라우저에서 Instagram에 로그인해주세요.');
            console.log('로그인 후 아무 키나 누르면 계속됩니다...');

            // Wait for user to login manually
            await new Promise(resolve => {
                process.stdin.once('data', () => resolve());
            });

            // Save cookies after login
            await saveCookies(page);
            console.log('✅ 로그인 완료!\n');
        } else {
            console.log('✅ 이미 로그인되어 있습니다.\n');
        }

        // Upload videos
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < videosToUpload.length; i++) {
            const success = await uploadToInstagram(page, videosToUpload[i], i + 1, videosToUpload.length);

            if (success) {
                successCount++;
            } else {
                failCount++;
            }

            // Delay between uploads
            if (i < videosToUpload.length - 1) {
                console.log(`\n⏳ 다음 업로드까지 10초 대기...\n`);
                await delay(10000);
            }
        }

        // Summary
        console.log('\n' + '━'.repeat(80));
        console.log('📊 업로드 완료');
        console.log('━'.repeat(80));
        console.log(`✅ 성공: ${successCount}개`);
        console.log(`❌ 실패: ${failCount}개`);
        console.log(`📝 전체: ${videosToUpload.length}개`);
        console.log('━'.repeat(80));

    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
    } finally {
        await browser.close();
    }
}

// Run batch upload
batchUpload().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
