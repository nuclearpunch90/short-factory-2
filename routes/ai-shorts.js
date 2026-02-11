import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Set FFmpeg paths - 시스템 PATH 사용
// ffmpeg.setFfmpegPath('C:\\ffmpeg\\bin\\ffmpeg.exe');
// ffmpeg.setFfprobePath('C:\\ffmpeg\\bin\\ffprobe.exe');

// Style prefixes for different image styles
const STYLE_PREFIXES = {
  realistic: 'Photorealistic, high quality photograph, realistic lighting, ',
  anime: 'Anime style illustration, Japanese animation style, vibrant colors, ',
  cartoon: 'Cartoon style, colorful, fun, animated look, ',
  comic: 'American comic book style, bold lines, dynamic shading, Marvel/DC style, ',
  watercolor: 'Watercolor painting style, soft edges, artistic, ',
  oil: 'Oil painting style, rich textures, classical art, ',
  '3d': '3D rendered, CGI style, Pixar-like quality, '
};

const AI_302_IMAGE_URL = 'https://api.302.ai/v1/images/generations';

// Generate image with 302.AI DALL-E
async function generateImage(prompt, style = 'realistic') {
  const apiKey = process.env.AI_302_API_KEY;
  if (!apiKey) {
    throw new Error('AI_302_API_KEY not configured. 설정에서 입력해주세요.');
  }

  const stylePrefix = STYLE_PREFIXES[style] || STYLE_PREFIXES.realistic;
  const styledPrompt = stylePrefix + prompt;

  console.log(`[302.AI DALL-E] Style: ${style}, Generating: "${styledPrompt.substring(0, 80)}..."`);

  const requestBody = {
    model: 'dall-e-3',
    prompt: styledPrompt,
    n: 1,
    size: '1024x1792',  // Vertical format for shorts (portrait)
    quality: 'standard',
    response_format: 'url'
  };

  const response = await fetch(AI_302_IMAGE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('302.AI API error:', errorData);
    throw new Error(`302.AI API error: ${response.status} - ${errorData}`);
  }

  const data = await response.json();

  if (!data?.data?.[0]?.url) {
    throw new Error('302.AI 이미지 생성 결과를 찾을 수 없습니다.');
  }

  return data.data[0].url;
}

// Download image from URL
async function downloadImage(url, filepath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filepath, buffer);
  return filepath;
}

// 302.AI TTS API (OpenAI-compatible)
const AI_302_TTS_URL = 'https://api.302.ai/v1/audio/speech';

// Generate TTS with 302.AI
async function generateTTS(text, outputPath, voice = 'nova') {
  const apiKey = process.env.AI_302_API_KEY;

  if (!apiKey) {
    throw new Error('AI_302_API_KEY not configured. 설정에서 입력해주세요.');
  }

  const response = await fetch(AI_302_TTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: voice,
      response_format: 'mp3',
      speed: 1.0
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`302.AI TTS API error: ${response.status} - ${errorText}`);
  }

  // 302.AI TTS returns binary audio data
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);
  await fs.writeFile(outputPath, audioBuffer);

  return outputPath;
}

// Get audio duration using ffprobe
function getAudioDuration(filepath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filepath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });
}

// Create video from image with duration
function createVideoFromImage(imagePath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .loop(duration)
      .outputOptions([
        '-c:v libx264',
        '-t', duration.toString(),
        '-pix_fmt yuv420p',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
        '-r 30'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// Concatenate videos
function concatenateVideos(videoList, outputPath) {
  return new Promise((resolve, reject) => {
    const listFile = outputPath.replace('.mp4', '_list.txt');
    const listContent = videoList.map(v => `file '${v.replace(/\\/g, '/')}'`).join('\n');

    fs.writeFile(listFile, listContent).then(() => {
      ffmpeg()
        .input(listFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('end', async () => {
          await fs.unlink(listFile).catch(() => { });
          resolve(outputPath);
        })
        .on('error', reject)
        .run();
    });
  });
}

// Add audio to video
function addAudioToVideo(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v copy',
        '-c:a aac',
        '-b:a 128k',
        '-shortest'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// Concatenate audio files
function concatenateAudios(audioList, outputPath) {
  return new Promise((resolve, reject) => {
    const listFile = outputPath.replace('.mp3', '_list.txt');
    const listContent = audioList.map(a => `file '${a.replace(/\\/g, '/')}'`).join('\n');

    fs.writeFile(listFile, listContent).then(() => {
      ffmpeg()
        .input(listFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('end', async () => {
          await fs.unlink(listFile).catch(() => { });
          resolve(outputPath);
        })
        .on('error', reject)
        .run();
    });
  });
}

// Main API: Generate AI Shorts
router.post('/generate', async (req, res) => {
  try {
    const { scenes, title = 'AI Shorts', style = 'vivid', voice = 'nova', bgMusic = null, musicFolder = null, musicFile = null } = req.body;

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Scenes array is required. Each scene should have: { text, imagePrompt, duration? }'
      });
    }

    // Create project folder
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');
    const projectDir = path.join(__dirname, '..', 'outputs', `ai_shorts_${timestamp}`);
    const imagesDir = path.join(projectDir, 'images');
    const audioDir = path.join(projectDir, 'audio');
    const tempDir = path.join(projectDir, 'temp');

    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(audioDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });

    console.log(`[AI Shorts] Starting generation: ${scenes.length} scenes`);
    console.log(`[AI Shorts] Project folder: ${projectDir}`);

    const results = [];
    const videoSegments = [];
    const audioSegments = [];

    // Process each scene
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const sceneNum = i + 1;

      console.log(`\n[AI Shorts] Processing scene ${sceneNum}/${scenes.length}`);
      console.log(`[AI Shorts] Text: "${scene.text?.substring(0, 50)}..."`);
      console.log(`[AI Shorts] Image prompt: "${scene.imagePrompt?.substring(0, 50)}..."`);

      try {
        // 1. Generate TTS for this scene
        console.log(`[AI Shorts] Generating TTS...`);
        const audioPath = path.join(audioDir, `scene_${sceneNum}.mp3`);
        await generateTTS(scene.text, audioPath, voice);

        // Get audio duration
        const audioDuration = await getAudioDuration(audioPath);
        const duration = scene.duration || Math.ceil(audioDuration) + 0.5; // Add buffer
        console.log(`[AI Shorts] Audio duration: ${audioDuration.toFixed(2)}s, Scene duration: ${duration}s`);

        // 2. Generate image with DALL-E
        console.log(`[AI Shorts] Generating image with DALL-E...`);
        const imageUrl = await generateImage(scene.imagePrompt, style);

        // Download image
        const imagePath = path.join(imagesDir, `scene_${sceneNum}.png`);
        await downloadImage(imageUrl, imagePath);
        console.log(`[AI Shorts] Image saved: ${imagePath}`);

        // 3. Create video segment from image
        console.log(`[AI Shorts] Creating video segment...`);
        const videoSegmentPath = path.join(tempDir, `segment_${sceneNum}.mp4`);
        await createVideoFromImage(imagePath, videoSegmentPath, duration);

        videoSegments.push(videoSegmentPath);
        audioSegments.push(audioPath);

        results.push({
          scene: sceneNum,
          success: true,
          duration,
          imagePath: `/outputs/ai_shorts_${timestamp}/images/scene_${sceneNum}.png`,
          audioPath: `/outputs/ai_shorts_${timestamp}/audio/scene_${sceneNum}.mp3`
        });

        console.log(`[AI Shorts] Scene ${sceneNum} completed!`);

      } catch (sceneError) {
        console.error(`[AI Shorts] Error in scene ${sceneNum}:`, sceneError);
        results.push({
          scene: sceneNum,
          success: false,
          error: sceneError.message
        });
      }

      // Add delay between API calls to avoid rate limiting
      if (i < scenes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Check if we have any successful scenes
    const successfulScenes = results.filter(r => r.success);
    if (successfulScenes.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'All scenes failed to generate',
        results
      });
    }

    // 4. Concatenate all video segments
    console.log(`\n[AI Shorts] Concatenating ${videoSegments.length} video segments...`);
    const concatenatedVideo = path.join(tempDir, 'concatenated.mp4');
    await concatenateVideos(videoSegments, concatenatedVideo);

    // 5. Concatenate all audio segments
    console.log(`[AI Shorts] Concatenating ${audioSegments.length} audio segments...`);
    const concatenatedAudio = path.join(tempDir, 'concatenated.mp3');
    await concatenateAudios(audioSegments, concatenatedAudio);

    // 6. Merge video and audio
    console.log(`[AI Shorts] Merging video and audio...`);
    const finalVideo = path.join(projectDir, `${title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}.mp4`);
    await addAudioToVideo(concatenatedVideo, concatenatedAudio, finalVideo);

    // 7. Add background music if specified
    const bgMusicBaseDir = path.join(__dirname, '..', 'background music');
    let bgMusicPath = null;

    // New Logic: Folder + File
    if (musicFolder) {
      const folderPath = path.join(bgMusicBaseDir, musicFolder);

      try {
        if (musicFile === 'random') {
          // Select random file from folder
          const files = await fs.readdir(folderPath);
          const audioFiles = files.filter(f => /\.(mp3|wav|m4a)$/i.test(f));
          if (audioFiles.length > 0) {
            const randomFile = audioFiles[Math.floor(Math.random() * audioFiles.length)];
            bgMusicPath = path.join(folderPath, randomFile);
            console.log(`[AI Shorts] Selected random music: ${randomFile} from ${musicFolder}`);
          }
        } else if (musicFile) {
          // Specific file
          bgMusicPath = path.join(folderPath, musicFile);
        }
      } catch (err) {
        console.error(`[AI Shorts] Error selecting music from folder ${musicFolder}:`, err);
      }
    }
    // Legacy Logic (if bgMusic provided directly)
    else if (bgMusic) {
      bgMusicPath = path.join(__dirname, '..', 'audio', bgMusic);
    }

    let outputPath = finalVideo;
    if (bgMusicPath) {
      console.log(`[AI Shorts] Adding background music: ${path.basename(bgMusicPath)}`);
      const withMusicPath = path.join(projectDir, `${title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_with_music.mp4`);

      try {
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(finalVideo)
            .input(bgMusicPath)
            .complexFilter([
              '[1:a]volume=0.15[bg]',
              '[0:a][bg]amix=inputs=2:duration=first[out]'
            ])
            .outputOptions([
              '-map', '0:v',
              '-map', '[out]',
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-b:a', '128k',
              '-shortest'
            ])
            .output(withMusicPath)
            .on('end', () => resolve())
            .on('error', reject)
            .run();
        });
        outputPath = withMusicPath;
      } catch (musicError) {
        console.error('[AI Shorts] Error adding background music:', musicError);
      }
    }

    // Cleanup temp files
    console.log(`[AI Shorts] Cleaning up temp files...`);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });

    console.log(`\n[AI Shorts] ✓ Video generated: ${outputPath}`);

    res.json({
      success: true,
      message: 'AI Shorts generated successfully!',
      videoPath: outputPath.replace(path.join(__dirname, '..'), '').replace(/\\/g, '/'),
      projectFolder: `ai_shorts_${timestamp}`,
      results,
      summary: {
        totalScenes: scenes.length,
        successfulScenes: successfulScenes.length,
        failedScenes: scenes.length - successfulScenes.length
      }
    });

  } catch (error) {
    console.error('[AI Shorts] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get music folders
router.get('/music-folders', async (req, res) => {
  try {
    const musicDir = path.join(__dirname, '..', 'background music');

    // Ensure directory exists
    try {
      await fs.access(musicDir);
    } catch {
      await fs.mkdir(musicDir, { recursive: true });
    }

    const files = await fs.readdir(musicDir, { withFileTypes: true });
    const folders = files.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

    res.json({
      success: true,
      folders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get music files in folder
router.get('/music-files', async (req, res) => {
  try {
    const { folder } = req.query;
    if (!folder) {
      return res.status(400).json({ success: false, error: 'Folder required' });
    }

    const musicDir = path.join(__dirname, '..', 'background music', folder);
    const files = await fs.readdir(musicDir);
    const musicFiles = files.filter(f => /\.(mp3|wav|m4a)$/i.test(f));

    res.json({
      success: true,
      files: musicFiles
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Preview: Generate single image (for testing prompts)
router.post('/preview-image', async (req, res) => {
  try {
    const { prompt, style = 'vivid' } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    const imageUrl = await generateImage(prompt, style);

    res.json({
      success: true,
      imageUrl
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
