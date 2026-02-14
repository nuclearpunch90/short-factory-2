import express from 'express';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure FFmpeg globally for this module
// Configure FFmpeg globally for this module
import ffprobeStatic from 'ffprobe-static';
import ffmpegStatic from 'ffmpeg-static';

// Robust FFmpeg path setup
let ffmpegPath = ffmpegStatic;
if (!ffmpegPath || !fsSync.existsSync(ffmpegPath)) {
    console.warn('ffmpeg-static binary not found, falling back to system "ffmpeg"');
    ffmpegPath = 'ffmpeg';
}
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);
console.log(`[Video Route] Using FFmpeg path: ${ffmpegPath}`);

// 음악 사용 통계 파일 경로
const musicStatsFile = path.join(__dirname, '..', 'data', 'common', 'music_usage_stats.json');

// 공평한 랜덤 음악 선택 함수 (사용 횟수 기반)
async function getFairRandomMusic(folderPath) {
    try {
        // 폴더 내 음악 파일 목록 조회
        const musicFiles = await fs.readdir(folderPath);
        const validMusicFiles = musicFiles.filter(file =>
            file.toLowerCase().endsWith('.mp3') ||
            file.toLowerCase().endsWith('.wav') ||
            file.toLowerCase().endsWith('.m4a')
        );

        if (validMusicFiles.length === 0) return null;

        // 통계 파일 로드
        let stats = {};
        if (fsSync.existsSync(musicStatsFile)) {
            try {
                stats = JSON.parse(fsSync.readFileSync(musicStatsFile, 'utf8'));
            } catch (err) {
                console.error('Error reading music stats:', err);
            }
        }

        // 각 파일의 사용 횟수 확인 (폴더명 포함하여 유니크하게 관리)
        // folderPath에서 기본 폴더명 추출 (예: 'background music/folderA')
        const relativeFolderPath = path.relative(path.join(__dirname, '..'), folderPath);

        // 후보군 생성
        const candidates = validMusicFiles.map(file => {
            const key = path.join(relativeFolderPath, file).replace(/\\/g, '/');
            return {
                filename: file,
                key: key,
                count: stats[key] || 0
            };
        });

        // 사용 횟수 오름차순 정렬
        candidates.sort((a, b) => a.count - b.count);

        // 최소 사용 횟수 찾기
        const minCount = candidates[0].count;

        // 최소 사용 횟수를 가진 파일들 중 랜덤 선택 (동점자 처리)
        const bestCandidates = candidates.filter(c => c.count === minCount);
        const selected = bestCandidates[Math.floor(Math.random() * bestCandidates.length)];

        console.log(`Fair Random Music: Selected '${selected.filename}' (Used: ${selected.count} times)`);

        // 통계 업데이트 및 저장
        stats[selected.key] = selected.count + 1;

        // stats 파일이 있는 디렉토리 확인 및 생성
        const statsDir = path.dirname(musicStatsFile);
        if (!fsSync.existsSync(statsDir)) {
            fsSync.mkdirSync(statsDir, { recursive: true });
        }

        fsSync.writeFileSync(musicStatsFile, JSON.stringify(stats, null, 2), 'utf8');

        return selected.filename;

    } catch (error) {
        console.error('Error in getFairRandomMusic:', error);
        return null; // 실패 시 null 반환 -> 호출 측에서 처리
    }
}

// 전체 폴더에서 랜덤 음악 선택 함수 (모든 하위 폴더 포함)
async function getFairRandomMusicFromAllFolders(rootPath) {
    try {
        // 통계 파일 로드
        let stats = {};
        if (fsSync.existsSync(musicStatsFile)) {
            try {
                stats = JSON.parse(fsSync.readFileSync(musicStatsFile, 'utf8'));
            } catch (err) {
                console.error('Error reading music stats:', err);
            }
        }

        const candidates = [];
        const relativeRootPath = path.relative(path.join(__dirname, '..'), rootPath);

        // 모든 하위 폴더 스캔
        const folders = await fs.readdir(rootPath, { withFileTypes: true });

        for (const folder of folders) {
            if (folder.isDirectory()) {
                const folderPath = path.join(rootPath, folder.name);
                try {
                    const musicFiles = await fs.readdir(folderPath);
                    const validMusicFiles = musicFiles.filter(file =>
                        file.toLowerCase().endsWith('.mp3') ||
                        file.toLowerCase().endsWith('.wav') ||
                        file.toLowerCase().endsWith('.m4a')
                    );

                    for (const file of validMusicFiles) {
                        const relativePath = path.join(relativeRootPath, folder.name, file).replace(/\\/g, '/');
                        candidates.push({
                            filename: file,
                            folder: folder.name,
                            fullPath: path.join(folderPath, file),
                            key: relativePath,
                            count: stats[relativePath] || 0
                        });
                    }
                } catch (err) {
                    console.error(`Error reading folder ${folder.name}:`, err);
                }
            }
        }

        if (candidates.length === 0) return null;

        // 사용 횟수 오름차순 정렬
        candidates.sort((a, b) => a.count - b.count);

        // 최소 사용 횟수 찾기
        const minCount = candidates[0].count;

        // 최소 사용 횟수를 가진 파일들 중 랜덤 선택
        const bestCandidates = candidates.filter(c => c.count === minCount);
        const selected = bestCandidates[Math.floor(Math.random() * bestCandidates.length)];

        console.log(`Fair Random Music (All Folders): Selected '${selected.folder}/${selected.filename}' (Used: ${selected.count} times)`);

        // 통계 업데이트 및 저장
        stats[selected.key] = selected.count + 1;

        const statsDir = path.dirname(musicStatsFile);
        if (!fsSync.existsSync(statsDir)) {
            fsSync.mkdirSync(statsDir, { recursive: true });
        }

        fsSync.writeFileSync(musicStatsFile, JSON.stringify(stats, null, 2), 'utf8');

        return {
            path: selected.fullPath,
            folder: selected.folder,
            filename: selected.filename
        };

    } catch (error) {
        console.error('Error in getFairRandomMusicFromAllFolders:', error);
        return null;
    }
}

// 302.AI Whisper STT API
const AI_302_STT_URL = 'https://api.302.ai/v1/audio/transcriptions';

// 302.AI Whisper STT helper
async function transcribeWith302AI(apiKey, audioPath) {
    const formData = new FormData();
    formData.append('file', fsSync.createReadStream(audioPath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'ko');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');

    const response = await fetch(AI_302_STT_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders()
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`302.AI Whisper API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Whisper verbose_json 형식을 변환
    return {
        text: data.text,
        segments: data.segments?.map(seg => ({
            start: seg.start,
            end: seg.end,
            text: seg.text
        })) || []
    };
}

// 테스트 라우트
router.get('/test', (req, res) => {
    res.json({ message: 'Video API is working!', timestamp: new Date().toISOString() });
});

// FFmpeg 경로 설정 - 시스템 PATH 사용
// ffmpeg.setFfmpegPath('C:\\ffmpeg\\bin\\ffmpeg.exe');
// ffmpeg.setFfprobePath('C:\\ffmpeg\\bin\\ffprobe.exe');

// SRT 생성을 위한 함수들
function generateSRT(transcription) {
    let srtContent = '';
    let index = 1;

    // segments가 있는 경우 (verbose_json 응답)
    if (transcription.segments && transcription.segments.length > 0) {
        for (const segment of transcription.segments) {
            const startTime = formatTime(segment.start);
            const endTime = formatTime(segment.end);
            const text = segment.text.trim();

            if (text) {
                // 긴 텍스트는 적절한 길이로 분할 (최대 2줄)
                const maxLineLength = 35; // 한 줄 최대 글자 수 (좌우 마진 증가로 더 길게)
                const maxTotalLength = 70; // 전체 최대 글자 수 (2줄)

                if (text.length > maxTotalLength) {
                    // 텍스트가 너무 길면 여러 자막으로 분할
                    const words = text.split(/\s+/); // 공백으로 단어 분리
                    const subSegments = [];
                    let currentSegment = '';

                    for (const word of words) {
                        // 현재 세그먼트 + 새 단어가 최대 길이를 넘으면
                        if (currentSegment.length + word.length + 1 > maxTotalLength && currentSegment) {
                            // 한 줄로 유지 (줄바꿈 없음)
                            subSegments.push(currentSegment);
                            currentSegment = word;
                        } else {
                            currentSegment = currentSegment ? currentSegment + ' ' + word : word;
                        }
                    }

                    if (currentSegment) {
                        // 마지막 세그먼트도 한 줄로 유지
                        subSegments.push(currentSegment);
                    }

                    // 각 서브세그먼트에 시간 할당
                    const segmentDuration = segment.end - segment.start;
                    const timePerSegment = segmentDuration / subSegments.length;
                    for (let i = 0; i < subSegments.length; i++) {
                        const subStart = segment.start + (i * timePerSegment);
                        const subEnd = segment.start + ((i + 1) * timePerSegment);

                        srtContent += `${index}\n`;
                        srtContent += `${formatTime(subStart)} --> ${formatTime(subEnd)}\n`;
                        srtContent += `${subSegments[i]}\n\n`;
                        index++;
                    }
                } else {
                    // 모든 텍스트를 한 줄로 유지 (줄바꿈 없음)
                    srtContent += `${index}\n`;
                    srtContent += `${startTime} --> ${endTime}\n`;
                    srtContent += `${text}\n\n`;
                    index++;
                }
            }
        }
    } else {
        // segments가 없는 경우 전체 텍스트를 적절히 분할
        const text = transcription.text || '';
        const duration = transcription.duration || 10;
        const maxLineLength = 35; // 한 줄 최대 글자 수 (좌우 마진 증가로 더 길게)
        const maxTotalLength = 70; // 전체 최대 글자 수 (2줄)
        const chunks = [];

        // 텍스트를 단어 단위로 분할
        const words = text.split(/\s+/);
        let currentChunk = '';

        for (const word of words) {
            if (currentChunk.length + word.length + 1 > maxTotalLength && currentChunk) {
                // 한 줄로 유지 (줄바꿈 없음)
                chunks.push(currentChunk);
                currentChunk = word;
            } else {
                currentChunk = currentChunk ? currentChunk + ' ' + word : word;
            }
        }

        if (currentChunk) {
            // 마지막 청크도 한 줄로 유지
            chunks.push(currentChunk);
        }

        // 각 청크에 시간 할당
        const timePerChunk = duration / chunks.length;
        for (let i = 0; i < chunks.length; i++) {
            const startSec = i * timePerChunk;
            const endSec = (i + 1) * timePerChunk;

            srtContent += `${index}\n`;
            srtContent += `${formatTime(startSec)} --> ${formatTime(endSec)}\n`;
            srtContent += `${chunks[i]}\n\n`;
            index++;
        }
    }

    return srtContent;
}

// Logic-based SRT Generation (Perfect Sync for TTS)
function generateSRTFromDurations(script, durations) {
    let srtContent = '';
    let index = 1;
    let currentTime = 0;

    // Split script by newlines (matching how TTS segments are generated)
    const scriptParts = script.split(/\n+/).filter(part => part.trim());

    // Iterate through parts
    for (let i = 0; i < scriptParts.length; i++) {
        const text = scriptParts[i].trim();
        // Use duration if available, otherwise estimate or skip? 
        const duration = (i < durations.length) ? durations[i] : (text.length * 0.2); // Fallback estimate

        // Logic to sub-segment long text
        // User requested much shorter segments ("burdening" to see whole sentence)
        const maxBlockChars = 20; // Aggressive limit for Shorts (approx 4-5 words)

        // Always try to split if longer than limits, or contains sentence delimiters
        if (text.length > maxBlockChars || /[.!?]/.test(text)) {
            // Split into sub-segments based on punctuation or length

            // 1. Split by sentence delimiters first to keep semantic meaning
            // Use positive lookbehind/ahead or regex to include delimiter in the chunk
            let chunks = text.match(/[^.!?]+([.!?]+|$)/g) || [text];

            // 2. If any chunk is still too huge, split it by spaces
            let finalChunks = [];
            for (let chunk of chunks) {
                chunk = chunk.trim();
                // Even if chunk is small, if it's a separate sentence, it's already split by step 1
                // Now check if it needs further splitting by length
                if (chunk.length > maxBlockChars) {
                    const words = chunk.split(/\s+/);
                    let currentSub = '';
                    for (let w of words) {
                        // Check if adding next word exceeds limit
                        if ((currentSub + w).length > maxBlockChars) {
                            if (currentSub) finalChunks.push(currentSub);
                            currentSub = w;
                        } else {
                            currentSub = currentSub ? currentSub + ' ' + w : w;
                        }
                    }
                    if (currentSub) finalChunks.push(currentSub);
                } else if (chunk.length > 0) {
                    finalChunks.push(chunk);
                }
            }

            // Interpolate duration for each chunk
            let totalLength = text.replace(/\s+/g, '').length; // Count non-space chars for better accuracy
            if (totalLength === 0) totalLength = 1; // Prevent div by zero
            let accumulatedDuration = 0;

            for (let j = 0; j < finalChunks.length; j++) {
                const chunkText = finalChunks[j].trim();
                const chunkLen = chunkText.replace(/\s+/g, '').length;

                // Calculate portion of total duration
                let chunkDuration;
                if (j === finalChunks.length - 1) {
                    chunkDuration = duration - accumulatedDuration;
                } else {
                    chunkDuration = (chunkLen / totalLength) * duration;
                }

                // Prevent negative or zero duration
                if (chunkDuration <= 0) chunkDuration = 0.1;

                // Create subtitle entry
                const subStartTime = formatTime(currentTime);
                const subEndTime = formatTime(currentTime + chunkDuration);

                srtContent += `${index}\n`;
                srtContent += `${subStartTime} --> ${subEndTime}\n`;

                // Force newline if > 15 chars for vertical balance (Shorts style)
                let formattedText = chunkText;
                if (chunkText.length > 15 && !chunkText.includes('\n')) {
                    const mid = Math.floor(chunkText.length / 2);
                    const splitIdx = chunkText.lastIndexOf(' ', mid);
                    if (splitIdx > -1) {
                        formattedText = chunkText.substring(0, splitIdx) + '\n' + chunkText.substring(splitIdx + 1);
                    }
                }

                srtContent += `${formattedText}\n\n`;

                index++;
                currentTime += chunkDuration;
                accumulatedDuration += chunkDuration;
            }

        } else {
            // Short enough to fit in one block
            const startTime = formatTime(currentTime);
            const endTime = formatTime(currentTime + duration);

            srtContent += `${index}\n`;
            srtContent += `${startTime} --> ${endTime}\n`;
            srtContent += `${text}\n\n`;

            index++;
            currentTime += duration;
        }
    }

    return srtContent;
}

// 시간을 SRT 포맷으로 변환 (00:00:00,000)
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(milliseconds, 3)}`;
}

// 숫자를 지정된 자릿수로 패딩
function pad(num, size = 2) {
    let s = num.toString();
    while (s.length < size) s = "0" + s;
    return s;
}

// 이미지 업로드를 위한 multer 설정
const upload = multer({
    dest: path.join(__dirname, '..', 'uploads'),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('이미지 파일만 업로드 가능합니다.'));
        }
    }
});

// SRT 파일에서 타이밍 정보 파싱
function parseSRTTimings(srtContent) {
    const timings = [];
    const lines = srtContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
        // 타임스탬프 라인 찾기 (00:00:00,000 --> 00:00:00,000 형식)
        if (lines[i].includes('-->')) {
            const [start, end] = lines[i].split('-->').map(t => t.trim());
            const startSeconds = parseTimeToSeconds(start);
            const endSeconds = parseTimeToSeconds(end);

            // 다음 라인이 텍스트
            if (i + 1 < lines.length && lines[i + 1].trim()) {
                timings.push({
                    start: startSeconds,
                    end: endSeconds,
                    text: lines[i + 1].trim()
                });
            }
        }
    }

    return timings;
}

// SRT 시간 형식을 초로 변환
function parseTimeToSeconds(timeStr) {
    const [time, millis] = timeStr.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds + (Number(millis) / 1000);
}

// 스크립트 기반 클립 추출 함수
async function extractClipsByScript(inputsDir, outputDir, duration, script, srtContent, segmentDurations, selectedFiles = []) {
    try {
        // inputs 폴더의 모든 비디오 파일 가져오기
        // inputs 폴더의 모든 비디오 파일 가져오기 (70% 소스 - Root Inputs 강제)
        const rootInputsDir = path.join(__dirname, '..', 'inputs');
        const files = await fs.readdir(rootInputsDir);
        let videoFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext);
        });

        // Street inputs 폴더 확인 및 파일 가져오기 (30% 확률로 사용)
        const streetInputsDir = path.join(__dirname, '..', 'inputs', 'street');
        let streetVideoFiles = [];
        try {
            if (fsSync.existsSync(streetInputsDir)) {
                const sFiles = await fs.readdir(streetInputsDir);
                streetVideoFiles = sFiles.filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext);
                });
                console.log(`Found ${streetVideoFiles.length} street video files in inputs/street`);
            }
        } catch (e) {
            console.warn('Failed to read street inputs directory:', e);
        }

        // Parse selectedVideoFiles if it's a string
        if (typeof selectedFiles === 'string') {
            try { selectedFiles = JSON.parse(selectedFiles); } catch (e) { }
        }

        // Filter by selected files if provided
        if (selectedFiles && Array.isArray(selectedFiles) && selectedFiles.length > 0) {
            videoFiles = videoFiles.filter(file => selectedFiles.includes(file));
            console.log(`Filtering by selected files. Available candidates: ${videoFiles.length}`);
        }

        if (videoFiles.length === 0) {
            throw new Error('inputs 폴더에 비디오 파일이 없습니다.');
        }

        console.log(`Found ${videoFiles.length} video files in inputs folder for script extraction`);

        // Shuffle all video files for random selection
        const shuffledVideos = [...videoFiles];
        for (let i = shuffledVideos.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledVideos[i], shuffledVideos[j]] = [shuffledVideos[j], shuffledVideos[i]];
        }

        let videoIndex = 0;


        // 스크립트 줄바꿈 기준으로 세그먼트 나누기
        let segments = [];

        if (script && segmentDurations && segmentDurations.length > 0) {
            // segmentDurations이 있으면 각 세그먼트의 정확한 길이 사용
            const scriptParts = script.split(/\n+/).filter(part => part.trim());

            console.log(`Script split into ${scriptParts.length} parts with exact durations:`, segmentDurations);

            let currentTime = 0;
            for (let i = 0; i < scriptParts.length && i < segmentDurations.length; i++) {
                const segmentDuration = segmentDurations[i];
                segments.push({
                    start: currentTime,
                    end: currentTime + segmentDuration,
                    duration: segmentDuration,
                    text: scriptParts[i].trim(),
                    partIndex: i
                });
                console.log(`Segment ${i + 1}: "${scriptParts[i].substring(0, 30)}..." (${currentTime.toFixed(2)}s - ${(currentTime + segmentDuration).toFixed(2)}s, duration: ${segmentDuration.toFixed(2)}s)`);
                currentTime += segmentDuration;
            }
        } else if (script) {
            // segmentDurations이 없으면 기존 방식 (균등 분할)
            const scriptParts = script.split(/\n+/).filter(part => part.trim());

            console.log(`Script split into ${scriptParts.length} parts (equal duration):`, scriptParts);

            if (scriptParts.length > 0) {
                const segmentDuration = duration / scriptParts.length;

                for (let i = 0; i < scriptParts.length; i++) {
                    segments.push({
                        start: i * segmentDuration,
                        end: (i + 1) * segmentDuration,
                        duration: segmentDuration,
                        text: scriptParts[i],
                        partIndex: i
                    });
                    console.log(`Segment ${i + 1}: "${scriptParts[i]}" (${(i * segmentDuration).toFixed(2)}s - ${((i + 1) * segmentDuration).toFixed(2)}s)`);
                }
            } else {
                segments.push({
                    start: 0,
                    end: duration,
                    duration: duration,
                    text: script,
                    partIndex: 0
                });
            }
        } else {
            // 스크립트도 없으면 전체를 하나의 세그먼트로
            segments.push({
                start: 0,
                end: duration,
                duration: duration,
                text: ''
            });
        }

        console.log(`Created ${segments.length} segments for video clips`);

        const clips = [];

        // 각 세그먼트마다 클립 생성
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];

            // 세그먼트 길이를 채우기 위해 여러 개의 짧은 클립 생성
            let remainingDuration = segment.duration;
            let clipIndex = 0;

            while (remainingDuration > 0.1) {
                let currentVideoPath;
                let isStreetVideo = false;

                // 30% Chance to pick from 'street' inputs if available
                if (streetVideoFiles.length > 0 && Math.random() < 0.3) {
                    const randomStreetVideo = streetVideoFiles[Math.floor(Math.random() * streetVideoFiles.length)];
                    currentVideoPath = path.join(streetInputsDir, randomStreetVideo);
                    isStreetVideo = true;
                    console.log(`[Mix] Selected STREET video: ${randomStreetVideo}`);
                } else {
                    // Normal Selection (Stratified) from ROOT Inputs

                    // If no root files available, try street fallback
                    if (videoFiles.length === 0) {
                        if (streetVideoFiles.length > 0) {
                            const randomStreetVideo = streetVideoFiles[Math.floor(Math.random() * streetVideoFiles.length)];
                            currentVideoPath = path.join(streetInputsDir, randomStreetVideo);
                            isStreetVideo = true;
                            console.log(`[Mix] Fallback to STREET video (no root files): ${randomStreetVideo}`);
                        } else {
                            console.error('No video files available at all!');
                            break;
                        }
                    } else {
                        // Select next video from shuffled list
                        const currentVideo = shuffledVideos[videoIndex % shuffledVideos.length];
                        videoIndex++;

                        currentVideoPath = path.join(rootInputsDir, currentVideo);
                        isStreetVideo = false;
                    }
                }

                // 현재 비디오 길이 가져오기
                let currentVideoDuration = 0;
                try {
                    currentVideoDuration = await new Promise((resolve, reject) => {
                        ffmpeg.ffprobe(currentVideoPath, (err, metadata) => {
                            if (err) reject(err);
                            else resolve(metadata.format.duration);
                        });
                    });
                } catch (err) {
                    console.error(`Error probing video ${currentVideoPath}:`, err);
                    continue; // Skip bad file
                }

                // 클립 길이: 남은 시간과 비디오 길이 중 작은 값 (최대 2초)
                // Street video logic also uses 2s max duration automatically here
                const clipDuration = Math.min(remainingDuration, currentVideoDuration, 2);

                if (clipDuration > 0.1) {
                    const maxStart = Math.max(0, currentVideoDuration - clipDuration);
                    const startTime = Math.random() * maxStart;

                    clips.push({
                        path: currentVideoPath,
                        start: startTime,
                        duration: clipDuration,
                        index: i,
                        scriptLine: segment.text
                    });

                    console.log(`Clip ${i + 1}-${clipIndex + 1}: ${path.basename(currentVideoPath)} (${startTime.toFixed(2)}s - ${(startTime + clipDuration).toFixed(2)}s) duration: ${clipDuration.toFixed(2)}s [Start: ${startTime.toFixed(2)}] ${isStreetVideo ? '[STREET]' : ''}`);

                    remainingDuration -= clipDuration;
                    clipIndex++;
                } else {
                    break;
                }
            }
        }

        return clips;
    } catch (error) {
        console.error('Error extracting clips by script:', error);
        throw error;
    }
}

// inputs 폴더에서 랜덤 클립 추출 함수 (구버전 - 스크립트 없을 때용)
async function extractRandomClips(inputsDir, outputDir, duration, selectedFiles = []) {
    try {
        // inputs 폴더의 모든 비디오 파일 가져오기 (70% 소스 - Root Inputs 강제)
        const rootInputsDir = path.join(__dirname, '..', 'inputs');
        const files = await fs.readdir(rootInputsDir);
        let videoFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext);
        });

        // Street inputs 폴더 확인 및 파일 가져오기 (30% 확률로 사용)
        const streetInputsDir = path.join(__dirname, '..', 'inputs', 'street');
        let streetVideoFiles = [];
        try {
            if (fsSync.existsSync(streetInputsDir)) {
                const sFiles = await fs.readdir(streetInputsDir);
                streetVideoFiles = sFiles.filter(file => {
                    const ext = path.extname(file).toLowerCase();
                    return ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext);
                });
                console.log(`Found ${streetVideoFiles.length} street video files in inputs/street`);
            }
        } catch (e) {
            console.warn('Failed to read street inputs directory:', e);
        }

        // Parse selectedVideoFiles if it's a string
        if (typeof selectedFiles === 'string') {
            try { selectedFiles = JSON.parse(selectedFiles); } catch (e) { }
        }

        // Filter by selected files if provided
        if (selectedFiles && Array.isArray(selectedFiles) && selectedFiles.length > 0) {
            videoFiles = videoFiles.filter(file => selectedFiles.includes(file));
            console.log(`Filtering by selected files. Available candidates: ${videoFiles.length}`);
        }

        if (videoFiles.length === 0) {
            throw new Error('inputs 폴더에 비디오 파일이 없습니다.');
        }

        console.log(`Found ${videoFiles.length} video files in inputs folder`);

        // 각 비디오에서 랜덤 클립 추출
        const clips = [];
        let totalDuration = 0;
        const targetDuration = duration || 30; // 기본 30초
        const maxClips = 50; // 최대 50개까지 허용 (짧은 클립으로도 시간을 채울 수 있도록)

        // Shuffle all video files for random selection
        const shuffledVideos2 = [...videoFiles];
        for (let i = shuffledVideos2.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledVideos2[i], shuffledVideos2[j]] = [shuffledVideos2[j], shuffledVideos2[i]];
        }

        let videoIndex2 = 0;

        while (totalDuration < targetDuration && clips.length < maxClips) {
            let videoPath;
            let isStreetVideo = false;

            // 30% Chance to pick from 'street' inputs if available
            if (streetVideoFiles.length > 0 && Math.random() < 0.3) {
                const randomStreetVideo = streetVideoFiles[Math.floor(Math.random() * streetVideoFiles.length)];
                videoPath = path.join(streetInputsDir, randomStreetVideo);
                isStreetVideo = true;
                console.log(`[Mix] Selected STREET video: ${randomStreetVideo}`);
            } else {
                // If no root files available, try street fallback
                if (videoFiles.length === 0) {
                    if (streetVideoFiles.length > 0) {
                        const randomStreetVideo = streetVideoFiles[Math.floor(Math.random() * streetVideoFiles.length)];
                        videoPath = path.join(streetInputsDir, randomStreetVideo);
                        isStreetVideo = true;
                        console.log(`[Mix] Fallback to STREET video (no root files): ${randomStreetVideo}`);
                    } else {
                        console.error('No video files available at all!');
                        break;
                    }
                } else {
                    // Select next video from shuffled list
                    const randomVideo = shuffledVideos2[videoIndex2 % shuffledVideos2.length];
                    videoIndex2++;
                    videoPath = path.join(rootInputsDir, randomVideo);
                    isStreetVideo = false;
                }
            }

            // 비디오 길이 가져오기
            let videoDuration = 0;
            try {
                videoDuration = await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(videoPath, (err, metadata) => {
                        if (err) reject(err);
                        else resolve(metadata.format.duration);
                    });
                });
            } catch (err) {
                console.error(`Error probing video ${videoPath}:`, err);
                continue;
            }


            // 각 클립 2초로 고정
            const clipDuration = 2; // 2초 고정
            const remainingDuration = targetDuration - totalDuration;
            const actualClipDuration = Math.min(clipDuration, remainingDuration, videoDuration);

            if (actualClipDuration < 0.5) break; // 0.5초 미만이면 중단

            // 랜덤 시작 지점 (비디오 길이 - 클립 길이 범위 내에서)
            const maxStart = Math.max(0, videoDuration - actualClipDuration);
            const startTime = Math.random() * maxStart;

            clips.push({
                path: videoPath,
                start: startTime,
                duration: actualClipDuration,
                index: clips.length
            });
            console.log(`Clip ${clips.length}: ${path.basename(videoPath)} (${startTime.toFixed(2)}s - ${(startTime + actualClipDuration).toFixed(2)}s) duration: ${actualClipDuration.toFixed(2)}s [Start: ${startTime.toFixed(2)}] ${isStreetVideo ? '[STREET]' : ''}`);

            totalDuration += actualClipDuration;
        }



        return clips;
    } catch (error) {
        console.error('Error extracting random clips:', error);
        throw error;
    }
}

// 클립들을 하나의 비디오로 합치기
async function concatenateClips(clips, outputPath, audioPath, srtPath, title, template = '1.png', outro = '', includeAds = false, includeTitle = false, videoFilter = 'none') {
    return new Promise(async (resolve, reject) => {
        const ffmpegCommand = ffmpeg();

        // 템플릿 파일 추가 (배경으로 사용)
        const templatePath = path.join(__dirname, '..', 'template', template);
        let isVideoTemplate = false;

        if (fsSync.existsSync(templatePath)) {
            isVideoTemplate = template.toLowerCase().endsWith('.mp4') ||
                template.toLowerCase().endsWith('.avi') ||
                template.toLowerCase().endsWith('.mov');

            if (isVideoTemplate) {
                // 비디오 템플릿인 경우 - stream_loop로 반복
                ffmpegCommand.input(templatePath)
                    .inputOptions(['-stream_loop', '-1']); // 무한 반복
            } else {
                // 이미지 템플릿인 경우 - 기존 방식
                ffmpegCommand.input(templatePath)
                    .inputOptions(['-loop', '1']);
            }
        }

        // 모든 클립을 입력으로 추가
        clips.forEach(clip => {
            ffmpegCommand.input(clip.path)
                .inputOptions([
                    `-ss ${clip.start}`,
                    `-t ${clip.duration}`
                ]);
        });

        // 오디오 추가 (있는 경우)
        if (audioPath) {
            ffmpegCommand.input(audioPath);
        }

        // 배너 추가 (있는 경우)
        const bannerPath = path.join(__dirname, '..', 'data', 'common', 'ads', 'banner.png');
        const hasBanner = fsSync.existsSync(bannerPath);
        if (hasBanner) {
            ffmpegCommand.input(bannerPath).inputOptions(['-loop', '1']);
        }

        // 필터 컴플렉스 생성
        let filterComplex = [];
        const hasTemplate = fsSync.existsSync(templatePath);
        const videoStartIndex = hasTemplate ? 1 : 0;
        const videoCount = clips.length;
        const hasAudio = !!audioPath;
        let audioIndex = hasTemplate ? videoCount + 1 : videoCount;
        let bannerIndex = audioIndex;
        if (hasAudio) {
            bannerIndex = audioIndex + 1;
        } else if (hasBanner) {
            audioIndex = bannerIndex;
        }

        // 템플릿이 있는 경우, 템플릿을 1080x1920로 스케일 (꽉 채우기)
        if (hasTemplate) {
            if (isVideoTemplate) {
                // 비디오 템플릿인 경우 - 반복되도록 처리, fps=30으로 설정, 꽉 채우기
                filterComplex.push(
                    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[template]`
                );
            } else {
                // 이미지 템플릿인 경우 - 꽉 채우기
                filterComplex.push(
                    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[template]`
                );
            }
        }

        // 각 비디오 클립을 65% 크기로 스케일링 (702x1248) - 꽉 채우기
        clips.forEach((clip, i) => {
            const inputIndex = hasTemplate ? i + 1 : i;
            let filterChain = `scale=702:1248:force_original_aspect_ratio=increase,crop=702:1248,setsar=1,fps=30`;

            // Apply Video Filter
            if (videoFilter === 'western') {
                filterChain += `,eq=contrast=1.15:saturation=1.2,colorbalance=rs=.05:bs=-.05`;
            }

            filterComplex.push(
                `[${inputIndex}:v]${filterChain}[v${i}]`
            );
        });

        // 비디오 클립들을 연결
        const videoInputs = clips.map((_, i) => `[v${i}]`).join('');
        filterComplex.push(`${videoInputs}concat=n=${videoCount}:v=1:a=0[clip]`);

        // 템플릿과 클립 오버레이 (클립을 중앙 하단에 배치)
        if (hasTemplate) {
            filterComplex.push(
                `[template][clip]overlay=(W-w)/2:450:shortest=1[composed]`
            );
        } else {
            filterComplex.push('[clip]copy[composed]');
        }

        // 먼저 제목 추가 (화면 상단에 검은색으로, 배경 없이)
        let videoWithTitle = 'composed';
        // DISABLED: Title overlay completely removed per user request
        if (false && includeTitle && title && title.trim()) {
            console.log('Adding title to video:', title);
            console.log('Title length:', title.length);

            // 제목이 너무 길면 자르기 (최대 30자)
            let processedTitle = title.trim();
            if (processedTitle.length > 30) {
                processedTitle = processedTitle.substring(0, 27) + '...';
                console.log('Title truncated to:', processedTitle);
            }

            // 제목 텍스트 정리 및 이스케이프
            const normalizedTitle = processedTitle
                .replace(/\\/g, '\\\\')  // 백슬래시
                .replace(/'/g, "\\'")     // 작은따옴표
                .replace(/"/g, '\\"')     // 큰따옴표  
                .replace(/:/g, '\\:')     // 콜론
                .replace(/,/g, '\\,')     // 쉼표
                .replace(/\[/g, '\\[')    // 대괄호
                .replace(/\]/g, '\\]')    // 대괄호
                .replace(/=/g, '\\=')     // 등호
                .replace(/%/g, '\\%')     // 퍼센트
                .replace(/;/g, '\\;')     // 세미콜론
                .replace(/\(/g, '\\(')    // 괄호
                .replace(/\)/g, '\\)');   // 괄호

            // 폰트 경로 설정
            const fontPath = path.join(__dirname, '..', 'data', 'common', 'fonts', 'NanumMyeongjo.ttf');
            const normalizedFontPath = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');

            console.log('Processed title:', normalizedTitle);
            console.log('Font path:', normalizedFontPath);

            // 제목 필터 추가 - 검은색, 배경 없음, y=272 (8픽셀 위로)
            // 폰트 크기 증가
            filterComplex.push(
                `[composed]drawtext=text='${normalizedTitle}':fontfile='${normalizedFontPath}':fontsize=72:fontcolor=black:x=(w-text_w)/2:y=272:fix_bounds=true[withtitle]`
            );
            videoWithTitle = 'withtitle';
        }

        // 그 다음 자막 추가 (화면 하단에)
        let videoWithSubtitles = videoWithTitle;
        if (srtPath && fsSync.existsSync(srtPath)) {
            const normalizedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
            const fontsDir = path.join(__dirname, '..', 'data', 'common', 'fonts');
            const normalizedFontsDir = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');

            filterComplex.push(
                `[${videoWithTitle}]subtitles='${normalizedSrtPath}':fontsdir='${normalizedFontsDir}':force_style='Fontname=NanumMyeongjo,Fontsize=8,PrimaryColour=&Hffffff,BackColour=&H00000000,BorderStyle=1,Outline=0,Shadow=0.5,Alignment=10,MarginV=30,MarginL=10,MarginR=10,Bold=1'[withsubtitles]`
            );
            videoWithSubtitles = 'withsubtitles';
        }

        // 최상단 배너 오버레이 추가
        let finalVideo = videoWithSubtitles;

        if (hasBanner) {
            console.log('Adding top banner overlay:', bannerPath);

            // 배너를 비디오 너비(702px)에 맞게 스케일링하고 최상단(y=0)에 오버레이
            filterComplex.push(
                `[${bannerIndex}:v]scale=702:-1[banner]`
            );
            filterComplex.push(
                `[${videoWithSubtitles}][banner]overlay=x=0:y=0:shortest=1[final]`
            );
            finalVideo = 'final';
        } else {
            console.log('Banner not found, skipping overlay');
            filterComplex.push(`[${videoWithSubtitles}]copy[final]`);
            finalVideo = 'final';
        }

        ffmpegCommand.complexFilter(filterComplex);

        // 출력 옵션
        const outputOptions = [
            '-map', '[final]',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-pix_fmt', 'yuv420p'
        ];

        if (hasAudio) {
            outputOptions.push(
                '-map', `${audioIndex}:a`,
                '-c:a', 'aac',
                '-b:a', '192k',
                // '-shortest' 
            );
        } else {
            outputOptions.push('-an'); // 오디오 없음
        }

        // outro가 있으면 임시 파일로 먼저 생성
        const tempOutputPath = outro ? outputPath.replace('.mp4', '_temp.mp4') : outputPath;

        ffmpegCommand
            .outputOptions(outputOptions)
            .output(tempOutputPath)
            .on('start', (commandLine) => {
                console.log('Concatenation FFmpeg command:', commandLine);
            })
            .on('progress', (progress) => {
                console.log('Concatenating: ' + (progress.percent || 0).toFixed(2) + '% done');
            })
            .on('end', async () => {
                console.log('Video concatenation completed');

                // ads 추가 여부 확인
                let currentOutputPath = tempOutputPath;

                // ads를 추가하는 경우
                if (includeAds) {
                    console.log('Adding advertisement...');
                    const adsDir = path.join(__dirname, '..', 'data/common/ads');

                    try {
                        const adsFiles = await fs.readdir(adsDir);
                        const validAdsFiles = adsFiles.filter(file =>
                            file.toLowerCase().endsWith('.mp4') ||
                            file.toLowerCase().endsWith('.avi') ||
                            file.toLowerCase().endsWith('.mov')
                        );

                        if (validAdsFiles.length > 0) {
                            // 랜덤으로 광고 선택
                            const randomAd = validAdsFiles[Math.floor(Math.random() * validAdsFiles.length)];
                            const adPath = path.join(adsDir, randomAd);
                            console.log('Selected ad:', randomAd);

                            const adTempPath = currentOutputPath.replace('.mp4', '_with_ad.mp4');

                            await new Promise((resolveAd, rejectAd) => {
                                // 먼저 메인 비디오의 길이를 가져옴
                                ffmpeg.ffprobe(currentOutputPath, (err, metadata) => {
                                    if (err) {
                                        console.error('Error getting video duration:', err);
                                        rejectAd(err);
                                        return;
                                    }

                                    const videoDuration = metadata.format.duration;
                                    const overlapTime = 1.5; // 1.5초 겹침
                                    const mainVideoCutDuration = Math.max(0, videoDuration - overlapTime);

                                    ffmpeg()
                                        .input(currentOutputPath)
                                        .input(adPath)
                                        .complexFilter([
                                            // 첫 번째 비디오를 2초 일찍 자르고 정규화 - 꽉 채우기
                                            `[0:v]trim=duration=${mainVideoCutDuration},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v0]`,
                                            `[0:a]atrim=duration=${mainVideoCutDuration}[a0]`,
                                            // 두 번째 비디오 (광고) 정규화 - 꽉 채우기
                                            '[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v1]',
                                            // 비디오와 오디오를 함께 연결 (2초 일찍 광고 시작)
                                            '[v0][a0][v1][1:a]concat=n=2:v=1:a=1[outv][outa]'
                                        ])
                                        .outputOptions([
                                            '-map', '[outv]',
                                            '-map', '[outa]',
                                            '-c:v', 'libx264',
                                            '-preset', 'medium',
                                            '-crf', '23',
                                            '-pix_fmt', 'yuv420p',
                                            '-c:a', 'aac',
                                            '-b:a', '192k'
                                        ])
                                        .output(adTempPath)
                                        .on('end', () => {
                                            console.log('Ad added successfully (overlapped last 1.5 seconds)');
                                            // 이전 임시 파일 삭제
                                            fsSync.unlinkSync(currentOutputPath);
                                            currentOutputPath = adTempPath;
                                            resolveAd();
                                        })
                                        .on('error', (err) => {
                                            console.error('Ad addition error:', err);
                                            // 실패시 광고 없이 진행
                                            resolveAd();
                                        })
                                        .run();
                                });
                            });
                        } else {
                            console.log('No ad files found in ads folder');
                        }
                    } catch (error) {
                        console.error('Error reading ads folder:', error);
                    }
                }

                // outro가 있으면 outro와 합치기
                if (outro) {
                    console.log('Adding outro video:', outro);
                    const outroPath = path.join(__dirname, '..', 'outro', outro);

                    if (fsSync.existsSync(outroPath)) {
                        await new Promise((resolveOutro, rejectOutro) => {
                            ffmpeg()
                                .input(currentOutputPath)
                                .input(outroPath)
                                .complexFilter([
                                    // 비디오 정규화 (outro는 겹치지 않음) - 꽉 채우기
                                    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v0]',
                                    '[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v1]',
                                    // 비디오와 오디오를 함께 연결
                                    '[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[outv][outa]'
                                ])
                                .outputOptions([
                                    '-map', '[outv]',
                                    '-map', '[outa]',
                                    '-c:v', 'libx264',
                                    '-preset', 'medium',
                                    '-crf', '23',
                                    '-pix_fmt', 'yuv420p',
                                    '-c:a', 'aac',
                                    '-b:a', '192k'
                                ])
                                .output(outputPath)
                                .on('end', () => {
                                    console.log('Outro added successfully');
                                    // 임시 파일 삭제
                                    fsSync.unlinkSync(currentOutputPath);
                                    resolveOutro();
                                })
                                .on('error', (err) => {
                                    console.error('Outro addition error:', err);
                                    // 실패시 임시 파일을 최종 파일로 이동
                                    fsSync.renameSync(currentOutputPath, outputPath);
                                    resolveOutro(); // outro 추가 실패해도 계속 진행
                                })
                                .run();
                        });
                    } else {
                        console.log('Outro file not found, skipping outro');
                        // outro 파일이 없으면 임시 파일을 최종 파일로 이동
                        fsSync.renameSync(currentOutputPath, outputPath);
                    }
                } else {
                    // outro가 없으면 임시 파일을 최종 파일로 이동
                    fsSync.renameSync(currentOutputPath, outputPath);
                }

                resolve();
            })
            .on('error', (err) => {
                console.error('Concatenation error:', err);
                reject(err);
            })
            .run();
    });
}

// 이미지 + 오디오로 비디오 생성 (기존 엔드포인트 유지)
router.post('/generate-video', upload.single('image'), async (req, res) => {
    const { audioPath, title, projectFolder, backgroundMusic, useRandomClips, script, segmentDurations, inputFolder, template, outro, videoIndex, includeAds, includeTitle, videoFilter } = req.body;
    const imageFile = req.file;

    // useRandomClips가 true면 inputs 폴더에서 랜덤 클립 사용
    if (useRandomClips === 'true' || useRandomClips === true) {
        try {
            console.log('Generating video with random clips from inputs folder');

            // 프로젝트 폴더 생성
            let finalProjectFolder = projectFolder;
            if (!projectFolder || projectFolder === 'undefined') {
                const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
                finalProjectFolder = `video_${timestamp}`;
                console.log('Auto-generated project folder:', finalProjectFolder);
            }

            const outputDir = path.join(__dirname, '..', 'outputs', finalProjectFolder);
            await fs.mkdir(outputDir, { recursive: true });

            // temp 폴더 생성
            const tempDir = path.join(outputDir, 'temp');
            await fs.mkdir(tempDir, { recursive: true });

            const timestamp = Date.now();
            // videoIndex가 있으면 파일명에 추가
            const videoSuffix = videoIndex ? `_v${videoIndex}` : '';

            let videoFilename;
            if (title) {
                // 제목을 파일명으로 사용 (OneDrive 호환 처리)
                // 1. 유니코드 정규화 (한글 자모 결합)
                // 2. OneDrive 금지 문자 제거: \ / : * ? " < > |
                // 3. 제어 문자, 특수 유니코드, 점으로 시작/끝나는 문자 제거
                const sanitizedTitle = title
                    .normalize('NFC')  // 한글 자모 결합
                    .replace(/[\\/:*?"<>|]/g, '')  // OneDrive 금지 문자
                    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')  // 제어 문자
                    .replace(/[\u0300-\u036f]/g, '')  // 결합 분음 부호
                    .replace(/^\.|\.$|^\s+|\s+$/g, '')  // 점이나 공백으로 시작/끝
                    .replace(/\s+/g, '_')  // 공백을 언더스코어로
                    .replace(/_+/g, '_')  // 연속 언더스코어 제거
                    .substring(0, 200);  // 최대 길이 제한
                videoFilename = `${sanitizedTitle}${videoSuffix}.mp4`;
            } else {
                videoFilename = `video${videoSuffix}_${timestamp}.mp4`;
            }
            const videoPath = path.join(outputDir, videoFilename);

            // inputs 폴더 경로 (inputFolder가 지정되면 해당 하위폴더 사용)
            // inputs 폴더 경로 (inputFolder가 지정되면 해당 하위폴더 사용)
            let inputsDir = path.join(__dirname, '..', 'inputs');

            // Check if folder exists in Output directory first (e.g., ai-videos, ai-shorts, etc.)
            // inputFolder가 있을 때만 path.join 실행
            // inputFolder 유효성 검사 및 Output 폴더 확인
            let outputDirExists = false;
            let possibleOutputDir = '';

            if (inputFolder && inputFolder !== 'undefined' && inputFolder !== 'all') {
                possibleOutputDir = path.join(__dirname, '..', 'Output', inputFolder);
                outputDirExists = fsSync.existsSync(possibleOutputDir);
            }

            if (outputDirExists) {
                inputsDir = possibleOutputDir;
                console.log(`Using folder from Output directory: ${inputsDir}`);
            } else if (inputFolder && inputFolder !== 'undefined' && inputFolder !== 'all') {
                // Check if this folder is in folder-paths.json
                const pathsFile = path.join(__dirname, '..', 'folder-paths.json');
                try {
                    const pathsData = await fs.readFile(pathsFile, 'utf-8');
                    const paths = JSON.parse(pathsData);
                    if (paths[inputFolder]) {
                        // Use local path from folder-paths.json
                        let mappedPath = paths[inputFolder];
                        // If it's a relative path, make it absolute relative to project root
                        if (mappedPath.startsWith('./') || mappedPath.startsWith('../')) {
                            inputsDir = path.resolve(__dirname, '..', mappedPath);
                        } else {
                            inputsDir = mappedPath;
                        }
                        console.log(`Using folder path from mapping: ${inputsDir}`);
                    } else if (inputFolder === 'Output' || inputFolder === 'output') {
                        // Fallback for 'Output' specifically if not in mappings
                        inputsDir = path.join(__dirname, '..', 'Output');
                        console.log(`Using default Output directory: ${inputsDir}`);
                    } else {
                        // Use inputs subfolder
                        inputsDir = path.join(inputsDir, inputFolder);
                    }
                } catch (err) {
                    // folder-paths.json doesn't exist, use inputs subfolder
                    inputsDir = path.join(inputsDir, inputFolder);
                }
            }

            // 오디오 길이 가져오기 (있는 경우)
            let audioDuration = 30; // 기본 30초
            if (audioPath && fsSync.existsSync(audioPath)) {
                audioDuration = await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(audioPath, (err, metadata) => {
                        if (err) resolve(30); // 에러시 기본값
                        else resolve(metadata.format.duration);
                    });
                });
            }

            // segmentDurations 파싱 (먼저 수행)
            let parsedSegmentDurations = null;
            if (segmentDurations) {
                try {
                    parsedSegmentDurations = JSON.parse(segmentDurations);
                    console.log('Parsed segment durations:', parsedSegmentDurations);
                } catch (error) {
                    console.error('Failed to parse segment durations:', error);
                }
            }

            // SRT 생성 (1. 로직 기반 -> 2. STT 기반)
            let srtPath = null;
            let srtContent = null;
            let hasSrt = false;

            try {
                // 1. 로직 기반 SRT 생성 (스크립트와 구간 길이가 있는 경우 - TTS 모드)
                if (script && parsedSegmentDurations && parsedSegmentDurations.length > 0) {
                    console.log('Generating SRT from Script + Durations (Perfect Sync)');
                    srtContent = generateSRTFromDurations(script, parsedSegmentDurations);
                }
                // 2. STT 기반 SRT 생성 (오디오 파일만 있는 경우 - 업로드 모드)
                else if (audioPath && fsSync.existsSync(audioPath)) {
                    console.log('Generating SRT from audio via STT:', audioPath);
                    const transcription = await transcribeWith302AI(process.env.AI_302_API_KEY, audioPath);
                    srtContent = generateSRT(transcription);
                }

                if (srtContent) {
                    const srtFilename = `subtitle_${timestamp}.srt`;
                    srtPath = path.join(tempDir, srtFilename);
                    const BOM = '\ufeff';
                    fsSync.writeFileSync(srtPath, BOM + srtContent, 'utf8');
                    console.log('SRT file created:', srtPath);
                    hasSrt = true; // Flag for later use (though variable scope might be an issue if defined inside try?) 
                    // Actually 'hasSrt' checks later handle null srtPath. 
                    // Wait, lines 1316 check 'hasSrt'. I should ensure it matches legacy or current logic.
                    // In this specific block (Random Clips Video), 'hasSrt' wasn't used? 
                    // Let's check line 1033 context.
                    // Ah, this is inside `router.post('/generate-video'...)` BUT inside `if (bgMusic)`???
                    // NO. Line 1033 was "SRT 생성을 먼저 수행".
                    // It is inside the random clips block?
                    // Let's re-read the context. Use `view_file` if unsure.
                }
            } catch (error) {
                console.error('SRT generation failed:', error);
            }

            // 파라미터 추출
            const { selectedVideoFiles } = req.body; // Multer text field body.selectedVideoFiles might be stringified JSON

            // 스크립트가 있으면 SRT 타이밍과 줄바꿈 기준, 없으면 랜덤 클립 추출
            const clips = script
                ? await extractClipsByScript(inputsDir, outputDir, audioDuration, script, srtContent, parsedSegmentDurations, selectedVideoFiles)
                : await extractRandomClips(inputsDir, outputDir, audioDuration, selectedVideoFiles);

            console.log(`Using ${script ? 'script-based' : 'random'} clip extraction method`);

            // 배경음악 처리
            let finalAudioPath = audioPath;
            if (backgroundMusic && backgroundMusic !== 'none' && audioPath) {
                let musicPath;
                const { musicFolder } = req.body;

                // 전체 폴더 랜덤 선택 처리
                if (musicFolder === '__ALL_RANDOM__' || backgroundMusic === '__RANDOM__') {
                    console.log('[Video DEBUG] Attempting __ALL_RANDOM__ or __RANDOM__ music selection');
                    try {
                        const rootPath = path.join(__dirname, '..', 'background music');
                        console.log('[Video DEBUG] Root path:', rootPath, 'exists:', fsSync.existsSync(rootPath));
                        if (fsSync.existsSync(rootPath)) {
                            const result = await getFairRandomMusicFromAllFolders(rootPath);
                            console.log('[Video DEBUG] getFairRandomMusicFromAllFolders result:', result);
                            if (result) {
                                musicPath = result.path;
                                console.log(`[Video] Fair Random music selected from all folders: ${result.folder}/${result.filename}`);
                            } else {
                                console.log('[Video DEBUG] No music file selected (result is null)');
                            }
                        } else {
                            console.log('[Video DEBUG] Root path does not exist');
                        }
                    } catch (e) { console.error('Fair Random music selection from all folders failed:', e); }
                } else if (musicFolder) {
                    // 폴더가 지정된 경우
                    const folderPath = path.join(__dirname, '..', 'background music', musicFolder);

                    if (backgroundMusic === 'random') {
                        // 해당 폴더에서 랜덤 선택 (공평한 셔플)
                        try {
                            if (fsSync.existsSync(folderPath)) {
                                const randomFile = await getFairRandomMusic(folderPath);
                                if (randomFile) {
                                    musicPath = path.join(folderPath, randomFile);
                                    console.log(`[Video] Fair Random music selected from ${musicFolder}: ${randomFile}`);
                                }
                            } else {
                                console.warn(`[Video] Music folder not found: ${folderPath}`);
                            }
                        } catch (e) { console.error('Fair Random music selection failed:', e); }
                    } else {
                        // background music/폴더명/파일명
                        musicPath = path.join(folderPath, backgroundMusic);
                    }
                } else {
                    // 폴더가 없는 경우
                    if (backgroundMusic === 'random') {
                        // 랜덤이면 background music 루트에서 선택 (공평한 셔플)
                        try {
                            const rootPath = path.join(__dirname, '..', 'background music');
                            if (fsSync.existsSync(rootPath)) {
                                const randomFile = await getFairRandomMusic(rootPath);
                                if (randomFile) {
                                    musicPath = path.join(rootPath, randomFile);
                                    console.log(`[Video] Fair Random music selected from root: ${randomFile}`);
                                }
                            }
                        } catch (e) { console.error('Fair Random music selection failed (root):', e); }
                    } else {
                        // 1. 기존 audio 폴더 확인 (하위 호환성)
                        const legacyPath = path.join(__dirname, '..', 'audio', backgroundMusic);
                        if (fsSync.existsSync(legacyPath)) {
                            musicPath = legacyPath;
                        } else {
                            // 2. background music 루트 확인
                            musicPath = path.join(__dirname, '..', 'background music', backgroundMusic);
                        }
                    }
                }

                console.log(`[Video Debug] bgMusic=${backgroundMusic}, musicFolder=${musicFolder}, resolvedPath=${musicPath}, exists=${musicPath && fsSync.existsSync(musicPath)}`);

                if (musicPath && fsSync.existsSync(musicPath)) {
                    const mixedAudioPath = path.join(outputDir, `mixed_${timestamp}.mp3`);
                    await new Promise((resolve, reject) => {
                        // Explicitly set path again to be safe - Removed incorrect hardcoded Mac path
                        // ffmpeg.setFfmpegPath('/opt/homebrew/bin/ffmpeg'); // Mac system ffmpeg

                        ffmpeg()
                            .input(audioPath)
                            .input(musicPath)
                            .complexFilter([
                                `[0:a]volume=1.7,atempo=1.1[tts]`,  // TTS 볼륨 1.7배 증폭, 속도 1.1배
                                `[1:a]volume=0.15,atempo=1.0,aloop=loop=-1:size=2e+09[bg]`,  // 배경음악 볼륨 15%로 감소
                                `[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[mixed]`
                            ])
                            .outputOptions(['-map [mixed]', '-ac 2', '-ar 44100', `-t ${audioDuration}`])
                            .output(mixedAudioPath)
                            .on('start', (commandLine) => {
                                console.log('Audio mixing FFmpeg command:', commandLine);
                            })
                            .on('progress', (progress) => {
                                console.log('Audio mixing progress:', (progress.percent || 0).toFixed(2) + '%');
                            })
                            .on('end', () => {
                                console.log('Audio mixing completed');
                                finalAudioPath = mixedAudioPath;
                                resolve();
                            })
                            .on('error', (err) => {
                                console.error('Audio mixing error:', err);
                                reject(err);
                            })
                            .run();
                    });
                }
            }

            // 클립들을 하나의 비디오로 합치기
            const shouldIncludeAds = includeAds === 'true' || includeAds === true;
            const shouldIncludeTitle = includeTitle === 'true' || includeTitle === true; // Default to false if undefined
            await concatenateClips(clips, videoPath, finalAudioPath, srtPath, title, template, outro, shouldIncludeAds, shouldIncludeTitle, videoFilter);

            // 임시 이미지 파일 삭제 (있는 경우)
            if (imageFile && imageFile.path) {
                await fs.unlink(imageFile.path).catch(err => console.error('Error deleting temp image:', err));
            }

            const videoUrl = `/outputs/${finalProjectFolder}/${videoFilename}`;

            res.json({
                success: true,
                videoPath: videoPath,
                videoUrl: videoUrl,
                title: title || 'Random Clips Video',
                duration: audioDuration,
                folderName: finalProjectFolder,
                clipsUsed: clips.length
            });

        } catch (error) {
            console.error('Random clips video generation error:', error);
            if (imageFile && imageFile.path) {
                await fs.unlink(imageFile.path).catch(err => console.error('Error deleting temp image:', err));
            }
            res.status(500).json({
                error: '랜덤 클립 비디오 생성 중 오류가 발생했습니다.',
                details: error.message
            });
        }
        return;
    }

    // 기존 로직 (이미지 + 오디오)
    if (!imageFile || !audioPath || !title) {
        return res.status(400).json({ error: '이미지, 오디오 경로, 제목이 필요합니다.' });
    }

    try {
        console.log('Generating video with:', {
            audioPath,
            title,
            projectFolder: projectFolder || 'undefined',
            imagePath: imageFile.path,
            backgroundMusic: backgroundMusic || 'none'
        });

        // 프로젝트 폴더가 없으면 자동 생성 (영어로만)
        let finalProjectFolder = projectFolder;
        if (!projectFolder || projectFolder === 'undefined') {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            finalProjectFolder = `video_${timestamp}`;
            console.log('Auto-generated project folder:', finalProjectFolder);
        }

        // 출력 디렉토리 생성
        const outputDir = path.join(__dirname, '..', 'outputs', finalProjectFolder);
        await fs.mkdir(outputDir, { recursive: true });

        // 출력 파일 경로 (영어로만)
        // 출력 파일 경로 (영어로만)
        const timestamp = Date.now();

        let videoFilename;
        if (title) {
            // 제목을 파일명으로 사용 (OneDrive 호환 처리)
            // 1. 유니코드 정규화 (한글 자모 결합)
            // 2. OneDrive 금지 문자 제거: \ / : * ? " < > |
            // 3. 제어 문자, 특수 유니코드, 점으로 시작/끝나는 문자 제거
            const sanitizedTitle = title
                .normalize('NFC')  // 한글 자모 결합
                .replace(/[\\/:*?"<>|]/g, '')  // OneDrive 금지 문자
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '')  // 제어 문자
                .replace(/[\u0300-\u036f]/g, '')  // 결합 분음 부호
                .replace(/^\.|\.$|^\s+|\s+$/g, '')  // 점이나 공백으로 시작/끝
                .replace(/\s+/g, '_')  // 공백을 언더스코어로
                .replace(/_+/g, '_')  // 연속 언더스코어 제거
                .substring(0, 200);  // 최대 길이 제한
            videoFilename = `${sanitizedTitle}.mp4`;
        } else {
            videoFilename = `video_${timestamp}.mp4`;
        }
        const videoPath = path.join(outputDir, videoFilename);

        // 이미지 크기 정보 가져오기
        const getImageSize = () => {
            return new Promise((resolve, reject) => {
                ffmpeg.ffprobe(imageFile.path, (err, metadata) => {
                    if (err) {
                        reject(err);
                    } else {
                        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                        resolve({
                            width: videoStream.width,
                            height: videoStream.height
                        });
                    }
                });
            });
        };

        // 오디오 길이 정보 가져오기
        const getAudioDuration = () => {
            return new Promise((resolve, reject) => {
                ffmpeg.ffprobe(audioPath, (err, metadata) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(metadata.format.duration);
                    }
                });
            });
        };

        // 이미지 크기와 오디오 길이 가져오기
        const [imageSize, audioDuration] = await Promise.all([
            getImageSize(),
            getAudioDuration()
        ]);

        console.log('Image size:', imageSize);
        console.log('Audio duration:', audioDuration);

        // SRT 자막 파일 생성 (OpenAI 클라이언트는 파일 상단에서 이미 초기화됨)
        let srtPath = null;
        let hasSrt = false;

        try {
            console.log('Generating SRT from audio:', audioPath);

            // 오디오 파일 읽기
            const transcription = await transcribeWith302AI(process.env.AI_302_API_KEY, audioPath);

            console.log('Transcription completed');

            // SRT 파일 생성
            const srtContent = generateSRT(transcription);

            // SRT 파일 저장 (영어 파일명)
            const srtFilename = `subtitle_${timestamp}.srt`;
            srtPath = path.join(outputDir, srtFilename);

            // SRT 파일 저장
            // UTF-8 BOM 추가하여 Windows에서 한글 인코딩 문제 해결
            const BOM = '\ufeff';
            fsSync.writeFileSync(srtPath, BOM + srtContent, 'utf8');
            hasSrt = true;

            console.log('SRT file created:', srtPath);

        } catch (error) {
            console.error('SRT generation failed:', error);
            console.log('Continuing without subtitles');
        }

        // 오디오 믹싱 및 비디오 생성
        let finalAudioPath = audioPath;

        // 배경음악 자동 선택 (audio 폴더에서 랜덤)
        let selectedBackgroundMusic = backgroundMusic;
        if (!backgroundMusic || backgroundMusic === 'none') {
            try {
                const audioDir = path.join(__dirname, '..', 'audio');
                if (fsSync.existsSync(audioDir)) {
                    const randomMusic = await getFairRandomMusic(audioDir);
                    if (randomMusic) {
                        selectedBackgroundMusic = randomMusic;
                        console.log('Fair Random background music selected (legacy):', selectedBackgroundMusic);
                    }
                }
            } catch (error) {
                console.log('No background music files found, proceeding without music');
            }
        }

        // 백그라운드 음악이 있는 경우 오디오 믹싱
        if (selectedBackgroundMusic && selectedBackgroundMusic !== 'none') {
            const musicPath = path.join(__dirname, '..', 'audio', selectedBackgroundMusic);
            const mixedAudioPath = path.join(outputDir, `mixed_${timestamp}.mp3`);

            console.log('Mixing audio with background music...');

            // 백그라운드 음악과 TTS 믹싱 (TTS가 메인, 백그라운드 음악은 볼륨 30%로)
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(audioPath)
                    .input(musicPath)
                    .complexFilter([
                        // TTS 볼륨 증폭, 백그라운드 음악 볼륨 감소
                        `[0:a]volume=1.7,atempo=1.1[tts]`,  // TTS 볼륨 1.7배 증폭, 속도 1.1배
                        `[1:a]volume=0.15,atempo=1.0,aloop=loop=-1:size=2e+09[bg]`,  // 배경음악 볼륨 15%로 감소
                        `[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[mixed]`
                    ])
                    .outputOptions([
                        '-map [mixed]',
                        '-ac 2',
                        '-ar 44100'
                    ])
                    .output(mixedAudioPath)
                    .on('start', (commandLine) => {
                        console.log('Audio mixing command:', commandLine);
                    })
                    .on('end', () => {
                        console.log('Audio mixing completed');
                        finalAudioPath = mixedAudioPath;
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('Audio mixing error:', err);
                        reject(err);
                    })
                    .run();
            });
        }

        // FFmpeg로 비디오 생성
        await new Promise((resolve, reject) => {
            const ffmpegCommand = ffmpeg()
                .input(imageFile.path)
                .inputOptions([
                    '-loop 1',
                    `-t ${audioDuration}`
                ])
                .input(finalAudioPath);

            // 입력 필터 체인 생성 (기본 이미지 처리를 위해)
            // 비디오 필터가 있거나 로고/자막 오버레이를 위해 complex filter 사용 필요
            // 하지만 현재 구조상 complex filter가 아래 조건문에서 생성됨.

            // 로고 경로 설정
            const logoPath = path.join(__dirname, '..', 'logo', '1.png');
            const logoExists = fsSync.existsSync(logoPath);
            const normalizedLogoPath = logoPath.replace(/\\/g, '/').replace(/:/g, '\\:');

            // 자막과 로고 설정
            // 필터 적용을 위해 필터 체인 구성
            let mainVideoFilter = '';
            if (videoFilter === 'western') {
                mainVideoFilter = ',eq=contrast=1.15:saturation=1.2,colorbalance=rs=.05:bs=-.05';
            }

            if (hasSrt && logoExists) {
                // 자막과 로고 모두 있는 경우 - complex filter 사용
                const normalizedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
                const fontsDir = path.join(__dirname, '..', 'data', 'common', 'fonts');
                const normalizedFontsDir = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');

                const filterComplex = [
                    `[0:v]format=yuv420p${mainVideoFilter}[base]`,
                    `[base]subtitles='${normalizedSrtPath}':fontsdir='${normalizedFontsDir}':force_style='Fontname=NanumMyeongjo,Fontsize=8,PrimaryColour=&Hffffff,BackColour=&H00000000,BorderStyle=1,Outline=0,Shadow=0.5,Alignment=10,MarginV=20,MarginL=10,MarginR=10,Bold=1'[subtitled]`,
                    `movie='${normalizedLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.95[logo]`,
                    `[subtitled][logo]overlay=(W-w)/2:H-h-200`
                ];
                ffmpegCommand.complexFilter(filterComplex);
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    `-s ${imageSize.width}x${imageSize.height}`,
                    '-pix_fmt yuv420p',
                    '-shortest'
                ]);
                console.log('Adding subtitles and logo with complex filter');
            } else if (hasSrt) {
                // 자막만 있는 경우
                const normalizedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
                const fontsDir = path.join(__dirname, '..', 'data', 'common', 'fonts');
                const normalizedFontsDir = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');

                const subtitlesFilter = `${mainVideoFilter ? 'format=yuv420p' + mainVideoFilter + ',' : ''}subtitles='${normalizedSrtPath}':fontsdir='${normalizedFontsDir}':force_style='Fontname=NanumMyeongjo,Fontsize=8,PrimaryColour=&Hffffff,BackColour=&H00000000,BorderStyle=1,Outline=0,Shadow=0.5,Alignment=10,MarginV=20,MarginL=10,MarginR=10,Bold=1'`;

                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    `-s ${imageSize.width}x${imageSize.height}`,
                    '-pix_fmt yuv420p',
                    `-vf ${subtitlesFilter}`,
                    '-shortest'
                ]);
                console.log('Adding subtitles only');
            } else if (logoExists) {
                // 로고만 있는 경우
                const logoOnlyFilter = `[0:v]format=yuv420p${mainVideoFilter}[base];movie='${normalizedLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.95[logo];[base][logo]overlay=(W-w)/2:H-h-200`;
                ffmpegCommand.complexFilter(logoOnlyFilter);
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    `-s ${imageSize.width}x${imageSize.height}`,
                    '-pix_fmt yuv420p',
                    '-shortest'
                ]);
                console.log('Adding logo overlay');
            } else {
                // 로고도 자막도 없는 기본 비디오 설정
                if (mainVideoFilter) {
                    ffmpegCommand.complexFilter(`[0:v]format=yuv420p${mainVideoFilter}[outv]`);
                    ffmpegCommand.outputOptions(['-map [outv]']);
                }

                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    `-s ${imageSize.width}x${imageSize.height}`,
                    // '-pix_fmt yuv420p', // complex filter output handles format usually, or we ensure it
                    // Remove explicit pix_fmt if mapping from filter that outputs it, 
                    // or keep it to be safe. "format=yuv420p" in filter ensures it.
                    '-pix_fmt yuv420p',
                    '-shortest'
                ]);
            }

            ffmpegCommand.output(videoPath)
                .on('start', (commandLine) => {
                    console.log('FFmpeg command:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('Processing: ' + progress.percent + '% done');
                })
                .on('end', () => {
                    console.log('Video generation completed');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    reject(err);
                })
                .run();
        });

        // 임시 이미지 파일 삭제
        await fs.unlink(imageFile.path);

        // 비디오 URL 생성 (원본 폴더명 사용)
        const videoUrl = `/outputs/${finalProjectFolder}/${videoFilename}`;

        console.log(`Video file saved: ${videoPath}`);

        res.json({
            success: true,
            videoPath: videoPath,
            videoUrl: videoUrl,
            title: title,
            size: imageSize,
            duration: audioDuration,
            folderName: finalProjectFolder
        });

    } catch (error) {
        console.error('Video generation error:', error);

        // 임시 파일 정리
        if (imageFile && imageFile.path) {
            try {
                await fs.unlink(imageFile.path);
            } catch (unlinkError) {
                console.error('Error deleting temp image:', unlinkError);
            }
        }

        res.status(500).json({
            error: '비디오 생성 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 배치 비디오 생성
router.post('/generate-batch-videos', upload.array('images', 9), async (req, res) => {
    const { items } = req.body;
    const imageFiles = req.files;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: '배치 작업 항목이 필요합니다.' });
    }

    try {
        const results = [];
        const errors = [];

        // 병렬 처리를 위한 Promise 배열
        const promises = items.map(async (item, index) => {
            try {
                const { title, audioPath, projectFolder } = item;
                const imageFile = imageFiles[index];

                if (!title || !audioPath || !imageFile) {
                    throw new Error(`항목 ${index + 1}: 제목, 오디오, 이미지가 필요합니다.`);
                }

                console.log(`Processing batch video ${index + 1}: ${title}`);

                // 각 비디오마다 개별 폴더 생성
                // projectFolder가 있으면 사용하고, 없으면 타임스탬프로 자동 생성
                let individualProjectFolder = projectFolder;
                if (!individualProjectFolder || individualProjectFolder === 'undefined') {
                    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
                    individualProjectFolder = `video_${timestamp}_${index + 1}`;
                }

                // 출력 디렉토리 생성
                const outputDir = path.join(__dirname, '..', 'outputs', individualProjectFolder);
                await fs.mkdir(outputDir, { recursive: true });

                const timestamp = Date.now();

                let videoFilename;
                if (title) {
                    // 제목을 파일명으로 사용 (OneDrive 호환 처리)
                    // 1. 유니코드 정규화 (한글 자모 결합)
                    // 2. OneDrive 금지 문자 제거: \ / : * ? " < > |
                    // 3. 제어 문자, 특수 유니코드, 점으로 시작/끝나는 문자 제거
                    const sanitizedTitle = title
                        .normalize('NFC')  // 한글 자모 결합
                        .replace(/[\\/:*?"<>|]/g, '')  // OneDrive 금지 문자
                        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')  // 제어 문자
                        .replace(/[\u0300-\u036f]/g, '')  // 결합 분음 부호
                        .replace(/^\.|\.$|^\s+|\s+$/g, '')  // 점이나 공백으로 시작/끝
                        .replace(/\s+/g, '_')  // 공백을 언더스코어로
                        .replace(/_+/g, '_')  // 연속 언더스코어 제거
                        .substring(0, 200);  // 최대 길이 제한
                    videoFilename = `${sanitizedTitle}_${index}.mp4`;
                } else {
                    videoFilename = `video_${timestamp}_${index}.mp4`;
                }
                const videoPath = path.join(outputDir, videoFilename);

                // 이미지 크기 정보 가져오기
                const getImageSize = () => {
                    return new Promise((resolve, reject) => {
                        ffmpeg.ffprobe(imageFile.path, (err, metadata) => {
                            if (err) {
                                reject(err);
                            } else {
                                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                                resolve({
                                    width: videoStream.width,
                                    height: videoStream.height
                                });
                            }
                        });
                    });
                };

                // 오디오 길이 정보 가져오기
                const getAudioDuration = () => {
                    return new Promise((resolve, reject) => {
                        ffmpeg.ffprobe(audioPath, (err, metadata) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(metadata.format.duration);
                            }
                        });
                    });
                };

                // 이미지 크기와 오디오 길이 가져오기
                const [imageSize, audioDuration] = await Promise.all([
                    getImageSize(),
                    getAudioDuration()
                ]);

                // SRT 자막 파일 생성 (배치 모드)
                let batchSrtPath = null;
                let batchHasSrt = false;

                try {
                    console.log(`Batch video ${index + 1}: Generating SRT from audio:`, audioPath);

                    const batchTranscription = await transcribeWith302AI(process.env.AI_302_API_KEY, audioPath);

                    console.log(`Batch video ${index + 1}: Transcription completed`);

                    // SRT 파일 생성
                    const batchSrtContent = generateSRT(batchTranscription);

                    // SRT 파일 저장 (영어 파일명)
                    const batchSrtFilename = `subtitle_${timestamp}_${index}.srt`;
                    batchSrtPath = path.join(outputDir, batchSrtFilename);

                    // SRT 파일 저장
                    // UTF-8 BOM 추가하여 Windows에서 한글 인코딩 문제 해결
                    const batchBOM = '\ufeff';
                    fsSync.writeFileSync(batchSrtPath, batchBOM + batchSrtContent, 'utf8');
                    batchHasSrt = true;

                    console.log(`Batch video ${index + 1}: SRT file created:`, batchSrtPath);

                } catch (error) {
                    console.error(`Batch video ${index + 1}: SRT generation failed:`, error);
                    console.log(`Batch video ${index + 1}: Continuing without subtitles`);
                }

                // 배경음악 자동 선택 (audio 폴더에서 랜덤)
                let selectedBatchMusic = null;
                try {
                    const audioDir = path.join(__dirname, '..', 'audio');
                    const musicFiles = await fs.readdir(audioDir);
                    const validMusicFiles = musicFiles.filter(file =>
                        file.toLowerCase().endsWith('.mp3') ||
                        file.toLowerCase().endsWith('.wav') ||
                        file.toLowerCase().endsWith('.m4a')
                    );
                    if (validMusicFiles.length > 0) {
                        selectedBatchMusic = validMusicFiles[Math.floor(Math.random() * validMusicFiles.length)];
                        console.log(`Batch video ${index + 1}: Random background music selected:`, selectedBatchMusic);
                    }
                } catch (error) {
                    console.log(`Batch video ${index + 1}: No background music files found`);
                }

                // 오디오 믹싱 처리
                let finalBatchAudioPath = audioPath;
                if (selectedBatchMusic) {
                    const musicPath = path.join(__dirname, '..', 'audio', selectedBatchMusic);
                    const mixedAudioPath = path.join(outputDir, `mixed_${timestamp}_${index}.mp3`);

                    console.log(`Batch video ${index + 1}: Mixing audio with background music...`);

                    // 백그라운드 음악과 TTS 믹싱
                    await new Promise((resolve, reject) => {
                        ffmpeg()
                            .input(audioPath)
                            .input(musicPath)
                            .complexFilter([
                                // 백그라운드 음악을 TTS 길이에 맞춰 자르거나 반복하고 볼륨 조절
                                `[0:a]volume=1.7,atempo=1.1[tts]`,  // TTS 볼륨 1.7배 증폭, 속도 1.1배
                                `[1:a]volume=0.15,atempo=1.0,aloop=loop=-1:size=2e+09[bg]`,  // 배경음악 볼륨 15%로 감소
                                `[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[mixed]`
                            ])
                            .outputOptions([
                                '-map [mixed]',
                                '-ac 2',
                                '-ar 44100',
                                `-t ${audioDuration}`
                            ])
                            .output(mixedAudioPath)
                            .on('end', () => {
                                console.log(`Batch video ${index + 1}: Audio mixing completed`);
                                finalBatchAudioPath = mixedAudioPath;
                                resolve();
                            })
                            .on('error', (err) => {
                                console.error(`Batch video ${index + 1}: Audio mixing error:`, err);
                                reject(err);
                            })
                            .run();
                    });
                }

                // FFmpeg로 비디오 생성
                await new Promise((resolve, reject) => {
                    const ffmpegCommand = ffmpeg()
                        .input(imageFile.path)
                        .inputOptions([
                            '-loop 1',
                            `-t ${audioDuration}`
                        ])
                        .input(finalBatchAudioPath);

                    // 로고 경로 설정 (배치 모드)
                    const batchLogoPath = path.join(__dirname, '..', 'logo', '1.png');
                    const batchLogoExists = fsSync.existsSync(batchLogoPath);
                    const normalizedBatchLogoPath = batchLogoPath.replace(/\\/g, '/').replace(/:/g, '\\:');

                    // 배치 모드 자막과 로고 설정
                    if (batchHasSrt && batchLogoExists) {
                        // 자막과 로고 모두 있는 경우
                        const normalizedBatchSrtPath = batchSrtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
                        const batchFilterComplex = [
                            `[0:v]subtitles='${normalizedBatchSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'[subtitled]`,
                            `movie='${normalizedBatchLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.95[logo]`,
                            `[subtitled][logo]overlay=(W-w)/2:H-h-200`
                        ];
                        ffmpegCommand.complexFilter(batchFilterComplex);
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            `-s ${imageSize.width}x${imageSize.height}`,
                            '-pix_fmt yuv420p',
                            '-shortest'
                        ]);
                        console.log(`Batch video ${index + 1}: Adding subtitles and logo`);
                    } else if (batchHasSrt) {
                        // 자막만 있는 경우
                        const normalizedBatchSrtPath = batchSrtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
                        const batchSubtitlesFilter = `subtitles='${normalizedBatchSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'`;
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            `-s ${imageSize.width}x${imageSize.height}`,
                            '-pix_fmt yuv420p',
                            `-vf ${batchSubtitlesFilter}`,
                            '-shortest'
                        ]);
                        console.log(`Batch video ${index + 1}: Adding subtitles only`);
                    } else if (batchLogoExists) {
                        // 로고만 있는 경우
                        const batchLogoOnlyFilter = `movie='${normalizedBatchLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.95[logo];[0:v][logo]overlay=(W-w)/2:H-h-200`;
                        ffmpegCommand.complexFilter(batchLogoOnlyFilter);
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            `-s ${imageSize.width}x${imageSize.height}`,
                            '-pix_fmt yuv420p',
                            '-shortest'
                        ]);
                        console.log(`Batch video ${index + 1}: Adding logo overlay`);
                    } else {
                        // 로고도 자막도 없는 기본 비디오 설정
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            `-s ${imageSize.width}x${imageSize.height}`,
                            '-pix_fmt yuv420p',
                            '-shortest'
                        ]);
                    }

                    ffmpegCommand.output(videoPath)
                        .on('end', () => {
                            console.log(`Batch video ${index + 1}: Video generation completed`);
                            resolve();
                        })
                        .on('error', reject)
                        .run();
                });

                // 임시 이미지 파일 삭제
                await fs.unlink(imageFile.path);

                // 비디오 URL 생성 (개별 폴더명 사용)
                const videoUrl = `/outputs/${individualProjectFolder}/${videoFilename}`;

                console.log(`Batch video file saved: ${videoPath}`);

                // info.txt 파일 생성
                // UTF-8 BOM 추가하여 Windows에서 한글 인코딩 문제 해결
                const BOM = '\ufeff';
                const infoContent = `${BOM}제목: ${title}
생성시간: ${new Date().toISOString()}
비디오: ${videoFilename}
오디오: ${path.basename(audioPath)}
`;
                const infoPath = path.join(outputDir, 'info.txt');
                await fs.writeFile(infoPath, infoContent, { encoding: 'utf8' });

                return {
                    index,
                    title,
                    success: true,
                    videoPath: videoPath,
                    videoUrl: videoUrl,
                    size: imageSize,
                    duration: audioDuration,
                    folderName: individualProjectFolder
                };

            } catch (error) {
                console.error(`Error processing batch video ${index + 1}:`, error);

                // 임시 파일 정리
                if (imageFiles[index] && imageFiles[index].path) {
                    try {
                        await fs.unlink(imageFiles[index].path);
                    } catch (unlinkError) {
                        console.error('Error deleting temp image:', unlinkError);
                    }
                }

                return {
                    index,
                    title: item.title || `항목 ${index + 1}`,
                    success: false,
                    error: error.message
                };
            }
        });

        // 모든 Promise 완료 대기
        const results_array = await Promise.allSettled(promises);

        // 결과 분류
        results_array.forEach(result => {
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    results.push(result.value);
                } else {
                    errors.push(result.value);
                }
            } else {
                errors.push({
                    index: -1,
                    title: '알 수 없음',
                    success: false,
                    error: result.reason.message
                });
            }
        });

        // 응답 반환
        res.json({
            success: true,
            processed: items.length,
            successful: results.length,
            failed: errors.length,
            results: results,
            errors: errors
        });

    } catch (error) {
        console.error('Batch video generation error:', error);

        // 모든 임시 파일 정리
        if (imageFiles) {
            for (const file of imageFiles) {
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    console.error('Error deleting temp image:', unlinkError);
                }
            }
        }

        res.status(500).json({
            error: '배치 비디오 생성 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

export default router;
