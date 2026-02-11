import fs from 'fs';
import path from 'path';

const TARGET_DIRS = [
    path.join(process.cwd(), 'data/common/audio'),
    path.join(process.cwd(), 'Output/ai-videos')
];

async function run() {
    console.log('Starting advanced collision and normalization cleanup...');

    for (const dir of TARGET_DIRS) {
        if (!fs.existsSync(dir)) {
            console.log(`Skipping missing dir: ${dir}`);
            continue;
        }

        console.log(`Scanning: ${dir}`);
        const files = fs.readdirSync(dir);

        // Map to track lowercase filenames to detect collisions
        // Key: lowercase filename, Value: original filename
        const seenFiles = new Map();

        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) continue;

            const originalName = file;
            let newName = file.normalize('NFC'); // Force NFC normalization

            // Check for case-insensitive collision
            const lowerName = newName.toLowerCase();

            let isCollision = false;
            if (seenFiles.has(lowerName)) {
                isCollision = true;
                console.log(`[COLLISION DETECTED] '${originalName}' conflicts with seen '${seenFiles.get(lowerName)}'`);
            } else {
                seenFiles.set(lowerName, originalName);
            }

            // Decide if we need to rename
            // Rename if:
            // 1. Name is not NFC (original !== NFC)
            // 2. Collision detected
            // 3. Name contains special chars that might confuse OneDrive (unlikely if sanitized previously, but good to check)

            if (originalName !== newName || isCollision) {
                if (isCollision) {
                    // Append timestamp to resolve collision
                    const ext = path.extname(newName);
                    const base = path.basename(newName, ext);
                    newName = `${base}_${Math.floor(Math.random() * 1000)}${ext}`; // Add suffix
                }

                // Perform rename
                // We use a temp name intermediate step to ensure OS registers the change (especially for NFC/NFD or Case changes)
                const tempPath = path.join(dir, `temp_mv_${Date.now()}_${Math.random().toString(36).slice(2)}`);
                const finalPath = path.join(dir, newName);

                try {
                    fs.renameSync(fullPath, tempPath);
                    fs.renameSync(tempPath, finalPath);
                    console.log(`[FIXED] '${originalName}' -> '${newName}'`);

                    // Update map if we resolved a collision
                    if (isCollision) {
                        seenFiles.set(newName.toLowerCase(), newName);
                    }
                } catch (e) {
                    console.error(`[ERROR] Failed to rename '${originalName}':`, e.message);
                }
            }
        }
    }
    console.log('Cleanup completed.');
}

run();
