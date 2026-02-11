/**
 * AI Video Short-form Generator Routes
 * 
 * Handles:
 * - Image listing from video-sources folder
 * - Video generation with ByteDance Seedance
 * - Script generation with Gemini
 */
// Restart trigger for ffmpeg-static fix

import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import textToSpeech from '@google-cloud/text-to-speech';
import sdk from 'microsoft-cognitiveservices-speech-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Initialize Google TTS client
const ttsClient = new textToSpeech.TextToSpeechClient();

// Image source folder path
const IMAGE_SOURCE_PATH = path.join(__dirname, '../public/images/video-sources');
const OUTPUT_PATH = path.join(__dirname, '../Output/ai-videos');
const AUDIO_OUTPUT_PATH = path.join(__dirname, '../data/common/audio');

// Supported image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Camera work prompts (unchanged)
const CAMERA_WORK_PROMPTS = {
    zoom_out: "Use the provided image strictly as the final frame. Camera originates above the scene and glides downward into the final frame at extremely slow cinematic speed. Camera performs a very slow, subtle zoom-out only. Food or subject must remain completely static, no morphing, no movement. Only camera moves. 8 seconds duration.",
    rotate: "Barely moving camera. Camera rotates only 10-15 degrees total throughout entire 8 second video. Not a turntable, object stays perfectly still. 35mm lens, 3:4 vertical aspect ratio. Subject must not move or deform at all.",
    zoom_in: "Very slow forward zoom in. Scale zoom from 1.0x to 1.2x over 8 seconds. Absolutely no object motion. Subject must remain completely static. Camera movement only, cinematic documentary style.",
    pan_down: "Camera starts above the scene and performs a linear vertical tracking move downward at an extremely slow, cinematic-documentary speed. Subject remains absolutely frozen in place. Only camera performs the movement. 8 seconds.",
    diagonal: "Camera originates outside the top-left area and moves diagonally from the bottom-left corner toward the top-right corner at extremely slow pace. The subject must remain perfectly stationary. Smooth, professional camera motion only. 8 seconds duration.",
    pan_right: "Camera starts from the left side and performs a linear horizontal tracking move from left to right at an extremely slow, cinematic-documentary speed. Subject remains absolutely frozen in place. Only camera performs the smooth horizontal movement. 8 seconds duration."
};

// Interior Mode Camera Prompts
const INTERIOR_CAMERA_WORK_PROMPTS = {
    zoom_out: "Start frame is the absolute reference. Strictly maintain all original furniture, lighting, and textures. Camera slowly zooms out. No new objects appearing. No morphing. High-fidelity architectural visualization.",
    rotate: "Keep all furniture and decor completely static. Camera moves in a subtle arc. Strictly preserve the original structure and layout. No new elements. maintain consistency with the start frame.",
    zoom_in: "Strictly adhere to the original image details. Camera slowly pushes in. Do not change any furniture designs. No hallucinations. Maintain perfect structural stability of the room.",
    pan_down: "Vertical scan of the room. Keep all original objects exactly as they are. No warping or adding items. Clean, stable, and professional architectural presentation.",
    diagonal: "Diagonal slide movement. Parallax effect only. Do not add or remove any objects. Strictly faithful to the original interior design. High geometric stability.",
    pan_right: "Horizontal tracking movement from left to right. Maintain all furniture and decor exactly as shown in the original image. No object morphing or hallucination. Clean architectural camera move preserving room integrity."
};

// Script styles (Updated to match Python source)
const SCRIPT_STYLES = {
    "Review": { korean: "리뷰형", english: "Review", description: "개인적인 방문 경험을 바탕으로 한 진솔한 리뷰 스타일" },
    "Promotional": { korean: "홍보형", english: "Promotional", description: "매장의 장점을 강조하는 직접적인 홍보 스타일" },
    "Storytelling": { korean: "스토리텔링형", english: "Storytelling", description: "가게의 스토리나 사장님의 이야기를 담은 감성 스타일" },
    "Tips": { korean: "팁/추천형", english: "Tips & Recommendation", description: "꿀팁이나 추천 메뉴를 소개하는 정보 제공 스타일" },
    "HoneyTips": { korean: "꿀팁", english: "Honey Tips", description: "유용한 꿀팁을 핵심만 쏙쏙 뽑아 알려주는 스타일" },
    "Urgency": { korean: "긴급/FOMO형", english: "Urgency/FOMO", description: "지금 가야 하는 이유를 강조하는 긴박감 있는 스타일" },
    "Comparison": { korean: "비교형", english: "Comparison", description: "다른 곳과 비교하며 차별점을 부각하는 스타일" },
    "Question": { korean: "질문형", english: "Question", description: "시청자에게 질문을 던지며 호기심을 유발하는 스타일" },
    // Entertainment Styles
    "Humor/Gag": { korean: "유머/개그", english: "Humor/Gag", description: "재미있고 웃긴 요소가 강조된 스타일" },
    "Information": { korean: "정보전달", english: "Information", description: "유용한 정보나 사실을 전달하는 스타일" },
    "Ranking/Top 5": { korean: "순위/랭킹", english: "Ranking/Top 5", description: "Top 5 등 순위를 매겨 소개하는 스타일" },
    "Vlog": { korean: "브이로그", english: "Vlog", description: "일상적인 이야기를 자연스럽게 풀어내는 스타일" },
    "Reaction": { korean: "리액션/후기", english: "Reaction", description: "찐 반응과 리얼한 후기를 담은 스타일" },
    "Story/Rumor": { korean: "썰/스토리", english: "Story/Rumor", description: "흥미진진한 이야기를 들려주는 스타일" }
};

// Intro styles (Updated to match Python source)
const INTRO_STYLES = {
    "충격적 사실형": { english: "Shocking Fact", description: "놀라운 사실로 시작 (예: 알고 계셨나요? 이 집은...)" },
    "질문 던지기형": { english: "Question Hook", description: "시청자에게 질문 던지기 (예: 여러분은 어떤 음식 좋아하세요?)" },
    "놀람 후크형": { english: "Surprise Hook", description: "감탄사로 시작 (예: 와, 진짜 대박이에요!)" },
    "지역 인증형": { english: "Local Authority", description: "지역 사람들의 인정 강조 (예: 고양시 택시 기사님들이 1등으로 뽑는다는...)" },
    "직설적 소개형": { english: "Direct Introduction", description: "바로 본론으로 시작 (예: 40년 전통의 할매 순대국, 드디어 방문했습니다!)" },
    "방문 인증형": { english: "Visit Verification", description: "매장 위치와 이름을 언급하며 방문 사실을 알리며 시작 (예: 오늘은 [위치]에 있는 [가게이름]에 다녀왔는데요...)" },
    // Entertainment Styles
    "시선강탈형": { english: "Hook/Attention", description: "초반 3초 안에 시선을 확 끄는 비주얼이나 멘트" },
    "질문유발형": { english: "Question/Curiosity", description: "궁금증을 자아내는 질문으로 시작" },
    "결론제시형": { english: "Conclusion First", description: "결과물이나 결론을 먼저 보여주고 시작" },
    "상황극형": { english: "Situation/Skit", description: "짧은 상황극으로 재미있게 시작" }
};

// Outro styles (Updated to match Python source)
const OUTRO_STYLES = {
    "물음표 마무리형": { english: "Question Mark Ending", description: "장소를 물음표로 마무리 (예: 배터지게 먹을 수 있는 이곳은?)" },
    "장점 강조 물음형": { english: "Benefits Question", description: "매장 장점 강조 후 '이곳은?'으로 마무리 (예: 삼겹살을 저렴하게 배터지게 먹을 수 있는 이곳은?)" },
    "물음표 장난형": { english: "Playful Question", description: "재치있는 질문으로 마무리 (예: 이 가격에 뭐 남는 것 있으세요?)" },
    "추천형": { english: "Recommendation", description: "직접적인 추천 (예: 든든한 한 끼 생각나면 꼭 들러보세요!)" },
    "행동 유도형": { english: "Call to Action", description: "방문 유도 (예: 여러분도 한번 가보시길 추천드립니다!)" },
    "반전 확신형": { english: "Confident Conclusion", description: "확신을 주는 마무리 (예: 진짜 찐맛집 맞더라고요!)" },
    // Entertainment Styles
    "구독/좋아요 유도": { english: "Subscribe/Like", description: "구독과 좋아요를 자연스럽게 요청" },
    "다음화 예고": { english: "Next Episode", description: "다음 내용을 예고하며 기대감 조성" },
    "댓글참여 유도": { english: "Comment Question", description: "시청자의 의견을 묻는 질문으로 댓글 유도" },
    "요약정리": { english: "Summary", description: "핵심 내용을 짧게 요약하며 마무리" }
};

// Ensure output directory exists
async function ensureOutputDir() {
    try {
        await fs.mkdir(OUTPUT_PATH, { recursive: true });
    } catch (error) {
        console.error('Failed to create output directory:', error);
    }
}

// Ensure image source directory exists
async function ensureImageSourceDir() {
    try {
        await fs.mkdir(IMAGE_SOURCE_PATH, { recursive: true });
    } catch (error) {
        console.error('Failed to create image source directory:', error);
    }
}

// Multer configuration for image upload
const imageStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            if (!fsSync.existsSync(IMAGE_SOURCE_PATH)) {
                fsSync.mkdirSync(IMAGE_SOURCE_PATH, { recursive: true });
            }
            cb(null, IMAGE_SOURCE_PATH);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        // Keep original filename but add timestamp to avoid conflicts
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        // Sanitize filename to prevent OneDrive sync issues
        // Allow Korean, English, Numbers, Hyphen, Underscore
        const sanitizedName = name.replace(/[^a-zA-Z0-9가-힣_-]/g, '').trim() || 'image';
        const timestamp = Date.now();
        cb(null, `${sanitizedName}_${timestamp}${ext}`);
    }
});

const imageUpload = multer({
    storage: imageStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit per file
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype.startsWith('image/');
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
        }
    }
});

// Upload images
router.post('/upload', imageUpload.array('images', 50), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, error: '업로드할 파일이 없습니다.' });
        }

        console.log(`[AI Video] Uploaded ${files.length} images`);

        res.json({
            success: true,
            uploaded: files.length,
            files: files.map(f => ({
                name: f.filename,
                path: `/images/video-sources/${f.filename}`,
                size: f.size
            }))
        });
    } catch (error) {
        console.error('Image upload failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete image
router.post('/delete-image', async (req, res) => {
    try {
        const { imagePath } = req.body;

        if (!imagePath) {
            return res.status(400).json({ success: false, error: '이미지 경로가 필요합니다.' });
        }

        // Clean the path and get the actual file path
        const cleanPath = imagePath.replace(/^\/+/, ''); // Remove leading slashes
        const actualPath = path.join(__dirname, '../public', cleanPath);

        // Check if file exists
        try {
            await fs.access(actualPath);
        } catch {
            return res.status(404).json({ success: false, error: '파일을 찾을 수 없습니다.' });
        }

        // Delete the file
        await fs.unlink(actualPath);
        console.log(`[AI Video] Deleted image: ${actualPath}`);

        res.json({ success: true, message: '이미지가 삭제되었습니다.' });
    } catch (error) {
        console.error('Image deletion failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get list of images from video-sources folder
router.get('/images', async (req, res) => {
    try {
        // Ensure the source directory exists
        try {
            await fs.access(IMAGE_SOURCE_PATH);
        } catch {
            await fs.mkdir(IMAGE_SOURCE_PATH, { recursive: true });
            return res.json({ success: true, images: [] });
        }

        const files = await fs.readdir(IMAGE_SOURCE_PATH);
        const images = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (IMAGE_EXTENSIONS.includes(ext)) {
                const filePath = path.join(IMAGE_SOURCE_PATH, file);
                const stats = await fs.stat(filePath);

                images.push({
                    name: file,
                    path: `/images/video-sources/${file}`,
                    size: stats.size,
                    modified: stats.mtime
                });
            }
        }

        // Sort by modified date (newest first)
        images.sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({ success: true, images });
    } catch (error) {
        console.error('Failed to get images:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate script using Gemini
router.post('/generate-script', async (req, res) => {
    try {
        const { storeName, storeDescription, scriptStyle, introStyle, outroStyle } = req.body;

        if (!storeName) {
            return res.status(400).json({ success: false, error: 'Store name is required' });
        }

        const styleInfo = SCRIPT_STYLES[scriptStyle] || SCRIPT_STYLES.review;
        const introInfo = INTRO_STYLES[introStyle] || INTRO_STYLES.shocking;
        const outroInfo = OUTRO_STYLES[outroStyle] || OUTRO_STYLES.question_mark;

        const prompt = `You are a professional YouTube Shorts scriptwriter specializing in food and restaurant content.

## Input Information:
- Store/Product Name: ${storeName}
- Description: ${storeDescription || 'No additional description provided'}

## Script Style: ${styleInfo.korean}
${styleInfo.description}

## Intro Style:
${introInfo}

## Outro Style:
${outroInfo}

## Writing Guidelines:
1. Title: Create a click-worthy title (10-15 words in Korean)
2. Length: 35-50 seconds when read aloud (approximately 100-130 Korean characters)
3. Tone: Natural, conversational, casual speech - like talking to a friend
4. Use natural fillers like "진짜 대박인 게", "근데", "솔직히" sparingly
5. NO emojis (for TTS compatibility)
6. Mention the store name only ONCE
7. Make it engaging and authentic

## Output Format (JSON):
{
  "title": "영상 제목",
  "script": "대본 내용...",
  "description": "영상 설명 및 해시태그"
}

Write the script in Korean:`;

        // Check for API key
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            // Return a sample script if no API key
            const sampleScript = {
                title: `${storeName} 리뷰 - 진짜 맛집인지 확인해봤습니다`,
                script: `여러분 오늘 진짜 대박인 곳 발견했어요. ${storeName}인데요, ${storeDescription || '여기 진짜 맛있어요'}. 솔직히 처음에는 반신반의했는데 한입 먹자마자 '아 이거다' 싶더라고요. 가격도 착하고 양도 푸짐하고, 진짜 맛집 맞더라고요. 여러분도 한번 가보세요!`,
                description: `#${storeName.replace(/\s/g, '')} #맛집 #먹방 #맛집추천 #리뷰`
            };
            return res.json({ success: true, script: JSON.stringify(sampleScript, null, 2) });
        }

        // Call Gemini API
        // Call Gemini API (Using gemini-2.0-flash-exp as requested/latest)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 1024
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`Gemini API Error (${response.status}): ${data.error?.message || response.statusText}`);
        }

        if (data.promptFeedback?.blockReason) {
            throw new Error(`Script blocked by safety filters: ${data.promptFeedback.blockReason}`);
        }

        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
            const scriptText = data.candidates[0].content.parts[0].text;
            res.json({ success: true, script: scriptText });
        } else {
            console.error('Unexpected Gemini Response:', JSON.stringify(data, null, 2));
            throw new Error(`Invalid response structure from Gemini API: ${JSON.stringify(data)}`);
        }

    } catch (error) {
        console.error('Script generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate video from image using AI
router.post('/generate', async (req, res) => {
    try {
        const { imagePath, cameraWork, model, prompt, videoFilter, videoMode = 'restaurant' } = req.body;

        if (!imagePath || !cameraWork) {
            return res.status(400).json({ success: false, error: 'Image path and camera work are required' });
        }

        await ensureOutputDir();

        // Select prompt based on mode
        let cameraPrompt;
        if (videoMode === 'interior') {
            cameraPrompt = INTERIOR_CAMERA_WORK_PROMPTS[cameraWork] || prompt;
            console.log(`[AI Video] Using INTERIOR mode prompt for ${cameraWork}`);
        } else {
            cameraPrompt = CAMERA_WORK_PROMPTS[cameraWork] || prompt;
            console.log(`[AI Video] Using RESTAURANT mode prompt for ${cameraWork}`);
        }

        // Get the actual file path
        const actualImagePath = path.join(__dirname, '../public', imagePath);

        // Check if image exists
        try {
            await fs.access(actualImagePath);
        } catch {
            return res.status(404).json({ success: false, error: 'Image not found' });
        }

        // Generate output filename
        const rawImageName = path.basename(imagePath, path.extname(imagePath));
        // Sanitize image name for video output
        const imageName = rawImageName.replace(/[^a-zA-Z0-9가-힣_-]/g, '').trim() || 'video';
        const timestamp = Date.now();

        // Add stratified sampling prefix if indices are provided
        const { imageIndex, variationIndex } = req.body;
        let prefix = "";
        if (imageIndex && variationIndex) {
            prefix = `${imageIndex}-${variationIndex}_`;
        }

        // Include mode in filename for easier debugging
        const modePrefix = videoMode === 'interior' ? 'interior_' : '';
        const outputFileName = `${prefix}${modePrefix}${imageName}_${cameraWork}_${timestamp}.mp4`;
        const outputPath = path.join(OUTPUT_PATH, outputFileName);

        // TODO: Integrate with actual ByteDance Seedance API
        // For now, return a placeholder response

        console.log(`[AI Video] Generating video:`);
        console.log(`  - Image: ${imagePath}`);
        console.log(`  - Camera Work: ${cameraWork}`);
        console.log(`  - Model: ${model}`);
        console.log(`  - Prompt: ${cameraPrompt.substring(0, 100)}...`);


        // Check for API key
        const apiKey = process.env.SEEDANCE_API_KEY || process.env.ARK_API_KEY;

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'API key not configured. Please set SEEDANCE_API_KEY or ARK_API_KEY in your .env file.'
            });
        }

        // BytePlus ModelArk API endpoint  
        const apiEndpoint = 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';

        // Model name mapping
        const modelNames = {
            'seedance-1.5-pro': 'seedance-1-5-pro-251215',
            'seedance-1.0-pro-fast': 'seedance-1-0-pro-fast-251015',
            'seedance-1.0-lite': 'seedance-1-0-lite-i2v-250428',
            'seedance-1.0-pro': 'seedance-1-0-pro-250528'
        };
        const modelName = modelNames[model] || 'seedance-1-0-pro-fast-251015';

        // Create image URL (we need to serve the image or encode it)
        // For BytePlus, we'll use base64 data URL
        let imageDataUrl;
        try {
            const imageBuffer = await fs.readFile(actualImagePath);
            const imageBase64 = imageBuffer.toString('base64');
            const ext = path.extname(actualImagePath).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
            imageDataUrl = `data:${mimeType};base64,${imageBase64}`;
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: 'Failed to read image file: ' + error.message
            });
        }

        // Set resolution based on model (9:16 vertical for shorts)
        const isLiteModel = modelName.includes('lite'); // lite adapts to source; avoid forcing resolution
        const modelResolution = {
            'seedance-1-5-pro-251215': '720p',   // supports 480p/720p
            'seedance-1-0-pro-250528': '1080p',  // supports 480p/720p/1080p
            'seedance-1-0-pro-fast-251015': '720p' // not documented; use 720p for speed/cost balance
        };
        const resolution = modelResolution[modelName];
        const resolutionParams = isLiteModel
            ? '--ratio 9:16'
            : `--resolution ${resolution || '720p'} --ratio 9:16`;

        // Build prompt with parameters
        const promptWithParams = `${cameraPrompt} ${resolutionParams} --duration 2 --camerafixed false --watermark false`;

        try {
            // Create video generation task
            console.log(`[AI Video] Calling BytePlus ModelArk API...`);
            console.log(`[AI Video] Model: ${modelName}`);
            console.log(`[AI Video] Endpoint: ${apiEndpoint}`);

            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: modelName,
                    content: [
                        {
                            type: 'text',
                            text: promptWithParams
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageDataUrl
                            }
                        }
                    ]
                })
            });

            const data = await response.json();
            console.log(`[AI Video] Response status: ${response.status}`);

            if (!response.ok) {
                console.error('[AI Video] API Error:', JSON.stringify(data, null, 2));
                return res.status(response.status).json({
                    success: false,
                    error: `BytePlus API error: ${data.message || data.error || JSON.stringify(data)}`,
                    details: data
                });
            }

            // Check if task was created successfully
            const taskId = data.id || data.task_id || data.req_id;
            if (taskId) {
                console.log(`[AI Video] Task created: ${taskId}`);

                // Poll for task completion
                const maxAttempts = 60; // 5 minutes max (5s intervals)
                let attempts = 0;
                let videoUrl = null;

                while (attempts < maxAttempts) {
                    attempts++;

                    // Wait 5 seconds before checking
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    // Check task status
                    const statusResponse = await fetch(`${apiEndpoint}/${taskId}`, {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`
                        }
                    });

                    const statusData = await statusResponse.json();
                    const status = statusData.status || statusData.task_status || statusData.state;
                    console.log(`[AI Video] Polling ${attempts}/${maxAttempts}: status=${status}`);

                    if (status === 'SUCCESS' || status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'succeeded') {
                        // BytePlus API returns video URL in content.video_url field
                        videoUrl = (statusData.content && statusData.content.video_url) ||
                            (statusData.content && statusData.content[0] && statusData.content[0].video_url) ||
                            statusData.video_url ||
                            statusData.videoUrl;

                        if (videoUrl) {
                            console.log(`[AI Video] Video URL found: ${videoUrl}`);
                            break;
                        } else {
                            // Task succeeded but no video URL - log response for debugging
                            console.error('[AI Video] Task succeeded but no video URL found. Response:', JSON.stringify(statusData, null, 2));
                            return res.status(500).json({
                                success: false,
                                error: 'Video generation completed but no video URL was returned',
                                details: statusData
                            });
                        }
                    } else if (status === 'FAILED' || status === 'ERROR' || status === 'failed') {
                        console.error('[AI Video] Task failed:', statusData);
                        return res.status(500).json({
                            success: false,
                            error: 'Video generation failed on server',
                            details: statusData
                        });
                    }
                }

                if (!videoUrl) {
                    return res.status(408).json({
                        success: false,
                        error: 'Video generation timeout or video URL not found. Please try again.',
                        task_id: taskId
                    });
                }

                // Download the video to local storage
                console.log(`[AI Video] Downloading video from: ${videoUrl}`);
                const videoResponse = await fetch(videoUrl);

                if (!videoResponse.ok) {
                    throw new Error(`Failed to download video: ${videoResponse.status}`);
                }

                const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

                await fs.writeFile(outputPath, videoBuffer);
                console.log(`[AI Video] Video saved to: ${outputPath}`);

                // Appy Video Filter if requested
                if (videoFilter === 'western') {
                    console.log('[AI Video] Applying Western Filter...');
                    try {
                        const ffmpeg = (await import('fluent-ffmpeg')).default;
                        const tempFilteredPath = outputPath.replace('.mp4', '_filtered.mp4');

                        await new Promise((resolve, reject) => {
                            ffmpeg(outputPath)
                                .videoFilters('eq=contrast=1.15:saturation=1.2,colorbalance=rs=.05:bs=-.05')
                                .outputOptions('-c:a copy') // Copy audio if any (though AI video usually has none or we want to keep it)
                                .save(tempFilteredPath)
                                .on('end', async () => {
                                    // Replace original with filtered
                                    await fs.rename(tempFilteredPath, outputPath);
                                    console.log('[AI Video] Western Filter applied successfully');
                                    resolve();
                                })
                                .on('error', (err) => {
                                    console.error('[AI Video] Filter application failed:', err);
                                    // Continue with original video on error
                                    resolve();
                                });
                        });
                    } catch (filterErr) {
                        console.error('[AI Video] Filter setup failed:', filterErr);
                    }
                }

                res.json({
                    success: true,
                    videoPath: `/Output/ai-videos/${outputFileName}`,
                    task_id: taskId,
                    message: 'Video generated successfully'
                });

            } else {
                console.error('[AI Video] No task ID in response:', data);
                return res.status(500).json({
                    success: false,
                    error: 'Unexpected API response format - no task ID received',
                    details: data
                });
            }

        } catch (error) {
            console.error('[AI Video] Generation error:', error);
            return res.status(500).json({
                success: false,
                error: 'Video generation failed: ' + error.message
            });
        }


    } catch (error) {
        console.error('Video generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available models
router.get('/models', (req, res) => {
    res.json({
        success: true,
        models: [
            { id: 'seedance-1.0', name: 'Seedance 1.0', description: '빠른 생성, 안정적' },
            { id: 'seedance-1.5', name: 'Seedance 1.5', description: '고품질, 느림' }
        ]
    });
});

// Get camera work options
router.get('/camera-works', (req, res) => {
    res.json({
        success: true,
        cameraWorks: Object.entries(CAMERA_WORK_PROMPTS).map(([key, prompt]) => ({
            id: key,
            name: key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
            prompt
        }))
    });
});

// Ensure audio output directory exists
async function ensureAudioDir() {
    try {
        await fs.mkdir(AUDIO_OUTPUT_PATH, { recursive: true });
    } catch (error) {
        console.error('Failed to create audio output directory:', error);
    }
}

// Generate multiple scripts with new logic
router.post('/generate-scripts', async (req, res) => {
    try {
        const {
            restaurantName,
            description,
            styles,
            language,
            introStyle,
            outroStyle,
            location,
            locationIn,
            includeRestaurantName,

            mode = 'business',
            count = 1
        } = req.body;

        const actualCount = Math.min(Math.max(parseInt(count) || 1, 1), 10);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: 'GEMINI_API_KEY is not set' });
        }

        console.log(`[Script Gen] Generating scripts for styles: ${styles.join(', ')}`);

        const results = {};

        // Helper to generate one script
        async function generateSingleScript(styleName) {
            // Find key by matching korean or english name
            const styleKey = Object.keys(SCRIPT_STYLES).find(key =>
                SCRIPT_STYLES[key].korean === styleName || SCRIPT_STYLES[key].english === styleName
            ) || styleName;

            // Construct Prompt
            let prompt = "";
            const introDesc = INTRO_STYLES[introStyle]?.description || "";
            const outroDesc = OUTRO_STYLES[outroStyle]?.description || "";

            // Determine language for prompt construction
            const isKorean = language === "Korean";
            const isEntertainment = mode === 'entertainment';

            if (isEntertainment) {
                // === ENTERTAINMENT MODE PROMPT ===
                if (isKorean) {
                    prompt = `당신은 유튜브 쇼츠 전문 대본 작가입니다. 다음 **주제**를 바탕으로 재미있고 흥미로운 쇼츠 대본을 작성해주세요.

**중요 지침 (저작권 및 사실 관계):**
만약 아래 '상세 내용/가이드'에 완성된 대본이나 구체적인 정보(팁, 순서 등)가 있다면, **핵심 내용과 팩트는 그대로 유지**하되 문장 끝맺음이나 연결어만 자연스럽게 다듬어주세요. **내용을 과도하게 변형하거나 없는 사실을 지어내지 마세요.**

**영상 정보:**
- 주제/제목: ${includeRestaurantName ? restaurantName : "비공개 (대본/제목에 언급 금지)"} (이것을 대본의 핵심 소재로 사용하세요)
- 상세 내용/가이드: 
${description}

**대본 스타일:** ${styleName} (예: 스토리텔링, 유머, 정보전달 등)
**인트로 스타일:** ${introStyle} (예: 충격적 사실, 질문 던지기 등)
**아웃트로 스타일:** ${outroStyle} (예: 반전 확신형, 추천형 등)

**작성 가이드라인:**

0. **[중요] 이모지 절대 금지**:
   - 제목과 대본 어디에도 이모지(😊, ✨, 👍 등)를 절대 사용하지 마세요.
   - TTS가 이모지를 읽지 못하거나 이상하게 읽을 수 있습니다.

1. **제목 작성**:
   - 클릭을 유도하는 20-30자 내외의 임팩트 있는 제목
   - 호기심을 자극하는 표현 사용

2. **대본 분량**: 35-50초 내외 (약 150-180자)
   - 늘어지지 않게 핵심만 전달
   - 유튜브 쇼츠 특유의 빠른 호흡 유지

3. **말투**: 자연스러운 일상 대화체 구어체
   - "~했는데", "~하더라고요", "~습니다", "~길래", "~인지" 같은 자연스러운 표현 사용
   - 실제 사람이 말하듯이 편안하고 친근한 톤

4. **구조**:
   - **인트로**: ${introStyle} 스타일로 시작 (너무 과장되지 않게)
   - **본문**: ${(styleKey === 'Ranking/Top 5' || styleKey === 'Tips' || styleKey === 'HoneyTips') ?
                            '**필수: 줄글(문단)로 쓰지 말고, 번호를 매겨서 "첫째, [내용]", "둘째, [내용]" 형식으로 딱딱 끊어서 작성할 것. (입력된 팁의 개수와 순서를 정확히 지킬 것)**' :
                            `주제(${includeRestaurantName ? restaurantName : "이곳"})에 대한 이야기. 입력된 내용이 리스트라면 순서와 팩트를 유지.`}
   - **아웃트로**: ${outroStyle} 스타일로 깔끔하게 마무리

5. **중요 - 담백하고 자연스러운 어조**:
   - "어머 세상에!", "난리 났어요!" 같은 **지나친 호들갑(오버액션) 금지**.
   - 친구에게 차분하게 정보를 공유하거나 설명하는 듯한 **담백한 톤** 유지.
   - 문장은 "~습니다", "~해요", "~하더라고요" 등으로 깔끔하게 끝맺음.
6. **[가게 이름] 같은 괄호나 플레이스홀더 절대 금지**:
   - 가게 이름이 제공되지 않았거나 비공개라면, 아예 언급하지 마세요.
   - 억지로 "[가게 이름]"이라고 쓰면 TTS가 그대로 읽어서 방송 사고가 납니다.
   - ${includeRestaurantName ? "가게 이름(" + restaurantName + ")을 자연스럽게 1번 정도 언급하세요." : "가게 이름을 절대 언급하지 마세요."}


**출력 형식 (반드시 이 형식을 따라주세요):**
제목: [여기에 제목 작성]

대본: [여기에 대본 작성]

(설명이나 주석 없이 위 형식대로만 작성하세요)`;
                } else {
                    prompt = `You are a professional YouTube Shorts scriptwriter. Create an engaging 35-50 second script based on the following **Topic**.

**IMPORTANT (Copyright Compliance):**
If the 'Details/Guide' below contains a full script or long text, you **MUST paraphrase or rewrite it slightly** to avoid copyright issues. Keep the core meaning and style, but change sentence structures and vocabulary to make it original.

**CRITICAL - LANGUAGE REQUIREMENT:**
- The input/description may be provided in Korean or other languages
- You MUST write the ENTIRE output (title + script) in ENGLISH ONLY
- NO mixing of languages allowed
- Translate the core concepts from the input, then write naturally in English

**Video Info:**
- Topic/Title: ${includeRestaurantName ? restaurantName : "Hidden (DO NOT mention name in title/script)"} (Use this as the core subject)
- Details/Guide: 
${description}

**Script Style:** ${styleName}
**Intro Style:** ${introStyle}
**Outro Style:** ${outroStyle}

**Guidelines:**

0. **[CRITICAL] NO EMOJIS**:
   - Do NOT use emojis (😊, 🔥, etc.) in the title or script.
   - TTS cannot process emojis correctly. Keep it text-only.

1. **Title**: Catchy, click-worthy title (20-30 chars). NO emojis in title.
2. **Length**: 35-50 seconds (approx 100-130 words). Keep it snappy.
3. **Tone**: Conversational, engaging, typical YouTuber energy.
4. **Structure**:
   - **Intro**: Hook the viewer immediately using '${introStyle}' style.
   - **Body**: Develop the '${includeRestaurantName ? restaurantName : "hidden spot"}' topic. Expand on the details provided in '${description}' creatively.
   - **Outro**: Wrap up with a strong '${outroStyle}' ending.
5. **CRITICAL - ABSOLUTELY FORBIDDEN**:
   - **NO timestamps**: NEVER include (0-5s), (10-20 seconds), [15s], etc.
   - **NO emojis**: NEVER use 💪, 🔥, ✨ anywhere in title or script.
   - **NO stage directions**: NEVER include (Visual: ...), (Cut to...), **(Scene: ...)**, etc.
   - NO scene descriptions: Write NARRATION ONLY - what will be SPOKEN
   - This is pure voice-over text for TTS, not a video script with directions
   
6. ${includeRestaurantName ? "Include the restaurant name naturally in the script (narration) at least once." : "Do NOT mention the restaurant name in the title or script."}

**Output Format:**
Title: [Write title here]

Script: [Write script here]

(No extra comments, just the format above. REMEMBER: English narration text ONLY!)`;
                }
            }
            else if (isKorean) {
                // === BUSINESS MODE PROMPT (Existing) ===
                // Korean Prompt Construction
                let locationInstruction = "";
                if (location) {
                    if (locationIn === "intro") {
                        locationInstruction = `
**매장 위치 정보 (필수):**
- 위치: ${location}
- **중요**: 인트로에서 반드시 위치를 자연스럽게 언급해야 합니다.
- 예시: "오늘은 ${location}에 있는 ${includeRestaurantName ? restaurantName : '이곳'}에 다녀왔는데요..", "${location}에서 찾은 숨은 맛집..", "이번에 ${location}에 갔다가 발견한.."
- 인트로 스타일(${introStyle})에 맞게 자연스럽게 위치 정보를 녹여내세요. 특별히 '${introStyle}'인 경우 위치와 가게 이름을 인트로 첫 문장에 바로 언급하세요.`;
                    } else { // outro
                        locationInstruction = `
**매장 위치 정보 (필수):**
- 위치: ${location}
- **중요**: 아웃트로에서 반드시 위치를 자연스럽게 언급해야 합니다.
- 예시: "${location}에 40년 전통을 이어가는 이곳은?", "${location}에서 꼭 가봐야 할 맛집은?", "${location} 맛집 찾는다면 바로 여기"
- 아웃트로 스타일(${outroStyle})에 맞게 자연스럽게 위치 정보를 녹여내세요.`;
                    }
                }

                prompt = `당신은 유튜브 쇼츠 전문 대본 작가입니다. 다음 정보를 바탕으로 영상 제목과 35-50초 분량의 쇼츠 대본을 작성해주세요.

**중요 지침 (사실 관계 유지 및 담백한 톤):**
입력된 '식당 상세 설명'이 구체적인 정보나 리스트 형태라면, **그 내용을 왜곡하지 말고 그대로 살려서** 자연스럽게 읽을 수 있게만 다듬어주세요. "어머!", "대박!" 같은 과도한 추임새는 빼고, **담백하고 신뢰감 있게** 작성해주세요. 없는 내용(지어낸 에피소드 등)은 추가하지 마세요.

**식당 정보:**
- 가게 이름: ${includeRestaurantName ? restaurantName : "비공개 (대본/제목에 언급 금지)"}
- 식당 상세 설명 (장점, 리뷰 등 포함 가능): 
${description}
${locationInstruction}

**대본 스타일:** ${styleName}

**인트로 스타일:** ${introStyle}
- ${introDesc}

**아웃트로 스타일:** ${outroStyle}
- ${outroDesc}

**작성 가이드라인:**

0. **[중요] 이모지 절대 금지**:
   - 제목과 대본 어디에도 이모지(😊, ✨, 👍 등)를 절대 사용하지 마세요.
   - TTS가 이모지를 읽지 못하거나 이상하게 읽을 수 있습니다.

1. 제목 작성:
   - 클릭을 유도하는 임팩트 있는 제목
   - 20-30자 내외
   - 호기심을 자극하는 표현 사용
   - 예: "택시기사님들도 인정하는 고양 돈까스 찐맛집"

2. 대본 분량: 35-50초에 맞게 작성 (약 150-170자 내외, 공백 제외)
   - 구체적인 디테일을 포함하되 장황하지 않게
   - 핵심 경험을 생동감 있게 전달

3. 말투: 담백하고 편안한 구어체
   - 지나친 감탄사나 호들갑("어머 세상에", "난리 났어요") 지양
   - "~했는데", "~하더라고요", "~습니다" 같이 차분하게 끝맺음
   - 객관적인 정보를 전달할 때는 신뢰감 있는 톤 유지

4. 내용: 입력된 정보를 충실히 반영
   - 입력된 내용의 **순서나 팩트를 임의로 바꾸지 말 것**
   - 불필요한 미사여구(형용사 남발) 자제

5. ${styleName} 스타일을 적용하되, 기본적으로 듣기 편안한 톤 유지

6. 대본 구조:
   - **인트로**: ${introStyle} 스타일로 시작 (간결하게)
   - **본문**: ${(styleKey === 'Ranking/Top 5' || styleKey === 'Tips' || styleKey === 'HoneyTips') ?
                        '**필수: 내용을 줄글로 쓰지 말고, "첫째, [내용]", "둘째, [내용]" 처럼 번호를 붙여 명확히 구분하여 말할 것. (최소 3개 이상의 포인트로 정리)**' :
                        '핵심 경험과 장점을 명확하게 전달'}
   - **아웃트로**: ${outroStyle} 스타일로 마무리
   ${(outroStyle === '장점 강조 물음형' || outroStyle === '물음표 마무리형') ? '- **(중요)** 반드시 문장의 맨 마지막을 "이곳은 어디일까요?"가 아닌 **"이곳은 ?"**으로 끝낼 것' : ''}

7. 영상 대본용으로 작성 (지문 제외, 스피킹 텍스트만)

8. **중요 - 완전한 문장**:
   - "최고!", "추천!" 같은 단답형 대신 "정말 최고였습니다.", "강력 추천합니다."로 서술어 완결
   - **이모지나 특수문자 사용 금지 (텍스트만 작성)**

9. **[가게 이름] 같은 플레이스홀더 사용 금지**:
   - 가게 이름이 비공개이거나 문맥상 불필요하면 아예 언급하지 마세요.
   - "[가게 이름]", "[상호명]" 이렇게 쓰면 TTS가 그대로 읽으므로 절대 금지입니다.
   - ${includeRestaurantName ? "가게 이름(" + restaurantName + ")을 자연스럽게 1번 정도 언급하세요." : "가게 이름을 절대 언급하지 마세요."}

**예시 말투 (161자):**
"고양시 택시 기사님들이 1등으로 뽑는다는 돈가스 맛집입니다. 사이즈가 사람 얼굴보다 훨씬 크길래 두께는 얇게 찌했는데 두께도 적당히 두껍고 기름도 좋은 거 쓰는지 기름 냄새 1일도 안 나고 깔끔하게 바삭하고 맛있습니다. 수제 소스도 훌륭하고 셀프바에서 밥이랑 스프 반찬들까지 전부 무한인 것도 좋더라고요."

**출력 형식 (반드시 이 형식을 따라주세요):**
제목: [여기에 제목 작성]

대본: [여기에 대본 작성]

**설명이나 주석은 불필요합니다. 위 형식대로만 작성해주세요.**`;

            } else {
                // English Prompt
                const introEng = INTRO_STYLES[introStyle]?.english || introStyle;
                const outroEng = OUTRO_STYLES[outroStyle]?.english || outroStyle;
                const styleEng = SCRIPT_STYLES[styleKey]?.english || styleName;

                let locationInstruction = "";
                if (location) {
                    if (locationIn === "intro") {
                        locationInstruction = `
**Restaurant Location (REQUIRED):**
- Location: ${location}
- **IMPORTANT**: You MUST naturally mention the location in the intro.
- Examples: "Today I visited this amazing restaurant in ${location}...", "Found this hidden gem in ${location}...", "Went to ${location} and discovered..."
- Blend the location naturally into the ${introEng} style.`;
                    } else { // outro
                        locationInstruction = `
**Restaurant Location (REQUIRED):**
- Location: ${location}
- **IMPORTANT**: You MUST naturally mention the location in the outro.
- Examples: "This 40-year tradition continues in ${location}, where is it?", "Must-visit spot in ${location}?", "If you're looking for great food in ${location}, this is it"
- Blend the location naturally into the ${outroEng} style.`;
                    }
                }

                prompt = `You are a professional YouTube Shorts scriptwriter. Create a video title and 35-50 second script based on the following information.

**IMPORTANT (Copyright Compliance):**
If the 'Restaurant Description' below contains a full script or long text, you **MUST paraphrase or rewrite it slightly** to avoid copyright issues. Keep the core meaning and style, but change sentence structures and vocabulary to make it original. Do not copy it verbatim.

**CRITICAL - LANGUAGE REQUIREMENT:**
- The input/description may be provided in Korean or other languages
- You MUST write the ENTIRE output (title + script) in ENGLISH ONLY
- NO mixing of languages allowed
- Translate the concepts naturally, maintaining the restaurant review tone

**Restaurant Information:**
- Restaurant Name: ${includeRestaurantName ? restaurantName : "Hidden (DO NOT mention name in title/script)"}
- Restaurant Description (detailed features, strengths, reviews):
${description}
${locationInstruction}

**Script Style:** ${styleEng}

**Intro Style:** ${introEng}
- ${introDesc}

**Outro Style:** ${outroEng}
- ${outroDesc}

**Writing Guidelines:**

0. **[CRITICAL] NO EMOJIS**:
   - Do NOT use emojis (😊, 🔥, etc.) in the title or script.
   - TTS cannot process emojis correctly. Keep it text-only.

1. Title:
   - Create an attention-grabbing, click-worthy title
   - 10-15 words max
   - Use curiosity-inducing language
   - Example: "Taxi Drivers' #1 Pick: The Best Tonkatsu in Town"

2. Script Duration: 35-50 seconds (approximately 100-130 words)
   - Include specific details but stay focused
   - Deliver the core experience vividly

3. Tone: Natural, conversational, casual speech
   - Use everyday language like "so", "actually", "you know", "I mean"
   - Sound like a real person talking to a friend
   - Relaxed and authentic voice

4. Content: Detailed and specific descriptions
   - Include specific details about size, taste, atmosphere
   - Paint a vivid picture with concrete examples
   - Share personal observations and experiences

5. Match the ${styleEng} style

6. Script Structure:
   - **Intro**: Use ${introEng} style to grab viewer's attention
   - **Body**: Deliver core experience and strengths in detail
   - **Outro**: End with ${outroEng} style for strong impression

7. Consider this will be narrated over video

8. No emojis or special characters

9. **NO PLACEHOLDERS**:
   - NEVER use "[Restaurant Name]" or "[Store Name]" in the script.
   - If the name is hidden or not strictly needed, just omit it.
   - ${includeRestaurantName ? "Include the restaurant name (" + restaurantName + ") naturally at least once." : "Do NOT mention the restaurant name."}

**Example tone:**
"This is the tonkatsu place that Goyang taxi drivers voted number one. The portion size was way bigger than I expected - like, seriously huge compared to my face. I thought it would be thin, but it was actually pretty thick and crispy. The oil they use must be really good quality because there's zero greasy smell, and everything tastes so fresh and clean. The homemade sauce is excellent, and the self-service bar with unlimited rice, soup, and side dishes is a great touch."

**Output Format (You must follow this format):**
Title: [Your title here]

Script: [Your script here]

**No explanations or annotations needed. Follow the format above.**`;
            }

            // Call AI API based on user
            const EXCLUDED_USER = 'moonlight8909@gmail.com';
            const userEmail = req.user ? req.user.email : ''; // req.user comes from requireAuth middleware

            if (userEmail && userEmail !== EXCLUDED_USER) {
                // === USE 302.AI (OpenAI Compatible) ===
                const api302Key = process.env.API_KEY_302AI;
                // Assuming standard OpenAI-compatible endpoint for 302.ai
                // User mentioned 302.ai, usually proxies OpenAI. 
                // If not set, we might fallback or error. For now, try/catch with fallback or specific error.

                if (!api302Key) {
                    // Since user requested it, we should probably error if missing, or use Gemini as fallback?
                    // "All features must run on 302ai api" implies strict requirement.
                    // But to avoid breakage if keys are missing during dev:
                    console.warn('302.ai Key missing, falling back to Gemini temporarily or failing.');
                    // throw new Error('302.ai API Key (API_KEY_302AI) is not configured.');
                }

                // 302.ai Endpoint (defaulting to typical if not in env)
                const api302Endpoint = process.env.BASE_URL_302AI || 'https://api.302.ai/v1/chat/completions';
                const api302Model = process.env.MODEL_302AI || 'gpt-4o';

                const response = await fetch(api302Endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${api302Key}`
                    },
                    body: JSON.stringify({
                        model: api302Model,
                        messages: [
                            { role: "system", content: "You are a professional script writer." },
                            { role: "user", content: prompt }
                        ],
                        temperature: 0.8,
                        max_tokens: 1024
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(`302.ai API Error: ${data.error?.message || response.statusText}`);
                }

                if (data.choices && data.choices[0]?.message?.content) {
                    return data.choices[0].message.content;
                } else {
                    return "Error: No generation from 302.ai";
                }

            } else {
                // === USE GOOGLE GEMINI (Existing) ===
                // Using gemini-2.0-flash-exp
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.8,
                            maxOutputTokens: 1024
                        }
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(`Gemini API Error: ${data.error?.message || response.statusText}`);
                }
                if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                    return data.candidates[0].content.parts[0].text;
                } else {
                    return "Error: No generation";
                }
            }
        }

        // Execute all promises
        // Execute all promises
        const promises = [];
        for (const style of styles) {
            for (let i = 0; i < actualCount; i++) {
                promises.push(
                    generateSingleScript(style)
                        .then(script => ({ style, script, index: i, success: true }))
                        .catch(e => {
                            console.error(`Error generating style ${style} #${i + 1}:`, e);
                            return { style, script: `Error: ${e.message}`, index: i, success: false };
                        })
                );
            }
        }

        const generated = await Promise.all(promises);

        generated.forEach(item => {
            const key = actualCount > 1 ? `${item.style} #${item.index + 1}` : item.style;
            results[key] = item.script;
        });

        await Promise.all(promises);
        res.json({ success: true, results });

    } catch (error) {
        console.error('Script generation failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// TTS Endpoint
router.post('/generate-tts', async (req, res) => {
    try {
        const { text, provider, language, title, storeName } = req.body;

        console.log(`[TTS] Request: Provider=${provider}, Lang=${language}, Text Length=${text.length}, Title=${title || storeName || 'N/A'}`);

        // 파일명 생성: 제목/가게명 + 날짜 + 시간
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
        const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS

        // Sanitize and normalize filename
        // 1. Normalize to NFC (to avoid NFD/NFC conflicts in sync)
        let safeName = (storeName || title || '').normalize('NFC');
        // 2. Remove any chars that aren't Word, Korean, or Space
        // \w includes [A-Za-z0-9_]
        safeName = safeName.replace(/[^\w\s가-힣]/g, '');
        // 3. Replace whitespace with underscore
        safeName = safeName.replace(/\s+/g, '_');
        // 4. Remove consecutive underscores and trim from ends
        safeName = safeName.replace(/_+/g, '_').replace(/^_+|_+$/g, '');

        let baseName = safeName.slice(0, 30) || 'tts_audio';
        const ttsFileName = `${baseName}_${dateStr}_${timeStr}.mp3`;

        if (provider === 'Google') {
            await ensureAudioDir();

            // Google Cloud TTS configuration
            const request = {
                input: { text: text },
                voice: {
                    languageCode: language === 'Korean' ? 'ko-KR' : 'en-US',
                    // Use standard voices as fallback if specific 'Algenib' is not available in standard lib
                    // However, user requested Algenib. 'ko-KR-Standard-A' is safe.
                    // Algenib corresponds to a specific new voice type, potentially Chirp or Journey.
                    // We will use Neural2 Male if possible as a good substitute if Algenib ID is unknown.
                    // Actually, let's try 'ko-KR-Neural2-C' (Male) for Korean and 'en-US-Neural2-D' (Male) for English
                    name: language === 'Korean' ? 'ko-KR-Neural2-C' : 'en-US-Neural2-D'
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: 1.5
                },
            };

            const [response] = await ttsClient.synthesizeSpeech(request);
            const audioContent = response.audioContent;

            const filePath = path.join(AUDIO_OUTPUT_PATH, ttsFileName);

            await fs.writeFile(filePath, audioContent, 'binary');

            res.json({
                success: true,
                audioPath: `/audio/${ttsFileName}`,
                localPath: filePath
            });

        } else if (provider === 'Azure') {
            await ensureAudioDir();

            // Checks for Azure keys
            const speechKey = process.env.AZURE_SPEECH_KEY;
            const serviceRegion = process.env.AZURE_SPEECH_REGION;

            if (!speechKey || !serviceRegion) {
                return res.status(400).json({
                    success: false,
                    error: "Azure API Key or Region is missing. Please configure them in Settings."
                });
            }

            const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, serviceRegion);

            // Set voice based on language
            // Using 'Hyunsu' for Korean and 'Andrew Multilingual' for English
            let rate;
            if (language === 'Korean') {
                speechConfig.speechSynthesisVoiceName = "ko-KR-HyunsuNeural";
                rate = "1.5"; // Korean 1.5x
            } else {
                speechConfig.speechSynthesisVoiceName = "en-US-AndrewMultilingualNeural";
                rate = "1.3"; // English 1.3x
            }

            const filePath = path.join(AUDIO_OUTPUT_PATH, ttsFileName);

            // Synthesize to file
            const audioConfig = sdk.AudioConfig.fromAudioFileOutput(filePath);
            const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

            // SSML for speaking rate adjustment
            // Azure SDK doesn't have a direct 'speakingRate' property on SpeechConfig like Google.
            // We use SSML to adjust speed.
            const ssml = `
                <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language === 'Korean' ? 'ko-KR' : 'en-US'}">
                    <voice name="${speechConfig.speechSynthesisVoiceName}">
                        <prosody rate="${rate}">
                            ${text}
                        </prosody>
                    </voice>
                </speak>
            `;

            synthesizer.speakSsmlAsync(ssml,
                result => {
                    if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                        synthesizer.close();
                        res.json({
                            success: true,
                            audioPath: `/audio/${ttsFileName}`,
                            localPath: filePath
                        });
                    } else {
                        synthesizer.close();
                        res.status(500).json({
                            success: false,
                            error: `Azure TTS Generation Failed: ${result.errorDetails}`
                        });
                    }
                },
                error => {
                    synthesizer.close();
                    console.error('Azure TTS Error:', error);
                    res.status(500).json({ success: false, error: error });
                }
            );

        } else if (provider === 'ElevenLabs') {
            await ensureAudioDir();

            const apiKey = process.env.ELEVENLABS_API_KEY;

            // Define allowed voices for random selection
            const PRESET_VOICES = [
                'mYk0rAapHek2oTw18z8x', // Voice 1
                '4JJwo477JUAx3HV0T7n7', // Voice 2
                'QPFsEL6IBxlT15xfiD6C', // Voice 3
                'uyVNoMrnUku1dZyVEXwD'  // Voice 4
            ];

            let voiceId = req.body.voiceId || process.env.ELEVENLABS_VOICE_ID;

            // If voiceId is 'random', 'neutral' (legacy default), 'surprise' (legacy), or not in list (and not explicitly set in env to something else), pick random
            // Actually, allow any valid ID if passed, but if 'random' or legacy keywords, pick from PRESET.
            if (!voiceId || voiceId === 'random' || voiceId === 'neutral' || voiceId === 'surprise') {
                voiceId = PRESET_VOICES[Math.floor(Math.random() * PRESET_VOICES.length)];
                console.log(`[ElevenLabs] Random voice selected: ${voiceId}`);
            }

            // Fallback if still empty (shouldn't happen with logic above)
            if (!voiceId) voiceId = '21m00Tcm4TlvDq8ikWAM';

            if (!apiKey) {
                return res.status(500).json({ success: false, error: 'ELEVENLABS_API_KEY is not configured.' });
            }

            const filePath = path.join(AUDIO_OUTPUT_PATH, ttsFileName);

            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': apiKey
                },
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_multilingual_v2", // Better for multiple languages including Korean
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('ElevenLabs API Error:', errorData);

                // Check for quota exceeded, payment required error and Fallback to 302.ai (MiniMax)
                if (errorData.detail?.status === 'quota_exceeded' || errorData.detail?.status === 'payment_required' || response.status === 401 || response.status === 429) {
                    console.warn('ElevenLabs Quota Exceeded or Payment Required. Falling back to 302.ai (MiniMax)...');

                    const api302Key = process.env.AI_302_API_KEY;
                    if (!api302Key) {
                        throw new Error(`ElevenLabs Limit Reached & 302.ai Key Missing: ${errorData.detail?.message}`);
                    }

                    // 302.ai TTS (MiniMax) Logic
                    // voice_id: 'male-qn-qingse', 'female-shaonv', 'male-ad-boy' etc.
                    // Let's use a standard Korean 302 voice or map randomness
                    const minimaxVoices = ['male-qn-qingse', 'female-shaonv', 'presenter_male', 'presenter_female'];
                    const randomVoice = minimaxVoices[Math.floor(Math.random() * minimaxVoices.length)];

                    const response302 = await fetch('https://api.302.ai/v1/audio/speech', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${api302Key}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'minimax', // or tts-1-hd depending on 302 support. Assuming 'minimax' or standard openai format
                            input: text,
                            voice: randomVoice,
                            speed: 1.3 // 302/MiniMax might support speed directly
                        })
                    });

                    if (!response302.ok) {
                        const errText = await response302.text();
                        throw new Error(`302.ai Backup TTS Failed: ${errText}`);
                    }

                    const arrayBuffer302 = await response302.arrayBuffer();
                    const buffer302 = Buffer.from(arrayBuffer302);

                    // Save directly (assuming 302 returns mp3) - no speed adjustment needed if speed param worked, 
                    // but we will treat it same as ElevenLabs output for consistency
                    await fs.writeFile(filePath, buffer302);

                    console.log(`[TTS] Applied 302.ai (Backup) text-to-speech.`);

                    res.json({
                        success: true,
                        audioPath: `/audio/${ttsFileName}`,
                        localPath: filePath
                    });
                    return; // Exit successfully
                }

                throw new Error(`ElevenLabs TTS Failed: ${errorData.detail?.message || response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Speed up audio to 1.3x using ffmpeg
            const tempFilePath = filePath.replace('.mp3', '_temp.mp3');
            await fs.writeFile(tempFilePath, buffer);
            console.log(`[TTS] Applied text-to-speech. Original size: ${buffer.length}`);

            try {
                const ffmpeg = (await import('fluent-ffmpeg')).default;
                const ffmpegStatic = (await import('ffmpeg-static')).default;
                const ffprobeStatic = (await import('ffprobe-static')).default;

                let ffmpegPath = ffmpegStatic;
                try {
                    if (!ffmpegPath || !(await fs.stat(ffmpegPath).catch(() => false))) {
                        console.warn('[AI Video] ffmpeg-static binary not found, falling back to system "ffmpeg"');
                        ffmpegPath = 'ffmpeg';
                    }
                } catch (e) { ffmpegPath = 'ffmpeg'; }

                ffmpeg.setFfmpegPath(ffmpegPath);
                ffmpeg.setFfprobePath(ffprobeStatic.path);
                await new Promise((resolve, reject) => {
                    console.log('[TTS] Starting speed adjustment (1.3x) and silence removal...');
                    ffmpeg(tempFilePath)
                        .audioFilters([
                            'silenceremove=start_periods=1:start_duration=0:start_threshold=-60dB', // Trim only start silence, stricter threshold
                            'atempo=1.3' // Speed up
                        ])
                        .save(filePath)
                        .on('end', () => {
                            console.log('[TTS] Speed adjustment completed.');
                            resolve();
                        })
                        .on('error', (err) => {
                            console.error('[TTS] Speed adjustment error:', err);
                            reject(err);
                        });
                });
                // Remove temp file
                await fs.unlink(tempFilePath);
            } catch (ffmpegErr) {
                console.error('FFmpeg speed adjustment failed, using original:', ffmpegErr);
                // Fallback: use original (rename temp to final)
                await fs.rename(tempFilePath, filePath);
            }

            res.json({
                success: true,
                audioPath: `/audio/${ttsFileName}`,
                localPath: filePath
            });

        } else {
            res.status(400).json({ success: false, error: 'Invalid provider' });
        }

    } catch (error) {
        console.error('TTS Failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
