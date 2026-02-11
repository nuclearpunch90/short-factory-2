import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { requireAdmin } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const ENV_PATH = path.join(__dirname, '..', '.env');

// Parse .env file content
function parseEnv(content) {
    const env = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key) {
                env[key.trim()] = valueParts.join('=').trim();
            }
        }
    }
    return env;
}

// Convert env object to .env file content
function stringifyEnv(env) {
    let content = '';

    // Add comments and structure
    content += '# 302.AI API Configuration\n';
    content += '# Get your API key from https://dash.302.ai/apis/markets\n';
    content += '# This key provides access to all AI models (GPT, Claude, Gemini, DALL-E, Whisper, TTS, etc.)\n';
    content += `AI_302_API_KEY=${env.AI_302_API_KEY || ''}\n\n`;

    content += '# Server Configuration\n';
    content += `PORT=${env.PORT || '4567'}\n\n`;

    content += '# Azure Cognitive Services (TTS)\n';
    content += `AZURE_SPEECH_KEY=${env.AZURE_SPEECH_KEY || ''}\n`;
    content += `AZURE_SPEECH_REGION=${env.AZURE_SPEECH_REGION || ''}\n`;

    // Preserve any other keys that were present
    const preservedKeys = ['AI_302_API_KEY', 'PORT', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'];
    for (const [key, value] of Object.entries(env)) {
        if (!preservedKeys.includes(key)) {
            content += `${key}=${value}\n`;
        }
    }

    return content;
}

// Get current API key status (not the actual keys for security)
router.get('/status', requireAdmin, async (req, res) => {
    try {
        const has302AI = !!process.env.AI_302_API_KEY;
        const hasAzure = !!process.env.AZURE_SPEECH_KEY && !!process.env.AZURE_SPEECH_REGION;

        res.json({
            success: true,
            configured: {
                AI_302_API_KEY: has302AI,
                AZURE_TTS: hasAzure
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get masked API keys for display
router.get('/keys', requireAdmin, async (req, res) => {
    try {
        const maskKey = (key) => {
            if (!key) return '';
            if (key.length <= 8) return '****';
            return key.substring(0, 4) + '****' + key.substring(key.length - 4);
        };

        res.json({
            success: true,
            keys: {
                AI_302_API_KEY: maskKey(process.env.AI_302_API_KEY),
                AZURE_SPEECH_KEY: maskKey(process.env.AZURE_SPEECH_KEY),
                AZURE_SPEECH_REGION: process.env.AZURE_SPEECH_REGION || ''
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save API keys
router.post('/keys', requireAdmin, async (req, res) => {
    try {
        const { AI_302_API_KEY, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION } = req.body;

        // Read existing .env or create new
        let env = {};
        try {
            const content = await fs.readFile(ENV_PATH, 'utf8');
            env = parseEnv(content);
        } catch (e) {
            // File doesn't exist, start fresh
        }

        // Update only provided keys
        if (AI_302_API_KEY !== undefined) env.AI_302_API_KEY = AI_302_API_KEY;
        if (AZURE_SPEECH_KEY !== undefined) env.AZURE_SPEECH_KEY = AZURE_SPEECH_KEY;
        if (AZURE_SPEECH_REGION !== undefined) env.AZURE_SPEECH_REGION = AZURE_SPEECH_REGION;

        // Preserve PORT
        env.PORT = env.PORT || process.env.PORT || '4567';

        // Write back to .env
        await fs.writeFile(ENV_PATH, stringifyEnv(env), 'utf8');

        // Reload all keys from .env file into process.env
        // This allows immediate use without server restart
        const savedContent = await fs.readFile(ENV_PATH, 'utf8');
        const savedEnv = parseEnv(savedContent);

        // Update process.env with all keys from .env file
        if (savedEnv.AI_302_API_KEY) process.env.AI_302_API_KEY = savedEnv.AI_302_API_KEY;
        if (savedEnv.AZURE_SPEECH_KEY) process.env.AZURE_SPEECH_KEY = savedEnv.AZURE_SPEECH_KEY;
        if (savedEnv.AZURE_SPEECH_REGION) process.env.AZURE_SPEECH_REGION = savedEnv.AZURE_SPEECH_REGION;

        console.log('✅ API key updated in process.env');

        res.json({
            success: true,
            message: 'API 키가 저장되었습니다.'
        });
    } catch (error) {
        console.error('Error saving API keys:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test 302.AI API connection
router.post('/test-302ai', requireAdmin, async (req, res) => {
    try {
        const apiKey = req.body.apiKey || process.env.AI_302_API_KEY;

        if (!apiKey) {
            return res.status(400).json({ success: false, error: '302.AI API 키가 필요합니다.' });
        }

        // Test 302.AI API with a simple chat completion request
        const response = await fetch('https://api.302.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gemini-2.0-flash',
                messages: [{ role: 'user', content: 'Hello' }]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`302.AI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        res.json({
            success: true,
            message: '302.AI 연결 성공! 모든 AI 모델(GPT, Claude, Gemini, DALL-E, Whisper 등)을 사용할 수 있습니다.',
            response: data.choices[0].message.content
        });
    } catch (error) {
        console.error('302.AI test failed:', error);
        res.json({ success: false, error: error.message });
    }
});

// Open output folder
router.post('/open-folder', requireAdmin, async (req, res) => {
    try {
        const folderPath = path.join(__dirname, '..', 'outputs');

        // Ensure folder exists
        try {
            await fs.access(folderPath);
        } catch {
            await fs.mkdir(folderPath, { recursive: true });
        }

        let command;
        if (process.platform === 'win32') {
            command = `start "" "${folderPath}"`;
        } else if (process.platform === 'darwin') {
            command = `open "${folderPath}"`;
        } else {
            command = `xdg-open "${folderPath}"`;
        }

        exec(command, (error) => {
            if (error) {
                console.error('Failed to open folder:', error);
                return res.status(500).json({ success: false, error: '폴더를 열 수 없습니다.' });
            }
            res.json({ success: true, message: '폴더가 열렸습니다.' });
        });
    } catch (error) {
        console.error('Error opening folder:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Debug endpoint to check current process.env API keys
router.get('/debug/env', requireAdmin, async (_req, res) => {
    res.json({
        AI_302_API_KEY: process.env.AI_302_API_KEY ? `SET (${process.env.AI_302_API_KEY.substring(0, 10)}...)` : 'NOT SET'
    });
});

export default router;
