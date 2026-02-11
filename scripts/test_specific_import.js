console.log('Start specific import test');
try {
    const { youtube } = await import('googleapis/build/src/apis/youtube/index.js');
    console.log('YouTube imported');
    const { google } = await import('googleapis/build/src/googleapis.js');
    console.log('Google base imported');
} catch (e) {
    console.error('Import failed', e);
}
console.log('End specific import test');
