import fs from 'fs';
import path from 'path';

const TARGET_DIR = path.join(process.cwd(), 'data/common/audio');

async function forceRename() {
    console.log(`Scanning directory: ${TARGET_DIR}`);

    if (!fs.existsSync(TARGET_DIR)) {
        console.error('Target directory does not exist!');
        return;
    }

    const files = fs.readdirSync(TARGET_DIR);
    let count = 0;

    for (const file of files) {
        // Check if file has Korean characters
        if (/[가-힣]/.test(file)) {
            const ext = path.extname(file);
            const name = path.basename(file, ext);

            // Create a completely new name to force FS/OneDrive update
            // We append '_clean' to safeguard content
            // We also force NFC normalization just in case
            const newName = `${name.normalize('NFC')}_clean${ext}`;

            const oldPath = path.join(TARGET_DIR, file);
            const newPath = path.join(TARGET_DIR, newName);

            try {
                fs.renameSync(oldPath, newPath);
                console.log(`[RENAMED] ${file} -> ${newName}`);
                count++;
            } catch (err) {
                console.error(`[ERROR] Failed to rename ${file}:`, err.message);
            }
        }
    }

    console.log(`Completed. Renamed ${count} files.`);
}

forceRename();
