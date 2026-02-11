import express from 'express';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FormData from 'form-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const AI_302_TRANSCRIPTION_URL = 'https://api.302.ai/v1/audio/transcriptions';

async function transcribeWith302AI(apiKey, audioPath) {
    const formData = new FormData();
    formData.append('file', fsSync.createReadStream(audioPath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'ko');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');

    const response = await fetch(AI_302_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders()
        },
        body: formData
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`302.AI API error: ${error}`);
    }

    const data = await response.json();

    // Convert OpenAI Whisper format to our format
    const segments = data.segments ? data.segments.map(seg => ({
        start: seg.start,
        end: seg.end,
        text: seg.text
    })) : [];

    return {
        segments,
        text: data.text
    };
}

router.post('/generate-srt', async (req, res) => {
    const { audioPath, title } = req.body;

    if (!audioPath || !title) {
        return res.status(400).json({ error: '오디오 경로와 제목이 필요합니다.' });
    }

    const apiKey = process.env.AI_302_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'AI_302_API_KEY not configured' });
    }

    try {
        console.log('Processing audio with 302.AI Whisper:', audioPath);

        const transcription = await transcribeWith302AI(apiKey, audioPath);

        console.log('Transcription completed');

        const srtContent = generateSRT(transcription);

        const audioDir = path.dirname(audioPath);
        const baseName = path.basename(audioPath, '.mp3');
        const srtFilename = `${baseName}.srt`;

        const srtPath = path.join(audioDir, srtFilename);
        const BOM = '\ufeff';
        fsSync.writeFileSync(srtPath, BOM + srtContent, 'utf8');

        const outputsDir = path.join(__dirname, '..', 'outputs');
        const relativePath = path.relative(outputsDir, srtPath).replace(/\\/g, '/');

        console.log(`SRT file saved: ${srtPath}`);

        res.json({
            success: true,
            srtPath: srtPath,
            srtUrl: `/outputs/${relativePath}`,
            srtContent: srtContent,
            transcription: transcription.text
        });

    } catch (error) {
        console.error('Whisper Error:', error);
        res.status(500).json({
            error: '자막 생성 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

function generateSRT(transcription) {
    let srtContent = '';
    let index = 1;

    if (transcription.segments && transcription.segments.length > 0) {
        for (const segment of transcription.segments) {
            const startTime = formatTime(segment.start);
            const endTime = formatTime(segment.end);
            const text = segment.text.trim();

            if (text) {
                srtContent += `${index}\n`;
                srtContent += `${startTime} --> ${endTime}\n`;
                srtContent += `${text}\n\n`;
                index++;
            }
        }
    } else {
        const text = transcription.text || '';
        const words = text.split(' ');
        const wordsPerSubtitle = 8;
        const duration = transcription.duration || 10;

        for (let i = 0; i < words.length; i += wordsPerSubtitle) {
            const chunk = words.slice(i, i + wordsPerSubtitle).join(' ');
            const startSec = (i / words.length) * duration;
            const endSec = Math.min(((i + wordsPerSubtitle) / words.length) * duration, duration);

            const startTime = formatTime(startSec);
            const endTime = formatTime(endSec);

            srtContent += `${index}\n`;
            srtContent += `${startTime} --> ${endTime}\n`;
            srtContent += `${chunk}\n\n`;
            index++;
        }
    }

    return srtContent;
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(milliseconds, 3)}`;
}

function pad(num, size = 2) {
    let s = num.toString();
    while (s.length < size) s = '0' + s;
    return s;
}

export default router;
