import BatchUploader from './batch_upload.js';

const args = process.argv.slice(2);
const folderPaths = [];
let privacyStatus = 'public';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--folder' && args[i + 1]) {
        folderPaths.push(args[i + 1]);
        i++;
    } else if (args[i] === '--folders') {
        i++;
        while (i < args.length && !args[i].startsWith('--')) {
            folderPaths.push(args[i]);
            i++;
        }
        i--;
    } else if (args[i] === '--privacy' && args[i + 1]) {
        privacyStatus = args[i + 1];
        i++;
    }
}

if (folderPaths.length === 0) {
    console.error('❌ No folders specified');
    console.log('Usage: node scripts/upload_batch.js --folders <path1> <path2> ... [--privacy <private|unlisted|public>]');
    process.exit(1);
}

const uploader = new BatchUploader();
uploader.processFolders(folderPaths, privacyStatus)
    .then(() => {
        console.log('\n✨ All done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n❌ Error:', err);
        process.exit(1);
    });
