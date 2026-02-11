import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'images', 'templates');
const TEMPLATE_COUNT = 34;

async function generateTemplateImages() {
    console.log('Starting template image generation...');

    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    console.log(`Output directory: ${OUTPUT_DIR}`);

    // Launch browser
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Set viewport for high quality capture
    await page.setViewport({ width: 1920, height: 10000 });

    // Load the template page
    const templatePath = path.join(__dirname, '..', 'public', 'templates', 'thumbnail-templates.html');
    const fileUrl = `file:///${templatePath.replace(/\\/g, '/')}`;
    console.log(`Loading: ${fileUrl}`);

    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 2000)); // Extra wait for web fonts

    console.log('Page loaded, generating images...\n');

    // Generate each template image
    for (let i = 1; i <= TEMPLATE_COUNT; i++) {
        const selector = `#template${i}`;

        try {
            const element = await page.$(selector);
            if (!element) {
                console.log(`Template ${i}: Element not found`);
                continue;
            }

            // Get element bounding box
            const box = await element.boundingBox();
            if (!box) {
                console.log(`Template ${i}: Could not get bounding box`);
                continue;
            }

            // Take screenshot of the element (at 0.5 scale = 640x360)
            // Then we'll resize to 320x180 for preview
            const outputPath = path.join(OUTPUT_DIR, `template-${i}.png`);

            await element.screenshot({
                path: outputPath,
                type: 'png'
            });

            console.log(`Template ${i}: Saved to ${outputPath}`);

        } catch (err) {
            console.error(`Template ${i}: Error - ${err.message}`);
        }
    }

    await browser.close();
    console.log('\nDone! All template images generated.');
}

generateTemplateImages().catch(console.error);
