import fs from 'fs';
import path from 'path';

const TARGET_DIRS = [
    path.join(process.cwd(), 'data/common/audio'),
    path.join(process.cwd(), 'Output/ai-videos')
];

function sanitizeFilename(filename) {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);

    // 1. Normalize NFC
    let newName = name.normalize('NFC');

    // 2. Remove special chars (keep Korean, English, digits, underscore, hyphen)
    newName = newName.replace(/[^\w\s가-힣-]/g, '');

    // 3. Replace spaces with underscore
    newName = newName.replace(/\s+/g, '_');

    // 4. Merge multiple underscores
    newName = newName.replace(/_+/g, '_');

    // 5. Trim underscores
    newName = newName.replace(/^_+|_+$/g, '');

    return newName + ext;
}

async function cleanup() {
    console.log('Starting filename cleanup...');

    for (const dir of TARGET_DIRS) {
        if (!fs.existsSync(dir)) {
            console.log(`Directory not found: ${dir}`);
            continue;
        }

        console.log(`Scanning directory: ${dir}`);
        const files = fs.readdirSync(dir);
        let renameCount = 0;

        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) continue;

            const sanitized = sanitizeFilename(file);

            // Rename if different
            if (file !== sanitized) {
                const newPath = path.join(dir, sanitized);

                // Check if target exists
                if (fs.existsSync(newPath)) {
                    console.log(`[SKIP] Target already exists: ${file} -> ${sanitized}`);
                    continue;
                }

                try {
                    fs.renameSync(fullPath, newPath);
                    console.log(`[RENAMED] ${file} -> ${sanitized}`);
                    renameCount++;
                } catch (err) {
                    console.error(`[ERROR] Failed to rename ${file}:`, err.message);
                }
            }
        }
        console.log(`Finished ${dir}. Renamed ${renameCount} files.`);
    }
}

cleanup();
