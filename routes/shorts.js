import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Define allowed voices for random selection (Same as ai-video.js)
const PRESET_VOICES = [
    'mYk0rAapHek2oTw18z8x', // Voice 1
    '4JJwo477JUAx3HV0T7n7', // Voice 2
    'QPFsEL6IBxlT15xfiD6C', // Voice 3
    'uyVNoMrnUku1dZyVEXwD'  // Voice 4
];

// Helper to get local base URL dynamically from request
const getBaseUrl = (req) => {
    const protocol = req.protocol || 'http';
    const host = req.headers.host || 'localhost:4567';
    return `${protocol}://${host}`;
};

// 통합 쇼츠 생성 API
router.post('/generate', async (req, res) => {
    let { jsonData, emotion = 'surprise', backgroundMusic = '1.mp3', inputFolder = 'japan', template, outro = '', videoIndex = 1, includeAds = false, includeTitle = false } = req.body;
    template = template || '2.png';

    // 인증 헤더 추출 (내부 API 호출용)
    const authHeader = req.headers.authorization;

    if (!jsonData) {
        return res.status(400).json({ error: 'JSON 데이터가 필요합니다.' });
    }

    let parsedData;
    try {
        parsedData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    } catch (error) {
        return res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
    }

    let { script, title, description } = parsedData;

    // 싱크 개선을 위한 스크립트 전처리: 문장 부호 뒤에 줄바꿈 추가
    if (script) {
        script = script.replace(/([.!?])\s*(?=[^.!?\n])/g, '$1\n');
    }

    if (!script || !title || !description) {
        return res.status(400).json({
            error: 'script, title, description 필드가 필요합니다.'
        });
    }

    try {
        // 프로젝트 폴더명 생성 (videoIndex가 1보다 크면 폴더명에 추가)
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const projectFolder = videoIndex > 1 ? `${timestamp}_v${videoIndex}` : `${timestamp}`;
        const projectDir = path.join(__dirname, '..', 'outputs', projectFolder);
        await fs.mkdir(projectDir, { recursive: true });

        console.log(`Starting shorts generation for project: ${projectFolder} (Video ${videoIndex})`);

        // 1. TTS 생성 - 스크립트를 \n으로 분할하여 개별 MP3 생성
        console.log('Step 1: Generating TTS for each script segment...');
        const scriptSegments = script.split('\n').filter(segment => segment.trim());
        console.log(`Script split into ${scriptSegments.length} segments`);

        const ttsFiles = [];
        const segmentDurations = [];

        // temp 폴더를 먼저 생성
        const tempDir = path.join(projectDir, 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        // 일관된 목소리를 위해 미리 랜덤 보이스 선정 (또는 지정된 보이스 사용)
        let selectedVoiceId = emotion;
        if (!selectedVoiceId || ['random', 'neutral', 'surprise'].includes(selectedVoiceId)) {
            selectedVoiceId = PRESET_VOICES[Math.floor(Math.random() * PRESET_VOICES.length)];
            console.log(`[Shorts] Random voice selected for initial consistency: ${selectedVoiceId}`);
        }

        // 각 세그먼트별로 TTS 생성 (temp 폴더에 저장)
        for (let i = 0; i < scriptSegments.length; i++) {
            const segment = scriptSegments[i].trim();
            if (!segment) continue;

            console.log(`Generating TTS for segment ${i + 1}: "${segment.substring(0, 30)}..."`);

            // Use Azure TTS via ai-video endpoint
            const ttsResponse = await axios.post(`${getBaseUrl(req)}/api/ai-video/generate-tts`, {
                title: `${title}_segment_${i + 1}`,
                text: segment,
                provider: 'Azure',
                language: 'Korean',
                storeName: title,
                voiceId: selectedVoiceId // Use the pre-selected consistent voice ID
            }, {
                headers: {
                    'Authorization': authHeader
                }
            });

            if (!ttsResponse.data.success) {
                throw new Error(`TTS 생성 실패: 세그먼트 ${i + 1}`);
            }

            ttsFiles.push(ttsResponse.data.localPath);

            // 각 오디오 파일의 길이 가져오기
            const ffmpeg = (await import('fluent-ffmpeg')).default;
            const duration = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(ttsResponse.data.localPath, (err, metadata) => {
                    if (err) reject(err);
                    else resolve(metadata.format.duration);
                });
            });
            segmentDurations.push(duration);
            console.log(`Segment ${i + 1} duration: ${duration.toFixed(2)}s`);
        }

        // 모든 MP3 파일을 하나로 합치기 (temp 폴더에 저장)
        console.log('Merging all TTS segments...');
        const ffmpeg = (await import('fluent-ffmpeg')).default;
        const ffmpegStatic = (await import('ffmpeg-static')).default;
        const ffprobeStatic = (await import('ffprobe-static')).default;

        let ffmpegPath = ffmpegStatic;
        try {
            if (!ffmpegPath || !(await fs.stat(ffmpegPath).catch(() => false))) {
                console.warn('[Shorts] ffmpeg-static binary not found, falling back to system "ffmpeg"');
                ffmpegPath = 'ffmpeg';
            }
        } catch (e) { ffmpegPath = 'ffmpeg'; }

        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobeStatic.path);
        const mergedAudioPath = path.join(tempDir, `merged_audio_${Date.now()}.mp3`);

        await new Promise((resolve, reject) => {
            const command = ffmpeg();

            // 모든 오디오 파일을 입력으로 추가
            ttsFiles.forEach(file => {
                command.input(file);
            });

            // concat 필터로 합치기
            const filterInputs = ttsFiles.map((_, i) => `[${i}:a]`).join('');
            command
                .complexFilter(`${filterInputs}concat=n=${ttsFiles.length}:v=0:a=1[out]`)
                .outputOptions(['-map [out]'])
                .output(mergedAudioPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });

        const ttsData = {
            success: true,
            audioPath: mergedAudioPath,
            segmentFiles: ttsFiles,
            segmentDurations: segmentDurations,
            totalDuration: segmentDurations.reduce((a, b) => a + b, 0)
        };

        // 2. 비디오 생성 (랜덤 클립 + TTS + 자막)
        console.log('Step 2: Generating video with random clips...');

        const FormData = (await import('form-data')).default;
        const formData = new FormData();

        // 더미 이미지 추가 (API 요구사항) - 실제 템플릿 사용
        try {
            const templateFile = template || '2.png';
            const dummyImagePath = path.join(__dirname, '..', 'data', 'remix-shorts', 'templates', templateFile);
            const imageBuffer = await fs.readFile(dummyImagePath);
            formData.append('image', imageBuffer, {
                filename: 'image.png',
                contentType: 'image/png'
            });
        } catch (error) {
            console.warn('Failed to load template image, using buffer:', error);
            const dummyImage = Buffer.from('dummy');
            formData.append('image', dummyImage, 'dummy.jpg');
        }
        formData.append('useRandomClips', 'true');
        formData.append('audioPath', ttsData.audioPath);
        formData.append('title', title);
        formData.append('projectFolder', projectFolder);
        formData.append('script', script);  // 스크립트 전달 (줄바꿈 기준 클립 전환용)
        formData.append('segmentDurations', JSON.stringify(ttsData.segmentDurations));  // 각 세그먼트 길이 전달

        if (backgroundMusic) {
            formData.append('backgroundMusic', backgroundMusic);
        }
        if (req.body.musicFolder) {
            formData.append('musicFolder', req.body.musicFolder);
        }
        if (inputFolder) {
            formData.append('inputFolder', inputFolder);
        }
        if (template) {
            formData.append('template', template);
        }
        if (outro) {
            formData.append('outro', outro);
        }
        if (includeAds) {
            formData.append('includeAds', includeAds.toString());
        }
        formData.append('includeTitle', includeTitle.toString());
        if (req.body.videoFilter) {
            formData.append('videoFilter', req.body.videoFilter);
        }

        const videoResponse = await axios.post(`${getBaseUrl(req)}/api/video/generate-video`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': authHeader
            }
        });

        const videoData = videoResponse.data.success ? videoResponse.data : null;

        // 3. 남은 파일들 정리 (SRT, mixed audio 등을 temp로 이동)
        console.log('Step 3: Organizing remaining files...');

        // 프로젝트 루트의 파일들 확인
        const rootFiles = await fs.readdir(projectDir);
        for (const file of rootFiles) {
            const filePath = path.join(projectDir, file);
            const stats = await fs.stat(filePath);

            // 디렉토리는 건너뛰기
            if (stats.isDirectory()) continue;

            // MP4와 info.txt를 제외한 파일들을 temp로 이동
            if (!file.endsWith('.mp4') && file !== 'info.txt') {
                const newPath = path.join(tempDir, file);
                try {
                    await fs.rename(filePath, newPath);
                    console.log(`Moved to temp: ${file}`);
                } catch (error) {
                    console.log(`Could not move ${file}: ${error.message}`);
                }
            }
        }

        // 4. title과 description을 하나의 info.txt 파일로 저장
        console.log('Step 4: Saving info file...');
        console.log('Title to save:', title); // 디버깅용 로그
        console.log('Description to save:', description); // 디버깅용 로그
        const infoPath = path.join(projectDir, 'info.txt');
        // UTF-8 BOM 추가하여 Windows에서 한글 인코딩 문제 해결
        const BOM = '\ufeff';
        const infoContent = `${BOM}제목: ${title}\n\n설명: ${description}`;
        await fs.writeFile(infoPath, infoContent, { encoding: 'utf8' });

        console.log(`Shorts generation completed for project: ${projectFolder}`);

        // 응답 반환
        res.json({
            success: true,
            projectFolder: projectFolder,
            title: title,
            description: description,
            script: script,
            emotion: emotion,
            ttsData: ttsData,
            videoData: videoData,
            infoFile: `/outputs/${projectFolder}/info.txt`,
            metadata: {
                generated_at: new Date().toISOString(),
                processing_steps: ['tts_generation', 'video_generation', 'metadata_files']
            }
        });

    } catch (error) {
        console.error('Shorts Generation Error:', {
            message: error.message,
            code: error.code,
            url: error.config?.url,
            data: error.response?.data
        });
        res.status(500).json({
            error: '쇼츠 생성 중 오류가 발생했습니다.',
            details: error.response?.data || error.message
        });
    }
});

// TTS만 생성하는 API
router.post('/generate-tts', async (req, res) => {
    const { jsonData, emotion = 'surprise' } = req.body;

    // 인증 헤더 추출 (내부 API 호출용)
    const authHeader = req.headers.authorization;

    if (!jsonData) {
        return res.status(400).json({ error: 'JSON 데이터가 필요합니다.' });
    }

    let parsedData;
    try {
        parsedData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    } catch (error) {
        return res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
    }

    let { script, title, description } = parsedData;

    // 싱크 개선을 위한 스크립트 전처리: 문장 부호 뒤에 줄바꿈 추가
    if (script) {
        script = script.replace(/([.!?])\s*(?=[^.!?\n])/g, '$1\n');
    }

    if (!script || !title || !description) {
        return res.status(400).json({
            error: 'script, title, description 필드가 필요합니다.'
        });
    }

    try {
        // 메인 프로젝트 폴더명 생성 (타임스탬프 기반)
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const mainProjectFolder = `${timestamp}`;
        const projectDir = path.join(__dirname, '..', 'outputs', mainProjectFolder);
        await fs.mkdir(projectDir, { recursive: true });

        console.log(`Generating TTS only for project: ${mainProjectFolder}`);

        // TTS 생성 - 스크립트를 \n으로 분할하여 개별 MP3 생성
        const scriptSegments = script.split('\n').filter(segment => segment.trim());
        const ttsFiles = [];
        const segmentDurations = [];

        // temp 폴더를 먼저 생성
        const tempDir = path.join(projectDir, 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        // 일관된 목소리를 위해 미리 랜덤 보이스 선정 (또는 지정된 보이스 사용)
        let selectedVoiceId = emotion;
        if (!selectedVoiceId || ['random', 'neutral', 'surprise'].includes(selectedVoiceId)) {
            selectedVoiceId = PRESET_VOICES[Math.floor(Math.random() * PRESET_VOICES.length)];
            console.log(`[Shorts] Random voice selected for consistency: ${selectedVoiceId}`);
        }

        // 각 세그먼트별로 TTS 생성 (temp 폴더에 저장)
        for (let i = 0; i < scriptSegments.length; i++) {
            const segment = scriptSegments[i].trim();
            if (!segment) continue;

            console.log(`Generating TTS for segment ${i + 1}: "${segment.substring(0, 30)}..."`);

            // Use Azure TTS via ai-video endpoint
            const ttsResponse = await axios.post(`${getBaseUrl(req)}/api/ai-video/generate-tts`, {
                title: `${title}_segment_${i + 1}`,
                text: segment,
                provider: 'Azure',
                language: 'Korean',
                storeName: title,
                voiceId: selectedVoiceId // Use the pre-selected consistent voice ID
            }, {
                headers: {
                    'Authorization': authHeader
                }
            });

            if (!ttsResponse.data.success) {
                throw new Error(`TTS 생성 실패: 세그먼트 ${i + 1}`);
            }

            ttsFiles.push(ttsResponse.data.localPath);

            const ffmpeg = (await import('fluent-ffmpeg')).default;
            const ffmpegStatic = (await import('ffmpeg-static')).default;
            const ffprobeStatic = (await import('ffprobe-static')).default;

            let ffmpegPath = ffmpegStatic;
            try {
                if (!ffmpegPath || !(await fs.stat(ffmpegPath).catch(() => false))) {
                    console.warn('[Shorts] ffmpeg-static binary not found, falling back to system "ffmpeg"');
                    ffmpegPath = 'ffmpeg';
                }
            } catch (e) { ffmpegPath = 'ffmpeg'; }

            ffmpeg.setFfmpegPath(ffmpegPath);
            ffmpeg.setFfprobePath(ffprobeStatic.path);
            const duration = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(ttsResponse.data.localPath, (err, metadata) => {
                    if (err) reject(err);
                    else resolve(metadata.format.duration);
                });
            });
            segmentDurations.push(duration);
        }

        // 모든 MP3 파일을 하나로 합치기
        const ffmpeg = (await import('fluent-ffmpeg')).default;
        // Static paths likely set above, but setting again to be safe if scopes differ significantly (though imports are cached)
        const ffmpegStatic = (await import('ffmpeg-static')).default;
        const ffprobeStatic = (await import('ffprobe-static')).default;

        let ffmpegPath = ffmpegStatic;
        try {
            if (!ffmpegPath || !(await fs.stat(ffmpegPath).catch(() => false))) {
                console.warn('[Shorts] ffmpeg-static binary not found, falling back to system "ffmpeg"');
                ffmpegPath = 'ffmpeg';
            }
        } catch (e) { ffmpegPath = 'ffmpeg'; }

        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobeStatic.path);
        const mergedAudioPath = path.join(tempDir, `merged_audio_${Date.now()}.mp3`);

        await new Promise((resolve, reject) => {
            const command = ffmpeg();

            ttsFiles.forEach(file => {
                command.input(file);
            });

            command
                .on('end', resolve)
                .on('error', reject)
                .mergeToFile(mergedAudioPath, tempDir);
        });

        // info.txt 파일 생성 (title과 description 통합)
        const infoFile = path.join(projectDir, 'info.txt');
        const infoContent = `제목: ${title}\n\n설명: ${description}`;
        await fs.writeFile(infoFile, infoContent, 'utf8');

        res.json({
            success: true,
            mainProjectFolder: mainProjectFolder,
            audioPath: mergedAudioPath,
            audioUrl: `/outputs/${mainProjectFolder}/temp/merged_audio_${Date.now()}.mp3`,
            segmentDurations: segmentDurations,
            infoFile: `/outputs/${mainProjectFolder}/info.txt`,
            script: script
        });

    } catch (error) {
        console.error('TTS Generation Error:', {
            message: error.message,
            code: error.code,
            url: error.config?.url,
            data: error.response?.data
        });
        res.status(500).json({
            error: 'TTS 생성 중 오류가 발생했습니다.',
            details: error.response?.data || error.message
        });
    }
});

// 비디오만 생성하는 API (TTS 재사용)
// 비디오 생성만 수행하는 API (TTS 데이터 재사용)
router.post('/generate-video-only', async (req, res) => {
    let { ttsData, jsonData, backgroundMusic = '1.mp3', inputFolder = 'japan', template, outro = '', videoIndex = 1, includeAds = false, selectedVideoFiles = [], includeTitle = false, videoFilter } = req.body;
    template = template || '2.png';

    // 인증 헤더 추출 (내부 API 호출용)
    const authHeader = req.headers.authorization;

    if (!ttsData || !jsonData) {
        return res.status(400).json({ error: 'TTS 데이터와 JSON 데이터가 필요합니다.' });
    }

    try {
        // 메인 프로젝트 폴더 사용 (서브폴더 생성하지 않음)
        const mainFolder = ttsData.mainProjectFolder;
        const projectFolder = mainFolder;  // 메인 폴더를 그대로 사용
        const projectDir = path.join(__dirname, '..', 'outputs', projectFolder);

        console.log(`Generating video only for project: ${projectFolder} (Video ${videoIndex})`);

        // FormData 생성
        const FormData = (await import('form-data')).default;
        const formData = new FormData();

        // 더미 이미지 추가 (비디오 생성에 필요)
        try {
            const dummyImagePath = path.join(__dirname, '..', 'data', 'remix-shorts', 'templates', template);
            formData.append('image', await fs.readFile(dummyImagePath), {
                filename: 'image.png',
                contentType: 'image/png'
            });
        } catch (e) {
            console.warn('Failed to load template image, using buffer:', e);
            const dummyImage = Buffer.from('dummy');
            formData.append('image', dummyImage, 'dummy.jpg');
        }

        formData.append('useRandomClips', 'true');
        formData.append('audioPath', ttsData.audioPath);
        formData.append('title', jsonData.title);
        formData.append('projectFolder', projectFolder);
        formData.append('script', ttsData.script);
        formData.append('segmentDurations', JSON.stringify(ttsData.segmentDurations));
        formData.append('videoIndex', videoIndex.toString());  // 비디오 인덱스 전달

        if (backgroundMusic) {
            formData.append('backgroundMusic', backgroundMusic);
        }
        if (req.body.musicFolder) {
            formData.append('musicFolder', req.body.musicFolder);
        }
        if (inputFolder) {
            formData.append('inputFolder', inputFolder);
        }
        if (template) {
            formData.append('template', template);
        }
        if (outro) {
            formData.append('outro', outro);
        }
        if (includeAds) {
            formData.append('includeAds', includeAds.toString());
        }
        formData.append('includeTitle', includeTitle.toString());
        if (videoFilter) {
            formData.append('videoFilter', videoFilter);
        }

        // Pass manual video selection
        if (selectedVideoFiles && selectedVideoFiles.length > 0) {
            formData.append('selectedVideoFiles', JSON.stringify(selectedVideoFiles));
        }

        const videoResponse = await axios.post(`${getBaseUrl(req)}/api/video/generate-video`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': authHeader
            }
        });

        const videoData = videoResponse.data.success ? videoResponse.data : null;

        res.json({
            success: true,
            mainProjectFolder: mainFolder,
            projectFolder: projectFolder,
            videoData: videoData,
            metadata: {
                generated_at: new Date().toISOString(),
                video_index: videoIndex,
                used_tts_from: ttsData.mainProjectFolder
            }
        });

    } catch (error) {
        console.error('Video Generation Error:', error.response?.data || error.message);
        res.status(500).json({
            error: '비디오 생성 중 오류가 발생했습니다.',
            details: error.response?.data || error.message
        });
    }
});

// 오디오 파일로부터 비디오 생성 API (Voiceover)
router.post('/generate-video-from-file', async (req, res) => {
    let { audioFilename, jsonData, backgroundMusic = '1.mp3', inputFolder = 'japan', template, outro = '', videoIndex = 1, includeAds = false, selectedVideoFiles = [], includeTitle = true, videoFilter } = req.body;
    template = template || '2.png';

    // 인증 헤더 추출 (내부 API 호출용)
    const authHeader = req.headers.authorization;

    if (!audioFilename || !jsonData) {
        return res.status(400).json({ error: '오디오 파일명과 JSON 데이터가 필요합니다.' });
    }

    let parsedData;
    try {
        parsedData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    } catch (error) {
        return res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
    }

    // Title is required, Script is optional but recommended for context (though STT generates subtitles)
    const { title, description, script } = parsedData;

    if (!title) {
        return res.status(400).json({ error: 'title 필드가 필요합니다.' });
    }

    try {
        // 메인 프로젝트 폴더명 생성 (타임스탬프 기반)
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const projectFolder = `${timestamp}_v${videoIndex}`; // Unique folder for this video
        const projectDir = path.join(__dirname, '..', 'outputs', projectFolder);
        await fs.mkdir(projectDir, { recursive: true });

        console.log(`Generating video from file for project: ${projectFolder}`);

        // 1. 오디오 파일 복사
        // 원본 오디오 파일 위치 (data/common/audio)
        const sourceAudioPath = path.join(__dirname, '..', 'data', 'common', 'audio', audioFilename);

        // 프로젝트 temp 폴더에 복사
        const tempDir = path.join(projectDir, 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        const targetAudioPath = path.join(tempDir, `voiceover_${audioFilename}`);

        try {
            await fs.copyFile(sourceAudioPath, targetAudioPath);
            console.log(`Copied audio file to: ${targetAudioPath}`);
        } catch (err) {
            console.error('Audio file copy failed:', err);
            return res.status(404).json({ error: '선택한 오디오 파일을 찾을 수 없습니다.' });
        }

        // 2. 비디오 생성 요청 (내부 API 호출)
        const FormData = (await import('form-data')).default;
        const formData = new FormData();

        // 더미 이미지 추가
        try {
            const dummyImagePath = path.join(__dirname, '..', 'data', 'remix-shorts', 'templates', template);
            formData.append('image', await fs.readFile(dummyImagePath), {
                filename: 'image.png',
                contentType: 'image/png'
            });
        } catch (e) {
            console.warn('Failed to load template image, using buffer:', e);
            const dummyImage = Buffer.from('dummy');
            formData.append('image', dummyImage, 'dummy.jpg');
        }


        formData.append('useRandomClips', 'true');
        formData.append('audioPath', targetAudioPath); // Copied audio path
        formData.append('title', title);
        formData.append('projectFolder', projectFolder);

        // Script helps if provided, otherwise STT does the job.
        // We pass it if we have it.
        if (script) {
            formData.append('script', script);
        }

        // Segment Durations: We don't have them per segment since it's one file.
        // passing empty or null will let /generate-video handle it (Single segment or STT based split)
        // Actually /generate-video logic handles extracting clips based on:
        // 1. script + segmentDurations (TTS flow)
        // 2. script only (Split by lines + equal duration)
        // 3. No script (Random clips for full duration)
        // Wait, if we rely on STT, /generate-video (lines 808+) generates SRT.
        // Then extractClipsByScript is called with srtContent.
        // This is perfect. Just ensuring we pass what matches "STT based generation".

        formData.append('videoIndex', videoIndex.toString());

        if (backgroundMusic) formData.append('backgroundMusic', backgroundMusic);
        if (req.body.musicFolder) formData.append('musicFolder', req.body.musicFolder);
        if (inputFolder) formData.append('inputFolder', inputFolder);
        if (template) formData.append('template', template);
        if (outro) formData.append('outro', outro);
        if (includeAds) formData.append('includeAds', includeAds.toString());
        formData.append('includeTitle', includeTitle.toString());
        if (videoFilter) formData.append('videoFilter', videoFilter);

        // Pass manual video selection
        if (selectedVideoFiles && selectedVideoFiles.length > 0) {
            formData.append('selectedVideoFiles', JSON.stringify(selectedVideoFiles));
        }

        const videoResponse = await axios.post(`${getBaseUrl(req)}/api/video/generate-video`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': authHeader
            }
        });

        const videoData = videoResponse.data.success ? videoResponse.data : null;

        // 3. Info 파일 생성
        const infoPath = path.join(projectDir, 'info.txt');
        const BOM = '\ufeff';
        const infoContent = `${BOM}제목: ${title}\n\n설명: ${description || ''}\n\n오디오 소스: ${audioFilename}`;
        await fs.writeFile(infoPath, infoContent, { encoding: 'utf8' });

        res.json({
            success: true,
            projectFolder: projectFolder,
            videoData: videoData,
            metadata: {
                generated_at: new Date().toISOString(),
                source_audio: audioFilename
            }
        });

    } catch (error) {
        console.error('Video Generation From File Error:', error.response?.data || error.message);
        res.status(500).json({
            error: '비디오 생성 중 오류가 발생했습니다.',
            details: error.response?.data || error.message
        });
    }
});

export default router;