import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 302.AI TTS API URLs
const AI_302_OPENAI_TTS_URL = 'https://api.302.ai/v1/audio/speech';  // OpenAI TTS
const AI_302_MINIMAX_TTS_URL = 'https://api.302.ai/minimaxi/v1/t2a_v2';  // MiniMax TTS

// 302.AI TTS 음성 목록
const VOICE_OPTIONS = [
    { id: 'alloy', name: 'Alloy', description: '중성적인 음성' },
    { id: 'echo', name: 'Echo', description: '남성 음성' },
    { id: 'fable', name: 'Fable', description: '영국식 남성 음성' },
    { id: 'onyx', name: 'Onyx', description: '깊은 남성 음성' },
    { id: 'nova', name: 'Nova', description: '여성 음성' },
    { id: 'shimmer', name: 'Shimmer', description: '부드러운 여성 음성' }
];

// 302.AI TTS API 호출
async function synthesizeWith302AI(apiKey, text, voiceId = 'nova') {
    if (!text || text.trim() === '') {
        throw new Error('No input specified');
    }

    // MiniMax 한국어 목소리인지 확인
    const isMiniMaxVoice = voiceId.startsWith('Korean_');

    let requestBody, apiUrl;

    if (isMiniMaxVoice) {
        // MiniMax TTS 요청 형식
        apiUrl = AI_302_MINIMAX_TTS_URL;
        requestBody = {
            model: 'speech-01-turbo',
            text: text,
            voice_setting: {
                voice_id: voiceId,
                speed: 1.2,
                vol: 1.0,
                pitch: 0
            },
            audio_setting: {
                sample_rate: 24000,
                bitrate: 128000,
                format: 'mp3',
                channel: 1
            }
        };
    } else {
        // OpenAI TTS 요청 형식
        apiUrl = AI_302_OPENAI_TTS_URL;
        requestBody = {
            model: 'tts-1',
            input: text,
            voice: voiceId,
            response_format: 'mp3',
            speed: 1.2
        };
    }

    console.log('[302.AI API] Request:', { url: apiUrl, model: isMiniMaxVoice ? 'speech-01-turbo' : 'tts-1', inputLength: text.length, voice: voiceId });
    console.log('[302.AI API] API Key exists:', !!apiKey, 'Length:', apiKey?.length);

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    console.log('[302.AI API] Response status:', response.status, response.statusText);

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[302.AI API] Error response:', errorText);
        throw new Error(`302.AI TTS API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // 응답 형식이 엔드포인트마다 다름
    console.log('[302.AI API] Parsing audio response...');

    if (isMiniMaxVoice) {
        // MiniMax: JSON 응답, data.audio 필드에 hex-encoded 오디오
        const result = await response.json();
        console.log('[302.AI API] MiniMax JSON response received');

        if (!result.data || !result.data.audio) {
            throw new Error('Invalid MiniMax response format: missing data.audio');
        }

        const audioBuffer = Buffer.from(result.data.audio, 'hex');
        console.log('[302.AI API] Audio buffer size:', audioBuffer.byteLength);
        return audioBuffer;
    } else {
        // OpenAI: 바이너리 오디오 데이터 직접 반환
        const arrayBuffer = await response.arrayBuffer();
        console.log('[302.AI API] Audio buffer size:', arrayBuffer.byteLength);
        return Buffer.from(arrayBuffer);
    }
}

router.post('/generate-tts', async (req, res) => {
    const { title, content, speed = 1.0, projectFolder, voiceId = 'nova' } = req.body;

    console.log('[302.AI TTS] Request body:', { title, content: content?.substring(0, 50), speed, projectFolder, voiceId });

    if (!title || !content) {
        console.error('[302.AI TTS] Missing parameters:', { title: !!title, content: !!content });
        return res.status(400).json({ error: '제목과 내용이 필요합니다.' });
    }

    const apiKey = process.env.AI_302_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: '302.AI API 키가 설정되지 않았습니다.',
            details: 'AI_302_API_KEY를 .env 파일에 설정해주세요.'
        });
    }

    try {
        console.log('[302.AI TTS] Calling API with:', { textLength: content.length, voiceId });
        const audioBuffer = await synthesizeWith302AI(apiKey, content, voiceId);
        console.log('[302.AI TTS] Audio buffer received:', audioBuffer.length, 'bytes');

        let folderName = projectFolder;
        if (!folderName) {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            folderName = timestamp;
        }
        console.log('[302.AI TTS] Using folder:', folderName);

        const projectDir = path.join(__dirname, '..', 'outputs', folderName);
        await fs.mkdir(projectDir, { recursive: true });
        console.log('[302.AI TTS] Created directory:', projectDir);

        const filename = `audio_${Date.now()}.mp3`;
        const outputPath = path.join(projectDir, filename);
        console.log('[302.AI TTS] Saving to:', outputPath);

        await fs.writeFile(outputPath, audioBuffer);
        console.log('[302.AI TTS] File saved successfully!');

        const response = {
            success: true,
            title: title,
            audioPath: outputPath,
            localPath: outputPath,  // shorts.js expects this field
            audioUrl: `/outputs/${folderName}/${filename}`,
            folderName: folderName
        };
        console.log('[302.AI TTS] Sending response:', response);

        res.json(response);

    } catch (error) {
        console.error('TTS Error:', error);
        res.status(500).json({
            error: 'TTS 생성 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

router.get('/voices', (req, res) => {
    res.json({
        success: true,
        voices: VOICE_OPTIONS
    });
});

router.use('/outputs', express.static(path.join(__dirname, '..', 'outputs')));

export default router;
