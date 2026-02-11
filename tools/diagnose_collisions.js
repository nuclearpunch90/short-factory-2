import fs from 'fs';
import path from 'path';

const TARGET_DIRS = [
    path.join(process.cwd(), 'data/common/audio'),
    path.join(process.cwd(), 'Output/ai-videos')
];

async function diagnose() {
    console.log('Starting comprehensive collision diagnosis...');

    for (const dir of TARGET_DIRS) {
        if (!fs.existsSync(dir)) {
            console.log(`Skipping missing dir: ${dir}`);
            continue;
        }

        console.log(`\nScanning directory: ${dir}`);
        const files = fs.readdirSync(dir);

        // Map to track potential collisions
        // Key: normalized NFC lowercase string (what OneDrive likely uses for comparison)
        // Value: Array of actual filenames found on disk
        const map = new Map();

        for (const file of files) {
            // OneDrive collision logic approximation:
            // Normalize to NFC and convert to lowercase
            const key = file.normalize('NFC').toLowerCase();

            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push(file);
        }

        let conflictCount = 0;
        const conflicts = [];

        for (const [key, variants] of map.entries()) {
            if (variants.length > 1) {
                // We found multiple files that normalize to the same 'OneDrive Key'
                conflictCount++;
                conflicts.push({ key, variants });
                console.log(`[CONFLICT DETECTED] Key: "${key}"`);
                variants.forEach(v => console.log(`  - Found: "${v}" (${Buffer.from(v).toString('hex')})`));
            }
        }

        if (conflictCount === 0) {
            console.log(`No collisions found in ${dir}.`);
        } else {
            console.log(`\nFound ${conflictCount} collision groups in ${dir}. These need to be resolved.`);

            // Fix Plan: Rename all variants to unique safe names
            console.log('Applying automatic fix for collisions...');
            for (const { key, variants } of conflicts) {
                console.log(`Fixing collision group for "${key}"...`);

                // Sort variants to have deterministic order
                variants.sort();

                // Keep the first one as "primary" (renamed to safe NFC)
                // Rename others to primary_1, primary_2, etc.

                for (let i = 0; i < variants.length; i++) {
                    const originalName = variants[i];
                    const extension = path.extname(originalName);
                    // Base name without extension, normalized NFC
                    let baseName = path.basename(originalName, extension).normalize('NFC');

                    // Sanitize baseName just to be super safe (remove non-safe chars)
                    baseName = baseName.replace(/[^\w\s가-힣-]/g, '').replace(/\s+/g, '_');

                    // Create new unique name
                    let newName;
                    if (i === 0) {
                        newName = `${baseName}${extension}`;
                    } else {
                        newName = `${baseName}_dup${i}${extension}`;
                    }

                    // If the new name is effectively "the same" as one of the existing variants (e.g. we just normalized it), 
                    // we still need to be careful. The OS might confuse them.
                    // Strategy: Rename to a temp hash matching strict ASCII first, then to final name.

                    const oldPath = path.join(dir, originalName);
                    const tempPath = path.join(dir, `temp_fix_${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`);
                    const finalPath = path.join(dir, newName);

                    try {
                        // 1. Rename to temp safe path
                        fs.renameSync(oldPath, tempPath);

                        // 2. Rename to final desired path
                        // Check if final path exists (it shouldn't if we calculated right, but check)
                        if (fs.existsSync(finalPath)) {
                            // If taken, append another random suffix
                            const safeFinal = path.join(dir, `${baseName}_fixed_${Date.now()}_${i}${extension}`);
                            fs.renameSync(tempPath, safeFinal);
                            console.log(`  -> Renamed "${originalName}" to "${path.basename(safeFinal)}"`);
                        } else {
                            fs.renameSync(tempPath, finalPath);
                            console.log(`  -> Renamed "${originalName}" to "${newName}"`);
                        }
                    } catch (e) {
                        console.error(`  [ERROR] Failed to fix "${originalName}": ${e.message}`);
                    }
                }
            }
        }
    }
    console.log('\nDiagnosis and fix process completed.');
}

diagnose();
