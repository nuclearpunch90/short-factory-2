import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import AccountManager from './account_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
];
const TOKEN_PATH = path.join(PROJECT_ROOT, 'youtube-token.json');
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');
const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'outputs');
const STATS_PATH = path.join(PROJECT_ROOT, 'youtube-upload-stats.json');

/**
 * Load upload statistics from file
 */
function loadUploadStats() {
    let stats = {};

    // Try to load existing stats
    try {
        if (fs.existsSync(STATS_PATH)) {
            stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
        }
    } catch (error) {
        console.warn('⚠️  통계 파일 로드 실패, 초기화합니다.');
    }

    // Ensure all accounts 1-4 exist in stats (add missing accounts with 0)
    for (let i = 1; i <= 4; i++) {
        if (stats[i] === undefined) {
            stats[i] = 0;
        }
    }

    return stats;
}

/**
 * Save upload statistics to file
 */
function saveUploadStats(stats) {
    try {
        fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
    } catch (error) {
        console.error('⚠️  통계 파일 저장 실패:', error.message);
    }
}

/**
 * Find account with least uploads (excluding last used)
 */
function findBestAccount(stats, lastUsedAccount) {
    let bestAccount = null;
    let minUploads = Infinity;

    for (let i = 1; i <= 4; i++) {
        // Skip last used account to prevent consecutive uploads
        if (i === lastUsedAccount) continue;

        // Check if account token exists
        const tokenPath = path.join(PROJECT_ROOT, `youtube-token-account${i}.json`);
        if (!fs.existsSync(tokenPath)) continue;

        const uploads = stats[i] || 0;
        if (uploads < minUploads) {
            minUploads = uploads;
            bestAccount = i;
        }
    }

    return bestAccount;
}

/**
 * Switch to a specific account
 */
function switchAccount(accountNumber) {
    try {
        const sourceToken = path.join(PROJECT_ROOT, `youtube-token-account${accountNumber}.json`);
        fs.copyFileSync(sourceToken, TOKEN_PATH);
        return true;
    } catch (error) {
        console.error(`❌ 계정 전환 실패: ${error.message}`);
        return false;
    }
}

/**
 * Detects which account number is currently active
 */
function detectCurrentAccount() {
    try {
        const currentToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

        for (let i = 1; i <= 4; i++) {
            const accountTokenPath = path.join(PROJECT_ROOT, `youtube-token-account${i}.json`);
            if (fs.existsSync(accountTokenPath)) {
                const accountToken = JSON.parse(fs.readFileSync(accountTokenPath, 'utf8'));
                if (currentToken.refresh_token === accountToken.refresh_token) {
                    return i;
                }
            }
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Get channel information from YouTube API
 */
async function getChannelInfo(auth) {
    try {
        const youtube = google.youtube({ version: 'v3', auth });
        const response = await youtube.channels.list({
            part: 'snippet',
            mine: true
        });

        if (response.data.items && response.data.items.length > 0) {
            const channel = response.data.items[0];
            return {
                title: channel.snippet.title,
                customUrl: channel.snippet.customUrl || ''
            };
        }
        console.warn('⚠️  채널 정보를 찾을 수 없습니다.');
        return null;
    } catch (error) {
        console.warn('⚠️  채널 정보 가져오기 실패:', error.message);
        if (error.message.includes('insufficientPermissions') || error.message.includes('forbidden')) {
            console.warn('💡 권한 부족: 계정을 재등록해주세요.');
        }
        return null;
    }
}

/**
 * Find all video files in outputs directory
 */
function findAllVideos() {
    const videos = [];

    if (!fs.existsSync(OUTPUTS_DIR)) {
        console.error(`❌ outputs 폴더를 찾을 수 없습니다: ${OUTPUTS_DIR}`);
        return videos;
    }

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
                let description = ''; // 항상 빈 상태로 업로드
                let priority = 999; // 기본값: 우선순위 없음 (맨 뒤)

                // Try to read info.txt (제목과 우선순위 읽기)
                if (fs.existsSync(infoPath)) {
                    try {
                        const infoContent = fs.readFileSync(infoPath, 'utf8');
                        const lines = infoContent.split('\n').map(line => line.trim()).filter(line => line);

                        for (const line of lines) {
                            if (line.startsWith('제목:')) {
                                title = line.replace('제목:', '').trim();
                            }
                            if (line.startsWith('우선순위:')) {
                                const priorityStr = line.replace('우선순위:', '').trim();
                                const parsedPriority = parseInt(priorityStr);
                                if (!isNaN(parsedPriority)) {
                                    priority = parsedPriority;
                                }
                            }
                            // 설명은 읽지 않음 - 항상 빈 상태로 업로드
                        }
                    } catch (err) {
                        // Ignore errors reading info.txt
                    }
                }

                videos.push({
                    path: videoPath,
                    title: title,
                    description: description,
                    folder: folder,
                    folderPath: folderPath,
                    priority: priority
                });
            }
        }
    }

    // 우선순위 순서대로 정렬 (1 -> 2 -> 3 -> 999)
    videos.sort((a, b) => a.priority - b.priority);

    return videos;
}

/**
 * Authorize and get OAuth2 client
 */
async function authorize(credentials) {
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    if (!fs.existsSync(TOKEN_PATH)) {
        throw new Error(`❌ 토큰 파일이 없습니다: ${TOKEN_PATH}\n계정을 전환하세요: ./scripts/switch_youtube_account.sh [1-8]`);
    }

    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
}

/**
 * Upload a single video (without confirmation prompt)
 */
async function uploadVideo(auth, videoInfo, privacyStatus, index, total, channelInfo, accountSequence) {
    return new Promise((resolve, reject) => {
        const youtube = google.youtube({ version: 'v3', auth });
        const currentAccount = detectCurrentAccount();

        let accountDisplay = currentAccount ? `Account ${currentAccount}` : '알 수 없음';
        if (channelInfo) {
            accountDisplay += ` (${channelInfo.title})`;
        }

        // Calculate scheduled publish time
        let status;
        let scheduleInfo;

        if (accountSequence === 1) {
            // First video: immediately public
            status = { privacyStatus: 'public' };
            scheduleInfo = '즉시 공개 (public)';
        } else {
            // Rest: private with scheduled publish time
            const delayHours = (accountSequence - 1) * 2;
            const publishDate = new Date();
            publishDate.setHours(publishDate.getHours() + delayHours);
            status = {
                privacyStatus: 'private',
                publishAt: publishDate.toISOString()
            };
            scheduleInfo = `${delayHours}시간 후 자동 공개 (${publishDate.toLocaleString('ko-KR')})`;
        }

        // Display upload progress
        console.log(`\n${'━'.repeat(80)}`);
        console.log(`⏫ 업로드 진행 중 [${index}/${total}]`);
        console.log('━'.repeat(80));
        console.log(`계정: ${accountDisplay}`);
        console.log(`폴더: ${videoInfo.folder}`);
        console.log(`비디오: ${path.basename(videoInfo.path)}`);
        console.log(`제목: ${videoInfo.title}`);
        console.log(`공개 설정: ${scheduleInfo}`);

        youtube.videos.insert(
            {
                part: 'snippet,status',
                requestBody: {
                    snippet: {
                        title: videoInfo.title,
                        description: videoInfo.description,
                        tags: ['shorts', 'api_upload'],
                    },
                    status: status,
                },
                media: {
                    body: fs.createReadStream(videoInfo.path),
                },
            },
            (err, res) => {
                if (err) {
                    console.error('❌ 업로드 실패:', err.message);
                    resolve({ error: err.message });
                    return;
                }
                console.log('✅ 업로드 성공!');
                console.log(`📺 Video ID: ${res.data.id}`);
                console.log(`🔗 Watch URL: https://www.youtube.com/watch?v=${res.data.id}`);
                resolve({ success: true, videoId: res.data.id, folderPath: videoInfo.folderPath });
            }
        );
    });
}

/**
 * Main batch upload function
 */
async function batchUpload() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let privacyStatus = 'private';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--privacy') privacyStatus = args[i + 1];
    }

    console.log('🔍 outputs 폴더에서 비디오 검색 중...\n');

    // Find all videos
    const videos = findAllVideos();

    if (videos.length === 0) {
        console.log('❌ 업로드할 비디오를 찾을 수 없습니다.');
        return;
    }

    console.log(`✅ ${videos.length}개의 비디오를 찾았습니다.\n`);

    // Display priority-sorted video list
    console.log('📋 우선순위 정렬 순서:');
    videos.forEach((video, idx) => {
        const priorityTag = video.priority && video.priority < 999 ? `[우선순위 ${video.priority}]` : '[우선순위 없음]';
        console.log(`   ${idx + 1}. ${priorityTag} ${video.title}`);
    });
    console.log('');

    // 우선순위 중복 제거: 각 우선순위당 최대 4개 (계정 수만큼) 선택
    const MAX_ACCOUNTS = 4;
    const priorityGroups = new Map();
    const filteredVideos = [];
    const skippedVideos = [];

    // 우선순위별로 그룹화
    videos.forEach(video => {
        if (video.priority && video.priority < 999) {
            if (!priorityGroups.has(video.priority)) {
                priorityGroups.set(video.priority, []);
            }
            priorityGroups.get(video.priority).push(video);
        } else {
            // 우선순위 없음 (999) - 나중에 추가
            priorityGroups.set(999, priorityGroups.get(999) || []);
            priorityGroups.get(999).push(video);
        }
    });

    // 우선순위 순서대로 정렬
    const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);

    // 각 우선순위별로 최대 4개씩 선택 (우선순위 1-3만)
    sortedPriorities.forEach(priority => {
        const videosInGroup = priorityGroups.get(priority);

        if (priority === 999) {
            // 우선순위 없음 - 건너뜀
            videosInGroup.forEach(video => {
                skippedVideos.push({ video, reason: '우선순위 없음 (업로드 제외)' });
            });
        } else if (priority > 3) {
            // 우선순위 4 이상 - 건너뜀
            videosInGroup.forEach(video => {
                skippedVideos.push({ video, reason: `우선순위 ${priority} (3 초과, 업로드 제외)` });
            });
        } else {
            // 우선순위 1-3만 업로드 - 최대 4개만 선택
            const selectedCount = Math.min(videosInGroup.length, MAX_ACCOUNTS);
            filteredVideos.push(...videosInGroup.slice(0, selectedCount));

            // 나머지는 건너뜀
            if (videosInGroup.length > selectedCount) {
                videosInGroup.slice(selectedCount).forEach(video => {
                    skippedVideos.push({ video, reason: `우선순위 ${priority} (최대 ${MAX_ACCOUNTS}개 초과)` });
                });
            }
        }
    });

    // 건너뛴 비디오가 있으면 알림
    if (skippedVideos.length > 0) {
        console.log('⚠️  우선순위 중복으로 건너뛴 비디오:');
        skippedVideos.forEach(({ video, reason }) => {
            console.log(`   ❌ ${video.title} (${reason})`);
        });
        console.log('');
    }

    // 필터링된 비디오로 교체
    const originalCount = videos.length;
    videos.length = 0;
    videos.push(...filteredVideos);

    if (videos.length < originalCount) {
        console.log(`📊 ${originalCount}개 중 ${videos.length}개 비디오 선택됨 (중복 제거)\n`);
    }

    // Load credentials
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));

    // Load upload statistics
    let stats = loadUploadStats();
    console.log('📊 현재 업로드 통계:');
    for (let i = 1; i <= 4; i++) {
        const tokenPath = path.join(PROJECT_ROOT, `youtube-token-account${i}.json`);
        if (fs.existsSync(tokenPath)) {
            console.log(`   Account ${i}: ${stats[i] || 0}개`);
        }
    }
    console.log('');

    // Calculate upload plan
    console.log('📋 업로드 계획 생성 중...\n');
    const uploadPlan = [];
    let tempStats = { ...stats };
    let lastUsedAccount = null;

    // Load AccountManager for account names
    const accountManager = new AccountManager();

    for (let i = 0; i < videos.length; i++) {
        const bestAccount = findBestAccount(tempStats, lastUsedAccount);

        if (!bestAccount) {
            console.error('❌ 사용 가능한 계정이 없습니다.');
            return;
        }

        // Get account name from AccountManager (no API call during planning)
        let channelInfo;
        try {
            const accountData = accountManager.getAccount(`account${bestAccount}`);
            channelInfo = { title: accountData.name };
        } catch (err) {
            channelInfo = { title: '알 수 없음' };
        }

        uploadPlan.push({
            video: videos[i],
            accountNumber: bestAccount,
            channelInfo: channelInfo,
            index: i + 1
        });

        tempStats[bestAccount] = (tempStats[bestAccount] || 0) + 1;
        lastUsedAccount = bestAccount;
    }

    // Display upload plan grouped by account
    console.log('━'.repeat(80));
    console.log(`📋 업로드 계획 (총 ${videos.length}개)`);
    console.log('━'.repeat(80));

    // Group by account and add sequence number
    const groupedByAccount = {};
    for (const plan of uploadPlan) {
        const accountKey = plan.accountNumber;
        if (!groupedByAccount[accountKey]) {
            groupedByAccount[accountKey] = [];
        }
        groupedByAccount[accountKey].push(plan);
    }

    // Add account sequence number to each plan
    for (const accountNum in groupedByAccount) {
        const plans = groupedByAccount[accountNum];
        for (let i = 0; i < plans.length; i++) {
            plans[i].accountSequence = i + 1;
        }
    }

    // Display grouped
    for (let accountNum = 1; accountNum <= 4; accountNum++) {
        const plans = groupedByAccount[accountNum];
        if (!plans || plans.length === 0) continue;

        const channelName = plans[0].channelInfo ? plans[0].channelInfo.title : '알 수 없음';
        console.log(`\n📺 Account ${accountNum} (${channelName}) - ${plans.length}개`);
        console.log('   ' + '─'.repeat(75));

        for (let i = 0; i < plans.length; i++) {
            const plan = plans[i];
            const delayHours = i * 2;
            const scheduleInfo = i === 0 ? '즉시 공개 (public)' : `+${delayHours}시간 후 자동 공개 (private → public)`;
            const priorityTag = plan.video.priority && plan.video.priority < 999 ? ` [우선순위 ${plan.video.priority}]` : '';
            console.log(`   [${i + 1}] ${plan.video.title}${priorityTag}`);
            console.log(`       📁 ${plan.video.folder}`);
            console.log(`       ⏰ ${scheduleInfo}`);
        }
    }

    console.log('\n' + '━'.repeat(80));
    console.log('🔒 공개 설정: 첫 번째 비디오는 즉시 public, 나머지는 2시간 간격으로 자동 공개');
    console.log('━'.repeat(80));

    // Get user confirmation
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
        rl.question('\n전체 업로드를 진행하시겠습니까? (y/n): ', (answer) => {
            rl.close();
            resolve(answer);
        });
    });

    if (answer.toLowerCase() !== 'y') {
        console.log('\n❌ 업로드가 취소되었습니다.');
        return;
    }

    console.log('\n⏫ 업로드를 시작합니다...\n');

    // Upload each video according to plan
    let successCount = 0;
    let errorCount = 0;
    const deletedFolders = new Set();

    for (const plan of uploadPlan) {
        // Switch to planned account
        console.log(`\n🔄 Account ${plan.accountNumber}로 전환 중... (누적: ${stats[plan.accountNumber]}개)`);
        if (!switchAccount(plan.accountNumber)) {
            console.error('계정 전환 실패, 다음 비디오로 건너뜁니다.');
            errorCount++;
            continue;
        }

        // Authorize with switched account
        const auth = await authorize(credentials);

        const result = await uploadVideo(
            auth,
            plan.video,
            privacyStatus,
            plan.index,
            videos.length,
            plan.channelInfo,
            plan.accountSequence
        );

        if (result.success) {
            successCount++;

            // Update statistics
            stats[plan.accountNumber] = (stats[plan.accountNumber] || 0) + 1;
            saveUploadStats(stats);
            console.log(`📈 Account ${plan.accountNumber} 누적: ${stats[plan.accountNumber]}개`);

            // 업로드 성공 시 폴더 삭제 (비활성화됨)
            // if (result.folderPath && !deletedFolders.has(result.folderPath)) {
            //     try {
            //         fs.rmSync(result.folderPath, { recursive: true, force: true });
            //         console.log(`🗑️  폴더 삭제: ${path.basename(result.folderPath)}`);
            //         deletedFolders.add(result.folderPath);
            //     } catch (err) {
            //         console.error(`⚠️  폴더 삭제 실패: ${err.message}`);
            //     }
            // }
        } else if (result.error) {
            errorCount++;
        }

        // Wait a bit between uploads
        if (plan.index < videos.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Final summary
    console.log('\n' + '━'.repeat(80));
    console.log('📊 업로드 완료');
    console.log('━'.repeat(80));
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${errorCount}개`);
    console.log(`📝 전체: ${videos.length}개`);
    console.log('━'.repeat(80));
    console.log('📈 최종 업로드 통계:');
    for (let i = 1; i <= 4; i++) {
        const tokenPath = path.join(PROJECT_ROOT, `youtube-token-account${i}.json`);
        if (fs.existsSync(tokenPath)) {
            console.log(`   Account ${i}: ${stats[i] || 0}개`);
        }
    }
    console.log('━'.repeat(80));
}

// Run batch upload
batchUpload().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
