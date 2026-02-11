// 이 파일은 video.js를 업데이트하는 스크립트입니다
// 실행: node update-video-settings.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const videoFilePath = path.join(__dirname, 'routes', 'video.js');
let content = fs.readFileSync(videoFilePath, 'utf8');

// 1. 자막 크기 18 -> 14로 변경
content = content.replace(/Fontsize=18/g, 'Fontsize=14');

// 2. 배경음악 볼륨 0.3 -> 0.35로 변경  
content = content.replace(/volume=0\.3/g, 'volume=0.35');

// 3. 로고 추가 코드 삽입 - 자막 설정 부분을 찾아서 교체
const oldSubtitleSection = `            // 자막 설정
            if (hasSrt) {
                // Windows 경로를 FFmpeg용으로 변환 (백슬래시를 슬래시로, 콜론 이스케이프)
                const normalizedSrtPath = srtPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
                const subtitlesFilter = \`subtitles='\${normalizedSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'\`;
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    \`-s \${imageSize.width}x\${imageSize.height}\`,
                    '-pix_fmt yuv420p',
                    \`-vf \${subtitlesFilter}\`,
                    '-shortest'
                ]);
                console.log('Adding subtitles with filter:', subtitlesFilter);
            } else {
                // 자막 없이 기본 비디오 설정
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    \`-s \${imageSize.width}x\${imageSize.height}\`,
                    '-pix_fmt yuv420p',
                    '-shortest'
                ]);
            }`;

const newSubtitleSection = `            // 로고 경로 설정
            const logoPath = path.join(__dirname, '..', 'logo', '1.png');
            const logoExists = fsSync.existsSync(logoPath);
            const normalizedLogoPath = logoPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
            
            // 자막과 로고 설정
            if (hasSrt && logoExists) {
                // 자막과 로고 모두 있는 경우 - complex filter 사용
                const normalizedSrtPath = srtPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
                const filterComplex = [
                    \`[0:v]subtitles='\${normalizedSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'[subtitled]\`,
                    \`movie='\${normalizedLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.9[logo]\`,
                    \`[subtitled][logo]overlay=(W-w)/2:H-h-200\`
                ];
                
                ffmpegCommand.complexFilter(filterComplex);
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    \`-s \${imageSize.width}x\${imageSize.height}\`,
                    '-pix_fmt yuv420p',
                    '-shortest'
                ]);
                console.log('Adding subtitles and logo with complex filter');
            } else if (hasSrt) {
                // 자막만 있는 경우
                const normalizedSrtPath = srtPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
                const subtitlesFilter = \`subtitles='\${normalizedSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'\`;
                
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    \`-s \${imageSize.width}x\${imageSize.height}\`,
                    '-pix_fmt yuv420p',
                    \`-vf \${subtitlesFilter}\`,
                    '-shortest'
                ]);
                console.log('Adding subtitles only');
            } else if (logoExists) {
                // 로고만 있는 경우
                const logoOnlyFilter = \`movie='\${normalizedLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.9[logo];[0:v][logo]overlay=(W-w)/2:H-h-200\`;
                ffmpegCommand.complexFilter(logoOnlyFilter);
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    \`-s \${imageSize.width}x\${imageSize.height}\`,
                    '-pix_fmt yuv420p',
                    '-shortest'
                ]);
                console.log('Adding logo overlay');
            } else {
                // 로고도 자막도 없는 기본 비디오 설정
                ffmpegCommand.outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-b:a 192k',
                    '-r 30',
                    \`-s \${imageSize.width}x\${imageSize.height}\`,
                    '-pix_fmt yuv420p',
                    '-shortest'
                ]);
            }`;

content = content.replace(oldSubtitleSection, newSubtitleSection);

// 4. 배치 모드도 동일하게 처리
const oldBatchSection = `                    // 배치 모드 자막 설정
                    if (batchHasSrt) {
                        // Windows 경로를 FFmpeg용으로 변환
                        const normalizedBatchSrtPath = batchSrtPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
                        const batchSubtitlesFilter = \`subtitles='\${normalizedBatchSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'\`;
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            \`-s \${imageSize.width}x\${imageSize.height}\`,
                            '-pix_fmt yuv420p',
                            \`-vf \${batchSubtitlesFilter}\`,
                            '-shortest'
                        ]);
                        console.log(\`Batch video \${index + 1}: Adding subtitles with filter:\`, batchSubtitlesFilter);
                    } else {
                        // 자막 없이 기본 비디오 설정
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            \`-s \${imageSize.width}x\${imageSize.height}\`,
                            '-pix_fmt yuv420p',
                            '-shortest'
                        ]);
                    }`;

const newBatchSection = `                    // 로고 경로 설정 (배치 모드)
                    const batchLogoPath = path.join(__dirname, '..', 'logo', '1.png');
                    const batchLogoExists = fsSync.existsSync(batchLogoPath);
                    const normalizedBatchLogoPath = batchLogoPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
                    
                    // 배치 모드 자막과 로고 설정
                    if (batchHasSrt && batchLogoExists) {
                        // 자막과 로고 모두 있는 경우
                        const normalizedBatchSrtPath = batchSrtPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
                        const batchFilterComplex = [
                            \`[0:v]subtitles='\${normalizedBatchSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'[subtitled]\`,
                            \`movie='\${normalizedBatchLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.9[logo]\`,
                            \`[subtitled][logo]overlay=(W-w)/2:H-h-200\`
                        ];
                        ffmpegCommand.complexFilter(batchFilterComplex);
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            \`-s \${imageSize.width}x\${imageSize.height}\`,
                            '-pix_fmt yuv420p',
                            '-shortest'
                        ]);
                        console.log(\`Batch video \${index + 1}: Adding subtitles and logo\`);
                    } else if (batchHasSrt) {
                        // 자막만 있는 경우
                        const normalizedBatchSrtPath = batchSrtPath.replace(/\\\\/g, '/').replace(/:/g, '\\\\:');
                        const batchSubtitlesFilter = \`subtitles='\${normalizedBatchSrtPath}':force_style='Fontsize=14,PrimaryColour=&Hffffff,BackColour=&H000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=6,MarginV=20,MarginL=10,MarginR=10,Bold=1,BorderRadius=8'\`;
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            \`-s \${imageSize.width}x\${imageSize.height}\`,
                            '-pix_fmt yuv420p',
                            \`-vf \${batchSubtitlesFilter}\`,
                            '-shortest'
                        ]);
                        console.log(\`Batch video \${index + 1}: Adding subtitles only\`);
                    } else if (batchLogoExists) {
                        // 로고만 있는 경우
                        const batchLogoOnlyFilter = \`movie='\${normalizedBatchLogoPath}',scale=180:-1,format=rgba,colorchannelmixer=aa=0.9[logo];[0:v][logo]overlay=(W-w)/2:H-h-200\`;
                        ffmpegCommand.complexFilter(batchLogoOnlyFilter);
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            \`-s \${imageSize.width}x\${imageSize.height}\`,
                            '-pix_fmt yuv420p',
                            '-shortest'
                        ]);
                        console.log(\`Batch video \${index + 1}: Adding logo overlay\`);
                    } else {
                        // 로고도 자막도 없는 기본 비디오 설정
                        ffmpegCommand.outputOptions([
                            '-c:v libx264',
                            '-c:a aac',
                            '-b:a 192k',
                            '-r 30',
                            \`-s \${imageSize.width}x\${imageSize.height}\`,
                            '-pix_fmt yuv420p',
                            '-shortest'
                        ]);
                    }`;

content = content.replace(oldBatchSection, newBatchSection);

// 파일 저장
fs.writeFileSync(videoFilePath, content, 'utf8');

console.log('✅ video.js 업데이트 완료!');
console.log('- 자막 크기: 14px');
console.log('- 배경음악 볼륨: 35%');
console.log('- 로고: 180px, 90% 불투명도, 하단 중앙에서 200px 위');