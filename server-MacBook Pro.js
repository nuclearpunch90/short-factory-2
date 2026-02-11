import dotenv from 'dotenv';
console.log('Loading dotenv...');
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import fsSync from 'fs';
import multer from 'multer';

console.log('Importing routes...');
import minimaxRoutes from './routes/minimax.js';
import whisperRoutes from './routes/whisper.js';
import videoRoutes from './routes/video.js';
import shortsRoutes from './routes/shorts.js';
import voiceListRoutes from './routes/voice-list.js';
import aiShortsRoutes from './routes/ai-shorts.js';
import seedreamRoutes from './routes/seedream.js';
import settingsRoutes from './routes/settings.js';
import authRoutes from './routes/auth.js';
import scriptRoutes from './routes/script.js';
import rankingVideoRoutes from './routes/ranking-video.js';
import thumbnailRoutes from './routes/thumbnail.js';
import aiVideoRoutes from './routes/ai-video.js';
import resourcesRouter from './routes/resources.js';
console.log('Routes imported.');

import { requireAuth } from './middleware/auth.js';
console.log('Auth middleware imported.');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4567;
app.set('port', PORT);

// JSON 응답 UTF-8 설정
app.set('json spaces', 2);
app.set('json escape', false);

// Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  // Only set JSON content type for API routes
  if (req.path.startsWith('/api/')) {
    res.header('Content-Type', 'application/json; charset=utf-8');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
app.use(express.json({ strict: false }));
app.use(express.urlencoded({ extended: true }));

// Middleware to serve .html files for extension-less routes
app.use((req, res, next) => {
  if (req.path.indexOf('.') === -1 && req.path !== '/') {
    const htmlPath = path.join(__dirname, 'public', req.path + '.html');
    if (fsSync.existsSync(htmlPath)) {
      return res.sendFile(htmlPath);
    }
  }
  next();
});

app.use(express.static('public'));
app.use('/outputs', express.static('data/remix-shorts/outputs'));
app.use('/uploads', express.static('uploads'));
app.use('/Output', express.static('Output'));  // AI-generated videos
app.use('/template', express.static('data/remix-shorts/templates'));
app.use('/outro', express.static('data/common/outro'));
app.use('/ads', express.static('data/common/ads'));
// Serve TTS audio files
app.use('/audio', express.static('data/common/audio'));
app.use('/background-music', express.static('background music'));
app.use('/data', express.static('data'));

// Create necessary directories
const createDirectories = async () => {
  const dirs = ['public', 'uploads', 'data/remix-shorts/outputs', 'data/remix-shorts/videos', 'data/remix-shorts/templates', 'data/ai-shorts/outputs', 'data/ai-longform/outputs', 'data/common/audio', 'data/common/fonts', 'data/common/outro', 'data/common/ads'];
  console.log('Starting to check/create directories...');
  for (const dir of dirs) {
    try {
      console.log(`Checking directory: ${dir}`);
      await fs.mkdir(path.join(__dirname, dir), { recursive: true });
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  }
  console.log('All directories checked.');
};

// Routes
app.use('/api/minimax', minimaxRoutes);
app.use('/api/whisper', whisperRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/shorts', shortsRoutes);
app.use('/api/voice-list', voiceListRoutes);
app.use('/api/ai-shorts', aiShortsRoutes);
app.use('/api/seedream', seedreamRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/script', scriptRoutes);
app.use('/api/ranking-video', rankingVideoRoutes);
app.use('/api/thumbnail', thumbnailRoutes);
app.use('/api/ai-video', aiVideoRoutes);
app.use('/api', resourcesRouter);

// ... existing auth routes ...

// Start server
const startServer = async () => {
  console.log('Initializing server...');
  try {
    await createDirectories();
    console.log('Starting HTTP server...');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Network access: http://192.168.0.8:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  process.exit(0);
});