import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import AccountManager from './account_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, 'client_secret.json');




/**
 * Batch upload videos from folders
 */
class BatchUploader {
    constructor() {
        this.manager = new AccountManager();
        this.credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    }

    /**
     * Find video files in a folder
     */
    findVideoInFolder(folderPath) {
        const files = fs.readdirSync(folderPath);
        const videoFile = files.find(file => file.toLowerCase().endsWith('.mp4'));

        if (!videoFile) {
            return null;
        }

        return path.join(folderPath, videoFile);
    }

    /**
     * Parse info.txt for metadata
     */
    parseInfoFile(folderPath) {
        const infoPath = path.join(folderPath, 'info.txt');

        if (!fs.existsSync(infoPath)) {
            return { title: null, description: null };
        }

        try {
            const content = fs.readFileSync(infoPath, 'utf8');
            const lines = content.split('\n').map(line => line.trim()).filter(line => line);

            let title = null;
            let description = null;

            for (const line of lines) {
                if (line.startsWith('제목:')) {
                    title = line.replace('제목:', '').trim();
                } else if (line.startsWith('설명:')) {
                    description = line.replace('설명:', '').trim();
                }
            }

            return { title, description };
        } catch (err) {
            console.warn(`⚠️  Could not read info.txt: ${err.message}`);
            return { title: null, description: null };
        }
    }

    /**
     * Upload a single video using specified account
     */
    async uploadVideo(videoPath, title, description, accountId, privacyStatus = 'unlisted') {
        const account = this.manager.getAccount(accountId);
        const tokenPath = path.join(PROJECT_ROOT, account.token_file);

        if (!fs.existsSync(tokenPath)) {
            throw new Error(`Token file not found: ${account.token_file}`);
        }

        const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        const { client_secret, client_id, redirect_uris } = this.credentials.installed || this.credentials.web;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
        oAuth2Client.setCredentials(token);

        const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

        console.log(`\n📤 Uploading to ${account.name} (${accountId})`);
        console.log(`   📹 Title: ${title}`);
        console.log(`   📝 Description: ${description || '(none)'}`);
        console.log(`   🔒 Privacy: ${privacyStatus}`);

        return new Promise((resolve, reject) => {
            youtube.videos.insert(
                {
                    part: 'snippet,status',
                    requestBody: {
                        snippet: {
                            title: title,
                            description: '', // Description removed as requested
                            tags: [], // Tags removed as requested
                        },
                        status: {
                            privacyStatus: privacyStatus,
                        },
                    },
                    media: {
                        body: fs.createReadStream(videoPath),
                    },
                },
                (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const videoId = res.data.id;
                    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

                    console.log(`   ✅ Success! Video ID: ${videoId}`);
                    console.log(`   🔗 URL: ${videoUrl}`);

                    // Update upload count
                    this.manager.incrementUploadCount(accountId);

                    resolve({ videoId, videoUrl, accountId });
                }
            );
        });
    }

    /**
     * Process a single folder
     */
    async processFolder(folderPath, privacyStatus = 'unlisted') {
        console.log(`\n📁 Processing folder: ${path.basename(folderPath)}`);
        console.log('━'.repeat(60));

        // Find video file
        const videoPath = this.findVideoInFolder(folderPath);
        if (!videoPath) {
            console.log('   ⚠️  No video file found, skipping');
            return null;
        }

        console.log(`   Found video: ${path.basename(videoPath)}`);

        // Parse metadata from info.txt
        const { title, description } = this.parseInfoFile(folderPath);

        if (!title) {
            const fileName = path.basename(videoPath, path.extname(videoPath));
            console.log(`   ℹ️  No title in info.txt, using filename: ${fileName}`);
        }

        const finalTitle = title || path.basename(videoPath, path.extname(videoPath));

        // Select account with least uploads
        const account = this.manager.getLeastUsedAccount();
        console.log(`   🎯 Selected account: ${account.name} (${account.upload_count} uploads)`);

        // Upload
        try {
            const result = await this.uploadVideo(videoPath, finalTitle, description, account.id, privacyStatus);
            return result;
        } catch (err) {
            console.error(`   ❌ Upload failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Process multiple folders
     */
    async processFolders(folderPaths, privacyStatus = 'public') {
        console.log(`\n🚀 Batch Upload Started`);
        console.log(`📊 Processing ${folderPaths.length} folder(s)\n`);

        const results = [];

        for (const folderPath of folderPaths) {
            if (!fs.existsSync(folderPath)) {
                console.log(`\n❌ Folder not found: ${folderPath}`);
                continue;
            }

            if (!fs.statSync(folderPath).isDirectory()) {
                console.log(`\n❌ Not a directory: ${folderPath}`);
                continue;
            }

            const result = await this.processFolder(folderPath, privacyStatus);
            if (result) {
                results.push(result);
            }
        }

        // Summary
        console.log('\n\n' + '='.repeat(60));
        console.log('📊 Batch Upload Summary');
        console.log('='.repeat(60));
        console.log(`Total folders: ${folderPaths.length}`);
        console.log(`Successful uploads: ${results.length}`);
        console.log(`Failed: ${folderPaths.length - results.length}`);

        if (results.length > 0) {
            console.log('\n✅ Uploaded videos:');
            for (const result of results) {
                console.log(`   - ${result.videoUrl} (${result.accountId})`);
            }
        }

        console.log('\n📈 Updated account statistics:');
        this.manager.displayStats();

        return results;
    }
}

// CLI usage - execute directly
// if (process.argv[1].endsWith('batch_upload.js')) {
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage:');
    console.log('  node scripts/batch_upload.js --folder <path> [--privacy <private|unlisted|public>]');
    console.log('  node scripts/batch_upload.js --folders <path1> <path2> ... [--privacy <private|unlisted|public>]');
    console.log('\nExamples:');
    console.log('  node scripts/batch_upload.js --folder outputs/20260208T092501');
    console.log('  node scripts/batch_upload.js --folders outputs/folder1 outputs/folder2 --privacy public');
    process.exit(0);
}

let folderPaths = [];
let privacyStatus = 'public';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--folder' && args[i + 1]) {
        folderPaths.push(args[i + 1]);
        i++;
    } else if (args[i] === '--folders') {
        // Collect all folder paths until we hit another flag
        i++;
        while (i < args.length && !args[i].startsWith('--')) {
            folderPaths.push(args[i]);
            i++;
        }
        i--;
    } else if (args[i] === '--parent' && args[i + 1]) {
        const parentDir = args[i + 1];
        if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
            const subdirs = fs.readdirSync(parentDir)
                .map(file => path.join(parentDir, file))
                .filter(p => fs.statSync(p).isDirectory());
            folderPaths.push(...subdirs);
        } else {
            console.error(`❌ Parent directory not found: ${parentDir}`);
        }
        i++;
    } else if (args[i] === '--privacy' && args[i + 1]) {
        privacyStatus = args[i + 1];
        i++;
    }
}

if (folderPaths.length === 0) {
    console.error('❌ No folders specified');
    process.exit(1);
}

console.log('Script initialization started');

try {
    const uploader = new BatchUploader();
    console.log('Uploader initialized');
    uploader.processFolders(folderPaths, privacyStatus)
        .then(() => {
            console.log('\n✨ All done!');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Error:', err);
            process.exit(1);
        });
} catch (error) {
    console.error('Failed to initialize uploader:', error);
    process.exit(1);
}
// }

export default BatchUploader;
