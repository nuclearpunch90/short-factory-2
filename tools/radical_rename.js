import fs from 'fs';
import path from 'path';

const TARGET_DIRS = [
    path.join(process.cwd(), 'data/common/audio'),
    path.join(process.cwd(), 'Output/ai-videos')
];

async function replaceAllKoreanFilenames() {
    console.log('Starting radical rename of ALL Korean-named files...');
    const logPath = path.join(process.cwd(), 'filename_changes.log');
    let logContent = `[${new Date().toISOString()}] Renaming Korean files to safe names\n`;

    for (const dir of TARGET_DIRS) {
        if (!fs.existsSync(dir)) {
            console.log(`Skipping missing dir: ${dir}`);
            continue;
        }

        console.log(`Scanning: ${dir}`);
        const files = fs.readdirSync(dir);
        let count = 0;

        for (const file of files) {
            // Check if file has Korean characters
            if (/[가-힣]/.test(file)) {
                const ext = path.extname(file);
                // Create a completely new safe name: audio_TIMESTAMP_INDEX.ext
                // We use high-res timestamp + random to ensure uniqueness and order
                const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
                const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
                const newName = `audio_${timestamp}_${random}${ext}`;

                const oldPath = path.join(dir, file);
                const newPath = path.join(dir, newName);

                try {
                    fs.renameSync(oldPath, newPath);
                    const msg = `[RENAMED] "${file}" -> "${newName}"`;
                    console.log(msg);
                    logContent += `${msg}\n`;
                    count++;
                } catch (err) {
                    const errMsg = `[ERROR] Failed to rename "${file}": ${err.message}`;
                    console.error(errMsg);
                    logContent += `${errMsg}\n`;
                }
            }
        }
        console.log(`Renamed ${count} files in ${dir}.`);
    }

    fs.writeFileSync(logPath, logContent, { flag: 'a' });
    console.log(`Log saved to ${logPath}`);
}

replaceAllKoreanFilenames();
