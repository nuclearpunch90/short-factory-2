"""랭킹 컴필레이션 비디오 자동 생성 스크립트"""

import os
os.environ["GOOGLE_API_USE_CLIENT_CERTIFICATE"] = "false"

from moviepy import (
    VideoFileClip,
    TextClip,
    CompositeVideoClip,
    concatenate_videoclips,
    ColorClip,
    AudioFileClip,
    CompositeAudioClip
)
from moviepy.audio.fx import MultiplyVolume, AudioLoop
from PIL import Image, ImageDraw, ImageFont
import json
import re
from datetime import datetime
import sys
import random

try:
    import requests
    import base64
    from io import BytesIO
    AI_AVAILABLE = True
except ImportError:
    AI_AVAILABLE = False
    requests = None

# 설정 파일 로드
def load_config(config_path=None):
    """설정 파일 로드"""
    if config_path is None:
        config_path = os.environ.get("CONFIG_FILE", "Config/config.json")
    if not os.path.exists(config_path):
        config_path = "Config/config.example.json"

    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def load_ranking_config(config_path=None):
    """랭킹 설정 파일 로드"""
    if config_path is None:
        # 환경변수에서 CONFIG_FILE을 읽고 ranking_config로 변환
        config_file = os.environ.get("CONFIG_FILE", "Config/config.json")
        # config.json -> ranking_config.json, config1.json -> ranking_config1.json
        config_path = config_file.replace("config", "ranking_config")

    if not os.path.exists(config_path):
        print(f"[WARNING] 랭킹 설정 파일을 찾을 수 없습니다: {config_path}")
        return {
            "ranking_settings": {
                "group_size": 3,
                "ranking_display_duration": 2.5,
                "title_position": "top_center",
                "ranking_position": "center",
                "transition_effect": "fade",
                "transition_duration": 0.5,
                "add_sound_effects": False
            },
            "overlay_settings": {
                "title": {
                    "font_size": 60,
                    "font_color": "white",
                    "keyword_color": "yellow",
                    "font_family": "Arial-Bold",
                    "position": "top",
                    "margin_top": 50
                },
                "ranking": {
                    "font_size": 100,
                    "font_family": "Impact",
                    "colors": {
                        "1": "#FFD700",
                        "2": "#C0C0C0",
                        "3": "#CD7F32"
                    },
                    "word_font_size": 50,
                    "word_color": "white",
                    "stroke_color": "black",
                    "stroke_width": 3
                }
            },
            "ai_settings": {
                "model": "gemini-1.5-flash",
                "temperature": 0.7
            }
        }

    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def get_random_background_music(music_dir="background music"):
    """background music 폴더에서 랜덤 오디오 파일 선택"""

    if not os.path.exists(music_dir):
        print(f"[WARNING] background music 폴더를 찾을 수 없습니다: {music_dir}")
        return None

    audio_files = [
        f for f in os.listdir(music_dir)
        if f.lower().endswith((".mp3", ".wav", ".m4a", ".aac"))
    ]

    if not audio_files:
        print("[WARNING] background music 폴더에 사용할 수 있는 오디오 파일이 없습니다.")
        return None

    selected = random.choice(audio_files)
    return os.path.join(music_dir, selected)


def get_random_highlight_music(music_dir="highlight music"):
    """highlight music 폴더에서 랜덤 오디오 파일 선택"""

    if not os.path.exists(music_dir):
        print(f"[WARNING] highlight music 폴더를 찾을 수 없습니다: {music_dir}")
        return None

    audio_files = [
        f for f in os.listdir(music_dir)
        if f.lower().endswith((".mp3", ".wav", ".m4a", ".aac"))
    ]

    if not audio_files:
        print("[WARNING] highlight music 폴더에 사용할 수 있는 오디오 파일이 없습니다.")
        return None

    selected = random.choice(audio_files)
    return os.path.join(music_dir, selected)


def get_random_highlight_emoji(emoji_dir="highlight emoji"):
    """highlight emoji 폴더에서 랜덤 PNG 이모지 선택"""

    if not os.path.exists(emoji_dir):
        print(f"[WARNING] highlight emoji 폴더를 찾을 수 없습니다: {emoji_dir}")
        return None

    emoji_files = [
        f for f in os.listdir(emoji_dir)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    ]

    if not emoji_files:
        print("[WARNING] highlight emoji 폴더에 사용할 수 있는 이미지 파일이 없습니다.")
        return None

    selected = random.choice(emoji_files)
    return os.path.join(emoji_dir, selected)


def extract_key_moment_from_txt(video_path):
    """비디오와 동일한 이름의 txt 파일에서 Key moment/Most important timeline을 초 단위로 추출"""

    txt_path = os.path.splitext(video_path)[0] + ".txt"
    if not os.path.exists(txt_path):
        print(f"[HIGHLIGHT] Key moment 텍스트를 찾을 수 없습니다: {os.path.basename(txt_path)}")
        return None

    try:
        with open(txt_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"[WARNING] Key moment 텍스트 로드 실패: {e}")
        return None

    pattern = re.compile(
        r'(?:Key moment|Most important timeline):\s*([0-9]{1,2}:[0-9]{2}|[0-9]+(?:\.[0-9]+)?)',
        flags=re.IGNORECASE
    )
    match = pattern.search(content)
    if not match:
        return None

    raw_value = match.group(1).strip()

    try:
        if ':' in raw_value:
            minutes, seconds = raw_value.split(':', 1)
            return int(minutes) * 60 + float(seconds)
        return float(raw_value)
    except ValueError:
        print(f"[WARNING] Key moment 파싱 실패: {raw_value}")
        return None


def create_highlight_ending(first_place_video_path, config):
    """
    1위 비디오의 키 모먼트를 캡처해서 highlight music과 함께 엔딩 클립 생성

    Args:
        first_place_video_path: 1위 비디오 파일 경로
        config: 설정 딕셔너리

    Returns:
        ImageClip with audio (highlight music 길이만큼)
    """
    from moviepy import ImageClip

    print("\n[HIGHLIGHT] 하이라이트 엔딩 클립 생성 중...")

    # highlight music 선택
    highlight_music_path = get_random_highlight_music()
    if not highlight_music_path:
        print("[WARNING] highlight music이 없어 엔딩 클립을 생성하지 않습니다.")
        return None

    try:
        highlight_audio = AudioFileClip(highlight_music_path)
        highlight_duration = highlight_audio.duration
        print(f"[HIGHLIGHT] 음악: {os.path.basename(highlight_music_path)} ({highlight_duration:.1f}초)")
    except Exception as e:
        print(f"[WARNING] highlight music 로드 실패: {e}")
        return None

    # 1위 비디오 로드
    try:
        first_video = VideoFileClip(first_place_video_path)

        # txt 메타데이터에서 Key moment 시점 우선 사용
        key_moment_time = extract_key_moment_from_txt(first_place_video_path)

        if key_moment_time is not None:
            if key_moment_time >= first_video.duration:
                key_moment_time = max(0, first_video.duration - 0.1)
                print(f"[HIGHLIGHT] Key moment가 영상 길이를 초과해 {key_moment_time:.1f}초로 조정")
            else:
                print(f"[HIGHLIGHT] Key moment 메타데이터 사용: {key_moment_time:.1f}초")
        else:
            # 키 모먼트 정보가 없으면 기존 방식 사용
            key_moment_time = min(3.0, first_video.duration * 0.3)
            print(f"[HIGHLIGHT] Key moment 정보 없음 → {key_moment_time:.1f}초 지점 캡처")

        # 해당 시점의 프레임 캡처
        frame = first_video.get_frame(key_moment_time)

        # 비디오 크기 저장
        video_width, video_height = first_video.size

        # ImageClip 생성 (highlight music 길이만큼)
        highlight_clip = ImageClip(frame, duration=highlight_duration)

        # 검은색 반투명 레이어 추가 (opacity 50%)
        black_overlay = ColorClip(
            size=(video_width, video_height),
            color=(0, 0, 0),
            duration=highlight_duration
        ).with_opacity(0.5)

        # 이모지 PNG 추가
        emoji_path = get_random_highlight_emoji()
        clips_to_composite = [highlight_clip, black_overlay]

        if emoji_path:
            try:
                from PIL import Image as PILImage
                import numpy as np

                # 이모지 이미지 로드 (RGBA 모드로 변환하여 투명도 유지)
                emoji_img = PILImage.open(emoji_path).convert("RGBA")

                # 이모지 크기 조정 (화면 너비의 25%)
                emoji_width = int(video_width * 0.25)
                aspect_ratio = emoji_img.height / emoji_img.width
                emoji_height = int(emoji_width * aspect_ratio)
                emoji_img_resized = emoji_img.resize((emoji_width, emoji_height), PILImage.LANCZOS)

                # RGBA 배열로 변환
                emoji_array = np.array(emoji_img_resized)

                # ImageClip 생성 - RGBA 배열을 직접 전달하면 자동으로 알파 채널 처리
                emoji_clip = ImageClip(emoji_array, duration=highlight_duration, is_mask=False)

                # 위치: 자막 위치쯤 (화면 하단에서 450px 위, 중앙)
                emoji_y = video_height - 450
                emoji_clip = emoji_clip.with_position(('center', emoji_y))

                clips_to_composite.append(emoji_clip)
                print(f"[HIGHLIGHT] 이모지 추가: {os.path.basename(emoji_path)}")

            except Exception as e:
                print(f"[WARNING] 이모지 추가 실패: {e}")

        # 정지화면 + 검은색 레이어 + 이모지 합성
        final_highlight = CompositeVideoClip(clips_to_composite)
        final_highlight = final_highlight.with_audio(highlight_audio)

        first_video.close()

        print(f"[HIGHLIGHT] 엔딩 클립 생성 완료 (검은색 오버레이 50% + 이모지, {highlight_duration:.1f}초)")
        return final_highlight

    except Exception as e:
        print(f"[WARNING] 하이라이트 엔딩 클립 생성 실패: {e}")
        return None


def apply_background_music(video_clip, config):
    """완성된 랭킹 비디오에 항상 배경 음악을 입혀서 반환"""

    if video_clip.duration is None or video_clip.duration <= 0:
        print("[WARNING] 비디오 길이를 확인할 수 없어 배경 음악을 추가하지 않습니다.")
        return video_clip

    music_path = get_random_background_music()
    if not music_path:
        return video_clip

    # 랭킹 비디오 배경 음악 볼륨 고정
    background_music_volume = 0.5

    try:
        music_clip = AudioFileClip(music_path)
    except Exception as e:
        print(f"[WARNING] 배경 음악 로드 실패 ({music_path}): {e}")
        return video_clip

    # 배경 음악은 최대 54.5초까지만 재생
    music_duration = min(video_clip.duration, 54.5)

    if music_clip.duration < music_duration:
        music_clip = music_clip.with_effects([AudioLoop(duration=music_duration)])

    music_clip = music_clip.subclipped(0, music_duration).with_start(0)

    if background_music_volume != 1.0:
        print(f"[AUDIO] 배경 음악 볼륨 조정: {background_music_volume:.2f}x")
        music_clip = music_clip.with_effects([MultiplyVolume(background_music_volume)])

    if video_clip.duration > 54.5:
        print(f"[MUSIC] 랭킹 비디오에 배경 음악 추가: {os.path.basename(music_path)} (54.5초까지만)")
    else:
        print(f"[MUSIC] 랭킹 비디오에 배경 음악 추가: {os.path.basename(music_path)}")

    base_audio = video_clip.audio
    if base_audio is None:
        # 원본 오디오가 없으면 배경 음악만 사용
        return video_clip.with_audio(music_clip)

    final_audio = CompositeAudioClip([base_audio, music_clip])
    return video_clip.with_audio(final_audio)

# 302.ai API 초기화
def get_302ai_api_key():
    """302.ai API 키 가져오기 (서버 환경변수 우선)"""
    # 서버에서 설정한 환경변수 우선 확인
    api_key = os.environ.get("AI_302_API_KEY")

    if not api_key:
        # config.json에서 읽기
        try:
            config = load_config()
            api_key = config.get("ai_settings", {}).get("api_key", "")
        except:
            pass

    return api_key

def extract_video_frames(video_path, num_frames=3):
    """비디오에서 프레임을 추출하여 base64 인코딩"""
    try:
        video = VideoFileClip(video_path)
        duration = video.duration
        frames_base64 = []

        # 비디오를 균등하게 나누어 프레임 추출
        for i in range(num_frames):
            timestamp = (i + 1) * duration / (num_frames + 1)
            frame = video.get_frame(timestamp)

            # numpy array를 PIL Image로 변환
            from PIL import Image as PILImage
            import numpy as np
            pil_image = PILImage.fromarray(frame.astype('uint8'), 'RGB')

            # 이미지 크기 줄이기 (512x512)
            pil_image.thumbnail((512, 512), PILImage.LANCZOS)

            # base64 인코딩
            buffered = BytesIO()
            pil_image.save(buffered, format="JPEG", quality=85)
            img_str = base64.b64encode(buffered.getvalue()).decode()
            frames_base64.append(f"data:image/jpeg;base64,{img_str}")

        video.close()
        return frames_base64
    except Exception as e:
        print(f"[ERROR] 프레임 추출 실패: {e}")
        return []

# 비디오 파일 스캔
def scan_video_files(output_dir):
    """Output 폴더에서 완성된 영상 파일 스캔"""
    supported_extensions = ('.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm')
    video_files = []

    if not os.path.exists(output_dir):
        print(f"[ERROR] Output 폴더를 찾을 수 없습니다: {output_dir}")
        return []

    for file in os.listdir(output_dir):
        if file.lower().endswith(supported_extensions):
            # 이미 랭킹 영상인 경우 제외
            if file.startswith('ranking_'):
                continue
            # description 파일 제외
            if file.endswith('.txt'):
                continue

            full_path = os.path.join(output_dir, file)
            if os.path.isfile(full_path):
                video_files.append(full_path)

    # 파일 수정 시간 기준 정렬 (오름차순 - 최신 파일이 마지막 = 1위)
    video_files.sort(key=lambda x: os.path.getmtime(x), reverse=False)

    print(f"\n[SCAN] {len(video_files)}개의 비디오 파일을 찾았습니다.")
    for i, video in enumerate(video_files, 1):
        print(f"  {i}. {os.path.basename(video)}")

    return video_files

# 비디오 그룹핑
def group_videos(video_files, group_size=3):
    """비디오를 N개씩 그룹핑"""
    groups = []
    for i in range(0, len(video_files), group_size):
        group = video_files[i:i + group_size]
        if len(group) == group_size:
            groups.append(group)
        else:
            print(f"\n[WARNING] 그룹 {len(groups) + 1}은 {len(group)}개의 영상만 있어 건너뜁니다.")
            print(f"  영상: {[os.path.basename(v) for v in group]}")

    return groups

# AI 기반 공통 주제 분석 (302.ai API 사용)
def analyze_common_theme(video_group, ranking_config):
    """302.ai Gemini API를 사용하여 공통 주제 분석 (비디오 프레임 기반)"""
    if not AI_AVAILABLE:
        # AI 사용 불가시 기본값 반환
        return "EPIC CLIPS", "EPIC"

    api_key = get_302ai_api_key()
    if not api_key:
        print("[WARNING] AI_302_API_KEY가 설정되지 않았습니다.")
        return "EPIC CLIPS", "EPIC"

    num_videos = len(video_group)
    print(f"\n[AI] {num_videos}개 영상에서 프레임 추출 및 302.ai API로 분석 중...")

    # config.json 로드
    config = load_config()
    language = config.get("voice_settings", {}).get("language", "en")
    base_url = config.get("ai_settings", {}).get("base_url", "https://api.302.ai/v1")
    model_name = ranking_config.get("ai_settings", {}).get("model", "gemini-2.5-flash")
    temperature = ranking_config.get("ai_settings", {}).get("temperature", 0.7)

    # 각 비디오에서 프레임 추출
    all_frames = []
    for i, video_path in enumerate(video_group, 1):
        print(f"  [{i}/{num_videos}] 프레임 추출 중: {os.path.basename(video_path)}")
        frames = extract_video_frames(video_path, num_frames=2)  # 각 비디오에서 2 프레임
        if frames:
            all_frames.extend(frames)
            print(f"  ✅ {len(frames)}개 프레임 추출 완료")
        else:
            print(f"  [WARNING] 프레임 추출 실패")

    if not all_frames:
        print("[WARNING] 프레임 추출 실패, 기본값 사용")
        return "EPIC CLIPS", "EPIC"

    # 언어별 프롬프트
    if language == "ko":
        text_prompt = f"""{num_videos}개의 비디오 프레임을 보고 이들의 **실제 공통점**을 찾아 주제를 추출하세요.

중요 지침:
1. 비디오의 **실제 내용**을 보고 구체적인 공통 주제를 찾으세요
2. 예시:
   - 모두 스포츠 실수 → "스포츠 실수"
   - 모두 음식 관련 실수 → "요리 대참사"
   - 모두 카르마/복수 → "즉각적인 카르마"
   - 모두 예상치 못한 결과 → "예상 외 결말"
   - 모두 친구 관련 → "우정 배신"
   - 모두 할아버지/노인 → "할아버지 장난"
3. **절대** 일반적인 단어는 피하세요: 대박, 순간, 웃긴, 클립, 영상 등
4. 2-3개의 **구체적인** 한국어 단어로 요약
5. "순간"이라는 단어는 절대 포함하지 마세요 (나중에 자동으로 추가됨)
6. 강조할 핵심 키워드 1개 추출

출력 형식 (JSON):
{{
  "theme": "즉각적인 카르마",
  "keyword": "카르마"
}}

JSON만 출력하세요. 다른 설명은 필요 없습니다."""
    else:  # 영어
        text_prompt = f"""Look at the frames from {num_videos} videos and find their **actual commonalities** to extract a theme.

Important Instructions:
1. Look at the **actual content** to find specific common themes
2. Examples:
   - All sports fails → "SPORTS FAILS"
   - All food-related mistakes → "FOOD DISASTERS"
   - All karma/revenge → "INSTANT KARMA"
   - All unexpected outcomes → "UNEXPECTED ENDINGS"
   - All friend-related → "FRIENDSHIP BETRAYALS"
   - All grandfather/elderly → "GRANDPA PRANKS"
3. **NEVER** use generic words: EPIC, MOMENTS, FUNNY, CLIPS, VIDEOS, etc.
4. Summarize in 2-3 **specific** English words (UPPERCASE)
5. NEVER include the word "MOMENTS" (it will be added automatically later)
6. Extract one core keyword to emphasize

Output Format (JSON):
{{
  "theme": "INSTANT KARMA",
  "keyword": "KARMA"
}}

Output JSON only. No other explanation needed."""

    # 302.ai API 호출
    try:
        url = f"{base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        # 메시지 content 구성 (텍스트 + 이미지들)
        content = [{"type": "text", "text": text_prompt}]
        for frame_data in all_frames:
            content.append({
                "type": "image_url",
                "image_url": {"url": frame_data}
            })

        data = {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": content
                }
            ],
            "temperature": temperature,
            "max_tokens": 500
        }

        print(f"\n[AI] 302.ai API 호출 중... (모델: {model_name})")
        response = requests.post(url, headers=headers, json=data, timeout=60)
        response.raise_for_status()

        result_data = response.json()
        result_text = result_data["choices"][0]["message"]["content"].strip()

        # JSON 코드 블록 제거
        result_text = re.sub(r'^```json\s*', '', result_text)
        result_text = re.sub(r'\s*```$', '', result_text)

        result = json.loads(result_text)
        theme = result.get("theme", "EPIC CLIPS")
        keyword = result.get("keyword", "EPIC")

        print(f"\n[AI] 공통 주제 분석 완료:")
        print(f"  주제: {theme}")
        print(f"  키워드: {keyword}")

        return theme, keyword

    except Exception as e:
        print(f"\n[WARNING] AI 주제 분석 실패: {e}")
        print("  기본값 사용: EPIC CLIPS")
        return "EPIC CLIPS", "EPIC"

# 텍스트 오버레이 생성 (PIL 기반)
def create_text_overlay_pil(text, width, height, font_size, color, stroke_color=None, stroke_width=0):
    """PIL을 사용하여 텍스트 오버레이 이미지 생성"""
    # 투명 배경 이미지 생성
    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 폰트 로드 (ExtraBold 우선)
    try:
        # macOS 기본 폰트 (한글 지원 폰트 우선, ExtraBold 사용)
        font_candidates = [
            ("/System/Library/Fonts/Supplemental/AppleSDGothicNeo.ttc", [14], "AppleSDGothicNeo.ttc"),  # ExtraBold
            ("/System/Library/Fonts/AppleSDGothicNeo.ttc", [14, 6, 5], "AppleSDGothicNeo.ttc"),  # ExtraBold, Bold
            ("/Library/Fonts/AppleGothic.ttf", [0], "AppleGothic.ttf"),
            ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", [0], "Arial Unicode.ttf"),
            ("/System/Library/Fonts/Supplemental/Impact.ttf", [0], "Impact.ttf"),
            ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", [0], "Arial Bold.ttf"),
        ]

        font = None
        for font_path, indexes, label in font_candidates:
            if not os.path.exists(font_path):
                continue

            for idx in indexes:
                try:
                    font = ImageFont.truetype(font_path, font_size, index=idx)
                    break
                except:
                    continue

            if font is not None:
                break

        if font is None:
            font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()

    # 텍스트 크기 계산 및 자동 줄바꿈 처리
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    # 화면 너비의 90%를 최대 너비로 설정
    max_width = int(width * 0.9)

    # 텍스트가 너무 길면 줄바꿈 처리
    lines = []
    if text_width > max_width:
        words = text.split()
        current_line = ""

        for word in words:
            test_line = current_line + " " + word if current_line else word
            test_bbox = draw.textbbox((0, 0), test_line, font=font)
            test_width = test_bbox[2] - test_bbox[0]

            if test_width <= max_width:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word

        if current_line:
            lines.append(current_line)
    else:
        lines = [text]

    # 여러 줄인 경우 각 줄의 높이 계산
    if len(lines) > 1:
        line_height = text_height
        total_height = line_height * len(lines) + (len(lines) - 1) * 10  # 줄 간격 10px
        start_y = (height - total_height) // 2

        for i, line in enumerate(lines):
            line_bbox = draw.textbbox((0, 0), line, font=font)
            line_width = line_bbox[2] - line_bbox[0]
            x = (width - line_width) // 2
            y = start_y + i * (line_height + 10)

            # 외곽선 그리기
            if stroke_color and stroke_width > 0:
                for adj_x in range(-stroke_width, stroke_width + 1):
                    for adj_y in range(-stroke_width, stroke_width + 1):
                        draw.text((x + adj_x, y + adj_y), line, font=font, fill=stroke_color)

            # 텍스트 그리기
            draw.text((x, y), line, font=font, fill=color)
    else:
        # 한 줄인 경우 기존 로직
        x = (width - text_width) // 2
        y = (height - text_height) // 2

        # 외곽선 그리기
        if stroke_color and stroke_width > 0:
            for adj_x in range(-stroke_width, stroke_width + 1):
                for adj_y in range(-stroke_width, stroke_width + 1):
                    draw.text((x + adj_x, y + adj_y), text, font=font, fill=stroke_color)

        # 텍스트 그리기
        draw.text((x, y), text, font=font, fill=color)

    return img

# 랭킹 오버레이 클립 생성
def create_ranking_overlay(rank, video_width, video_height, duration, ranking_config, video_title=""):
    """랭킹 오버레이 클립 생성 (랭킹 번호 + 비디오 제목 표시)"""

    overlay_config = ranking_config.get("overlay_settings", {}).get("ranking", {})

    # 랭킹 번호 색상 (#1: 금색, #2: 은색, #3: 동색, #4: 주황, #5: 보라)
    colors = overlay_config.get("colors", {
        "1": "#FFD700",
        "2": "#C0C0C0",
        "3": "#CD7F32",
        "4": "#E67E22",
        "5": "#9B59B6"
    })
    rank_color = colors.get(str(rank), "#FFFFFF")

    # 랭킹 번호 + 비디오 제목 텍스트 (#5 She Tried the Messi Bowling Kick)
    rank_text = f"#{rank} {video_title}" if video_title else f"#{rank}"
    rank_font_size = overlay_config.get("font_size", 100)

    stroke_color = overlay_config.get("stroke_color", "black")
    stroke_width = overlay_config.get("stroke_width", 3)

    # 랭킹 번호 이미지 생성
    rank_img = create_text_overlay_pil(
        rank_text,
        video_width,
        video_height // 3,
        rank_font_size,
        rank_color,
        stroke_color,
        stroke_width
    )

    # PIL Image를 numpy array로 변환
    import numpy as np
    img_array = np.array(rank_img)

    # ImageClip 생성
    from moviepy import ImageClip
    overlay_clip = ImageClip(img_array, duration=duration)
    overlay_clip = overlay_clip.with_position(('center', 'center'))

    # 페이드 효과는 제거 (ImageClip에서 지원하지 않음)
    # 필요시 나중에 opacity 조절로 구현 가능

    return overlay_clip

# 공통 타이틀 오버레이 생성 (기존 - 사용 안함)
def create_title_overlay(theme, keyword, video_width, video_height, duration, ranking_config):
    """공통 타이틀 오버레이 생성 (TOP N XXX MOMENTS)"""

    title_config = ranking_config.get("overlay_settings", {}).get("title", {})
    group_size = ranking_config.get("ranking_settings", {}).get("group_size", 3)

    # 언어 설정 가져오기
    language = ranking_config.get("voice_settings", {}).get("language", "en")

    # 언어별 타이틀 생성
    if language == "ko":
        # 한국어: "순간" 중복 방지
        if "순간" in theme:
            title_text = f"TOP {group_size} {theme}"
        else:
            title_text = f"TOP {group_size} {theme} 순간"
    else:
        # 영어: "MOMENTS" 중복 방지
        if "MOMENTS" in theme.upper():
            title_text = f"TOP {group_size} {theme}"
        else:
            title_text = f"TOP {group_size} {theme} MOMENTS"

    font_size = title_config.get("font_size", 60)
    font_color = title_config.get("font_color", "white")
    keyword_color = title_config.get("keyword_color", "yellow")
    margin_top = title_config.get("margin_top", 20)  # 더 위로 올림 (50 → 20)

    # 타이틀 이미지 생성
    title_img = create_text_overlay_pil(
        title_text,
        video_width,
        200,
        font_size,
        font_color,
        "black",
        8
    )

    import numpy as np
    img_array = np.array(title_img)

    from moviepy import ImageClip
    title_clip = ImageClip(img_array, duration=duration)
    title_clip = title_clip.with_position(('center', margin_top))

    return title_clip


# 썸네일 설정 기반 타이틀 오버레이 생성
def create_thumbnail_title_overlay(thumbnail_config, video_width, video_height, duration):
    """웹앱에서 설정한 썸네일 제목으로 타이틀 오버레이 생성 (단어별 색상 지원, 자동 크기 조정 및 줄바꿈)"""

    title_lines = thumbnail_config.get('title_lines', [])

    # 오버레이 높이 (상단 35%)
    overlay_height = int(video_height * 0.35)

    # 투명 배경 이미지 생성
    img = Image.new('RGBA', (video_width, overlay_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 최대 너비 (화면의 90%)
    max_width = int(video_width * 0.9)

    # 폰트 설정 함수
    def load_font(font_size, font_path, index):
        try:
            return ImageFont.truetype(font_path, font_size, index=index)
        except:
            return ImageFont.load_default()

    # 폰트 후보
    extrabold_font_candidates = [
        ("/System/Library/Fonts/Supplemental/AppleSDGothicNeo.ttc", [14], "AppleSDGothicNeo.ttc"),
        ("/System/Library/Fonts/AppleSDGothicNeo.ttc", [14, 6, 5], "AppleSDGothicNeo.ttc"),
        ("/Library/Fonts/AppleGothic.ttf", [0], "AppleGothic.ttf"),
        ("/System/Library/Fonts/Supplemental/AppleGothic.ttf", [0], "AppleGothic.ttf"),
        ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", [0], "Arial Bold.ttf"),
    ]

    # 사용 가능한 폰트 경로 찾기
    font_path = None
    font_index = 0
    for path, indexes, label in extrabold_font_candidates:
        if os.path.exists(path):
            font_path = path
            font_index = indexes[0]
            print(f"[FONT] 폰트 로드: {label}")
            break

    if not font_path:
        print("[FONT WARNING] ExtraBold 폰트 로드 실패, 기본 폰트 사용")

    # 각 줄 그리기
    y_positions = [int(overlay_height * 0.25), int(overlay_height * 0.6)]
    current_y_offset = 0  # 줄바꿈으로 인한 Y 위치 조정

    for line_idx, line in enumerate(title_lines):
        words = line.get('words', [])
        if not words:
            continue

        # 초기 폰트 크기 설정
        base_font_size = 105 if line_idx == 0 else 112
        min_font_size = 60  # 최소 폰트 크기
        spacing = 10

        # 폰트 크기 자동 조정: 화면에 맞을 때까지 줄이기
        font_size = base_font_size
        font = load_font(font_size, font_path, font_index) if font_path else ImageFont.load_default()

        # 전체 줄의 너비 계산
        while font_size >= min_font_size:
            font = load_font(font_size, font_path, font_index) if font_path else ImageFont.load_default()

            total_width = 0
            word_widths = []
            for word in words:
                bbox = draw.textbbox((0, 0), word['text'], font=font)
                word_width = bbox[2] - bbox[0]
                word_widths.append(word_width)
                total_width += word_width

            total_width += spacing * (len(words) - 1)

            # 화면에 맞으면 중단
            if total_width <= max_width:
                break

            # 폰트 크기 줄이기
            font_size -= 5

        if font_size < min_font_size:
            font_size = min_font_size
            font = load_font(font_size, font_path, font_index) if font_path else ImageFont.load_default()

        print(f"[FONT] 라인 {line_idx + 1} 폰트 크기: {font_size}px (전체 너비: {total_width}px, 최대: {max_width}px)")

        # 여전히 너비 초과 시 단어를 여러 줄로 나누기
        if total_width > max_width:
            print(f"[WRAP] 라인 {line_idx + 1}이 화면을 초과하여 줄바꿈 처리합니다.")

            # 단어를 여러 줄로 나누기
            lines_to_draw = []
            current_line_words = []
            current_line_width = 0

            for word_idx, word in enumerate(words):
                bbox = draw.textbbox((0, 0), word['text'], font=font)
                word_width = bbox[2] - bbox[0]

                test_width = current_line_width + word_width
                if current_line_words:
                    test_width += spacing

                if test_width <= max_width or not current_line_words:
                    current_line_words.append((word, word_width))
                    current_line_width = test_width
                else:
                    # 현재 줄 저장하고 새 줄 시작
                    lines_to_draw.append(current_line_words)
                    current_line_words = [(word, word_width)]
                    current_line_width = word_width

            # 마지막 줄 추가
            if current_line_words:
                lines_to_draw.append(current_line_words)

            # 여러 줄 그리기
            y_pos = y_positions[line_idx] if line_idx < len(y_positions) else y_positions[-1]
            y_pos += current_y_offset
            line_height = int(font_size * 1.2)

            for sub_line_idx, sub_line in enumerate(lines_to_draw):
                # 줄 너비 계산
                line_width = sum(w[1] for w in sub_line) + spacing * (len(sub_line) - 1)
                current_x = (video_width - line_width) // 2

                # 단어 그리기
                for word_data, word_width in sub_line:
                    word_text = word_data['text']
                    word_color = word_data.get('color', '#FFFFFF')

                    # 외곽선
                    stroke_width = 8 if line_idx == 1 else 7
                    for offset_x in range(-stroke_width, stroke_width + 1):
                        for offset_y in range(-stroke_width, stroke_width + 1):
                            if offset_x != 0 or offset_y != 0:
                                draw.text((current_x + offset_x, y_pos + offset_y),
                                         word_text, font=font, fill='black')

                    # 컬러 텍스트
                    draw.text((current_x, y_pos), word_text, font=font, fill=word_color)
                    current_x += word_width + spacing

                # 다음 줄 위치
                y_pos += line_height

            # 다음 라인을 위한 Y 오프셋 조정
            current_y_offset += line_height * (len(lines_to_draw) - 1)

        else:
            # 한 줄로 그리기 (기존 로직)
            y_pos = y_positions[line_idx] if line_idx < len(y_positions) else y_positions[-1]
            y_pos += current_y_offset

            current_x = (video_width - total_width) // 2

            for word_idx, word in enumerate(words):
                word_text = word['text']
                word_color = word.get('color', '#FFFFFF')

                # 외곽선 효과
                stroke_width = 8 if line_idx == 1 else 7
                for offset_x in range(-stroke_width, stroke_width + 1):
                    for offset_y in range(-stroke_width, stroke_width + 1):
                        if offset_x != 0 or offset_y != 0:
                            draw.text((current_x + offset_x, y_pos + offset_y),
                                     word_text, font=font, fill='black')

                # 컬러 텍스트
                draw.text((current_x, y_pos), word_text, font=font, fill=word_color)

                # 다음 단어 위치로 이동
                current_x += word_widths[word_idx] + spacing

    # PIL Image를 numpy array로 변환
    import numpy as np
    img_array = np.array(img)

    # ImageClip 생성
    from moviepy import ImageClip
    title_clip = ImageClip(img_array, duration=duration)
    title_clip = title_clip.with_position(('center', 'top'))

    return title_clip

# 랭킹 비디오 생성
def create_ranking_video(video_group, group_index, config, ranking_config):
    """N개의 비디오를 랭킹 형식으로 병합"""

    print(f"\n{'='*60}")
    print(f"[GROUP {group_index}] 랭킹 비디오 생성 시작")
    print(f"{'='*60}")

    # 1. AI 분석
    print("\n[STEP 1] AI 분석 중...")
    theme, keyword = analyze_common_theme(video_group, ranking_config)

    # 2. 비디오 로드 및 순서 정렬 (역순으로: N -> ... -> 2 -> 1)
    print("\n[STEP 2] 비디오 로드 중...")
    clips = []
    for i, video_path in enumerate(video_group):
        print(f"  로드 중: {os.path.basename(video_path)}")
        clip = VideoFileClip(video_path)
        clips.append(clip)

    # 3. 랭킹 오버레이 추가
    print("\n[STEP 3] 랭킹 오버레이 추가 중...")
    ranking_duration = ranking_config.get("ranking_settings", {}).get("ranking_display_duration", 2.5)
    group_size = ranking_config.get("ranking_settings", {}).get("group_size", 3)

    final_clips = []
    clip_durations = []  # 각 클립 길이 저장
    for i, clip in enumerate(clips):
        rank = group_size - i  # 5 -> 4 -> 3 -> 2 -> 1

        # 비디오 제목 추출 (파일명에서 확장자 제거)
        video_path = video_group[i]
        video_title = os.path.splitext(os.path.basename(video_path))[0]

        print(f"  #{rank}: {clip.duration:.1f}초 - {video_title}")

        # 랭킹 오버레이 생성
        ranking_overlay = create_ranking_overlay(
            rank,
            int(clip.w),
            int(clip.h),
            ranking_duration,
            ranking_config,
            video_title
        )

        # 클립에 랭킹 오버레이 합성 (처음 N초만)
        if clip.duration > ranking_duration:
            overlay_part = CompositeVideoClip([
                clip.subclipped(0, ranking_duration),
                ranking_overlay
            ])
            remaining_part = clip.subclipped(ranking_duration, clip.duration)
            final_clip = concatenate_videoclips([overlay_part, remaining_part])
        else:
            final_clip = CompositeVideoClip([clip, ranking_overlay])

        final_clips.append(final_clip)
        clip_durations.append(clip.duration)  # 원본 클립 길이 저장

    # 4. 비디오 병합
    print("\n[STEP 4] 비디오 병합 중...")
    merged_video = concatenate_videoclips(final_clips, method="compose")

    # 5. 썸네일 설정에서 타이틀 오버레이 추가
    print("\n[STEP 5] 타이틀 오버레이 추가 중...")

    # thumbnail_config.json 로드
    from create_thumbnail import load_thumbnail_config
    thumbnail_config = load_thumbnail_config()

    if thumbnail_config and 'title_lines' in thumbnail_config and len(thumbnail_config['title_lines']) > 0:
        print("  웹앱에서 설정한 썸네일 제목을 비디오 전체에 오버레이합니다.")

        # 전체 비디오 길이 동안 표시되는 타이틀 생성
        title_overlay = create_thumbnail_title_overlay(
            thumbnail_config,
            int(merged_video.w),
            int(merged_video.h),
            merged_video.duration
        )

        # 타이틀 오버레이 합성
        final_video = CompositeVideoClip([merged_video, title_overlay])
    else:
        print("  [WARNING] 썸네일 설정이 없어 타이틀 오버레이를 건너뜁니다.")
        print("  웹앱(http://192.168.0.8:3000)에서 썸네일 제목을 설정할 수 있습니다.")
        final_video = merged_video

    # 6. 하이라이트 엔딩 추가 (1위 비디오의 키 모먼트 + highlight music)
    first_place_video_path = video_group[-1]  # 역순이므로 마지막이 1위
    highlight_ending = create_highlight_ending(first_place_video_path, config)

    if highlight_ending:
        print("\n[STEP 6] 하이라이트 엔딩 추가 중...")
        final_video = concatenate_videoclips([final_video, highlight_ending], method="compose")
        print(f"  하이라이트 엔딩 추가 완료 (총 길이: {final_video.duration:.1f}초)")

    # 6-1. 배경 음악 항상 추가
    final_video = apply_background_music(final_video, config)

    # 7. 저장
    # ranking_config에서 output_dir 우선 확인, 없으면 기본 config 사용
    output_dir = ranking_config.get("ranking_settings", {}).get("output_dir") or config.get("paths", {}).get("output_dir", "Output")

    # 출력 폴더가 없으면 생성
    os.makedirs(output_dir, exist_ok=True)

    # 썸네일 제목을 파일명 앞에 추가 (충돌 방지)
    thumbnail_title = ""
    if thumbnail_config and 'title_lines' in thumbnail_config and len(thumbnail_config['title_lines']) > 0:
        # 첫 번째 타이틀 라인의 텍스트 추출
        title_text = thumbnail_config['title_lines'][0].get('text', '').strip()
        # 파일명에 사용 가능하도록 정리 (공백을 언더스코어로, 특수문자 제거)
        thumbnail_title = title_text.replace(" ", "_").replace("/", "_").replace("\\", "_")
        # 연속된 언더스코어를 하나로
        while "__" in thumbnail_title:
            thumbnail_title = thumbnail_title.replace("__", "_")
        thumbnail_title = thumbnail_title.strip("_")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    theme_slug = theme.lower().replace(" ", "_")

    # 썸네일 제목이 있으면 맨 앞에 추가
    if thumbnail_title:
        output_filename = f"{thumbnail_title}_ranking_{theme_slug}_{timestamp}.mp4"
    else:
        output_filename = f"ranking_{theme_slug}_{timestamp}.mp4"

    output_path = os.path.join(output_dir, output_filename)

    print(f"\n[STEP 7] 저장 중: {output_filename}")
    print("  메타데이터: CapCut 스타일 (Core Media Video/Audio, H.264 encoder)")

    # 동시 인코딩을 위한 인스턴스별 temp 파일명
    temp_dir = config.get("paths", {}).get("temp_dir", "Temp")
    temp_audio_file = os.path.join(temp_dir, f"temp-audio-ranking-{os.getpid()}.m4a")

    final_video.write_videofile(
        output_path,
        codec=config.get("audio_settings", {}).get("codec", "libx264"),
        audio_codec=config.get("audio_settings", {}).get("audio_codec", "aac"),
        fps=30,
        preset='medium',
        threads=2,  # FFmpeg 스레드 수 제한 (동시 인코딩 대응)
        temp_audiofile=temp_audio_file,
        remove_temp=True,
        ffmpeg_params=[
            '-metadata', 'handler_name=Core Media Video',
            '-metadata:s:a:0', 'handler_name=Core Media Audio',
            '-metadata', 'encoder=H.264',
            '-brand', 'qt',
        ]
    )

    # 8. description.txt 생성
    print("\n[STEP 8] description.txt 생성 중...")
    desc_filename = os.path.splitext(output_filename)[0] + ".txt"
    desc_path = os.path.join(output_dir, desc_filename)

    # 랭킹 비디오 설명 생성
    group_size = ranking_config.get("ranking_settings", {}).get("group_size", 3)

    # MOMENTS 중복 방지
    if "MOMENTS" in theme.upper():
        title_for_desc = f"TOP {group_size} {theme}"
    else:
        title_for_desc = f"TOP {group_size} {theme} MOMENTS"

    # 랭킹 번호 목록 생성 (5 -> 4 -> 3 -> 2 -> 1)
    ranking_list = "\n".join([f"#{i}" for i in range(group_size, 0, -1)])

    description_text = f"""{title_for_desc}

This compilation features the most {theme.lower()} from our recent videos. Watch as we count down from #{group_size} to #1!

{ranking_list}

Which moment was your favorite? Let us know in the comments!

#top{group_size} #{theme.lower().replace(' ', '')} #compilation #viral #trending"""

    try:
        with open(desc_path, 'w', encoding='utf-8') as f:
            f.write(description_text)
        print(f"  ✅ description.txt 저장: {desc_filename}")
    except Exception as e:
        print(f"  [WARNING] description.txt 저장 실패: {e}")

    # 9. 정리
    print("\n[CLEANUP] 리소스 정리 중...")
    for clip in clips:
        clip.close()
    final_video.close()

    # 10. 원본 개별 영상 및 txt 파일을 before merge 폴더로 이동
    print("\n[STEP 10] 원본 개별 영상을 before merge 폴더로 이동 중...")

    # before merge 폴더 경로 - video_group의 첫 영상이 있는 Output 디렉토리 기준
    source_output_dir = os.path.dirname(video_group[0])  # Output, Output1, Output2 등
    before_merge_dir = os.path.join(source_output_dir, "before merge")

    # 폴더가 없으면 생성
    if not os.path.exists(before_merge_dir):
        os.makedirs(before_merge_dir)
        print(f"  📁 폴더 생성: {before_merge_dir}")

    import shutil
    for video_path in video_group:
        try:
            # 영상 파일 이동
            if os.path.exists(video_path):
                dest_video = os.path.join(before_merge_dir, os.path.basename(video_path))
                shutil.move(video_path, dest_video)
                print(f"  📦 이동됨: {os.path.basename(video_path)}")

            # 연관된 txt 파일 이동
            base_name = os.path.splitext(video_path)[0]
            txt_path = base_name + ".txt"
            if os.path.exists(txt_path):
                dest_txt = os.path.join(before_merge_dir, os.path.basename(txt_path))
                shutil.move(txt_path, dest_txt)
                print(f"  📦 이동됨: {os.path.basename(txt_path)}")

            # description.txt 형식도 체크
            desc_txt_path = base_name + "_description.txt"
            if os.path.exists(desc_txt_path):
                dest_desc = os.path.join(before_merge_dir, os.path.basename(desc_txt_path))
                shutil.move(desc_txt_path, dest_desc)
                print(f"  📦 이동됨: {os.path.basename(desc_txt_path)}")

        except Exception as e:
            print(f"  [WARNING] 이동 실패: {os.path.basename(video_path)} - {e}")

    print(f"\n{'='*60}")
    print(f"[SUCCESS] 랭킹 비디오 생성 완료!")
    print(f"[OUTPUT] {output_path}")
    print(f"  ✅ 개별 영상 및 txt 파일을 before merge 폴더로 이동 완료")
    print(f"{'='*60}\n")

    return output_path

# 메인 함수
def main():
    """메인 실행 함수"""

    print("\n" + "="*60)
    print("  랭킹 컴필레이션 비디오 생성기")
    print("="*60 + "\n")

    # 설정 로드
    config = load_config()
    ranking_config = load_ranking_config()

    # MoviePy 임시 디렉토리를 인스턴스별로 분리 (동시 인코딩 대응)
    temp_dir = config.get("paths", {}).get("temp_dir", "Temp")
    moviepy_temp_dir = os.path.join(temp_dir, f"moviepy_ranking_{os.getpid()}")
    os.makedirs(moviepy_temp_dir, exist_ok=True)
    os.environ["MOVIEPY_TEMP_DIR"] = moviepy_temp_dir
    print(f"[INIT] MoviePy temp 디렉토리: {moviepy_temp_dir}")

    # Output 폴더 경로
    output_dir = config.get("paths", {}).get("output_dir", "Output")

    # 1. 비디오 스캔
    video_files = scan_video_files(output_dir)

    if not video_files:
        print("\n[ERROR] 처리할 비디오 파일이 없습니다.")
        print(f"  Output 폴더를 확인하세요: {output_dir}")
        return

    # 2. 그룹핑
    group_size = ranking_config.get("ranking_settings", {}).get("group_size", 3)
    groups = group_videos(video_files, group_size)

    if not groups:
        print(f"\n[ERROR] {group_size}개씩 그룹을 만들 수 없습니다.")
        print(f"  최소 {group_size}개의 비디오가 필요합니다.")
        return

    print(f"\n[INFO] 총 {len(groups)}개의 그룹을 생성합니다.\n")

    # 3. 각 그룹에 대해 랭킹 비디오 생성
    created_videos = []
    for i, group in enumerate(groups, 1):
        try:
            output_path = create_ranking_video(group, i, config, ranking_config)
            created_videos.append(output_path)
        except Exception as e:
            print(f"\n[ERROR] 그룹 {i} 처리 중 오류 발생: {e}")
            import traceback
            traceback.print_exc()
            continue

    # 4. 최종 결과
    print("\n" + "="*60)
    print(f"  전체 작업 완료!")
    print("="*60)
    print(f"\n생성된 랭킹 비디오: {len(created_videos)}개\n")
    for i, video in enumerate(created_videos, 1):
        print(f"  {i}. {os.path.basename(video)}")
    print()

if __name__ == "__main__":
    main()
