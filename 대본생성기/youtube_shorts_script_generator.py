#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YouTube Shorts Script Generator
Generates video titles and 35-50 second scripts for restaurant promotional shorts
Uses Google Gemini API and Google Cloud TTS
Requires: pip install google-generativeai gradio python-dotenv google-cloud-texttospeech
"""

import os
import json
import subprocess
import gradio as gr
import google.generativeai as genai
from google.cloud import texttospeech
import azure.cognitiveservices.speech as speechsdk
from dotenv import load_dotenv
import socket
from typing import List, Dict, Tuple, Optional
from pathlib import Path
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import base64
import io
from PIL import Image as PILImage
import requests
import logging

# byteplussdkarkruntime removed due to installation issues on Python 3.13
Ark = None # Placeholder to minimize diff noise, though we won't use it

# Configure logging
logging.basicConfig(
    filename='server_debug.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Path to save last input
LAST_INPUT_FILE = Path(__file__).parent / "last_input.json"
LAST_SELECTION_FILE = Path(__file__).parent / "last_video_selection.json"
LAST_OUTPUT_FILE = Path(__file__).parent / "last_output.json"

# Video merger paths
VIDEOS_DIR = Path(__file__).parent.parent / "videos"
OUTPUT_DIR = Path(__file__).parent.parent / "final_shorts"
BGM_DIR = Path(__file__).parent.parent / "background music"
TTS_AUDIO_DIR = Path(__file__).parent / "audio"

# Video generation paths
INPUT_DIR = Path(__file__).parent.parent / "input"
OUTPUT_BYTEPLUS_DIR = Path(__file__).parent.parent / "output_byteplus"

# BytePlus API configuration
ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3"
ARK_VIDEO_TASK_ENDPOINT = "/contents/generations/tasks"

# Network safety timeouts (prevents endless loading when APIs hang)
GENERATION_TIMEOUT = 60  # seconds for Gemini requests
TTS_TIMEOUT = 30         # seconds for Google TTS

# Create output directory
OUTPUT_DIR.mkdir(exist_ok=True)
TTS_AUDIO_DIR.mkdir(exist_ok=True)

# Script styles with Korean and English descriptions
SCRIPT_STYLES = {
    "리뷰형 (Review)": {
        "korean": "리뷰형",
        "english": "Review",
        "description": "개인적인 방문 경험을 바탕으로 한 진솔한 리뷰 스타일"
    },
    "홍보형 (Promotional)": {
        "korean": "홍보형",
        "english": "Promotional",
        "description": "매장의 장점을 강조하는 직접적인 홍보 스타일"
    },
    "스토리텔링형 (Storytelling)": {
        "korean": "스토리텔링형",
        "english": "Storytelling",
        "description": "가게의 스토리나 사장님의 이야기를 담은 감성 스타일"
    },
    "팁/추천형 (Tips)": {
        "korean": "팁/추천형",
        "english": "Tips & Recommendation",
        "description": "꿀팁이나 추천 메뉴를 소개하는 정보 제공 스타일"
    },
    "긴급/FOMO형 (Urgency)": {
        "korean": "긴급/FOMO형",
        "english": "Urgency/FOMO",
        "description": "지금 가야 하는 이유를 강조하는 긴박감 있는 스타일"
    },
    "비교형 (Comparison)": {
        "korean": "비교형",
        "english": "Comparison",
        "description": "다른 곳과 비교하며 차별점을 부각하는 스타일"
    },
    "질문형 (Question)": {
        "korean": "질문형",
        "english": "Question",
        "description": "시청자에게 질문을 던지며 호기심을 유발하는 스타일"
    }
}

# Intro styles
INTRO_STYLES = {
    "충격적 사실형": {
        "korean": "충격적 사실형",
        "english": "Shocking Fact",
        "description": "놀라운 사실로 시작 (예: 알고 계셨나요? 이 집은...)"
    },
    "질문 던지기형": {
        "korean": "질문 던지기형",
        "english": "Question Hook",
        "description": "시청자에게 질문 던지기 (예: 여러분은 어떤 음식 좋아하세요?)"
    },
    "놀람 후크형": {
        "korean": "놀람 후크형",
        "english": "Surprise Hook",
        "description": "감탄사로 시작 (예: 와, 진짜 대박이에요!)"
    },
    "지역 인증형": {
        "korean": "지역 인증형",
        "english": "Local Authority",
        "description": "지역 사람들의 인정 강조 (예: 고양시 택시 기사님들이 1등으로 뽑는다는...)"
    },
    "직설적 소개형": {
        "korean": "직설적 소개형",
        "english": "Direct Introduction",
        "description": "바로 본론으로 시작 (예: 40년 전통의 할매 순대국, 드디어 방문했습니다!)"
    },
    "방문 인증형": {
        "korean": "방문 인증형",
        "english": "Visit Verification",
        "description": "매장 위치와 이름을 언급하며 방문 사실을 알리며 시작 (예: 오늘은 [위치]에 있는 [가게이름]에 다녀왔는데요...)"
    }
}

# Outro styles
OUTRO_STYLES = {
    "물음표 마무리형": {
        "korean": "물음표 마무리형",
        "english": "Question Mark Ending",
        "description": "장소를 물음표로 마무리 (예: 배터지게 먹을 수 있는 이곳은?)"
    },
    "장점 강조 물음형": {
        "korean": "장점 강조 물음형",
        "english": "Benefits Question",
        "description": "매장 장점 강조 후 '이곳은?'으로 마무리 (예: 삼겹살을 저렴하게 배터지게 먹을 수 있는 이곳은?)"
    },
    "물음표 장난형": {
        "korean": "물음표 장난형",
        "english": "Playful Question",
        "description": "재치있는 질문으로 마무리 (예: 이 가격에 뭐 남는 것 있으세요?)"
    },
    "추천형": {
        "korean": "추천형",
        "english": "Recommendation",
        "description": "직접적인 추천 (예: 든든한 한 끼 생각나면 꼭 들러보세요!)"
    },
    "행동 유도형": {
        "korean": "행동 유도형",
        "english": "Call to Action",
        "description": "방문 유도 (예: 여러분도 한번 가보시길 추천드립니다!)"
    },
    "반전 확신형": {
        "korean": "반전 확신형",
        "english": "Confident Conclusion",
        "description": "확신을 주는 마무리 (예: 진짜 찐맛집 맞더라고요!)"
    }
}


def save_last_input(restaurant_name: str, description: str,
                    selected_styles: List[str], language: str, intro_style: str, outro_style: str,
                    location: str = "", location_in: str = "intro",
                    include_restaurant_name: bool = True):
    """Save last input to JSON file."""
    data = {
        "restaurant_name": restaurant_name,
        "description": description,
        "selected_styles": selected_styles,
        "language": language,
        "intro_style": intro_style,
        "outro_style": outro_style,
        "location": location,
        "location_in": location_in,
        "include_restaurant_name": include_restaurant_name
    }
    try:
        with open(LAST_INPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Failed to save last input: {e}")


def load_last_input() -> Dict:
    """Load last input from JSON file."""
    default_values = {
        "restaurant_name": "",
        "description": "",
        "selected_styles": ["리뷰형 (Review)", "홍보형 (Promotional)"],
        "language": "Korean",
        "intro_style": "직설적 소개형",
        "outro_style": "추천형",
        "include_restaurant_name": True
    }

    if not LAST_INPUT_FILE.exists():
        return default_values

    try:
        with open(LAST_INPUT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Migration path: if strengths or reviews exist, append them to description
            description = data.get("description", "")
            strengths = data.get("strengths", "")
            reviews = data.get("reviews", "")
            
            combined_desc = description
            if strengths:
                combined_desc += f"\n\n주요 장점:\n{strengths}"
            if reviews:
                combined_desc += f"\n\n매장 리뷰:\n{reviews}"
            
            data["description"] = combined_desc.strip()
            
            # Remove old keys
            data.pop("strengths", None)
            data.pop("reviews", None)
            
            # Add defaults for intro/outro if not present
            data.setdefault("intro_style", "직설적 소개형")
            data.setdefault("outro_style", "추천형")
            data.setdefault("include_restaurant_name", True)
            return data
    except Exception as e:
        print(f"Failed to load last input: {e}")
        return default_values


def save_last_output(output: str, audios: List[str]):
    """Save last generated output to JSON file (text only, no audio paths)."""
    data = {
        "output": output
        # Note: Audio paths are not saved as they are temporary files
    }
    try:
        with open(LAST_OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Failed to save last output: {e}")


def load_last_output() -> Dict:
    """Load last generated output from JSON file."""
    default_values = {
        "output": "",
        "audios": [None] * 7
    }

    if not LAST_OUTPUT_FILE.exists():
        return default_values

    try:
        with open(LAST_OUTPUT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Ensure audios list has exactly 7 elements
            audios = data.get("audios", [])
            while len(audios) < 7:
                audios.append(None)
            data["audios"] = audios[:7]  # Limit to 7
            return data
    except Exception as e:
        print(f"Failed to load last output: {e}")
        return default_values


def text_to_speech(text: str, language: str = "Korean", restaurant_name: str = "") -> str:
    """
    Convert text to speech using Google Cloud TTS.

    Args:
        text: Script text to convert
        language: "Korean" or "English"
        restaurant_name: Used for naming the audio file

    Returns:
        Path to generated audio file
    """
    # Fail fast if credentials are missing to avoid long hangs
    credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if credentials_path and not Path(credentials_path).exists():
        print(f"TTS skipped: GOOGLE_APPLICATION_CREDENTIALS not found at {credentials_path}")
        return None

    try:
        # Initialize TTS client
        client = texttospeech.TextToSpeechClient()

        # Set language and voice
        if language == "Korean":
            language_code = "ko-KR"
            voice_name = "ko-KR-Chirp3-HD-Algenib"  # Algenib (Male) voice
        else:
            language_code = "en-US"
            voice_name = "en-US-Neural2-F"  # Female voice

        # Configure synthesis input
        synthesis_input = texttospeech.SynthesisInput(text=text)

        # Configure voice
        voice = texttospeech.VoiceSelectionParams(
            language_code=language_code,
            name=voice_name
        )

        # Configure audio
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=1.2,  # 1.2x speed as per user request
            pitch=0.0
        )

        # Generate speech
        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config,
            timeout=TTS_TIMEOUT
        )

        # Save to temporary file
        TTS_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_restaurant = restaurant_name.strip().replace("/", "_").replace("\\", "_")
        if not safe_restaurant:
            safe_restaurant = "restaurant"
        safe_name = f"{safe_restaurant}_{timestamp}.mp3"
        output_path = TTS_AUDIO_DIR / safe_name
        with open(output_path, "wb") as f:
            f.write(response.audio_content)

        return str(output_path)
    except Exception as e:
        print(f"TTS error: {e}")
        return None


def text_to_speech_azure(text: str, language: str = "Korean", restaurant_name: str = "") -> str:
    """
    Convert text to speech using Azure TTS.
    
    Args:
        text: Script text to convert
        language: "Korean" or "English"
        restaurant_name: Used for naming the audio file
        
    Returns:
        Path to generated audio file
    """
    speech_key = os.environ.get('SPEECH_KEY')
    service_region = os.environ.get('SPEECH_REGION')
    
    if not speech_key or not service_region:
        print("Azure TTS skipped: SPEECH_KEY or SPEECH_REGION not set")
        return None
        
    try:
        speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=service_region)
        
        # Set voice based on language
        if language == "Korean":
            # Hyunsu (Male) - requested by user
            speech_config.speech_synthesis_voice_name = "ko-KR-HyunsuNeural"
        else:
            # Andrew (Male) - to match male persona
            speech_config.speech_synthesis_voice_name = "en-US-AndrewNeural"
            
        # Create audio config
        TTS_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_restaurant = restaurant_name.strip().replace("/", "_").replace("\\", "_")
        if not safe_restaurant:
            safe_restaurant = "restaurant"
        
        # Add provider suffix to distinguish files
        safe_name = f"{safe_restaurant}_{timestamp}_azure.mp3"
        output_path = TTS_AUDIO_DIR / safe_name
        
        audio_config = speechsdk.audio.AudioOutputConfig(filename=str(output_path))
        
        # Create synthesizer
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)
        
        # Synthesize
        # Apply speed adjustment via SSML since Azure SDK doesn't have a direct 'speaking_rate' param like Google
        # 1.2 rate = +20%
        ssml = f"""
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{language.lower()}">
            <voice name="{speech_config.speech_synthesis_voice_name}">
                <prosody rate="+50.00%">
                    {text}
                </prosody>
            </voice>
        </speak>
        """
        
        result = synthesizer.speak_ssml_async(ssml).get()
        
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return str(output_path)
        elif result.reason == speechsdk.ResultReason.Canceled:
            cancellation_details = result.cancellation_details
            print(f"Azure TTS canceled: {cancellation_details.reason}")
            if cancellation_details.reason == speechsdk.CancellationReason.Error:
                print(f"Error details: {cancellation_details.error_details}")
            return None
            
    except Exception as e:
        print(f"Azure TTS error: {e}")
        return None
        
        
def text_to_speech(text: str, language: str = "Korean", restaurant_name: str = "", provider: str = "Google") -> str:
    """
    Convert text to speech using selected provider.

    Args:
        text: Script text to convert
        language: "Korean" or "English"
        restaurant_name: Used for naming the audio file
        provider: "Google" or "Azure"

    Returns:
        Path to generated audio file
    """
    if provider == "Azure":
        return text_to_speech_azure(text, language, restaurant_name)
    
    # Default to Google (existing logic)
    # Fail fast if credentials are missing via env var check logic (kept from original)
    credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")


# ============================================================================
# Video Merger Functions
# ============================================================================

def get_video_files() -> List[str]:
    """Get list of video files from videos directory."""
    if not VIDEOS_DIR.exists():
        return []

    video_files = []
    for ext in ['*.mp4', '*.MP4']:
        video_files.extend(VIDEOS_DIR.glob(ext))

    # Sort by name
    video_files = sorted(list(set([str(f) for f in video_files])))
    return video_files


def get_bgm_files() -> List[str]:
    """Get list of background music files from background music directory."""
    if not BGM_DIR.exists():
        BGM_DIR.mkdir(parents=True, exist_ok=True)
        return []

    bgm_files = []
    for ext in ['*.mp3', '*.MP3', '*.wav', '*.WAV', '*.m4a', '*.M4A']:
        bgm_files.extend(BGM_DIR.glob(ext))

    # Sort by name and return filenames only
    bgm_files = sorted(list(set([f.name for f in bgm_files])))
    return bgm_files


def save_video_selection(selected_videos: List[str]):
    """Save last video selection."""
    try:
        with open(LAST_SELECTION_FILE, 'w', encoding='utf-8') as f:
            json.dump({"selected_videos": selected_videos}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Failed to save video selection: {e}")


def load_video_selection() -> List[str]:
    """Load last video selection."""
    if not LAST_SELECTION_FILE.exists():
        return []

    try:
        with open(LAST_SELECTION_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get("selected_videos", [])
    except Exception as e:
        print(f"Failed to load video selection: {e}")
        return []


def concat_videos(video_paths: List[str], output_path: str, clip_duration: int = 3) -> bool:
    """
    Concatenate multiple videos using ffmpeg, taking only first N seconds of each.

    Args:
        video_paths: List of video file paths
        output_path: Output file path
        clip_duration: Duration in seconds to take from each video (default: 3)

    Returns:
        True if successful, False otherwise
    """
    if not video_paths:
        return False

    # Create temporary directory for clipped videos
    temp_dir = tempfile.mkdtemp()
    clipped_videos = []
    concat_file = None

    try:
        # Clip each video to specified duration
        for i, video_path in enumerate(video_paths):
            clipped_path = os.path.join(temp_dir, f"clip_{i}.mp4")

            # Use ffmpeg to extract first N seconds (remove audio)
            cmd = [
                'ffmpeg',
                '-i', video_path,
                '-t', str(clip_duration),  # Duration
                '-c:v', 'libx264',         # Re-encode video (ensures accurate cutting)
                '-an',                     # Remove audio
                '-y',
                clipped_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                print(f"FFmpeg clip error for {video_path}: {result.stderr}")
                continue

            clipped_videos.append(clipped_path)

        if not clipped_videos:
            return False

        # Create concat file list
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            for clipped_path in clipped_videos:
                f.write(f"file '{clipped_path}'\n")
            concat_file = f.name

        # Concatenate clipped videos
        cmd = [
            'ffmpeg',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file,
            '-c', 'copy',
            '-y',
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"FFmpeg concat error: {result.stderr}")
            return False

        return True

    finally:
        # Cleanup temporary files
        if concat_file and os.path.exists(concat_file):
            os.unlink(concat_file)

        # Remove temporary directory and clipped videos
        for clipped_path in clipped_videos:
            if os.path.exists(clipped_path):
                os.unlink(clipped_path)

        if os.path.exists(temp_dir):
            os.rmdir(temp_dir)


def get_audio_duration(audio_path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    try:
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            audio_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"FFprobe error: {result.stderr}")
            return 0.0

        return float(result.stdout.strip())

    except Exception as e:
        print(f"Error getting audio duration: {e}")
        return 0.0


def get_tts_audio_files() -> List[str]:
    """List saved TTS audio files in the audio directory (sorted by modified time, newest first)."""
    if not TTS_AUDIO_DIR.exists():
        return []
    audio_files = []
    for ext in ['*.mp3', '*.MP3', '*.wav', '*.WAV', '*.m4a', '*.M4A', '*.aac', '*.AAC']:
        audio_files.extend(TTS_AUDIO_DIR.glob(ext))
    # Deduplicate using set (handles case-insensitive file systems returning duplicates for *.ext and *.EXT)
    unique_files = list(set(audio_files))
    audio_files = sorted(unique_files, key=lambda p: p.stat().st_mtime, reverse=True)
    return [p.name for p in audio_files]


def mix_audio_with_bgm(tts_audio_path: str, bgm_path: str, output_path: str, bgm_volume: float = 0.2) -> bool:
    """Mix TTS audio with background music using ffmpeg."""
    try:
        # Mix TTS (full volume) with BGM (reduced volume)
        cmd = [
            'ffmpeg',
            '-i', tts_audio_path,
            '-i', bgm_path,
            '-filter_complex', f'[1:a]volume={bgm_volume}[bg];[0:a][bg]amix=inputs=2:duration=first',
            '-c:a', 'aac',
            '-y',
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"FFmpeg audio mix error: {result.stderr}")
            return False

        return True

    except Exception as e:
        print(f"Error mixing audio with BGM: {e}")
        return False


def merge_video_audio(video_path: str, audio_path: str, output_path: str) -> bool:
    """Merge video with audio using ffmpeg."""
    try:
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-i', audio_path,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',
            '-y',
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"FFmpeg merge error: {result.stderr}")
            return False

        return True

    except Exception as e:
        print(f"Error merging video and audio: {e}")
        return False


def create_shorts(
    selected_videos: List[str],
    audio_files: List[str],
    video_order: str,
    bgm_file: str = None
) -> Tuple[str, List[str]]:
    """Create shorts by merging selected videos with audio files and optional background music."""
    if not selected_videos:
        return "❌ 비디오를 선택해주세요 / Please select videos", []

    if not audio_files:
        return "❌ 오디오 파일을 업로드해주세요 / Please upload audio files", []

    # Parse video order
    try:
        if video_order.strip():
            order_indices = [int(x.strip()) for x in video_order.split(',')]
            if len(order_indices) != len(selected_videos):
                return f"❌ 순서 개수({len(order_indices)})와 선택된 비디오 개수({len(selected_videos)})가 다릅니다", []
            ordered_videos = [selected_videos[i] for i in order_indices]
        else:
            ordered_videos = selected_videos
    except (ValueError, IndexError) as e:
        return f"❌ 순서 형식이 잘못되었습니다: {e}", []

    # Convert filenames to full paths
    video_paths = []
    for video_name in ordered_videos:
        video_path = VIDEOS_DIR / video_name
        if not video_path.exists():
            return f"❌ 비디오 파일을 찾을 수 없습니다: {video_name}", []
        video_paths.append(str(video_path))

    status_msg = ""
    output_videos = []

    # Process each audio file separately
    for i, audio_file in enumerate(audio_files, 1):
        status_msg += f"\n🔊 쇼츠 {i} 생성 중 (오디오: {Path(audio_file).name})...\n"

        # Get audio duration
        audio_duration = get_audio_duration(audio_file)
        if audio_duration <= 0:
            status_msg += f"❌ 오디오 길이를 확인할 수 없습니다\n"
            continue

        status_msg += f"⏱️ 오디오 길이: {audio_duration:.1f}초\n"

        # Calculate clip duration per video
        clip_duration = audio_duration / len(video_paths)
        status_msg += f"🎬 {len(video_paths)}개 비디오 연결 중 (각 {clip_duration:.1f}초)...\n"

        # Concatenate videos with calculated duration
        concat_video_path = OUTPUT_DIR / f"temp_concatenated_{i}.mp4"

        if not concat_videos(video_paths, str(concat_video_path), int(clip_duration) + 1):
            status_msg += "❌ 비디오 연결 실패\n"
            continue

        status_msg += "✅ 비디오 연결 완료\n"

        # Prepare audio (mix with BGM if provided)
        final_audio_path = audio_file
        temp_mixed_audio = None

        if bgm_file and bgm_file != "없음 / None":
            bgm_path = BGM_DIR / bgm_file
            if bgm_path.exists():
                status_msg += f"🎵 배경음악 믹싱 중: {bgm_file}\n"
                temp_mixed_audio = OUTPUT_DIR / f"temp_mixed_audio_{i}.aac"
                if mix_audio_with_bgm(audio_file, str(bgm_path), str(temp_mixed_audio)):
                    final_audio_path = str(temp_mixed_audio)
                    status_msg += "✅ 오디오 믹싱 완료\n"
                else:
                    status_msg += "⚠️ 오디오 믹싱 실패, TTS만 사용\n"

        # Merge with audio
        output_name = f"shorts_{i}.mp4"
        output_path = OUTPUT_DIR / output_name

        if merge_video_audio(str(concat_video_path), final_audio_path, str(output_path)):
            status_msg += f"✅ 쇼츠 {i} 완료: {output_path}\n"
            output_videos.append(str(output_path))
        else:
            status_msg += f"❌ 쇼츠 {i} 생성 실패\n"

        # Clean up temp files
        if concat_video_path.exists():
            concat_video_path.unlink()
        if temp_mixed_audio and temp_mixed_audio.exists():
            temp_mixed_audio.unlink()

    # Save selection
    save_video_selection(selected_videos)

    status_msg += f"\n🎉 총 {len(output_videos)}개 쇼츠 생성 완료!"

    return status_msg, output_videos


# ==================== Video Generation Pipeline ====================

def get_input_images() -> List[str]:
    """Get list of images from input directory."""
    if not INPUT_DIR.exists():
        INPUT_DIR.mkdir(parents=True, exist_ok=True)
        return []

    image_files = []
    for ext in ['*.jpg', '*.jpeg', '*.png', '*.JPG', '*.JPEG', '*.PNG']:
        image_files.extend(INPUT_DIR.glob(ext))

    return sorted(list(set([str(f) for f in image_files])))


class BytePlusVideoClient:
    """Client for BytePlus ModelArk Video API with parallel processing using direct REST API."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://ark.ap-southeast.bytepluses.com/api/v3"
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

    def _pil_to_base64_data_url(self, pil_img: PILImage.Image, format: str = "PNG") -> str:
        """Convert PIL Image to base64 data URL."""
        buffer = io.BytesIO()
        pil_img.save(buffer, format=format)
        buffer.seek(0)
        b64_str = base64.b64encode(buffer.read()).decode("utf-8")
        return f"data:image/{format.lower()};base64,{b64_str}"

    def create_task(self, image: PILImage.Image, prompt: str, model: str = "seedance-1-0-lite-i2v-250428", duration: int = 2) -> str:
        """Create video generation task using REST API."""
        image_data = self._pil_to_base64_data_url(image)

        payload = {
            "model": model,
            "content": [
                {"type": "text", "text": f"{prompt} --ratio 9:16 --dur {duration}"},
                {"type": "image_url", "image_url": {"url": image_data}}
            ]
        }

        try:
            logger.info(f"Creating video task. Model: {model}")
            response = requests.post(
                f"{self.base_url}/contents/generations/tasks",
                headers=self.headers,
                json=payload,
                timeout=60
            )
            response.raise_for_status()
            task_id = response.json()["id"]
            logger.info(f"Task created successfully. ID: {task_id}")
            return task_id
        except Exception as e:
            # Try to get more error info
            error_msg = str(e)
            if hasattr(e, 'response') and e.response:
                try:
                    error_msg += f" Response: {e.response.text}"
                except:
                    pass
            logger.error(f"Video generation task creation failed: {error_msg}")
            raise RuntimeError(f"Video generation task creation failed: {error_msg}")

    def poll_task(self, task_id: str, max_wait: int = 600, poll_interval: int = 10) -> bytes:
        """Poll task until completion and return video bytes using REST API."""
        start_time = time.time()
        logger.info(f"Polling task {task_id}...")

        while time.time() - start_time < max_wait:
            try:
                response = requests.get(
                    f"{self.base_url}/contents/generations/tasks/{task_id}",
                    headers=self.headers,
                    timeout=30
                )
                response.raise_for_status()
                task = response.json()
                
                status = task.get("status")
                logger.debug(f"Task {task_id} status: {status}")

                if status == "succeeded":
                    logger.info(f"Task {task_id} succeeded.")
                    # Extract video URL from task result
                    content = task.get("content")
                    if content:
                        video_url = None
                        # Content is usually a list of dicts in the JSON response
                        items = content if isinstance(content, list) else [content]
                        
                        for item in items:
                            video_url = item.get("video_url") or item.get("url")
                            if video_url:
                                break
                        
                        if not video_url:
                            logger.error(f"No video URL found in task content: {content}")
                            raise ValueError(f"No video URL found in task content: {content}")
                        
                        logger.info(f"Downloading video from: {video_url}")
                        video_response = requests.get(video_url, timeout=60)
                        video_response.raise_for_status()
                        logger.info(f"Video downloaded ({len(video_response.content)} bytes)")
                        return video_response.content
                    else:
                        logger.error(f"Task succeeded but no content found: {task}")
                        raise ValueError(f"Task succeeded but no content found: {task}")

                elif status == "failed":
                    error = task.get("error", {})
                    error_msg = error.get("message", "Unknown error") if isinstance(error, dict) else str(error)
                    logger.error(f"Task {task_id} failed: {error_msg}")
                    raise RuntimeError(f"Task {task_id} failed: {error_msg}")

                time.sleep(poll_interval)
            
            except Exception as e:
                # If it's the last attempt or a fatal error, re-raise
                if time.time() - start_time >= max_wait:
                     logger.error(f"Polling failed fatally: {e}")
                     raise RuntimeError(f"Polling failed: {e}")
                # Otherwise verify if we should continue polling
                logger.warning(f"Poll request failed ({e}), retrying...")
                print(f"Warning: Poll request failed ({e}), retrying...")
                time.sleep(poll_interval)

        raise TimeoutError(f"Task {task_id} did not complete within {max_wait}s")


def run_image_processing(selected_images: List[str], progress=gr.Progress()) -> Tuple[str, List[str]]:
    """Process selected images (3:4 outpainting + people removal)."""
    if not selected_images:
        return "❌ 이미지를 선택해주세요", []

    progress(0, desc="이미지 처리 중...")

    # Import and run nano_banana script functions
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent))
        from nano_banana_byteplus_sdk import process_images

        processed = []
        status_msg = f"🖼️ {len(selected_images)}개 이미지 처리 중...\n\n"

        for i, img_path in enumerate(selected_images):
            progress((i + 1) / len(selected_images), desc=f"처리 중 {i+1}/{len(selected_images)}")
            img_name = Path(img_path).name
            status_msg += f"[{i+1}/{len(selected_images)}] {img_name}...\n"

            # Process image using nano_banana functions
            # This will be implemented by calling the actual processing logic
            processed.append(img_path)

        status_msg += "\n✅ 이미지 처리 완료!"
        return status_msg, processed

    except Exception as e:
        return f"❌ 이미지 처리 실패: {e}", []


# Global stop flag
_stop_video_generation = False

def generate_videos_parallel(image_paths: List[str], model_id: str = "seedance-1-0-lite-i2v-250428", progress=gr.Progress()) -> str:
    """Generate videos from processed images in parallel (creation + polling)."""
    global _stop_video_generation
    _stop_video_generation = False  # Reset flag

    if not image_paths:
        return "❌ 처리된 이미지가 없습니다"

    api_key = os.environ.get("ARK_API_KEY")
    if not api_key:
        return "❌ ARK_API_KEY가 설정되지 않았습니다"

    client = BytePlusVideoClient(api_key)
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

    progress(0, desc="비디오 생성 준비 중...")

    # Video types and prompts
    video_types = [
        ("diagonal_zoom_out", "Camera descends from above with zoom-out effect, dish remains completely static. Use the provided image strictly as the final frame."),
        ("rotate", "Camera rotates 10-15 degrees around the dish, dish must remain completely static. Use the provided image as the final frame."),
        ("zoom", "Camera zooms from 1.0x to 1.2x toward center, dish stays static. Use the provided image as the final frame."),
        ("pan_down", "Camera pans from top to bottom, dish remains static. Use the provided image as the final frame."),
        ("diagonal", "Camera moves diagonally from bottom-left to top-right, dish stays static. Use the provided image as the final frame."),
    ]

    total_tasks = len(image_paths) * len(video_types)
    status_msg = f"🎬 {len(image_paths)}개 이미지에서 각 5개 비디오 생성 중 (총 {total_tasks}개)... 병렬 처리 시작\n\n"

    def process_single_video(img_path, vid_type, prompt):
        img_name = Path(img_path).stem
        if _stop_video_generation:
            return f"⚠️ {img_name}_{vid_type}: 중지됨 (시작 전)"
        
        try:
            # 1. Load Image
            img = PILImage.open(img_path).convert("RGB")
            
            # 2. Create Task
            logger.info(f"Starting {img_name}_{vid_type}")
            try:
                task_id = client.create_task(img, prompt, model=model_id, duration=2)
            except Exception as e:
                 return f"❌ {img_name}_{vid_type} 생성 요청 실패: {e}"

            if _stop_video_generation:
                return f"⚠️ {img_name}_{vid_type}: 중지됨 (요청 후)"

            # 3. Poll Task
            video_bytes = client.poll_task(task_id)
            
            if _stop_video_generation:
                return f"⚠️ {img_name}_{vid_type}: 중지됨 (완료 후 저장 안함)"

            # 4. Save Video
            output_path = VIDEOS_DIR / f"{img_name}_{vid_type}.mp4"
            with open(output_path, "wb") as f:
                f.write(video_bytes)
            
            return f"✅ {img_name}_{vid_type}.mp4"

        except Exception as e:
            logger.error(f"Failed {img_name}_{vid_type}: {e}")
            return f"❌ {img_name}_{vid_type}: {e}"

    # Submit all tasks
    completed = 0
    with ThreadPoolExecutor(max_workers=10) as executor:
        # Create futures
        futures = []
        for img_path in image_paths:
            for vid_type, prompt in video_types:
                futures.append(executor.submit(process_single_video, img_path, vid_type, prompt))
        
        progress(0.1, desc=f"모든 작업 요청 시작... (0/{total_tasks})")

        # Process as they complete
        for future in as_completed(futures):
            if _stop_video_generation:
                status_msg += "\n⚠️ 사용자가 중지했습니다.\n"
                executor.shutdown(wait=False, cancel_futures=True)
                break

            result = future.result()
            status_msg += f"{result}\n"
            completed += 1
            progress(0.1 + 0.9 * completed / total_tasks, desc=f"완료됨: {completed}/{total_tasks}")

    if _stop_video_generation:
        status_msg += f"\n⚠️ 중지됨! (완료: {completed}/{total_tasks}개)"
    else:
        status_msg += f"\n🎉 비디오 생성 완료! (총 {completed}개)"

    return status_msg


def stop_video_generation() -> str:
    """Stop the video generation process."""
    global _stop_video_generation
    _stop_video_generation = True
    return "⏹️ 중지 신호를 보냈습니다. 현재 진행 중인 작업이 완료되면 멈춥니다..."


class YouTubeShortsScriptGenerator:
    """YouTube Shorts script generator using Google Gemini."""

    def __init__(self, api_key: str, generation_timeout: int = GENERATION_TIMEOUT):
        """Initialize Gemini API client."""
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.5-flash')
        self.generation_timeout = generation_timeout

    def generate_script(
        self,
        restaurant_name: str,
        description: str,
        style: str,
        language: str,
        intro_style: str = "직설적 소개형",
        outro_style: str = "추천형",
        location: str = "",
        location_in: str = "intro",
        include_restaurant_name: bool = True,
        return_prompt: bool = False
    ):
        """
        Generate YouTube Shorts script.

        Args:
            restaurant_name: Name of the restaurant
            description: Combined description, strengths, and reviews
            style: Script style (e.g., "Review", "Promotional")
            language: "Korean" or "English"
            intro_style: Intro style (default: "직설적 소개형")
            outro_style: Outro style (default: "추천형")
            location: Restaurant location (default: "")
            location_in: Where to include location - "intro" or "outro" (default: "intro")

        Returns:
            Generated script text (or tuple of text and prompt when return_prompt=True)
        """
        # Build prompt based on language
        if language == "Korean":
            prompt = self._build_korean_prompt(restaurant_name, description, style, intro_style, outro_style, location, location_in, include_restaurant_name)
        else:
            prompt = self._build_english_prompt(restaurant_name, description, style, intro_style, outro_style, location, location_in, include_restaurant_name)

        # Generate script using Gemini with timeout to prevent infinite hangs
        try:
            response = self.model.generate_content(
                prompt,
                request_options={"timeout": self.generation_timeout}
            )
            if return_prompt:
                return response.text, prompt
            return response.text
        except Exception as e:
            raise RuntimeError(f"Gemini 요청 실패: {e}") from e

    def _build_korean_prompt(self, restaurant_name: str, description: str, style: str, intro_style: str, outro_style: str, location: str = "", location_in: str = "intro", include_restaurant_name: bool = True) -> str:
        """Build Korean prompt for Gemini."""
        # Get intro/outro descriptions
        intro_desc = INTRO_STYLES.get(intro_style, {}).get("description", "")
        outro_desc = OUTRO_STYLES.get(outro_style, {}).get("description", "")

        # Build location instruction
        location_instruction = ""
        if location:
            if location_in == "intro":
                location_instruction = f"""
**매장 위치 정보 (필수):**
- 위치: {location}
- **중요**: 인트로에서 반드시 위치를 자연스럽게 언급해야 합니다.
- 예시: "오늘은 {location}에 있는 {restaurant_name if include_restaurant_name else '이곳'}에 다녀왔는데요..", "{location}에서 찾은 숨은 맛집..", "이번에 {location}에 갔다가 발견한.."
- 인트로 스타일({intro_style})에 맞게 자연스럽게 위치 정보를 녹여내세요. 특별히 '{intro_style}'인 경우 위치와 가게 이름을 인트로 첫 문장에 바로 언급하세요."""
            else:  # outro
                location_instruction = f"""
**매장 위치 정보 (필수):**
- 위치: {location}
- **중요**: 아웃트로에서 반드시 위치를 자연스럽게 언급해야 합니다.
- 예시: "{location}에 40년 전통을 이어가는 이곳은?", "{location}에서 꼭 가봐야 할 맛집은?", "{location} 맛집 찾는다면 바로 여기"
- 아웃트로 스타일({outro_style})에 맞게 자연스럽게 위치 정보를 녹여내세요."""

        return f"""당신은 유튜브 쇼츠 전문 대본 작가입니다. 다음 정보를 바탕으로 영상 제목과 35-50초 분량의 쇼츠 대본을 작성해주세요.

**식당 정보:**
- 가게 이름: {restaurant_name if include_restaurant_name else "비공개 (대본/제목에 언급 금지)"}
- 식당 상세 설명 (장점, 리뷰 등 포함 가능): 
{description}
{location_instruction}

**대본 스타일:** {style}

**인트로 스타일:** {intro_style}
- {intro_desc}

**아웃트로 스타일:** {outro_style}
- {outro_desc}

**작성 가이드라인:**

1. 제목 작성:
   - 클릭을 유도하는 임팩트 있는 제목
   - 20-30자 내외
   - 호기심을 자극하는 표현 사용
   - 예: "택시기사님들도 인정하는 고양 돈까스 찐맛집"

2. 대본 분량: 35-50초에 맞게 작성 (약 150-170자 내외, 공백 제외)
   - 구체적인 디테일을 포함하되 장황하지 않게
   - 핵심 경험을 생동감 있게 전달

3. 말투: 자연스러운 일상 대화체 구어체
   - "~했는데", "~하더라고요", "~습니다", "~길래", "~인지", "~하면가" 같은 자연스러운 표현 사용
   - 실제 사람이 말하듯이 편안하고 친근한 톤

4. 내용: 세부적이고 구체적인 경험 묘사
   - 단순 나열이 아닌 디테일한 설명
   - 실제 방문 경험처럼 생동감 있게
   - 구체적인 크기, 맛, 느낌 등 디테일 포함

5. {style} 스타일에 맞게 작성

6. 대본 구조:
   - **인트로**: {intro_style} 스타일로 시작하여 시청자의 주의를 끌기
   - **본문**: 핵심 경험과 장점을 구체적으로 전달
   - **아웃트로**: {outro_style} 스타일로 마무리하여 강한 인상 남기기

7. 영상과 함께 나레이션될 것을 고려

8. 이모지나 특수문자 사용하지 않기

{"9. 가게 이름을 제목/대본 중 한 곳에 정확히 1번만 자연스럽게 넣을 것 (제목에 쓰면 대본에서는 쓰지 말고, 제목에 안 쓰면 대본에서 1번 언급)" if include_restaurant_name else "9. 가게 이름을 제목/대본에 직접 언급하지 말 것"}

**예시 말투 (161자):**
"고양시 택시 기사님들이 1등으로 뽑는다는 돈가스 맛집입니다. 사이즈가 사람 얼굴보다 훨씬 크길래 두께는 얇게 찌했는데 두께도 적당히 두껍고 기름도 좋은 거 쓰는지 기름 냄새 1일도 안 나고 깔끔하게 바삭하고 맛있습니다. 수제 소스도 훌륭하고 셀프바에서 밥이랑 스프 반찬들까지 전부 무한인 것도 좋더라고요."

**출력 형식 (반드시 이 형식을 따라주세요):**
제목: [여기에 제목 작성]

대본: [여기에 대본 작성]

**설명이나 주석은 불필요합니다. 위 형식대로만 작성해주세요.**"""

    def _build_english_prompt(self, restaurant_name: str, description: str, style: str, intro_style: str, outro_style: str, location: str = "", location_in: str = "intro", include_restaurant_name: bool = True) -> str:
        """Build English prompt for Gemini."""
        # Get intro/outro descriptions (use English version)
        intro_desc = INTRO_STYLES.get(intro_style, {}).get("description", "")
        outro_desc = OUTRO_STYLES.get(outro_style, {}).get("description", "")
        intro_eng = INTRO_STYLES.get(intro_style, {}).get("english", intro_style)
        outro_eng = OUTRO_STYLES.get(outro_style, {}).get("english", outro_style)

        # Build location instruction
        location_instruction = ""
        if location:
            if location_in == "intro":
                location_instruction = f"""
**Restaurant Location (REQUIRED):**
- Location: {location}
- **IMPORTANT**: You MUST naturally mention the location in the intro.
- Examples: "Today I visited this amazing restaurant in {location}...", "Found this hidden gem in {location}...", "Went to {location} and discovered..."
- Blend the location naturally into the {intro_eng} style."""
            else:  # outro
                location_instruction = f"""
**Restaurant Location (REQUIRED):**
- Location: {location}
- **IMPORTANT**: You MUST naturally mention the location in the outro.
- Examples: "This 40-year tradition continues in {location}, where is it?", "Must-visit spot in {location}?", "If you're looking for great food in {location}, this is it"
- Blend the location naturally into the {outro_eng} style."""

        return f"""You are a professional YouTube Shorts scriptwriter. Create a video title and 35-50 second script based on the following information.

**Restaurant Information:**
- Restaurant Name: {restaurant_name if include_restaurant_name else "Hidden (DO NOT mention name in title/script)"}
- Restaurant Description (detailed features, strengths, reviews):
{description}
{location_instruction}

**Script Style:** {style}

**Intro Style:** {intro_eng}
- {intro_desc}

**Outro Style:** {outro_eng}
- {outro_desc}

**Writing Guidelines:**

1. Title:
   - Create an attention-grabbing, click-worthy title
   - 10-15 words max
   - Use curiosity-inducing language
   - Example: "Taxi Drivers' #1 Pick: The Best Tonkatsu in Town"

2. Script Duration: 35-50 seconds (approximately 100-130 words)
   - Include specific details but stay focused
   - Deliver the core experience vividly

3. Tone: Natural, conversational, casual speech
   - Use everyday language like "so", "actually", "you know", "I mean"
   - Sound like a real person talking to a friend
   - Relaxed and authentic voice

4. Content: Detailed and specific descriptions
   - Include specific details about size, taste, atmosphere
   - Paint a vivid picture with concrete examples
   - Share personal observations and experiences

5. Match the {style} style

6. Script Structure:
   - **Intro**: Use {intro_eng} style to grab viewer's attention
   - **Body**: Deliver core experience and strengths in detail
   - **Outro**: End with {outro_eng} style for strong impression

7. Consider this will be narrated over video

8. No emojis or special characters

{"9. Include the restaurant name exactly once across title+script (if allowed): if used in the title, do NOT repeat it in the script; if not in the title, mention it once in the script." if include_restaurant_name else "9. Do NOT mention the restaurant name in the title or script."}

**Example tone:**
"This is the tonkatsu place that Goyang taxi drivers voted number one. The portion size was way bigger than I expected - like, seriously huge compared to my face. I thought it would be thin, but it was actually pretty thick and crispy. The oil they use must be really good quality because there's zero greasy smell, and everything tastes so fresh and clean. The homemade sauce is excellent, and the self-service bar with unlimited rice, soup, and side dishes is a great touch."

**Output Format (You must follow this format):**
Title: [Your title here]

Script: [Your script here]

**No explanations or annotations needed. Follow the format above.**"""

    def generate_multiple_scripts(
        self,
        restaurant_name: str,
        description: str,
        styles: List[str],
        language: str,
        intro_style: str = "직설적 소개형",
        outro_style: str = "추천형"
    ) -> Dict[str, str]:
        """Generate scripts for multiple styles."""
        scripts = {}
        for style in styles:
            script = self.generate_script(
                restaurant_name, description, style, language,
                intro_style, outro_style
            )
            scripts[style] = script
        return scripts


def create_gradio_interface():
    """Create Gradio UI for script generation and shorts merging."""

    # Initialize API key
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set. Please add it to .env file")

    generator = YouTubeShortsScriptGenerator(api_key)

    def generate_scripts_ui(
        restaurant_name: str,
        description: str,
        selected_styles: List[str],
        language: str,
        intro_style: str,
        outro_style: str,
        location: str,
        location_in: str,
        include_restaurant_name: bool,
        tts_provider: str = "Google",
        progress=gr.Progress(track_tqdm=True)
    ):
        """Generate scripts based on UI inputs with progress updates."""
        print(f"[DEBUG] UI Request - Provider: {tts_provider}, Language: {language}")

        status_lines = []
        current_output = ""
        audios = [None] * 7
        audio_list_state = []

        def trunc(text: str, length: int = 180) -> str:
            if text is None:
                return ""
            return text if len(text) <= length else text[:length] + "..."

        def push_status(msg: str):
            status_lines.append(msg)
            # Keep last 20 lines to avoid overflow
            return "\n".join(status_lines[-20:])

        def make_return(status_msg, output_text=None, audio_paths=None, audio_state=None):
            nonlocal current_output, audios, audio_list_state
            if output_text is not None:
                current_output = output_text
            if audio_paths is not None:
                audios = (audio_paths + [None] * 7)[:7]
            if audio_state is not None:
                audio_list_state = audio_state
            # Force multiline display by keeping newline-separated log text
            return (status_msg, current_output, *audios, audio_list_state)

        if not restaurant_name or not description:
            return make_return("❌ 필수 필드를 입력해주세요 (가게 이름, 식당 설명) / Please fill in required fields (Name, Description)")

        if not selected_styles:
            return make_return("❌ 최소 1개 이상의 스타일을 선택해주세요 / Please select at least 1 style")

        # Initial status update so UI shows "in progress"
        yield make_return(push_status("🚀 대본 생성 시작 / Starting script generation..."))

        # Get style keys from selected style names
        style_keys = []
        for style_name in selected_styles:
            for key, value in SCRIPT_STYLES.items():
                if key == style_name:
                    if language == "Korean":
                        style_keys.append(value["korean"])
                    else:
                        style_keys.append(value["english"])
                    break

        # Generate scripts
        try:
            total = len(style_keys)
            scripts = {}
            script_contents = {}  # Store only script content for TTS

            # Generate each script
            for idx, style in enumerate(style_keys, start=1):
                progress(idx / max(total, 1), desc=f"생성 중 {idx}/{total}")
                status_msg = push_status(f"→ [{idx}/{total}] Gemini 요청 준비: 스타일={style}, 언어={language}, 인트로={intro_style}, 아웃트로={outro_style}, 위치={'있음' if location else '없음'}")
                yield make_return(status_msg)

                try:
                    script_resp, prompt_text = generator.generate_script(
                        restaurant_name, description, style, language,
                        intro_style, outro_style, location, location_in, include_restaurant_name,
                        return_prompt=True
                    )
                except Exception as e:
                    status_msg = push_status(f"❌ [{idx}/{total}] Gemini 오류: {e}")
                    yield make_return(status_msg)
                    return make_return(status_msg)

                status_msg = push_status(
                    f"← [{idx}/{total}] Gemini 응답 수신 (프롬프트 {len(prompt_text)}자, 응답 {len(script_resp or '')}자)"
                )
                yield make_return(status_msg)

                scripts[style] = script_resp

                # Extract script content only (without title)
                script_content = script_resp
                if "제목:" in script_resp or "Title:" in script_resp:
                    lines = script_resp.strip().split('\n')
                    for j, line in enumerate(lines):
                        if line.startswith("대본:") or line.startswith("Script:"):
                            script_content = '\n'.join(lines[j:]).split(":", 1)[1].strip()
                            break
                script_contents[style] = script_content

            # Save last input on success
            save_last_input(restaurant_name, description, selected_styles, language,
                          intro_style, outro_style, location, location_in, include_restaurant_name)

            status_msg = push_status("📦 대본 포맷팅...")
            yield make_return(status_msg)

            # Format final output
            output = f"# 생성된 대본 / Generated Scripts\n\n"
            output += f"**가게 이름 / Restaurant:** {restaurant_name}\n\n"
            output += "---\n\n"

            for i, (style, script) in enumerate(scripts.items(), 1):
                output += f"## 스타일 {i}: {style}\n\n"

                # Parse title and script
                title = ""
                script_content = script

                if "제목:" in script or "Title:" in script:
                    lines = script.strip().split('\n')
                    for j, line in enumerate(lines):
                        if line.startswith("제목:") or line.startswith("Title:"):
                            title = line.split(":", 1)[1].strip()
                        elif line.startswith("대본:") or line.startswith("Script:"):
                            script_content = '\n'.join(lines[j:]).split(":", 1)[1].strip()
                            break

                if title:
                    output += f"**제목 / Title:**\n{title}\n\n"
                    output += f"**대본 / Script:**\n{script_content}\n\n"
                else:
                    output += f"{script_resp}\n\n"

                output += "---\n\n"

            # Generate TTS audio for each script (max 7)
            audios = [None] * 7
            audio_list = []  # Store non-None audio paths for merger tab
            for i, (style, script_content) in enumerate(script_contents.items()):
                if i < 7:  # Maximum 7 audio outputs
                    status_msg = push_status(f"🔊 TTS 생성 중 (스타일 {i+1}/{len(script_contents)}): {style} [{tts_provider}]")
                    yield make_return(status_msg, output, audios, audio_list)

                    audio_path = text_to_speech(script_content, language, restaurant_name, provider=tts_provider)
                    audios[i] = audio_path
                    if audio_path:
                        audio_list.append(audio_path)
                        status_msg = push_status(f"✅ TTS 완료: {Path(audio_path).name}")
                    else:
                        status_msg = push_status("⚠️ TTS 생성 실패 (로그 확인)")
                    yield make_return(status_msg, output, audios, audio_list)

            # Save last output for persistence
            save_last_output(output, audios)

            status_msg = push_status(f"✅ 대본 {len(script_contents)}개 생성 완료")
            return make_return(status_msg, output, audios, audio_list)
        except Exception as e:
            status_msg = push_status(f"❌ 오류 발생 / Error occurred: {str(e)}")
            return make_return(status_msg, current_output, audios, audio_list_state)

    # Load last input to prefill form
    last_input = load_last_input()

    # Get video files for merger tab
    video_files = get_video_files()
    video_names = [Path(v).name for v in video_files]
    last_video_selection = load_video_selection()

    # Custom CSS for the UI
    custom_css = """
    .order-display {
        min-width: 70px !important;
        max-width: 70px !important;
        margin-right: 15px !important;
        background: transparent !important;
    }
    .order-display input {
        background-color: #FF4343 !important;
        color: white !important;
        border-radius: 50% !important;
        width: 60px !important;
        height: 60px !important;
        font-size: 32px !important;
        font-weight: 900 !important;
        text-align: center !important;
        border: 3px solid white !important;
        box-shadow: 0 4px 15px rgba(255, 67, 67, 0.4) !important;
        padding: 0 !important;
        cursor: pointer !important;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    .order-display input:focus {
        background-color: #D32F2F !important;
        box-shadow: 0 0 0 4px rgba(255, 67, 67, 0.3) !important;
        transform: scale(1.1);
        outline: none !important;
    }
    .order-display input:hover {
        background-color: #FF5252 !important;
        transform: translateY(-2px);
    }
    .order-display div {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
    }
    """

    # Create Gradio interface
    with gr.Blocks(title="YouTube Shorts Creator", css=custom_css) as demo:
        gr.Markdown("""
        # 🎬 유튜브 쇼츠 크리에이터 / YouTube Shorts Creator

        대본 생성부터 비디오 병합까지 한 곳에서!

        From script generation to video merging - all in one place!
        """)

        # State to store generated audio paths
        generated_audios = gr.State(value=[])
        # State to store selected videos in order
        selection_order_state = gr.State(value=last_video_selection if last_video_selection else [])

        with gr.Tabs():
            # Tab 1: Video Generation
            with gr.Tab("🎥 비디오 생성 / Video Generation"):
                gr.Markdown("""
                input 폴더의 이미지를 선택하여 자동으로 비디오를 생성합니다.

                Select images from input folder to automatically generate videos.
                """)

                # State for input images and ordered selections
                input_images_state = gr.State(value=get_input_images())
                image_selections_state = gr.State(value=[]) # List of selected image paths in order

                def refresh_images():
                    """Re-scan input folder for images."""
                    new_images = get_input_images()
                    print(f"[DEBUG] Refreshing images. Found: {len(new_images)}")
                    return new_images, [] # Clear selections on refresh

                def image_checkbox_change(img_path, is_checked, current_order):
                    """Update ordered selection when a checkbox is toggled."""
                    new_order = list(current_order)
                    if is_checked:
                        if img_path not in new_order:
                            new_order.append(img_path)
                    else:
                        if img_path in new_order:
                            new_order.remove(img_path)
                    return new_order

                def image_order_submit(img_path, new_val, current_order):
                    """Handle manual order number changes with swap logic for images."""
                    if not new_val or not str(new_val).isdigit():
                        return list(current_order)
                    
                    new_pos = int(new_val)
                    new_order = list(current_order)
                    if img_path not in new_order:
                        new_order.append(img_path)
                        
                    old_idx = new_order.index(img_path)
                    new_idx = new_pos - 1
                    
                    if 0 <= new_idx < len(new_order):
                        new_order[old_idx], new_order[new_idx] = new_order[new_idx], new_order[old_idx]
                    
                    return new_order

                with gr.Row():
                    with gr.Column(scale=4):
                        with gr.Row():
                            gr.Markdown(f"### 📁 이미지 선택 / Select Images")
                            refresh_img_btn = gr.Button("🔄 최신화 / Refresh", size="sm", variant="secondary")

                        @gr.render(inputs=[input_images_state, image_selections_state])
                        def render_image_gallery(images, current_order):
                            image_names = [Path(img).name for img in images]
                            if len(images) > 0:
                                gr.Markdown(f"*📱 처리할 이미지를 선택하세요 ({len(images)}개) / Select images to process*")
                                
                                num_images = len(images)
                                images_per_row = 3
                                
                                for row_start in range(0, num_images, images_per_row):
                                    with gr.Row():
                                        for col in range(images_per_row):
                                            i = row_start + col
                                            if i < num_images:
                                                img_path = images[i]
                                                with gr.Column(scale=1, min_width=200):
                                                    gr.Image(
                                                        value=img_path,
                                                        label=None,
                                                        interactive=False,
                                                        height=280,
                                                        show_label=False
                                                    )
                                                    with gr.Row():
                                                        order_val = str(current_order.index(img_path) + 1) if img_path in current_order else ""
                                                        order_display = gr.Textbox(
                                                            value=order_val,
                                                            label=None,
                                                            container=False,
                                                            elem_classes=["order-display"],
                                                            interactive=True
                                                        )
                                                        checkbox = gr.Checkbox(
                                                            label=f"{image_names[i][:22]}..." if len(image_names[i]) > 22 else f"{image_names[i]}",
                                                            value=img_path in current_order,
                                                            container=False
                                                        )
                                                        
                                                        checkbox.change(
                                                            fn=image_checkbox_change,
                                                            inputs=[gr.State(img_path), checkbox, image_selections_state],
                                                            outputs=[image_selections_state]
                                                        )
                                                        order_display.submit(
                                                            fn=image_order_submit,
                                                            inputs=[gr.State(img_path), order_display, image_selections_state],
                                                            outputs=[image_selections_state]
                                                        )
                                            else:
                                                with gr.Column(scale=1, min_width=200):
                                                    pass
                            else:
                                gr.Markdown("⚠️ **input 폴더가 비어있습니다!** 이미지를 추가한 후 최신화 버튼을 누르세요.")

                        refresh_img_btn.click(
                            fn=refresh_images,
                            outputs=[input_images_state, image_selections_state]
                        )

                    with gr.Column(scale=1, min_width=250):
                        gr.Markdown("### ⚙️ 설정 / Settings")

                        gr.Markdown("#### 📋 파이프라인 단계")
                        gr.Markdown("""
                        1. **이미지 처리**: 3:4 비율 변환 + 인물 제거
                        2. **비디오 생성**: 5가지 카메라 움직임 (병렬 처리)
                        3. **속도 조절**: 0.8배속으로 슬로우 모션
                        """)

                        gr.Markdown("#### ⚙️ 파라미터 / Parameters")
                        model_selection = gr.Dropdown(
                            label="비디오 모델 / Video Model",
                            choices=[
                                ("Lite (Fast)", "seedance-1-0-lite-i2v-250428"),
                                ("Pro (High Quality)", "seedance-1-0-pro-250528")
                            ],
                            value="seedance-1-0-lite-i2v-250428",
                            info="Lite는 빠르고 저렴하며, Pro는 더 높은 품질의 영상을 생성합니다."
                        )

                        generate_pipeline_btn = gr.Button("🚀 비디오 생성 시작 / Start Pipeline", variant="primary", size="lg")
                        stop_pipeline_btn = gr.Button("⏹️ 중지 / Stop", variant="stop", size="lg")

                        gr.Markdown("---")

                        gr.Markdown("### 📊 진행 상황 / Progress")
                        pipeline_status = gr.Textbox(
                            label="상태 / Status",
                            lines=15,
                            interactive=False,
                            placeholder="파이프라인을 시작하려면 위의 버튼을 클릭하세요..."
                        )

                        gr.Markdown("### 💡 설명 / Info")
                        gr.Markdown("""
                        **비디오 유형** (각 이미지마다 5개 생성):
                        1. diagonal_zoom_out - 위에서 줌아웃
                        2. rotate - 회전 (10-15도)
                        3. zoom - 줌 (1.0x → 1.2x)
                        4. pan_down - 위에서 아래로
                        5. diagonal - 대각선 이동

                        **병렬 처리**: 모든 비디오를 동시에 생성하여 시간 단축!
                        **출력 폴더**: `videos/`
                        """)

                # Pipeline execution handler
                def run_pipeline_handler(model_id, current_order):
                    """Run the full video generation pipeline."""
                    # Use current_order directly from state
                    if not current_order:
                        return "❌ 이미지를 선택해주세요 / Please select images"

                    # For now, just run video generation (skip image processing step)
                    status = generate_videos_parallel(current_order, model_id=model_id)

                    return status

                generate_pipeline_btn.click(
                    fn=run_pipeline_handler,
                    inputs=[model_selection, image_selections_state],
                    outputs=[pipeline_status]
                )
                stop_pipeline_btn.click(
                    fn=stop_video_generation,
                    inputs=None,
                    outputs=[pipeline_status]
                )

            # Tab 2: Script Generator
            with gr.Tab("📝 대본 생성 / Script Generator"):
                gr.Markdown("""
                식당 정보를 입력하면 영상 제목과 35-50초 분량의 쇼츠 대본을 자동으로 생성합니다.

                Enter restaurant information to generate video title and 35-50 second YouTube Shorts scripts.
                """)

                with gr.Row():
                    with gr.Column():
                        gr.Markdown("### 📝 입력 정보 / Input Information")

                        restaurant_name = gr.Textbox(
                            label="가게 이름 / Restaurant Name",
                            placeholder="예: 할매순대국 / Example: Grandma's Soondae Soup",
                            lines=1,
                            value=last_input.get("restaurant_name", "")
                        )

                        description = gr.Textbox(
                            label="식당 상세 설명 / Restaurant Description",
                            placeholder="식당에 대한 모든 정보를 입력해주세요 (예: 40년 전통의 순대국 전문점. 진한 국물과 푸짐한 양이 장점이며, '인생 순대국'이라는 리뷰가 많음).",
                            lines=10,
                            value=last_input.get("description", "")
                        )

                        include_restaurant_name = gr.Checkbox(
                            label="대본에 가게 이름 포함 / Include restaurant name in title & script",
                            value=last_input.get("include_restaurant_name", True)
                        )

                        language = gr.Radio(
                            choices=["Korean", "English"],
                            value=last_input.get("language", "Korean"),
                            label="언어 / Language"
                        )
                        
                        tts_provider = gr.Radio(
                            choices=["Google", "Azure"],
                            value="Google",
                            label="TTS 서비스 / TTS Provider",
                            info="Google: Algenib (남) / Azure: Hyunsu (남)",
                            interactive=True
                        )

                        style_choices = list(SCRIPT_STYLES.keys())
                        selected_styles = gr.CheckboxGroup(
                            choices=style_choices,
                            value=last_input.get("selected_styles", [style_choices[0], style_choices[1]]),
                            label="스크립트 스타일 선택 / Select Script Styles (최소 1개 / min 1)",
                        )

                        # Intro/Outro style selection
                        gr.Markdown("### 🎭 인트로/아웃트로 스타일 / Intro/Outro Styles")

                        intro_choices = list(INTRO_STYLES.keys())
                        intro_style = gr.Dropdown(
                            choices=intro_choices,
                            value=last_input.get("intro_style", "직설적 소개형"),
                            label="인트로 스타일 / Intro Style"
                        )

                        outro_choices = list(OUTRO_STYLES.keys())
                        outro_style = gr.Dropdown(
                            choices=outro_choices,
                            value=last_input.get("outro_style", "추천형"),
                            label="아웃트로 스타일 / Outro Style"
                        )

                        # Location settings
                        gr.Markdown("### 📍 매장 위치 정보 / Location Information")
                        gr.Markdown("*위치 정보를 입력하면 인트로 또는 아웃트로에 자연스럽게 포함됩니다*")

                        location = gr.Textbox(
                            label="매장 위치 / Location",
                            placeholder="예: 성수동, 강남역, 홍대입구 / Example: Seongsu-dong, Gangnam Station",
                            lines=1,
                            value=last_input.get("location", "")
                        )

                        location_in = gr.Radio(
                            choices=["intro", "outro"],
                            value=last_input.get("location_in", "intro"),
                            label="위치 정보 포함 위치 / Include Location In",
                            info="인트로: 영상 시작 부분 / 아웃트로: 영상 마무리 부분"
                        )

                        # Show style descriptions
                        gr.Markdown("### 📚 스타일 설명 / Style Descriptions")

                        gr.Markdown("**대본 스타일 / Script Styles:**")
                        for style_name, style_info in SCRIPT_STYLES.items():
                            gr.Markdown(f"- **{style_name}**: {style_info['description']}")

                        gr.Markdown("**인트로 스타일 / Intro Styles:**")
                        for intro_name, intro_info in INTRO_STYLES.items():
                            gr.Markdown(f"- **{intro_name}**: {intro_info['description']}")

                        gr.Markdown("**아웃트로 스타일 / Outro Styles:**")
                        for outro_name, outro_info in OUTRO_STYLES.items():
                            gr.Markdown(f"- **{outro_name}**: {outro_info['description']}")

                        generate_btn = gr.Button("🎬 대본 생성 / Generate Scripts", variant="primary", size="lg")

                    with gr.Column():
                        script_status = gr.Textbox(
                            label="상태 / Status",
                            value="대기 중 / Idle",
                            interactive=False,
                            lines=12
                        )
                        gr.Markdown("### 📄 생성된 대본 / Generated Scripts")
                        output = gr.Markdown(label="Output")

                        gr.Markdown("### 🔊 오디오 미리듣기 / Audio Preview")
                        gr.Markdown("*대본 내용만 음성으로 변환됩니다 / Only script content is converted to speech*")
                        # Keep audio players visible so returned filepaths render immediately
                        audio1 = gr.Audio(label="스타일 1 / Style 1", type="filepath", visible=True, interactive=False)
                        audio2 = gr.Audio(label="스타일 2 / Style 2", type="filepath", visible=True, interactive=False)
                        audio3 = gr.Audio(label="스타일 3 / Style 3", type="filepath", visible=True, interactive=False)
                        audio4 = gr.Audio(label="스타일 4 / Style 4", type="filepath", visible=True, interactive=False)
                        audio5 = gr.Audio(label="스타일 5 / Style 5", type="filepath", visible=True, interactive=False)
                        audio6 = gr.Audio(label="스타일 6 / Style 6", type="filepath", visible=True, interactive=False)
                        audio7 = gr.Audio(label="스타일 7 / Style 7", type="filepath", visible=True, interactive=False)

                generate_btn.click(
                    fn=generate_scripts_ui,
                    inputs=[
                    restaurant_name, description, selected_styles, language,
                    intro_style, outro_style, location, location_in, include_restaurant_name,
                    tts_provider
                ],
                    outputs=[script_status, output, audio1, audio2, audio3, audio4, audio5, audio6, audio7, generated_audios]
                )

                # Examples
                gr.Markdown("### 💡 예시 / Examples")
                gr.Examples(
                    examples=[
                        ["할매순대국", "40년 전통의 순대국 전문점. 진한 국물, 푸짐한 양, 24시간 영업. 국물이 진짜 진하고 맛있다는 리뷰가 많음.", True, "Korean", ["리뷰형 (Review)", "홍보형 (Promotional)"]],
                        ["Grandma's Soondae Soup", "40-year traditional Korean soup restaurant. Rich broth, generous portions, 24/7 open. Many customers recommend the pork belly.", True, "English", ["리뷰형 (Review)", "팁/추천형 (Tips)"]],
                        ["이태리 정원", "정통 이탈리안 파스타와 피자 레스토랑. 수제 파스타, 화덕 피자, 와인 페어링. 분위기가 좋고 데이트 코스로 최고라는 평.", True, "Korean", ["스토리텔링형 (Storytelling)", "비교형 (Comparison)"]],
                    ],
                    inputs=[restaurant_name, description, include_restaurant_name, language, selected_styles]
                )

            # Tab 3: Shorts Merger
            with gr.Tab("🎬 쇼츠 병합 / Shorts Merger"):
                gr.Markdown("""
                비디오를 미리보면서 선택하고 오디오와 병합하여 최종 쇼츠를 생성합니다.

                Preview and select videos, then merge them with audio files to create final shorts.
                """)

                # Tab 3 State
                video_files_state = gr.State(value=get_video_files())

                def refresh_videos(current_order):
                    """Re-scan videos folder and prune selection."""
                    new_videos = get_video_files()
                    print(f"[DEBUG] Refreshing videos. Found: {len(new_videos)}")
                    # Keep selected videos that still exist
                    new_order = [v for v in current_order if (VIDEOS_DIR / v).exists()]
                    return new_videos, list(new_order)

                def merger_checkbox_change(video_name, is_checked, current_order):
                    """Update selection order when a checkbox is toggled."""
                    new_order = list(current_order)
                    if is_checked:
                        if video_name not in new_order:
                            new_order.append(video_name)
                    else:
                        if video_name in new_order:
                            new_order.remove(video_name)
                    return new_order

                def merger_order_submit(video_name, new_val, current_order):
                    """Handle manual order number changes with swap logic."""
                    if not new_val or not str(new_val).isdigit():
                        return list(current_order)
                    
                    new_pos = int(new_val)
                    new_order = list(current_order)
                    if video_name not in new_order:
                        new_order.append(video_name)
                        
                    old_idx = new_order.index(video_name)
                    new_idx = new_pos - 1
                    
                    if 0 <= new_idx < len(new_order):
                        new_order[old_idx], new_order[new_idx] = new_order[new_idx], new_order[old_idx]
                    
                    return new_order

                with gr.Row():
                    with gr.Column(scale=4):
                        with gr.Row():
                            gr.Markdown(f"### 📹 비디오 갤러리 / Video Gallery")
                            refresh_video_btn = gr.Button("🔄 최신화 / Refresh", size="sm", variant="secondary")
                        
                        gr.Markdown("*📱 비디오를 탭하여 선택/해제하세요 (선택 순서가 표시됩니다) / Tap videos to select/deselect (selection order will be shown)*")

                        # Fixed gallery slots (max 60 videos)
                        MAX_VIDEOS = 60
                        gallery_components = []
                        
                        # Create fixed grid of components
                        for row_idx in range(MAX_VIDEOS // 3):
                            with gr.Row():
                                for col_idx in range(3):
                                    idx = row_idx * 3 + col_idx
                                    with gr.Column(scale=1, min_width=200, visible=False) as container:
                                        video = gr.Video(
                                            label=None,
                                            interactive=False,
                                            height=280,
                                            show_label=False
                                        )
                                        with gr.Row():
                                            order_display = gr.Textbox(
                                                value="",
                                                label=None,
                                                container=False,
                                                elem_classes=["order-display"],
                                                interactive=True
                                            )
                                            checkbox = gr.Checkbox(
                                                label="",
                                                value=False,
                                                container=False
                                            )
                                        
                                        # Store components for updates
                                        gallery_components.append({
                                            "container": container,
                                            "video": video,
                                            "order": order_display,
                                            "checkbox": checkbox,
                                            "index": idx
                                        })
                                        
                                        # Event handlers
                                        def handle_checkbox_change(checked, current_order, all_files, idx=idx):
                                            if not all_files or idx >= len(all_files):
                                                return current_order, gr.update()
                                            
                                            video_name = Path(all_files[idx]).name
                                            new_order = merger_checkbox_change(video_name, checked, current_order)
                                            
                                            # Only update the specific order display, NOT the whole gallery
                                            order_val = str(new_order.index(video_name) + 1) if video_name in new_order else ""
                                            return new_order, order_val

                                        checkbox.change(
                                            fn=handle_checkbox_change,
                                            inputs=[checkbox, selection_order_state, video_files_state],
                                            outputs=[selection_order_state, order_display]
                                        )
                                        
                                        def handle_order_submit(val, current_order, all_files, idx=idx):
                                            if not all_files or idx >= len(all_files):
                                                return current_order
                                            video_name = Path(all_files[idx]).name
                                            return merger_order_submit(video_name, val, current_order)
                                            
                                        order_display.submit(
                                            fn=handle_order_submit,
                                            inputs=[order_display, selection_order_state, video_files_state],
                                            outputs=[selection_order_state]
                                        )

                        def refresh_gallery_ui(current_order):
                            """Refresh the UI components based on files on disk."""
                            all_files = get_video_files()
                            video_names = [Path(v).name for v in all_files]
                            
                            updates = []
                            # Update video_files_state
                            updates.append(all_files)
                            # Update order_state (clean up invalid files)
                            valid_order = [v for v in current_order if v in video_names]
                            updates.append(valid_order)
                            
                            # Update components
                            for i, comp in enumerate(gallery_components):
                                if i < len(all_files):
                                    v_path = all_files[i]
                                    v_name = video_names[i]
                                    is_selected = v_name in valid_order
                                    order_val = str(valid_order.index(v_name) + 1) if is_selected else ""
                                    
                                    # Show container
                                    updates.append(gr.update(visible=True))
                                    # Update video
                                    updates.append(gr.update(value=v_path))
                                    # Update order
                                    updates.append(gr.update(value=order_val))
                                    # Update checkbox
                                    updates.append(gr.update(
                                        label=f"{v_name[:25]}..." if len(v_name) > 25 else v_name,
                                        value=is_selected
                                    ))
                                else:
                                    # Hide unused slots
                                    updates.append(gr.update(visible=False))
                                    updates.append(gr.update(value=None))
                                    updates.append(gr.update(value=""))
                                    updates.append(gr.update(value=False))
                            
                            return tuple(updates)

                        # Flatten output list for refresh button
                        refresh_outputs = [video_files_state, selection_order_state]
                        for comp in gallery_components:
                            refresh_outputs.extend([
                                comp["container"], 
                                comp["video"], 
                                comp["order"], 
                                comp["checkbox"]
                            ])

                        refresh_video_btn.click(
                            fn=refresh_gallery_ui,
                            inputs=[selection_order_state],
                            outputs=refresh_outputs
                        )

                    with gr.Column(scale=1, min_width=250):
                        gr.Markdown("### ⚙️ 설정 / Settings")

                        video_order = gr.Textbox(
                            label="비디오 순서 (선택사항) / Video Order (Optional)",
                            placeholder="예: 0,2,1",
                            info="콤마로 구분된 인덱스. 비워두면 선택 순서 사용",
                            lines=1
                        )

                        gr.Markdown("### 🔊 오디오 선택 / Select Audio")
                        gr.Markdown("*`ai video script/audio` 폴더의 파일이나 방금 생성된 오디오를 선택하세요*")

                        tts_audio_choices = get_tts_audio_files()
                        audio_files_select = gr.CheckboxGroup(
                            choices=tts_audio_choices,
                            value=[],
                            label=f"TTS 오디오 파일 (총 {len(tts_audio_choices)}개)",
                            info="여러 개 선택하면 오디오 개수만큼 쇼츠가 생성됩니다"
                        )

                        def refresh_audio_choices(generated_paths):
                            """Refresh audio list from disk, include newly generated ones."""
                            files_on_disk = get_tts_audio_files()
                            # Ensure generated files are surfaced even if not yet scanned
                            extra = []
                            for p in generated_paths or []:
                                name = Path(p).name
                                if name not in files_on_disk:
                                    extra.append(name)
                            all_files = extra + files_on_disk
                            return gr.update(
                                choices=all_files,
                                label=f"TTS 오디오 파일 (총 {len(all_files)}개)",
                                value=[]
                            )

                        generated_audios.change(
                            fn=refresh_audio_choices,
                            inputs=[generated_audios],
                            outputs=[audio_files_select]
                        )

                        gr.Markdown("### 🎵 배경음악 / Background Music")
                        bgm_files = get_bgm_files()
                        bgm_choices = ["없음 / None"] + bgm_files
                        bgm_dropdown = gr.Dropdown(
                            choices=bgm_choices,
                            value="없음 / None",
                            label="배경음악 선택 / Select BGM",
                            info=f"background music 폴더에서 {len(bgm_files)}개 파일 발견"
                        )
                        gr.Markdown("*배경음악은 TTS 오디오와 믹싱되어 낮은 볼륨(20%)으로 재생됩니다*")

                        create_shorts_btn = gr.Button("🎬 쇼츠 만들기 / Create Shorts", variant="primary", size="lg")

                with gr.Row():
                    gr.Markdown("### 📄 생성 결과 / Creation Result")

                with gr.Row():
                    status_output = gr.Textbox(
                        label="상태 / Status",
                        lines=10,
                        interactive=False
                    )

                with gr.Row():
                    gr.Markdown("### 🎬 생성된 쇼츠 미리보기 / Generated Shorts Preview")

                with gr.Row():
                    output_video1 = gr.Video(label="쇼츠 1 / Shorts 1")
                    output_video2 = gr.Video(label="쇼츠 2 / Shorts 2")
                    output_video3 = gr.Video(label="쇼츠 3 / Shorts 3")

                with gr.Row():
                    output_video4 = gr.Video(label="쇼츠 4 / Shorts 4")
                    output_video5 = gr.Video(label="쇼츠 5 / Shorts 5")
                    output_video6 = gr.Video(label="쇼츠 6 / Shorts 6")

                with gr.Row():
                    output_video7 = gr.Video(label="쇼츠 7 / Shorts 7")

                # Create shorts handler
                def create_shorts_handler(current_selected_vids, selected_audio_files, generated_audio_paths, order, bgm):
                    # selected_audio_files: list of names from checkboxgroup
                    # generated_audio_paths: list of full paths from gr.State
                    # current_selected_vids: list of video names from selection_order_state
                    
                    selected_audio_files = selected_audio_files or []
                    generated_audio_paths = generated_audio_paths or []
                    selected_vids = current_selected_vids or []

                    # Build selected audios list from selected filenames (map to full paths)
                    selected_audios = []
                    for name in selected_audio_files:
                        full_path = TTS_AUDIO_DIR / name
                        if full_path.exists():
                            selected_audios.append(str(full_path))
                        else:
                            # fallback: maybe generated_audios contains absolute path
                            for p in generated_audio_paths:
                                if Path(p).name == name:
                                    selected_audios.append(p)
                                    break

                    if not selected_audios:
                        return ["❌ 대본 생성 또는 audio 폴더에서 오디오를 선택해주세요"] + [None] * 7
                    
                    if not selected_vids:
                        return ["❌ 비디오를 선택해주세요"] + [None] * 7

                    status, output_paths = create_shorts(selected_vids, selected_audios, order, bgm)
                    outputs = [None] * 7
                    for i, path in enumerate(output_paths[:7]):
                        outputs[i] = path
                    return [status] + outputs

                # Prepare inputs: selection_order_state + audio_files_select + generated_audios + video_order + bgm_dropdown
                all_inputs = [selection_order_state, audio_files_select, generated_audios, video_order, bgm_dropdown]

                create_shorts_btn.click(
                    fn=create_shorts_handler,
                    inputs=all_inputs,
                    outputs=[
                        status_output,
                        output_video1, output_video2, output_video3,
                        output_video4, output_video5, output_video6, output_video7
                    ]
                )

                # Usage guide
                gr.Markdown("### 💡 사용 방법 / How to Use")
                gr.Markdown("""
                1. **대본 생성**: "📝 대본 생성 / Script Generator" 탭에서 먼저 대본을 생성하세요
                2. **비디오 선택**: 갤러리에서 체크박스로 비디오를 선택하세요 (선택 순서가 표시됩니다)
                3. **오디오 선택**: 오른쪽 패널에서 생성된 오디오를 선택하세요
                4. **순서 지정** (선택사항): 비디오 순서를 변경하려면 인덱스 입력 (예: 0,2,1)
                5. **쇼츠 만들기**: 버튼을 클릭하면 선택한 각 오디오마다 쇼츠가 생성됩니다

                **출력 폴더**: `final_shorts/`
                """)

    return demo


def main():
    """Launch Gradio interface."""
    demo = create_gradio_interface()

    # Allow access to final_shorts directory
    final_shorts_dir = Path(__file__).parent.parent / "final_shorts"
    final_shorts_dir.mkdir(exist_ok=True)

    # Allow port override via environment (avoids collision if 7860 is busy)
    preferred_port = int(os.environ.get("GRADIO_SERVER_PORT", "7860"))

    def find_available_port(start_port: int, max_tries: int = 20) -> int:
        """Find an available port by attempting to bind incrementally."""
        for port in range(start_port, start_port + max_tries):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(("127.0.0.1", port))
                    return port
                except OSError:
                    continue
        raise OSError(f"No available port found in range {start_port}-{start_port + max_tries - 1}")

    server_port = find_available_port(preferred_port)

    demo.launch(
        share=False,
        server_name="127.0.0.1",
        server_port=server_port,
        allowed_paths=[
            str(final_shorts_dir), 
            str(TTS_AUDIO_DIR), 
            str(INPUT_DIR), 
            str(VIDEOS_DIR), 
            str(BGM_DIR)
        ]
    )
    print(f"\n✓ Gradio interface launched at http://127.0.0.1:{server_port}")
    print("Press Ctrl+C to stop the server")


if __name__ == "__main__":
    main()
