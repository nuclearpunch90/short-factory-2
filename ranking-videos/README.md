# Ranking Videos Module

Internal ranking video processing system for shorts-factory-main.

## Directory Structure

```
ranking-videos/
├── Config/                    # Configuration files
│   ├── config.json           # Main config (API keys, paths, settings)
│   ├── ranking_config.json   # Ranking-specific settings (group size, colors, etc.)
│   └── thumbnail_config.json # Thumbnail title settings
├── Input/                     # Downloaded videos (yt-dlp output)
├── Output/                    # Generated ranking videos
├── Temp/                      # Temporary files (auto-cleaned)
├── scripts/                   # Python scripts
│   ├── create_ranking_video.py
│   └── create_thumbnail.py
├── background music/          # Background music files (.mp3, .wav, .m4a)
├── highlight music/           # Highlight ending music
├── highlight emoji/           # PNG emoji overlays
├── venv/                      # Python virtual environment
├── run.sh                     # Main execution script
└── requirements.txt           # Python dependencies

## How It Works

1. **Download Videos**: ranking-video.js downloads videos to `Input/` using yt-dlp
2. **Create Ranking**: Python script processes videos from `Output/` and creates ranking compilation
3. **Output**: Final ranking video saved to `Output/`

## Usage

### Via Web API (Normal Usage)
The Express server (`server.js`) will automatically use this internal module when you:
1. Download videos via ranking-video API
2. Run the ranking video script

### Manual Execution
```bash
cd ranking-videos
./run.sh
```

## Configuration

### config.json
- API keys (Gemini AI)
- Audio/video settings
- Paths configuration

### ranking_config.json
- `group_size`: Number of videos per ranking (default: 5)
- `ranking_display_duration`: How long to show ranking overlay (seconds)
- Ranking number colors (#1 gold, #2 silver, etc.)

### thumbnail_config.json
- Title text with word-by-word colors
- Set via web interface or manually edit

## Dependencies

Python packages (auto-installed in venv):
- moviepy - Video processing
- numpy - Array operations
- Pillow (PIL) - Image manipulation
- google-generativeai - AI theme analysis

## Notes

- This is a self-contained module within shorts-factory-main
- Does NOT modify or depend on external Python projects
- All assets (music, emojis) are stored locally
- Virtual environment is isolated to this directory
