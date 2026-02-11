import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 302.AI TTS API (OpenAI-compatible)
const AI_302_TTS_URL = 'https://api.302.ai/v1/audio/speech';

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
    const response = await fetch(AI_302_TTS_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice: voiceId,
            response_format: 'mp3',
            speed: 1.0
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`302.AI TTS API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // 302.AI TTS는 바이너리 오디오 데이터를 반환
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

router.post('/generate-tts', async (req, res) => {
    const { title, content, speed = 1.0, projectFolder, voiceId = 'nova' } = req.body;

    if (!title || !content) {
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
        console.log('Calling 302.AI TTS...');
        const audioBuffer = await synthesizeWith302AI(apiKey, content, voiceId);

        let folderName = projectFolder;
        if (!folderName) {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            folderName = timestamp;
        }

        const projectDir = path.join(__dirname, '..', 'outputs', folderName);
        await fs.mkdir(projectDir, { recursive: true });

        const filename = `audio_${Date.now()}.mp3`;
        const outputPath = path.join(projectDir, filename);

        await fs.writeFile(outputPath, audioBuffer);

        res.json({
            success: true,
            title: title,
            audioPath: outputPath,
            audioUrl: `/outputs/${folderName}/${filename}`,
            folderName: folderName
        });

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
