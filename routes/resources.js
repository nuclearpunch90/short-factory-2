import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to safely read directory
const getDirectories = (source) =>
    fs.readdirSync(source, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

// ==========================================
// INPUTS ROUTES (Video Sources)
// ==========================================

// Get list of input folders (merges 'inputs' and 'Output' directories)
router.get('/inputs/folders', async (req, res) => {
    try {
        const folders = [];

        // 1. Scan 'inputs' directory (Original source)
        const inputsDir = path.join(__dirname, '..', 'inputs');
        if (fs.existsSync(inputsDir)) {
            const inputSubfolders = getDirectories(inputsDir);
            folders.push(...inputSubfolders);
        }

        // 2. Scan 'Output' directory (Generated content source, e.g., ai-videos)
        const outputDir = path.join(__dirname, '..', 'Output');
        if (fs.existsSync(outputDir)) {
            const outputSubfolders = getDirectories(outputDir);
            // Add valid output folders (avoiding duplicates if any)
            outputSubfolders.forEach(folder => {
                if (!folders.includes(folder)) {
                    folders.push(folder);
                }
            });
        }

        // Ensure default 'ai-videos' exists in list if it physically exists in Output
        // (Already covered by scanning Output, but good for verification)

        res.json({ success: true, folders });
    } catch (error) {
        console.error('Error fetching input folders:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch folders' });
    }
});

// Get files in specific input folder
router.get('/inputs/files', async (req, res) => {
    try {
        const { folder } = req.query;
        if (!folder) return res.status(400).json({ success: false, error: 'Folder parameter required' });

        let targetPath;

        // Logic to determine path (inputs vs Output)
        // Check Output first for folders like 'ai-videos'
        const possibleOutputPath = path.join(__dirname, '..', 'Output', folder);
        const possibleInputPath = path.join(__dirname, '..', 'inputs', folder);

        if (fs.existsSync(possibleOutputPath)) {
            targetPath = possibleOutputPath;
        } else if (fs.existsSync(possibleInputPath)) {
            targetPath = possibleInputPath;
        } else {
            return res.status(404).json({ success: false, error: 'Folder not found' });
        }

        const files = fs.readdirSync(targetPath)
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.mp4', '.mov', '.avi', '.mkv'].includes(ext);
            });

        res.json({ success: true, files });
    } catch (error) {
        console.error('Error fetching input files:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch files' });
    }
});


// ==========================================
// MUSIC ROUTES
// ==========================================

// Get list of music folders
router.get('/music/folders', async (req, res) => {
    try {
        const folders = [];

        // 1. Scan 'background music' directory (New standard)
        const bgMusicDir = path.join(__dirname, '..', 'background music');
        if (fs.existsSync(bgMusicDir)) {
            const bgFolders = getDirectories(bgMusicDir);
            folders.push(...bgFolders);
        }

        // 2. Scan 'audio' directory (Legacy/Fallback)
        const audioDir = path.join(__dirname, '..', 'audio');
        if (fs.existsSync(audioDir)) {
            // 'audio' is often a flat folder of files, but check for subfolders too
            const audioFolders = getDirectories(audioDir);
            audioFolders.forEach(f => {
                if (!folders.includes(f)) folders.push(f);
            });
        }

        res.json({ success: true, folders });
    } catch (error) {
        console.error('Error fetching music folders:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch music folders' });
    }
});

// Get files in specific music folder
router.get('/music/files', async (req, res) => {
    try {
        const { folder } = req.query;
        // Handle root folder of 'background music' or 'audio' if folder is empty/undefined?
        // The frontend usually selects a folder.

        if (!folder) {
            return res.status(400).json({ success: false, error: 'Folder parameter required' });
        }

        let targetPath;

        // Priority: background music -> audio
        const bgPath = path.join(__dirname, '..', 'background music', folder);
        const audioPath = path.join(__dirname, '..', 'audio', folder);

        if (fs.existsSync(bgPath)) {
            targetPath = bgPath;
        } else if (fs.existsSync(audioPath)) {
            targetPath = audioPath;
        } else {
            return res.status(404).json({ success: false, error: 'Folder not found' });
        }

        const files = fs.readdirSync(targetPath)
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.mp3', '.wav', '.m4a', '.ogg'].includes(ext);
            });

        res.json({ success: true, files });

    } catch (error) {
        console.error('Error fetching music files:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch music files' });
    }
});

export default router;
