import express from 'express';
import { spawn, exec } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Internal ranking-videos 경로 (프로젝트 루트 기준)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RANKING_VIDEOS_PATH = path.join(PROJECT_ROOT, 'ranking-videos');
const INPUT_DIR = path.join(RANKING_VIDEOS_PATH, 'Input');
const OUTPUT_DIR = path.join(RANKING_VIDEOS_PATH, 'Output');
const TEMP_DIR = path.join(RANKING_VIDEOS_PATH, 'Temp');
const CONFIG_DIR = path.join(RANKING_VIDEOS_PATH, 'Config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const THUMBNAIL_CONFIG_FILE = path.join(CONFIG_DIR, 'thumbnail_config.json');
const LOG_FILE = path.join(TEMP_DIR, 'ranking_video.log');
const RUN_SCRIPT = path.join(RANKING_VIDEOS_PATH, 'run.sh');

// 실행 중인 스크립트 프로세스
let runningProcess = null;

// ===== HELPER FUNCTIONS =====

// Electron 앱 데이터 디렉토리에서 쿠키 파일 경로 가져오기
function getCookieFilePath(platform) {
    const homeDir = os.homedir();

    // Try multiple possible paths
    const possiblePaths = [
        // Electron app paths
        path.join(homeDir, 'Library', 'Application Support', 'shorts-factory-main', 'cookies', `${platform}_cookies.txt`),
        path.join(homeDir, 'Library', 'Application Support', '쇼츠공장', 'cookies', `${platform}_cookies.txt`),
        path.join(homeDir, 'Library', 'Application Support', 'Electron', 'cookies', `${platform}_cookies.txt`),
        // Tauri app path (fallback)
        path.join(homeDir, 'Library', 'Application Support', 'com.shortsfactory.app', 'cookies', `${platform}_cookies.txt`),
    ];

    for (const cookieFile of possiblePaths) {
        if (fsSync.existsSync(cookieFile)) {
            console.log(`[COOKIE] ${platform} 쿠키 파일 발견: ${cookieFile}`);
            return cookieFile;
        }
    }

    console.log(`[COOKIE] ${platform} 쿠키 파일 없음 (tried ${possiblePaths.length} paths)`);
    return null;
}

// URL에서 플랫폼 감지
function detectPlatform(url) {
    if (url.includes('instagram.com') || url.includes('instagr.am')) {
        return 'instagram';
    } else if (url.includes('tiktok.com')) {
        return 'tiktok';
    }
    return null;
}

// Config 파일 읽기
async function readConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Config 읽기 실패:', error);
        return null;
    }
}

// Config 파일 쓰기
async function writeConfig(config) {
    try {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error('Config 쓰기 실패:', error);
        return false;
    }
}

// 썸네일 Config 읽기
async function readThumbnailConfig() {
    try {
        const data = await fs.readFile(THUMBNAIL_CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Thumbnail Config 읽기 실패:', error);
        return { title_lines: [] };
    }
}

// 썸네일 Config 쓰기
async function writeThumbnailConfig(config) {
    try {
        await fs.writeFile(THUMBNAIL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error('Thumbnail Config 쓰기 실패:', error);
        return false;
    }
}

// yt-dlp로 비디오 다운로드
async function downloadVideo(url, index, mute = false) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const muteSuffix = mute ? '_muted' : '';
        // Input 폴더에 다운로드
        const outputTemplate = path.join(INPUT_DIR, `video_${timestamp}_${index}${muteSuffix}.%(ext)s`);

        console.log(`[DOWNLOAD] 비디오 ${index} 다운로드 중: ${url}`);

        // 플랫폼 감지 및 쿠키 파일 확인
        const platform = detectPlatform(url);
        const cookieFile = platform ? getCookieFilePath(platform) : null;

        const args = [
            '--verbose',  // 자세한 로그 출력
            '--user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '--add-header', 'Accept-Language:en-us,en;q=0.5',
            '--no-check-certificates',
            '-o', outputTemplate,
        ];

        // 쿠키 파일이 있으면 사용, 없으면 Chrome 브라우저 쿠키 사용
        if (cookieFile) {
            console.log(`[DOWNLOAD] ✅ ${platform} 쿠키 파일 사용: ${cookieFile}`);
            args.push('--cookies', cookieFile);
        } else {
            console.log(`[DOWNLOAD] ⚠️ ${platform} 쿠키 파일 없음 - Chrome 브라우저 쿠키 시도`);
            args.push('--cookies-from-browser', 'chrome');
        }

        args.push(url);

        console.log(`[DOWNLOAD] yt-dlp 명령어: yt-dlp ${args.join(' ')}`);

        const ytdlp = spawn('yt-dlp', args);

        let stdout = '';
        let stderr = '';

        ytdlp.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            // 로그를 즉시 출력하고 유지
            process.stdout.write(`[yt-dlp stdout] ${output}`);
        });

        ytdlp.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            // 에러 로그도 stdout으로 출력해서 보이게 유지
            process.stdout.write(`[yt-dlp stderr] ${output}`);
        });

        ytdlp.on('close', async (code) => {
            if (code === 0) {
                console.log(`\n[DOWNLOAD] ✅ 비디오 ${index} 다운로드 완료\n`);

                // 다운로드된 파일 찾기
                try {
                    const files = await fs.readdir(INPUT_DIR);
                    const downloadedFile = files.find(f =>
                        f.startsWith(`video_${timestamp}_${index}${muteSuffix}`)
                    );

                    const filePath = downloadedFile ? path.join(INPUT_DIR, downloadedFile) : null;

                    resolve({
                        success: true,
                        index: index,
                        url: url,
                        mute: mute,
                        filePath: filePath,
                        message: `비디오 ${index} 다운로드 완료`
                    });
                } catch (err) {
                    console.error(`[DOWNLOAD] 파일 경로 확인 실패:`, err);
                    resolve({
                        success: true,
                        index: index,
                        url: url,
                        mute: mute,
                        filePath: null,
                        message: `비디오 ${index} 다운로드 완료`
                    });
                }
            } else {
                console.error(`\n[DOWNLOAD] ❌ 비디오 ${index} 다운로드 실패 (코드: ${code})`);
                console.error(`[DOWNLOAD] 전체 stderr 로그:\n${stderr}`);
                console.error(`[DOWNLOAD] 전체 stdout 로그:\n${stdout}\n`);
                reject({
                    success: false,
                    index: index,
                    url: url,
                    error: stderr || `다운로드 실패 (코드: ${code})`
                });
            }
        });

        ytdlp.on('error', (error) => {
            console.error(`[DOWNLOAD] yt-dlp 실행 오류:`, error);
            reject({
                success: false,
                index: index,
                url: url,
                error: error.message
            });
        });
    });
}

// Python 스크립트 실행
function runPythonScript() {
    return new Promise((resolve, reject) => {
        console.log('[SCRIPT] Python 스크립트 실행 시작');

        // 로그 파일 초기화
        try {
            fsSync.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] 스크립트 실행 시작\n`);
        } catch (error) {
            console.error('[SCRIPT] 로그 파일 초기화 실패:', error);
        }

        // Temp 폴더 정리
        console.log('[SCRIPT] Temp 폴더 정리 중...');
        exec(`rm -rf "${TEMP_DIR}"/*`, (error) => {
            if (error) {
                console.error('[SCRIPT] Temp 폴더 정리 실패:', error);
            } else {
                console.log('[SCRIPT] Temp 폴더 정리 완료');
            }

            // run.sh 실행 (내부 ranking-videos 스크립트)
            console.log('[SCRIPT] ranking-videos/run.sh 실행 중...');

            // 로그 파일 스트림 생성
            const logStream = fsSync.openSync(LOG_FILE, 'w');

            // 환경변수 설정 (API 키 전달)
            const scriptEnv = {
                ...process.env,
                GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.AI_302_API_KEY || '',
                AI_302_API_KEY: process.env.AI_302_API_KEY || process.env.GEMINI_API_KEY || ''
            };

            // run.sh 실행 - stdout/stderr를 로그 파일로 리다이렉트
            const scriptProcess = spawn('bash', ['./run.sh'], {
                cwd: RANKING_VIDEOS_PATH,
                detached: true,
                stdio: ['ignore', logStream, logStream],  // stdin은 ignore, stdout/stderr는 log file로
                env: scriptEnv
            });

            scriptProcess.unref();
            runningProcess = scriptProcess;

            // 로그 파일이 닫히도록 설정
            scriptProcess.on('exit', () => {
                try {
                    fsSync.closeSync(logStream);
                } catch (err) {
                    console.error('[SCRIPT] 로그 파일 닫기 실패:', err);
                }
            });

            console.log(`[SCRIPT] 프로세스 시작됨 (PID: ${scriptProcess.pid})`);

            resolve({
                success: true,
                pid: scriptProcess.pid,
                message: '스크립트 실행 시작'
            });
        });
    });
}

// 실행 중인 스크립트 중지
function stopPythonScript() {
    return new Promise((resolve, reject) => {
        console.log('[SCRIPT] 스크립트 중지 요청');

        // run_mac.sh와 ffmpeg 프로세스 찾아서 종료
        exec(`ps aux | grep -E "run_mac.sh|ffmpeg.*Output" | grep -v grep | awk '{print $2}' | xargs kill -9`, (error, stdout, stderr) => {
            if (error) {
                console.error('[SCRIPT] 프로세스 종료 실패:', error);
                resolve({
                    success: false,
                    message: '실행 중인 프로세스를 찾을 수 없습니다'
                });
            } else {
                console.log('[SCRIPT] 프로세스 종료 완료');
                runningProcess = null;
                resolve({
                    success: true,
                    message: '스크립트가 중지되었습니다'
                });
            }
        });
    });
}

// 로그 파일 읽기
async function readLogFile(lines = 500) {
    try {
        if (!fsSync.existsSync(LOG_FILE)) {
            return '';
        }

        return new Promise((resolve, reject) => {
            exec(`tail -n ${lines} "${LOG_FILE}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error('[LOG] 로그 읽기 실패:', error);
                    resolve('');
                } else {
                    resolve(stdout);
                }
            });
        });
    } catch (error) {
        console.error('[LOG] 로그 읽기 오류:', error);
        return '';
    }
}

// ===== API ROUTES =====

// 단일 비디오 다운로드
router.post('/download-single', async (req, res) => {
    try {
        const { url, index, mute } = req.body;

        if (!url || index === undefined) {
            return res.status(400).json({
                success: false,
                error: 'URL과 index가 필요합니다'
            });
        }

        const result = await downloadVideo(url, index, mute || false);
        res.json(result);

    } catch (error) {
        console.error('[API] 다운로드 실패:', error);
        res.status(500).json({
            success: false,
            error: error.error || error.message
        });
    }
});

// 여러 비디오 일괄 다운로드
router.post('/download', async (req, res) => {
    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({
                success: false,
                error: 'URLs 배열이 필요합니다'
            });
        }

        const results = [];

        for (let i = 0; i < urls.length; i++) {
            const urlData = urls[i];
            if (urlData && urlData.url) {
                try {
                    const result = await downloadVideo(urlData.url, i, urlData.mute || false);
                    results.push(result);
                } catch (error) {
                    results.push(error);
                }
            }
        }

        // 성공한 다운로드 개수 확인
        const successCount = results.filter(r => r.success).length;

        // 5개 모두 성공하면 자동 실행
        if (successCount === 5) {
            console.log('[API] 5개 다운로드 완료, 자동 실행 시작');
            await runPythonScript();
        }

        res.json({
            success: true,
            results: results,
            autoRun: successCount === 5
        });

    } catch (error) {
        console.error('[API] 일괄 다운로드 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 스크립트 실행
router.post('/run-script', async (req, res) => {
    try {
        const result = await runPythonScript();
        res.json(result);
    } catch (error) {
        console.error('[API] 스크립트 실행 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 스크립트 중지
router.post('/stop-script', async (req, res) => {
    try {
        const result = await stopPythonScript();
        res.json(result);
    } catch (error) {
        console.error('[API] 스크립트 중지 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 로그 조회
router.get('/script-log', async (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 500;
        const log = await readLogFile(lines);

        res.json({
            success: true,
            log: log
        });
    } catch (error) {
        console.error('[API] 로그 조회 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            log: ''
        });
    }
});

// 언어 설정 조회
router.get('/get-language', async (req, res) => {
    try {
        const config = await readConfig();
        const language = config?.voice_settings?.language || 'en';

        res.json({
            success: true,
            language: language
        });
    } catch (error) {
        console.error('[API] 언어 조회 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 언어 설정 변경
router.post('/set-language', async (req, res) => {
    try {
        const { language } = req.body;

        if (!language || !['en', 'ko'].includes(language)) {
            return res.status(400).json({
                success: false,
                error: '유효하지 않은 언어입니다 (en 또는 ko)'
            });
        }

        const config = await readConfig();
        if (!config) {
            return res.status(500).json({
                success: false,
                error: 'Config 파일을 읽을 수 없습니다'
            });
        }

        // 언어 설정 업데이트
        if (!config.voice_settings) {
            config.voice_settings = {};
        }
        config.voice_settings.language = language;

        const writeSuccess = await writeConfig(config);
        if (!writeSuccess) {
            return res.status(500).json({
                success: false,
                error: 'Config 파일을 저장할 수 없습니다'
            });
        }

        const languageName = language === 'ko' ? '한국어' : 'English';
        console.log(`[API] 언어 설정 변경: ${languageName}`);

        res.json({
            success: true,
            language: language,
            message: `언어가 ${languageName}로 변경되었습니다`
        });

    } catch (error) {
        console.error('[API] 언어 설정 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 썸네일 설정 조회
router.get('/get-thumbnail-config', async (req, res) => {
    try {
        const config = await readThumbnailConfig();

        res.json({
            success: true,
            config: config
        });
    } catch (error) {
        console.error('[API] 썸네일 설정 조회 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 썸네일 설정 저장
router.post('/set-thumbnail-config', async (req, res) => {
    try {
        const { config } = req.body;

        if (!config) {
            return res.status(400).json({
                success: false,
                error: '썸네일 설정 데이터가 필요합니다'
            });
        }

        const writeSuccess = await writeThumbnailConfig(config);
        if (!writeSuccess) {
            return res.status(500).json({
                success: false,
                error: '썸네일 설정을 저장할 수 없습니다'
            });
        }

        console.log('[API] 썸네일 설정 저장 완료');

        res.json({
            success: true,
            message: '썸네일 설정이 저장되었습니다'
        });

    } catch (error) {
        console.error('[API] 썸네일 설정 저장 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 상태 확인
router.get('/status', async (req, res) => {
    try {
        // 프로젝트 경로 존재 확인
        const projectExists = fsSync.existsSync(RANKING_VIDEOS_PATH);
        const inputExists = fsSync.existsSync(INPUT_DIR);
        const outputExists = fsSync.existsSync(OUTPUT_DIR);
        const configExists = fsSync.existsSync(CONFIG_FILE);

        res.json({
            success: true,
            status: {
                projectPath: RANKING_VIDEOS_PATH,
                projectExists: projectExists,
                inputExists: inputExists,
                outputExists: outputExists,
                configExists: configExists,
                scriptRunning: runningProcess !== null
            }
        });
    } catch (error) {
        console.error('[API] 상태 확인 실패:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 로그인 상태 테스트
router.post('/test-login', async (req, res) => {
    try {
        const { platform } = req.body;

        if (!platform || !['instagram', 'tiktok'].includes(platform)) {
            return res.status(400).json({
                success: false,
                error: '유효한 플랫폼을 지정하세요 (instagram 또는 tiktok)'
            });
        }

        console.log(`[TEST] ${platform} 로그인 상태 테스트 시작`);

        // Chrome Cookies 데이터베이스 찾기 (모든 프로필 검색)
        const homeDir = os.homedir();
        const chromeDir = path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome');

        console.log(`[TEST] Chrome 디렉토리: ${chromeDir}`);

        // Chrome이 설치되어 있는지 확인
        if (!fsSync.existsSync(chromeDir)) {
            console.log(`[TEST] ❌ Chrome이 설치되어 있지 않습니다`);
            return res.json({
                success: false,
                loggedIn: false,
                message: 'Chrome 브라우저가 설치되어 있지 않습니다'
            });
        }

        // 모든 Chrome 프로필에서 Cookies 파일 찾기
        const findCookiesCommand = `find "${chromeDir}" -name "Cookies" -type f 2>/dev/null`;

        exec(findCookiesCommand, (findError, findStdout, findStderr) => {
            if (findError || !findStdout.trim()) {
                console.error(`[TEST] ❌ Chrome 쿠키 DB를 찾을 수 없습니다`);
                return res.json({
                    success: false,
                    loggedIn: false,
                    message: 'Chrome 쿠키 데이터를 찾을 수 없습니다'
                });
            }

            const cookieFiles = findStdout.trim().split('\n');
            console.log(`[TEST] 발견된 쿠키 파일 수: ${cookieFiles.length}`);

            const domain = platform === 'instagram' ? 'instagram.com' : 'tiktok.com';
            let totalCookies = 0;
            let checkedCount = 0;

            // 모든 쿠키 파일에서 해당 도메인 쿠키 확인
            cookieFiles.forEach((cookieFile, index) => {
                const query = `SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%${domain}%';`;

                exec(`sqlite3 "${cookieFile.trim()}" "${query}"`, (error, stdout, stderr) => {
                    checkedCount++;

                    if (!error && stdout.trim()) {
                        const count = parseInt(stdout.trim());
                        if (count > 0) {
                            totalCookies += count;
                            console.log(`[TEST] ${cookieFile}: ${count}개 쿠키 발견`);
                        }
                    }

                    // 모든 파일 확인 완료
                    if (checkedCount === cookieFiles.length) {
                        console.log(`[TEST] ${domain} 총 쿠키 개수: ${totalCookies}`);

                        if (totalCookies > 0) {
                            console.log(`[TEST] ✅ ${platform} Chrome 쿠키 연동 성공`);
                            res.json({
                                success: true,
                                loggedIn: true,
                                message: `${platform} Chrome 쿠키 연동 성공 - 로그인된 상태입니다 (${totalCookies}개 쿠키)`
                            });
                        } else {
                            console.log(`[TEST] ❌ ${platform} Chrome 쿠키 없음`);
                            res.json({
                                success: false,
                                loggedIn: false,
                                message: `Chrome 브라우저에서 ${platform}에 로그인하세요`
                            });
                        }
                    }
                });
            });
        });

    } catch (error) {
        console.error('[API] 로그인 테스트 실패:', error);
        res.status(500).json({
            success: false,
            loggedIn: false,
            error: error.message
        });
    }
});

// 테스트 라우트
router.get('/test', (req, res) => {
    res.json({
        message: 'Ranking Video API (Python Integration) is working!',
        timestamp: new Date().toISOString(),
        pythonProjectPath: RANKING_VIDEOS_PATH
    });
});

export default router;
