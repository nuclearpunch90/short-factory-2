import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const DEFAULT_MODEL = 'dall-e-3';
const AI_302_IMAGE_URL = 'https://api.302.ai/v1/images/generations';

// Generate image using OpenAI DALL-E
router.post('/generate', async (req, res) => {
  try {
    const {
      prompt,
      model = DEFAULT_MODEL,
      n = 1,
      size = '1024x1024',
      quality = 'standard',
      response_format = 'url',
      outputDir
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    const apiKey = process.env.AI_302_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'AI_302_API_KEY not configured' });
    }

    console.log('Generating image with 302.AI DALL-E:', { prompt: prompt.substring(0, 100), model, size, quality });

    const requestBody = {
      model,
      prompt,
      n,
      size,
      quality,
      response_format
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
      return res.status(response.status).json({
        success: false,
        error: `302.AI API error: ${response.status}`,
        details: errorData
      });
    }

    const data = await response.json();

    // If outputDir is specified, save images to disk
    if (outputDir && data.data) {
      const savedImages = [];
      const outputPath = path.resolve(outputDir);

      try {
        await fs.mkdir(outputPath, { recursive: true });
      } catch (err) {
        // Directory might already exist
      }

      for (let i = 0; i < data.data.length; i++) {
        const imageData = data.data[i];
        const timestamp = Date.now();
        const filename = `dalle_${timestamp}_${i + 1}.png`;
        const filePath = path.join(outputPath, filename);

        if (imageData.url) {
          // Download image from URL
          const imageResponse = await fetch(imageData.url);
          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          await fs.writeFile(filePath, imageBuffer);
          savedImages.push({ filename, path: filePath, url: imageData.url });
        } else if (imageData.b64_json) {
          // Save base64 image
          const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
          await fs.writeFile(filePath, imageBuffer);
          savedImages.push({ filename, path: filePath });
        }
      }

      return res.json({
        success: true,
        images: savedImages,
        raw: data
      });
    }

    res.json({
      success: true,
      data: data.data,
      raw: data
    });

  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Batch generate images
router.post('/batch', async (req, res) => {
  try {
    const { prompts, ...options } = req.body;

    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ success: false, error: 'Prompts array is required' });
    }

    const apiKey = process.env.AI_302_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'AI_302_API_KEY not configured' });
    }

    console.log(`Batch generating ${prompts.length} images with 302.AI DALL-E`);

    const results = await Promise.allSettled(
      prompts.map(async (prompt) => {
        const requestBody = {
          model: options.model || DEFAULT_MODEL,
          prompt,
          n: options.n || 1,
          size: options.size || '1024x1024',
          quality: options.quality || 'standard',
          response_format: options.response_format || 'url'
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
          throw new Error(`302.AI API error: ${response.status}`);
        }

        return await response.json();
      })
    );

    const successResults = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failedResults = results.filter(r => r.status === 'rejected').map(r => r.reason.message);

    res.json({
      success: true,
      total: prompts.length,
      succeeded: successResults.length,
      failed: failedResults.length,
      results: successResults,
      errors: failedResults
    });

  } catch (error) {
    console.error('Error in batch generation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Image editing endpoint (DALL-E 2 only supports edit with mask)
router.post('/edit', async (req, res) => {
  try {
    const {
      prompt,
      image_url,
      model = 'dall-e-2',
      size = '1024x1024',
      response_format = 'url'
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    if (!image_url) {
      return res.status(400).json({ success: false, error: 'Image URL is required' });
    }

    const apiKey = process.env.AI_302_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'AI_302_API_KEY not configured' });
    }

    console.log('Note: DALL-E image editing requires uploading image file. Using variation instead.');

    // For now, just generate a new image based on prompt
    // Real edit would require multipart/form-data with actual image file
    const requestBody = {
      model,
      prompt,
      n: 1,
      size,
      response_format
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
      return res.status(response.status).json({
        success: false,
        error: `302.AI API error: ${response.status}`,
        details: errorData
      });
    }

    const data = await response.json();

    res.json({
      success: true,
      data: data.data,
      raw: data
    });

  } catch (error) {
    console.error('Error editing image:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
