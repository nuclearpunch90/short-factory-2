import fs from 'fs';
console.log('Hello from test_simple.js');
try {
    const { google } = await import('googleapis');
    console.log('Google imported');
} catch (e) {
    console.error('Error importing googleapis', e);
}
console.log('Done');
