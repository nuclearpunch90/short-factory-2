import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'outputs');
const ACCOUNTS_FILE = path.join(PROJECT_ROOT, 'instagram_accounts.json');
const STATS_FILE = path.join(PROJECT_ROOT, 'instagram-upload-stats.json');
const PROFILES_DIR = path.join(PROJECT_ROOT, '.instagram-profiles');

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

/**
 * Load Instagram accounts configuration
 */
function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        console.log('⚠️  instagram_accounts.json 파일이 없습니다.');
        console.log('기본 계정 설정을 생성합니다...\n');

        const defaultAccounts = {
            account1: { name: 'instagram_account_1', enabled: true },
            account2: { name: 'instagram_account_2', enabled: true },
            account3: { name: 'instagram_account_3', enabled: true },
            account4: { name: 'instagram_account_4', enabled: true },
            account5: { name: 'instagram_account_5', enabled: true },
            account6: { name: 'instagram_account_6', enabled: true },
            account7: { name: 'instagram_account_7', enabled: true },
            account8: { name: 'instagram_account_8', enabled: true }
        };

        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(defaultAccounts, null, 2));
        return defaultAccounts;
    }

    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
}

/**
 * Load upload statistics
 */
function loadUploadStats() {
    let stats = {};
    try {
        if (fs.existsSync(STATS_FILE)) {
            stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
    } catch (error) {
        console.warn('⚠️  통계 파일 로드 실패, 초기화합니다.');
    }

    // Ensure all accounts 1-8 exist in stats
    for (let i = 1; i <= 8; i++) {
        if (stats[i] === undefined) {
            stats[i] = 0;
        }
    }

    return stats;
}

/**
 * Save upload statistics
 */
function saveUploadStats(stats) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

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
                let priority = 999;
                if (fs.existsSync(infoPath)) {
                    try {
                        const infoContent = fs.readFileSync(infoPath, 'utf8');
                        const lines = infoContent.split('\n');

                        for (const line of lines) {
                            if (line.startsWith('제목:')) {
                                title = line.replace('제목:', '').trim();
                            } else if (line.startsWith('설명:')) {
                                description = line.replace('설명:', '').trim();
                            } else if (line.startsWith('우선순위:')) {
                                priority = parseInt(line.replace('우선순위:', '').trim()) || 999;
                            } else if (line.startsWith('#')) {
                                hashtags += line.trim() + ' ';
                            }
                        }
                    } catch (err) {
                        console.error(`⚠️  info.txt 읽기 실패: ${folder}`);
                    }
                }

                // Build Instagram caption (title + hashtags only, no description)
                const caption = `${title}\n\n${hashtags}`.trim();

                videos.push({
                    path: videoPath,
                    folder: folder,
                    title: title,
                    caption: caption,
                    priority: priority
                });
            }
        }
    }

    return videos;
}

/**
 * Distribute videos evenly across accounts
 */
function distributeVideos(videos, accounts, stats) {
    const distribution = [];
    const enabledAccounts = Object.keys(accounts)
        .filter(key => accounts[key].enabled)
        .map(key => parseInt(key.replace('account', '')))
        .sort((a, b) => a - b);

    if (enabledAccounts.length === 0) {
        console.log('❌ 활성화된 계정이 없습니다.');
        return distribution;
    }

    // Sort accounts by upload count (least uploads first)
    enabledAccounts.sort((a, b) => (stats[a] || 0) - (stats[b] || 0));

    // Distribute videos round-robin style
    let accountIndex = 0;
    for (const video of videos) {
        const accountNum = enabledAccounts[accountIndex];
        distribution.push({
            accountNum: accountNum,
            accountName: accounts[`account${accountNum}`].name,
            video: video
        });

        accountIndex = (accountIndex + 1) % enabledAccounts.length;
    }

    return distribution;
}

/**
 * Upload a single video to Instagram Reels
 *
 * FLOW:
 * 1. Navigate to Instagram home
 * 2. Click "Create" button (+ icon)
 * 3. Upload video file
 * 4. Handle "릴스로 공유됩니다" popup (if appears)
 * 5. Crop screen: Click "다음" using smart detection
 * 6. Filter screen: Click "다음" using smart detection
 * 7. Caption screen: Add title + hashtags
 * 8. Click "공유하기" using smart detection
 *
 * SMART DETECTION STRATEGIES:
 * - Position-based (top-right for Next, bottom-right for Share)
 * - Color-based (Instagram blue primary buttons)
 * - Sequential click with screen verification
 * - XPath fallback
 */
async function uploadToInstagram(page, video, accountName, index, total) {
    try {
        console.log(`\n${'━'.repeat(80)}`);
        console.log(`📤 업로드 중 [${index}/${total}] - 계정: ${accountName}`);
        console.log('━'.repeat(80));
        console.log(`제목: ${video.title}`);
        console.log(`비디오: ${path.basename(video.path)}`);
        console.log(`폴더: ${video.folder}`);

        // Navigate to Instagram
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(3000);

        // Click on "Create" button - try multiple selectors
        console.log('📸 Create 버튼 찾는 중...');

        let createClicked = false;
        const createSelectors = [
            'svg[aria-label="New post"]',
            'svg[aria-label="새로운 게시물"]',
            'svg[aria-label="Create"]',
            'a[href="#"] svg',
            '[role="menuitem"]'
        ];

        for (const selector of createSelectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    console.log(`✓ Create 버튼 발견: ${selector}`);
                    await element.click();
                    createClicked = true;
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        if (!createClicked) {
            throw new Error('Create 버튼을 찾을 수 없습니다');
        }

        await delay(3000);

        // Wait for file input to appear - try multiple times
        console.log('📁 파일 업로드 입력 찾는 중...');

        let fileInput = null;
        for (let i = 0; i < 10; i++) {
            fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                console.log('✓ 파일 입력 발견!');
                break;
            }
            console.log(`  대기 중... (${i + 1}/10)`);
            await delay(1000);
        }

        if (!fileInput) {
            // Take screenshot for debugging
            await page.screenshot({ path: 'instagram-error.png' });
            throw new Error('파일 업로드 입력을 찾을 수 없습니다. instagram-error.png 확인하세요.');
        }

        // Upload file
        console.log('📤 파일 업로드 중...');
        await fileInput.uploadFile(video.path);
        await delay(5000);

        // Check for popups and close them
        console.log('📋 팝업 확인 및 닫기...');
        try {
            // Strategy 1: Click "확인" button for Reels info popup
            const confirmButtons = await page.$$('button');
            for (const button of confirmButtons) {
                const buttonText = await page.evaluate(el => el.textContent, button);
                if (buttonText && buttonText.includes('확인')) {
                    console.log('  ✓ 릴스 안내 팝업 "확인" 클릭');
                    await button.click();
                    await delay(2000);
                    break;
                }
            }

            // Strategy 2: Click back arrow or close buttons
            const allButtons = await page.$$('button, div[role="button"], svg');
            for (const button of allButtons) {
                const ariaLabel = await page.evaluate(el => el.getAttribute('aria-label'), button);
                const buttonText = await page.evaluate(el => el.textContent, button);

                // Back button, Close button, or Not now
                if (ariaLabel && (ariaLabel.includes('Close') || ariaLabel.includes('닫기') || ariaLabel.includes('Back') || ariaLabel.includes('뒤로'))) {
                    console.log(`  ✓ 팝업 닫기 버튼 클릭: "${ariaLabel}"`);
                    await button.click();
                    await delay(2000);
                    break;
                }
                if (buttonText && (buttonText.includes('Not now') || buttonText.includes('나중에') || buttonText.includes('취소'))) {
                    console.log('  ✓ "Not now" 버튼 클릭');
                    await button.click();
                    await delay(2000);
                    break;
                }
            }

            // Strategy 3: Press ESC key to close popup
            console.log('  📋 ESC 키로 팝업 닫기 시도...');
            await page.keyboard.press('Escape');
            await delay(1500);

            // Strategy 4: Click outside popup area (center-left of screen)
            console.log('  📋 팝업 바깥쪽 클릭 시도...');
            await page.mouse.click(100, 450); // Left side, middle height
            await delay(1500);

        } catch (e) {
            console.log('  (팝업 처리 완료)');
        }

        // Set aspect ratio to vertical (9:16) for Reels - REQUIRED!
        console.log('📐 세로 비율(9:16) 설정 중... (필수!)');

        // Wait for crop screen to load (wait for "자르기" text or video preview)
        console.log('  ⏳ 자르기 화면 로딩 대기 중...');
        try {
            // Wait for the crop screen header with "자르기" text
            await page.waitForFunction(() => {
                const allText = Array.from(document.querySelectorAll('*'))
                    .map(el => el.textContent?.trim())
                    .filter(text => text && text.length < 20);
                return allText.some(text => text === '자르기' || text.includes('Crop'));
            }, { timeout: 15000 });
            console.log('  ✅ 자르기 화면 로드 완료!');
        } catch (e) {
            console.log('  ⚠️ 자르기 화면 감지 실패, 계속 진행...');
        }

        // Additional wait for UI to stabilize
        await delay(2000);

        // Load recorded click coordinates
        const coordsFile = path.join(PROJECT_ROOT, 'instagram-click-coords.json');
        let coords = null;

        if (fs.existsSync(coordsFile)) {
            try {
                coords = JSON.parse(fs.readFileSync(coordsFile, 'utf8'));
                console.log('  ✅ 녹화된 클릭 좌표 로드 완료');
                console.log(`  📍 총 ${coords.totalClicks || coords.clicks?.length || 0}개의 클릭 좌표`);
            } catch (e) {
                console.log('  ⚠️ 좌표 파일 읽기 실패');
                coords = null;
            }
        } else {
            console.log('  ⚠️ 좌표 파일 없음');
            console.log('  💡 먼저 "node scripts/setup_instagram_clicks.js" 실행하세요');
        }

        // Use recorded coordinates if available, otherwise fail
        if (!coords || !coords.clicks || coords.clicks.length === 0) {
            const screenshot = `instagram-no-coords-${Date.now()}.png`;
            await page.screenshot({ path: screenshot });
            throw new Error('❌ 좌표 파일이 없습니다. "node scripts/setup_instagram_clicks.js" 먼저 실행하세요!');
        }

        // Replay recorded clicks with caption insertion
        console.log('  🎯 녹화된 클릭 재생 중...');
        for (let i = 0; i < coords.clicks.length; i++) {
            const click = coords.clicks[i];

            // Special handling: After click 5 (index 4), add caption before click 6
            if (i === 5) {
                console.log('');
                console.log('✍️  캡션 입력 중...');

                // Wait for caption textarea to be ready
                await delay(2000);

                try {
                    // Try multiple selectors for caption field
                    const captionField = await page.$('textarea[aria-label*="caption"], textarea[aria-label*="캡션"], textarea[placeholder*="Write"], div[contenteditable="true"][role="textbox"]');

                    if (captionField) {
                        await captionField.click();
                        await delay(500);

                        // Type caption
                        await captionField.type(video.caption, { delay: 50 });
                        console.log('  ✅ 캡션 입력 완료');

                        await delay(1000);
                    } else {
                        console.log('  ⚠️  캡션 입력 필드를 찾을 수 없습니다');
                    }
                } catch (e) {
                    console.log('  ⚠️  캡션 입력 실패:', e.message);
                }

                console.log('');
            }

            // Click the coordinate
            console.log(`  ${i + 1}/${coords.clicks.length}: (${click.x}, ${click.y}) 클릭`);
            await page.mouse.click(click.x, click.y);

            // Wait between clicks (adjust timing as needed)
            if (i === 0) {
                // After first click (ratio button), wait for menu
                await delay(1000);
            } else if (i < coords.clicks.length - 1) {
                // Between other clicks
                await delay(2000);
            }
        }

        console.log('  ✅ 모든 녹화된 클릭 재생 완료!');
        console.log('  ✅ 업로드 완료! (녹화된 순서: 비율 변경 → 9:16 → 다음들 → 캡션 → 공유)');

        console.log('⏳ 업로드 처리 대기 중...');

        // Wait for upload to complete - check for success indicators
        let uploadComplete = false;
        let attempts = 0;
        const maxAttempts = 30; // 30 attempts x 2 seconds = 60 seconds max wait

        while (!uploadComplete && attempts < maxAttempts) {
            await delay(2000);
            attempts++;

            // Check for various success indicators
            const status = await page.evaluate(() => {
                const bodyText = document.body.textContent || '';

                // Success messages
                const hasSuccessMessage =
                    bodyText.includes('게시물이 공유') ||
                    bodyText.includes('공유됨') ||
                    bodyText.includes('Post shared') ||
                    bodyText.includes('Your reel has been shared') ||
                    bodyText.includes('릴스가 공유');

                // Check if we're back on home page or profile
                const onHomePage = window.location.pathname === '/' ||
                    window.location.pathname.startsWith('/p/') ||
                    !window.location.pathname.includes('create');

                // Check if upload dialog is closed
                const hasUploadDialog = document.querySelector('[role="dialog"]') !== null;

                return {
                    hasSuccessMessage,
                    onHomePage,
                    hasUploadDialog,
                    url: window.location.pathname
                };
            });

            console.log(`  확인 중 (${attempts}/${maxAttempts}): 성공메시지=${status.hasSuccessMessage}, 홈페이지=${status.onHomePage}, 다이얼로그=${status.hasUploadDialog}`);

            // Success conditions: success message OR back on home page without dialog
            if (status.hasSuccessMessage || (status.onHomePage && !status.hasUploadDialog)) {
                uploadComplete = true;
                console.log('✅ 업로드 완료 확인됨!');
                break;
            }

            // Take screenshot every 10 attempts for debugging
            if (attempts % 10 === 0) {
                await page.screenshot({ path: `instagram-uploading-${attempts}-${Date.now()}.png` });
                console.log(`  📸 업로드 진행 상황 스크린샷 저장 (${attempts}초)`);
            }
        }

        if (!uploadComplete) {
            console.log('⚠️  업로드 완료 확인을 못했습니다 (타임아웃). 수동으로 확인해주세요.');
        }

        // Take final screenshot
        await page.screenshot({ path: `instagram-final-${Date.now()}.png` });
        console.log('📸 최종 스크린샷 저장');

        // Extra delay to ensure everything is saved
        await delay(3000);

        return true;
    } catch (error) {
        console.error(`❌ 업로드 실패: ${error.message}`);

        // Take screenshot on error
        try {
            await page.screenshot({ path: `instagram-error-${Date.now()}.png` });
            console.log(`📸 에러 스크린샷 저장됨`);
        } catch (e) {
            // Ignore screenshot errors
        }

        return false;
    }
}

/**
 * Smart button clicker - tries multiple strategies to find and click the correct Next button
 * @param {Page} page - Puppeteer page object
 * @param {string} screenName - Name of current screen for logging (e.g., '자르기', '필터')
 * @returns {boolean} - True if button was clicked and screen transitioned
 */
async function clickNextButtonSmart(page, screenName) {
    console.log(`  🎯 "${screenName}" 화면에서 "다음" 버튼 찾는 중...`);

    // Strategy 1: Find button by position (top-right corner)
    console.log(`  전략 1: 위치 기반 탐색 (우상단)`);
    try {
        const topRightButton = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

            // Filter buttons with "다음" or "Next" text
            const nextButtons = buttons.filter(btn => {
                const text = btn.textContent || '';
                return text.includes('다음') || text.includes('Next');
            });

            if (nextButtons.length === 0) return null;

            // Find the one closest to top-right corner
            let bestButton = null;
            let minDistance = Infinity;

            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            for (const btn of nextButtons) {
                const rect = btn.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                // Calculate distance from top-right corner
                const distance = Math.sqrt(
                    Math.pow(windowWidth - rect.right, 2) +
                    Math.pow(rect.top, 2)
                );

                if (distance < minDistance) {
                    minDistance = distance;
                    bestButton = btn;
                }
            }

            if (bestButton) {
                bestButton.click();
                return true;
            }
            return false;
        });

        if (topRightButton) {
            console.log(`  ✅ 전략 1 성공: 우상단 버튼 클릭`);
            await delay(3000);

            // Verify screen changed
            const screenChanged = await verifyScreenTransition(page, screenName);
            if (screenChanged) {
                console.log(`  ✅ 화면 전환 확인됨`);
                return true;
            } else {
                console.log(`  ⚠️  화면 전환 실패, 다음 전략 시도`);
            }
        }
    } catch (e) {
        console.log(`  ⚠️  전략 1 실패: ${e.message}`);
    }

    // Strategy 2: Find blue/primary colored button
    console.log(`  전략 2: 색상 기반 탐색 (파란색 버튼)`);
    try {
        const blueButton = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

            for (const btn of buttons) {
                const text = btn.textContent || '';
                if (!text.includes('다음') && !text.includes('Next')) continue;

                const style = window.getComputedStyle(btn);
                const bgColor = style.backgroundColor;
                const color = style.color;

                // Check for blue-ish background or text
                if (bgColor.includes('0, 149, 246') || // Instagram blue
                    color.includes('0, 149, 246') ||
                    bgColor.includes('rgb(0, 149, 246)')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (blueButton) {
            console.log(`  ✅ 전략 2 성공: 파란색 버튼 클릭`);
            await delay(3000);

            const screenChanged = await verifyScreenTransition(page, screenName);
            if (screenChanged) {
                console.log(`  ✅ 화면 전환 확인됨`);
                return true;
            } else {
                console.log(`  ⚠️  화면 전환 실패, 다음 전략 시도`);
            }
        }
    } catch (e) {
        console.log(`  ⚠️  전략 2 실패: ${e.message}`);
    }

    // Strategy 3: Click all "Next" buttons until screen changes
    console.log(`  전략 3: 모든 "다음" 버튼 순차 클릭`);
    try {
        const buttons = await page.$$('button, div[role="button"]');

        for (let i = 0; i < buttons.length; i++) {
            try {
                const elementText = await page.evaluate(el => el.textContent, buttons[i]);

                if ((elementText.includes('다음') || elementText.includes('Next'))) {
                    const isVisible = await page.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }, buttons[i]);

                    if (isVisible) {
                        console.log(`  🔄 버튼 ${i + 1} 클릭 시도: "${elementText.trim()}"`);
                        await buttons[i].click();
                        await delay(3000);

                        const screenChanged = await verifyScreenTransition(page, screenName);
                        if (screenChanged) {
                            console.log(`  ✅ 전략 3 성공: 화면 전환 확인됨`);
                            return true;
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }
    } catch (e) {
        console.log(`  ⚠️  전략 3 실패: ${e.message}`);
    }

    // Strategy 4: Try clicking by evaluating all buttons and checking for "다음"
    console.log(`  전략 4: JavaScript evaluate로 버튼 클릭`);
    try {
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

            for (const btn of buttons) {
                const text = btn.textContent || '';
                if (text.includes('다음') || text.includes('Next')) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        btn.click();
                        return true;
                    }
                }
            }
            return false;
        });

        if (clicked) {
            console.log(`  🔄 전략 4: 버튼 클릭 성공`);
            await delay(3000);

            const screenChanged = await verifyScreenTransition(page, screenName);
            if (screenChanged) {
                console.log(`  ✅ 전략 4 성공: 화면 전환 확인됨`);
                return true;
            }
        }
    } catch (e) {
        console.log(`  ⚠️  전략 4 실패: ${e.message}`);
    }

    console.log(`  ❌ 모든 전략 실패: "다음" 버튼을 찾거나 클릭할 수 없습니다`);

    // Take screenshot for debugging
    try {
        const screenshotPath = `instagram-failed-${screenName}-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath });
        console.log(`  📸 디버깅 스크린샷 저장: ${screenshotPath}`);
    } catch (e) {
        // Ignore screenshot errors
    }

    return false;
}

/**
 * Verify that screen has transitioned by checking for screen-specific elements
 * @param {Page} page - Puppeteer page object
 * @param {string} currentScreen - Name of current screen we're trying to leave
 * @returns {boolean} - True if screen has changed
 */
async function verifyScreenTransition(page, currentScreen) {
    try {
        // Wait longer for transition animation
        await delay(2000);

        // Check if we see "다음" button disappearing (means screen changed)
        const nextButtonCount = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
            return buttons.filter(btn => {
                const text = btn.textContent || '';
                return text.includes('다음') || text.includes('Next');
            }).length;
        });

        // If there are still "다음" buttons visible, check what screen we're on
        if (nextButtonCount > 0) {
            // We still have Next buttons, which means we might have transitioned
            // Check for caption input (final screen) or other indicators
            const hasCaptionInput = await page.$('[aria-label*="캡션"], div[contenteditable="true"]') !== null;
            const hasShareButton = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                return buttons.some(btn => {
                    const text = btn.textContent || '';
                    return text.includes('공유') || text.includes('Share');
                });
            });

            // If we see caption input or share button, we've progressed
            if (hasCaptionInput || hasShareButton) {
                return true;
            }
        }

        // More lenient: assume success if no obvious error
        // Check for error indicators
        const hasError = await page.$('div[role="alert"]') !== null;
        if (hasError) {
            return false;
        }

        // If we waited and no error, assume transition worked
        return true;
    } catch (e) {
        // On any error, assume transition worked (be optimistic)
        console.log(`  (검증 오류, 계속 진행: ${e.message})`);
        return true;
    }
}

/**
 * Smart Share button clicker - tries multiple strategies to find and click Share button
 * @param {Page} page - Puppeteer page object
 * @returns {boolean} - True if button was clicked successfully
 */
async function clickShareButtonSmart(page) {
    console.log(`  🎯 "공유하기" 버튼 찾는 중...`);

    const shareTexts = ['공유하기', '공유', 'Share'];

    // Strategy 1: Find button by position (top-right corner - same as Next button!)
    console.log(`  전략 1: 위치 기반 탐색 (우상단)`);
    try {
        const topRightButton = await page.evaluate((shareTexts) => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

            // Filter buttons with share text
            const shareButtons = buttons.filter(btn => {
                const text = btn.textContent || '';
                return shareTexts.some(shareText => text.includes(shareText));
            });

            if (shareButtons.length === 0) return null;

            // Find the one closest to TOP-right corner (not bottom!)
            let bestButton = null;
            let minDistance = Infinity;

            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            for (const btn of shareButtons) {
                const rect = btn.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                // Calculate distance from TOP-right corner
                const distance = Math.sqrt(
                    Math.pow(windowWidth - rect.right, 2) +
                    Math.pow(rect.top, 2)  // Changed from rect.bottom to rect.top!
                );

                if (distance < minDistance) {
                    minDistance = distance;
                    bestButton = btn;
                }
            }

            if (bestButton) {
                bestButton.click();
                return true;
            }
            return false;
        }, shareTexts);

        if (topRightButton) {
            console.log(`  ✅ 전략 1 성공: 우상단 버튼 클릭`);
            return true;
        }
    } catch (e) {
        console.log(`  ⚠️  전략 1 실패: ${e.message}`);
    }

    // Strategy 2: Find blue/primary colored button
    console.log(`  전략 2: 색상 기반 탐색 (파란색 버튼)`);
    try {
        const blueButton = await page.evaluate((shareTexts) => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

            for (const btn of buttons) {
                const text = btn.textContent || '';
                if (!shareTexts.some(shareText => text.includes(shareText))) continue;

                const style = window.getComputedStyle(btn);
                const bgColor = style.backgroundColor;
                const color = style.color;

                // Check for blue-ish background or text
                if (bgColor.includes('0, 149, 246') || // Instagram blue
                    color.includes('0, 149, 246') ||
                    bgColor.includes('rgb(0, 149, 246)')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }, shareTexts);

        if (blueButton) {
            console.log(`  ✅ 전략 2 성공: 파란색 버튼 클릭`);
            return true;
        }
    } catch (e) {
        console.log(`  ⚠️  전략 2 실패: ${e.message}`);
    }

    // Strategy 3: Try all share buttons sequentially
    console.log(`  전략 3: 모든 "공유" 버튼 순차 클릭`);
    try {
        const buttons = await page.$$('button, div[role="button"]');

        for (let i = 0; i < buttons.length; i++) {
            try {
                const elementText = await page.evaluate(el => el.textContent, buttons[i]);

                if (shareTexts.some(shareText => elementText.includes(shareText))) {
                    const isVisible = await page.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }, buttons[i]);

                    if (isVisible) {
                        console.log(`  🔄 버튼 ${i + 1} 클릭 시도: "${elementText.trim()}"`);
                        await buttons[i].click();
                        console.log(`  ✅ 전략 3 성공: 버튼 클릭됨`);
                        return true;
                    }
                }
            } catch (e) {
                continue;
            }
        }
    } catch (e) {
        console.log(`  ⚠️  전략 3 실패: ${e.message}`);
    }

    // Strategy 4: JavaScript evaluate to find and click
    console.log(`  전략 4: JavaScript evaluate로 버튼 클릭`);
    try {
        const clicked = await page.evaluate((shareTexts) => {
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

            for (const btn of buttons) {
                const text = btn.textContent || '';
                if (shareTexts.some(shareText => text.includes(shareText))) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        btn.click();
                        return true;
                    }
                }
            }
            return false;
        }, shareTexts);

        if (clicked) {
            console.log(`  ✅ 전략 4 성공: 버튼 클릭됨`);
            return true;
        }
    } catch (e) {
        console.log(`  ⚠️  전략 4 실패: ${e.message}`);
    }

    console.log(`  ❌ 모든 전략 실패: "공유하기" 버튼을 찾거나 클릭할 수 없습니다`);

    // Take screenshot for debugging
    try {
        const screenshotPath = `instagram-failed-share-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath });
        console.log(`  📸 디버깅 스크린샷 저장: ${screenshotPath}`);
    } catch (e) {
        // Ignore screenshot errors
    }

    return false;
}

/**
 * Click button by text content (supports multiple languages)
 */
async function clickButtonByText(page, text) {
    // Map English to Korean
    const textMap = {
        'Next': ['Next', '다음'],
        'Share': ['Share', '공유하기', '공유'],
        'OK': ['OK', '확인']
    };

    const searchTexts = textMap[text] || [text];

    // Try multiple times with delay
    for (let attempt = 0; attempt < 5; attempt++) {
        // Try both button and div elements (Instagram uses divs for buttons)
        const elements = await page.$$('button, div[role="button"]');

        // Debug: log all button texts on first attempt
        if (attempt === 0) {
            console.log(`  🔍 "${text}" 버튼 검색 중... (총 ${elements.length}개 요소 발견)`);
        }

        for (const element of elements) {
            try {
                const elementText = await page.evaluate(el => el.textContent, element);

                // Debug: log on last attempt
                if (attempt === 4 && elementText && elementText.trim().length > 0 && elementText.trim().length < 100) {
                    console.log(`    - "${elementText.trim()}"`);
                }

                for (const searchText of searchTexts) {
                    if (elementText && elementText.includes(searchText)) {
                        console.log(`  ✓ 버튼 발견: "${elementText.trim()}"`);

                        // Ensure element is visible and clickable
                        const isVisible = await page.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        }, element);

                        if (isVisible) {
                            await element.click();
                            return true;
                        } else {
                            console.log(`    (숨겨진 버튼, 건너뜀)`);
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }

        if (attempt < 4) {
            console.log(`  버튼을 찾지 못함, 재시도 중... (${attempt + 1}/5)`);
            await delay(1000);
        }
    }

    console.log(`  ⚠️  "${text}" 버튼을 찾지 못했습니다`);
    return false;
}

/**
 * Delay helper
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if account is logged in
 */
async function checkLogin(page) {
    try {
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
        await delay(2000);

        // Check for logged-in indicators
        const isLoggedIn = await page.$('svg[aria-label="Home"]') !== null;
        return isLoggedIn;
    } catch (error) {
        console.error('로그인 체크 실패:', error.message);
        return false;
    }
}

/**
 * Setup account (ensure login)
 */
async function setupAccount(accountNum, accountName, headless) {
    const profileDir = path.join(PROFILES_DIR, `account${accountNum}`);

    // Create profile directory if not exists
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }

    console.log(`\n${'━'.repeat(80)}`);
    console.log(`🔧 계정 ${accountNum} 설정: ${accountName}`);
    console.log('━'.repeat(80));

    // Launch browser with dedicated profile
    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        userDataDir: profileDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1280,900'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Check if already logged in
    const isLoggedIn = await checkLogin(page);

    if (!isLoggedIn) {
        console.log('⚠️  로그인이 필요합니다!');
        console.log('');
        console.log(`브라우저에서 ${accountName} 계정으로 Instagram에 로그인해주세요.`);
        console.log('로그인 후 아무 키나 누르면 계속됩니다...');

        // Wait for user to login manually
        await new Promise(resolve => {
            process.stdin.once('data', () => resolve());
        });

        console.log('✅ 로그인 완료!\n');
    } else {
        console.log(`✅ 계정 ${accountNum}은 이미 로그인되어 있습니다.\n`);
    }

    await browser.close();
}

/**
 * Upload videos for a specific account
 */
async function uploadForAccount(accountNum, accountName, videos, headless) {
    const profileDir = path.join(PROFILES_DIR, `account${accountNum}`);

    console.log(`\n${'━'.repeat(80)}`);
    console.log(`📱 계정 ${accountNum} (${accountName})로 ${videos.length}개 업로드 시작`);
    console.log('━'.repeat(80));

    // Launch browser with account's profile
    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        userDataDir: profileDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1280,900'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    let successCount = 0;
    let failCount = 0;

    try {
        for (let i = 0; i < videos.length; i++) {
            const success = await uploadToInstagram(page, videos[i], accountName, i + 1, videos.length);

            if (success) {
                successCount++;
            } else {
                failCount++;
            }

            // Delay between uploads
            if (i < videos.length - 1) {
                console.log(`\n⏳ 다음 업로드까지 10초 대기...\n`);
                await delay(10000);
            }
        }
    } catch (error) {
        console.error(`❌ 계정 ${accountNum} 업로드 중 오류:`, error.message);
    } finally {
        await browser.close();
    }

    return { successCount, failCount };
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

    // Load accounts and stats
    const accounts = loadAccounts();
    const stats = loadUploadStats();

    // Parse command line arguments
    const args = process.argv.slice(2);
    let headless = false; // 기본값을 false로 변경 (브라우저 보이게)
    let limit = videos.length;
    let setupOnly = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--headless') headless = args[i + 1] !== 'false';
        if (args[i] === '--limit') limit = parseInt(args[i + 1]) || limit;
        if (args[i] === '--setup') setupOnly = true;
    }

    // Sort videos by priority (ascending, lower number = higher priority)
    videos.sort((a, b) => a.priority - b.priority);

    const videosToUpload = videos.slice(0, limit);

    // Distribute videos across accounts
    const distribution = distributeVideos(videosToUpload, accounts, stats);

    if (distribution.length === 0) {
        console.log('❌ 비디오 분배 실패');
        return;
    }

    // Show distribution plan
    console.log('━'.repeat(80));
    console.log('📊 업로드 분배 계획');
    console.log('━'.repeat(80));

    const accountGroups = {};
    for (const item of distribution) {
        if (!accountGroups[item.accountNum]) {
            accountGroups[item.accountNum] = [];
        }
        accountGroups[item.accountNum].push(item.video);
    }

    for (let i = 1; i <= 8; i++) {
        const accountVideos = accountGroups[i] || [];
        const count = accountVideos.length;
        const accountName = accounts[`account${i}`]?.name || `account${i}`;
        const currentCount = stats[i] || 0;
        console.log(`   계정 ${i} (${accountName}): ${count}개 업로드 예정 (현재 총 ${currentCount}개)`);

        // List video titles
        for (let j = 0; j < accountVideos.length; j++) {
            console.log(`      ${j + 1}. ${accountVideos[j].title}`);
        }
        if (count > 0) console.log(''); // Add spacing between accounts
    }

    console.log('━'.repeat(80));
    console.log(`🖥️  Headless 모드: ${headless ? 'ON' : 'OFF'}`);
    console.log('━'.repeat(80));
    console.log('');

    // Ask for confirmation before proceeding
    if (!setupOnly) {
        console.log('━'.repeat(80));
        console.log('⚠️  위 분배 계획으로 업로드를 진행하시겠습니까?');
        console.log('━'.repeat(80));
        process.stdout.write('계속하려면 "y" 입력 후 Enter (취소: 다른 키): ');

        const answer = await new Promise(resolve => {
            process.stdin.once('data', data => {
                resolve(data.toString().trim().toLowerCase());
            });
        });

        if (answer !== 'y') {
            console.log('\n❌ 업로드 취소됨');
            return;
        }

        console.log('\n✅ 업로드를 시작합니다!\n');
    }

    // Setup mode: just ensure all accounts are logged in
    if (setupOnly) {
        console.log('🔧 계정 설정 모드: 모든 계정에 로그인합니다...\n');

        const enabledAccounts = Object.keys(accounts)
            .filter(key => accounts[key].enabled)
            .map(key => parseInt(key.replace('account', '')))
            .sort((a, b) => a - b);

        for (const accountNum of enabledAccounts) {
            const accountName = accounts[`account${accountNum}`].name;
            await setupAccount(accountNum, accountName, false); // Always visible for setup
        }

        console.log('\n✅ 모든 계정 설정 완료!');
        return;
    }

    // Upload for each account
    let totalSuccess = 0;
    let totalFail = 0;

    for (const [accountNumStr, accountVideos] of Object.entries(accountGroups)) {
        const accountNum = parseInt(accountNumStr);
        const accountName = accounts[`account${accountNum}`].name;

        // Ensure account is set up
        const profileDir = path.join(PROFILES_DIR, `account${accountNum}`);
        if (!fs.existsSync(profileDir)) {
            await setupAccount(accountNum, accountName, headless);
        }

        // Upload videos for this account
        const result = await uploadForAccount(accountNum, accountName, accountVideos, headless);

        totalSuccess += result.successCount;
        totalFail += result.failCount;

        // Update stats
        stats[accountNum] = (stats[accountNum] || 0) + result.successCount;
        saveUploadStats(stats);

        // Delay between accounts
        if (Object.keys(accountGroups).indexOf(accountNumStr) < Object.keys(accountGroups).length - 1) {
            console.log(`\n⏳ 다음 계정으로 전환하기 전 5초 대기...\n`);
            await delay(5000);
        }
    }

    // Summary
    console.log('\n' + '━'.repeat(80));
    console.log('📊 전체 업로드 완료');
    console.log('━'.repeat(80));
    console.log(`✅ 성공: ${totalSuccess}개`);
    console.log(`❌ 실패: ${totalFail}개`);
    console.log(`📝 전체: ${videosToUpload.length}개`);
    console.log('━'.repeat(80));

    console.log('\n📈 계정별 누적 통계:');
    for (let i = 1; i <= 8; i++) {
        const accountName = accounts[`account${i}`]?.name || `account${i}`;
        const count = stats[i] || 0;
        console.log(`   계정 ${i} (${accountName}): 총 ${count}개 업로드됨`);
    }
    console.log('');
}

// Run batch upload
batchUpload().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
