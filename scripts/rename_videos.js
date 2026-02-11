import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetDir = path.join(__dirname, '../Output/ai-videos');

// Camera work keywords to identify the split point between "Source Prefix" and "Camera Work"
// Added 'diagonal_zoom_out' to handle compound suffix correctly
const cameraWorks = ['zoom_out', 'rotate', 'zoom_in', 'pan_down', 'diagonal', 'zoom', 'diagonal_zoom_out'];

function getSourcePrefix(filename) {
    // Sort camera works by length descending to match "diagonal_zoom_out" before "diagonal" or "zoom_out"
    const sortedWorks = [...cameraWorks].sort((a, b) => b.length - a.length);

    for (const work of sortedWorks) {
        // Look for `_work` or `_work_`
        const idx = filename.lastIndexOf(`_${work}`);
        if (idx !== -1) {
            return filename.substring(0, idx);
        }
    }
    return null;
}

try {
    if (!fs.existsSync(targetDir)) {
        console.error(`Directory not found: ${targetDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4'));
    const groups = {};

    files.forEach(file => {
        let cleanName = file;

        // Strip existing N-M_ prefix if present
        if (/^\d+-\d+_/.test(file)) {
            cleanName = file.replace(/^\d+-\d+_/, '');
        }

        const prefix = getSourcePrefix(cleanName);
        if (prefix) {
            if (!groups[prefix]) groups[prefix] = [];
            groups[prefix].push({
                originalFile: file,
                cleanName: cleanName
            });
        } else {
            console.warn(`Could not determine source prefix for: ${file} (Clean: ${cleanName})`);
        }
    });

    const sortedPrefixes = Object.keys(groups).sort();

    console.log(`Found ${sortedPrefixes.length} unique source groups.`);

    let renameCount = 0;

    sortedPrefixes.forEach((prefix, i) => {
        const imageIndex = i + 1;

        // Sort files within the group by their clean name to ensure consistent ordering
        const groupItems = groups[prefix].sort((a, b) => a.cleanName.localeCompare(b.cleanName));

        groupItems.forEach((item, j) => {
            const variationIndex = j + 1;
            const oldPath = path.join(targetDir, item.originalFile);
            const newFilename = `${imageIndex}-${variationIndex}_${item.cleanName}`;
            const newPath = path.join(targetDir, newFilename);

            if (item.originalFile !== newFilename) {
                console.log(`Renaming: ${item.originalFile} -> ${newFilename}`);
                try {
                    fs.renameSync(oldPath, newPath);
                    renameCount++;
                } catch (e) {
                    console.error(`Failed to rename ${item.originalFile}:`, e);
                }
            } else {
                console.log(`Skipping identical: ${item.originalFile}`);
            }
        });
    });

    console.log(`\nRenaming complete. Renamed ${renameCount} files.`);

} catch (error) {
    console.error('Error:', error);
}
