# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure Overview

이 프로젝트는 두 가지 배포 대상으로 구성됨:

### 1. Firebase Hosting (웹 배포)
- **`hosting/`** → 관리자 페이지 (shorts-factory-a123a.web.app)
  - `admin.html` - 관리자 대시보드
  - `login.html` - 로그인 페이지
  - `index.html` - 메인 리다이렉트
  - `js/`, `css/` - 공통 에셋

- **`hosting-landing/`** → 랭킹 페이지 (shorts-factory-landing.web.app)
  - `index.html` - 서비스 소개 및 결제 페이지
  - NICEPAY 결제 연동

### 2. Local Tool (데스크톱 앱 - 프로그램으로 판매)
- **`electron/`** → Electron 앱 설정 (legacy, Tauri 마이그레이션 진행 중)
  - `main.js` - Electron 메인 프로세스 (포트 4567에서 Express 서버 실행)
  - `preload.cjs` - 프리로드 스크립트

- **`public/`** → 메인 툴 UI
  - `index.html` - TTS 쇼츠 생성기
  - `ai-shorts.html` - AI 쇼츠 생성기
  - `ai-longform.html` - AI 롱폼 생성기
  - `ranking-video.html` - 랭킹 비디오 생성기
  - `cookie-login.html` - Instagram/TikTok 로그인 (Chrome 쿠키 연동)
  - `script-generator.html` - 대본 생성기 (로컬 전용)
  - `css/`, `js/` - 프론트엔드 에셋

- **`server.js`** → Express 백엔드 서버 (**항상 포트 4567 사용**)
- **`routes/`** → API 라우트 모듈
- **`ranking-videos/`** → 자체 포함된 Python 기반 랭킹 비디오 생성 모듈 (외부 의존성 없음)

### 배포 명령어
```bash
# Firebase 호스팅만 배포 (랜딩 + 관리자)
firebase deploy --only hosting

# 전체 배포 (호스팅 + Functions)
firebase deploy
```

### 중요: 파일 수정 시 주의사항
- `public/` 폴더 수정 → 로컬 툴에만 반영됨 (Firebase에 배포 안됨)
- `hosting/` 폴더 수정 → Firebase 관리자 사이트에 반영
- `hosting-landing/` 폴더 수정 → Firebase 랜딩 페이지에 반영
- `ranking-videos/` 폴더 → 독립적인 Python 모듈, 외부 프로젝트 수정 금지

---

## Development Commands

### Running the Application (메인)
```bash
# Express 서버 실행 (포트 4567 고정)
PORT=4567 node server.js

# Electron 앱 실행 (개발 모드)
npm run electron-dev

# nodemon으로 서버 실행
npm run dev
```

**중요**: 서버는 항상 **포트 4567**에서 실행됩니다. `PORT` 환경변수를 명시하지 않으면 기본값 4567이 사용됩니다.

### Environment Setup
Create a `.env` file in the root directory with:
```
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
MINIMAX_API_KEY=your_minimax_api_key
MINIMAX_GROUP_ID=your_minimax_group_id
PORT=4567
```

---

## Core Workflows

### 1. TTS Shorts Generation
1. Text to audio using MiniMax TTS API (Korean_SweetGirl voice)
2. Audio to SRT subtitles using Gemini STT
3. Image generation using OpenAI DALL-E
4. Video creation combining image + audio + subtitles + background music

### 2. Ranking Videos
1. Download videos from Instagram/TikTok using yt-dlp with Chrome cookies
2. Process videos with Python scripts (MoviePy + FFmpeg)
3. Create ranking compilation with overlays, background music, highlight ending
4. Output to `ranking-videos/Output/`

**Workflow Details**: Videos download to `ranking-videos/Output/` (NOT Input/) → Python script scans Output/ → Generates ranking video → Moves originals to `Output/before merge/`

---

## API Structure

- **Express Server** (`server.js`) - Main application entry point with CORS enabled
- **Route Modules** (`routes/`) - Organized by functionality:
  - `minimax.js` - TTS generation (single and batch processing)
  - `whisper.js` - Subtitle generation from audio files using Gemini STT
  - `video.js` - Video creation with image + audio + subtitles + background music mixing
  - `seedream.js` - Image generation using OpenAI DALL-E
  - `ai-shorts.js` - AI 이미지 생성 쇼츠
  - `ai-longform.js` - AI 롱폼 영상 생성
  - `script.js` - Script generation using Gemini
  - **`ranking-video.js`** - Video download (yt-dlp) + ranking video processing
- **Static Endpoints**: `/api/music/list` for background music files, static serving for `/outputs` and `/audio`

---

## Ranking Videos Module (`ranking-videos/`)

**자체 포함 모듈**: 외부 Python 프로젝트 의존성 없음. 모든 기능이 내부에 구현됨.

### Directory Structure
```
ranking-videos/
├── Config/                    # Configuration files
│   ├── config.json           # Main config (302.ai API, paths, settings)
│   ├── ranking_config.json   # Ranking settings (group_size: 2-5, colors, duration)
│   └── thumbnail_config.json # Thumbnail title with word-level colors
├── Input/                     # (unused - downloads go directly to Output/)
├── Output/                    # Downloaded videos + generated ranking videos
│   └── before merge/         # Original videos moved here after ranking creation
├── Temp/                      # Temporary files (auto-cleaned)
├── scripts/                   # Python scripts
│   ├── create_ranking_video.py  # Main ranking video generator
│   └── create_thumbnail.py      # Thumbnail generator
├── background music/          # Background music files
├── highlight music/           # Highlight ending music
├── highlight emoji/           # PNG emoji overlays
├── venv/                      # Isolated Python virtual environment
└── run.sh                     # Main execution script
```

### Key Configuration Files

**`ranking_config.json`**:
- `group_size`: Number of videos per ranking (default: 2 for testing, usually 5)
- `ranking_display_duration`: Overlay duration in seconds (default: 1.3s)
- `output_dir`: Where to save ranking videos (default: "Output")
- `colors`: Ranking number colors (#1 gold, #2 silver, #3 bronze, etc.)

**`config.json`**:
- `ai_settings.provider`: "302ai" (NOT direct Gemini)
- `ai_settings.base_url`: "https://api.302.ai/v1"
- `ai_settings.model`: "gemini-2.5-flash"
- API key read from server environment variables

**`thumbnail_config.json`**:
- Title text with word-by-word color customization
- Set via web interface or manual edit

### Python Dependencies
- moviepy - Video processing
- numpy - Array operations
- Pillow (PIL) - Image manipulation
- google-generativeai - AI theme analysis (302.ai compatible)

### Manual Execution
```bash
cd ranking-videos
./run.sh
```

Script will:
1. Clean Temp/ folder
2. Scan Output/ for videos
3. Group videos by `group_size`
4. Create ranking video with overlays, music, highlight ending
5. Move original videos to `Output/before merge/`

---

## Video Download Integration (yt-dlp)

### Instagram/TikTok Download Flow
1. User logs into Instagram/TikTok via Chrome browser (`cookie-login.html`)
2. Backend uses `--cookies-from-browser chrome` flag with yt-dlp
3. Videos download directly to `ranking-videos/Output/` (NOT Input/)
4. Supports private videos and stories via Chrome cookie authentication

### Chrome Cookie Paths (macOS)
```
~/Library/Application Support/Google/Chrome/[Profile]/Network/Cookies
```

Downloads use yt-dlp with:
- `--verbose` for detailed logging
- `--cookies-from-browser chrome` for automatic cookie extraction
- `--no-check-certificates` for compatibility
- Custom user-agent and headers

---

## File Organization

- **Project Folders** - Each generation creates a timestamped project folder in `outputs/`
- **Audio Files** - Stored in `{project}/mp3/` subdirectories
- **SRT Files** - Stored in project root directory (not in mp3 subfolder)
- **Video Files** - Generated with ASCII-safe filenames for FFmpeg compatibility
- **Ranking Videos** - `ranking-videos/Output/` with originals moved to `before merge/`

---

## Key Technical Details

### FFmpeg Integration
- **FFmpeg Dependencies**: Requires FFmpeg installed at `C:\\ffmpeg\\bin\\ffmpeg.exe` and `C:\\ffmpeg\\bin\\ffprobe.exe`
- **Path Handling**: Files stored in original project folders with Korean characters, but individual filenames use ASCII-safe characters
- **Subtitle Styling**: White text with black background, bottom alignment, configurable font size
- **Background Music**: Optional mixing at 30% volume (TTS) or 50% volume (ranking videos)
- **Output Format**: MP4 with H.264 video, AAC audio, 30fps, maintains original image dimensions

### MiniMax TTS Integration
- Uses `speech-2.5-turbo-preview` model with Korean_SweetGirl voice
- Audio returned as hex-encoded data, converted to Buffer for MP3 files
- Supports both single and batch processing with parallel API calls

### Gemini STT Integration
- Uses Google's Gemini `gemini-2.5-flash` model for audio transcription
- Generates JSON with segments containing start/end timestamps and text
- Converts transcription to SRT files with proper timing and Korean language support
- SRT files saved in project root, not in mp3 subdirectory

### OpenAI DALL-E Integration
- Uses OpenAI's `dall-e-3` model for AI image generation
- Supports batch image generation with parallel API calls
- Configurable image size (1024x1024), quality (standard/hd), and prompts
- Returns image URLs or base64-encoded images

### 302.ai API Configuration
- All AI services (Gemini, etc.) routed through 302.ai
- Base URL: `https://api.302.ai/v1`
- API keys managed via server environment variables (NOT hardcoded)
- Model names remain the same (e.g., "gemini-2.5-flash")

---

## Important Implementation Details

### ES Modules Configuration
- Project uses ES modules (`"type": "module"` in package.json)
- All imports use `.js` extensions
- Uses `import` syntax throughout codebase

### Port Configuration
- **Server always runs on port 4567** (fixed, not configurable at runtime)
- Set via `PORT=4567` environment variable or default
- Local access: `http://localhost:4567`
- Network access: `http://192.168.0.8:4567`

### Frontend-Backend Communication
- **CORS Enabled**: Full cross-origin support for development
- **File Upload**: Uses multer middleware for multipart form handling
- **Real-time Feedback**: No websockets - relies on HTTP request/response patterns
- **Logging**: Uses `process.stdout.write()` for persistent output (not `console.log()`)

### Firebase Integration
- **Authentication**: Firebase Auth for user management
- **Firestore**: User data and API key storage
- **Hosting**: Admin pages and landing page only (not main tool)
- **Functions**: User management APIs (getUsers, createUser, deleteUser, etc.)

### Electron Integration
- **Main Process**: `electron/main.js` - Express 서버를 in-process로 실행 (포트 4567)
- **Window Size**: 1280x900 기본 창 크기
- **DevTools**: 개발 모드에서 자동으로 열림 (detached)
- **IPC**: 폴더 선택 다이얼로그 지원 (`folder-picker:select`)
- **Server Wait**: 서버가 준비될 때까지 대기 후 창 표시 (최대 25회 재시도)
- **Preload Script**: `electron/preload.cjs`로 안전한 IPC 통신 제공

### Batch Processing
- Parallel processing using `Promise.allSettled()`
- Individual error handling per item
- Results returned with success/failure counts and detailed error information
