"""YouTube 비디오 자동 보이스오버 생성 스크립트 (Windows 버전)"""

# Google API Discovery 캐시 비활성화 (RAG API 충돌 방지)
import os
os.environ["GOOGLE_API_USE_CLIENT_CERTIFICATE"] = "false"

from moviepy import VideoFileClip, AudioFileClip, CompositeAudioClip, TextClip, CompositeVideoClip, ImageClip, ColorClip, concatenate_videoclips
from moviepy.video.VideoClip import VideoClip
from moviepy.audio.fx import MultiplyVolume, AudioLoop
from moviepy.video.fx import MultiplyColor, FadeOut, Resize
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageColor
import time
import zipfile
import shutil
import unicodedata
import sys
import requests

try:
    from pydub import AudioSegment
    from pydub.effects import speedup, compress_dynamic_range
    PYDUB_IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # Python 3.13 requires optional pyaudioop
    AudioSegment = None
    speedup = None
    compress_dynamic_range = None
    PYDUB_IMPORT_ERROR = exc
import re
import os
import json
import random
import textwrap
# 302.ai API만 사용 (google.generativeai 패키지 제거)
GEMINI_AVAILABLE = True  # 항상 True (302.ai 사용)
try:
    from google.api_core import exceptions as google_api_exceptions
except ImportError:
    google_api_exceptions = None

try:
    from auto_subtitle_windows import GeminiSubtitleGenerator as SubtitleGenerator
    AUTO_SUBTITLE_AVAILABLE = True
except ImportError:
    try:
        from auto_subtitle import GeminiSubtitleGenerator as SubtitleGenerator
        AUTO_SUBTITLE_AVAILABLE = True
    except ImportError:
        SubtitleGenerator = None
        AUTO_SUBTITLE_AVAILABLE = False



# 폰트 설정 캐시 (TTC 인덱스)
FONT_INDEX_OVERRIDES = {}


def register_font_override(path, *, index=0, textclip_name=None):
    """특정 폰트 파일에 대한 TTC 인덱스 정보 등록"""
    if path:
        FONT_INDEX_OVERRIDES[path] = index or 0


def get_textclip_font_name(font_path):
    """TextClip에는 항상 파일 경로를 사용 (Pillow가 TTC index를 지원하지 않음)."""
    return font_path


def load_pil_font(font_path, font_size):
    """등록된 TTC 인덱스를 고려하여 PIL 폰트를 로드."""
    if not font_path:
        return ImageFont.load_default()
    index = FONT_INDEX_OVERRIDES.get(font_path, 0)
    try:
        return ImageFont.truetype(font_path, font_size, index=index)
    except OSError:
        # 인덱스 문제 등으로 실패하면 기본 인덱스로 다시 시도
        if index:
            try:
                return ImageFont.truetype(font_path, font_size)
            except OSError:
                pass
        return ImageFont.load_default()


# 지원하는 비디오 확장자 목록
SUPPORTED_VIDEO_EXTENSIONS = (
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".m4v",
    ".webm",
)


def _safe_extract_zip_member(zip_file, member, target_dir):
    """ZIP 멤버를 안전하게 추출 (디렉터리 탈출 방지)."""
    destination = os.path.abspath(os.path.join(target_dir, member))
    target_root = os.path.abspath(target_dir)

    if not destination.startswith(target_root + os.sep) and destination != target_root:
        raise RuntimeError(f"ZIP 파일에 허용되지 않은 경로가 포함되어 있습니다: {member}")

    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with zip_file.open(member) as source, open(destination, "wb") as out_file:
        shutil.copyfileobj(source, out_file)
    return destination


def extract_tag_from_filename(filename):
    """
    비디오 파일명에서 태그를 추출.

    예시:
        masstiktok_@probablyeatable_1950_975.mp4 → @probablyeatable
        masstiktok_dusisalim_41-212-248.mp4 → dusisalim

    패턴: masstiktok_ 제거, 마지막 _숫자_숫자 또는 _숫자-숫자-숫자 패턴 제거
    """
    # 확장자 제거
    name_without_ext = os.path.splitext(filename)[0]

    # masstiktok_ 제거
    if name_without_ext.startswith("masstiktok_"):
        name_without_prefix = name_without_ext[len("masstiktok_"):]
    else:
        return ""

    # 마지막 부분의 _숫자_숫자 또는 _숫자-숫자-숫자 패턴 제거
    # 패턴: _로 시작하고 그 뒤로 숫자, 하이픈, 언더스코어만 있는 경우
    pattern = r'_[\d\-_]+$'
    tag = re.sub(pattern, '', name_without_prefix)

    return tag


def _extract_videos_from_archives(input_dir):
    """
    입력 폴더 내 ZIP 파일에서 비디오를 추출해 Temp/extracted_videos 에 저장.

    Returns:
        (list[str], str, dict, dict): 추출된 비디오 경로 목록, 추출 루트 디렉터리, source_map, folder_map
    """
    extracted_videos = []
    source_map = {}
    folder_map = {}  # 비디오 경로 -> ZIP 내부 폴더 이름
    temp_root = get_config_value(["paths", "temp_dir"], "Temp")
    extract_root = os.path.join(temp_root, "extracted_videos")
    os.makedirs(extract_root, exist_ok=True)

    used_root = os.path.abspath(os.path.join(input_dir, "Used"))

    for root, dirs, files in os.walk(input_dir):
        # Used 폴더는 스킵
        dirs[:] = [
            d for d in dirs
            if not os.path.abspath(os.path.join(root, d)).startswith(used_root)
        ]
        for filename in files:
            if os.path.splitext(filename)[1].lower() != ".zip":
                continue

            zip_path = os.path.join(root, filename)
            archive_name = os.path.splitext(os.path.basename(zip_path))[0]
            target_dir = os.path.join(extract_root, archive_name)

            if os.path.exists(target_dir):
                try:
                    shutil.rmtree(target_dir)
                except (OSError, PermissionError) as e:
                    # Windows에서 파일이 사용 중일 수 있음 - 무시하고 계속 진행
                    print(f"[WARNING] 기존 디렉토리 삭제 실패 (무시): {e}")
            os.makedirs(target_dir, exist_ok=True)

            try:
                with zipfile.ZipFile(zip_path, "r") as archive:
                    extracted_count = 0
                    for member in archive.namelist():
                        if member.endswith("/"):
                            continue

                        ext = os.path.splitext(member)[1].lower()
                        if ext not in SUPPORTED_VIDEO_EXTENSIONS:
                            continue

                        try:
                            extracted_path = _safe_extract_zip_member(archive, member, target_dir)
                            extracted_videos.append(extracted_path)
                            source_map[extracted_path] = zip_path

                            # ZIP 내부 폴더 이름 추출 (첫 번째 폴더)
                            member_parts = member.split('/')
                            if len(member_parts) > 1:
                                folder_name = member_parts[0]
                            else:
                                folder_name = archive_name
                            folder_map[extracted_path] = folder_name

                            extracted_count += 1
                        except RuntimeError as exc:
                            print(f"[WARNING]  ZIP 추출을 건너뜁니다 ({exc})")

                if extracted_count:
                    print(f"[ZIP] ZIP에서 비디오 {extracted_count}개 추출: {zip_path}")
                else:
                    print(f"[WARNING]  ZIP에서 비디오를 찾지 못했습니다: {zip_path}")
            except zipfile.BadZipFile as exc:
                print(f"[ERROR] ZIP 파일을 열 수 없습니다: {zip_path} ({exc})")

    return extracted_videos, extract_root, source_map, folder_map


def find_first_video_file(input_dir):
    """주어진 디렉터리와 하위 폴더에서 이름순으로 가장 빠른 비디오 파일을 반환"""
    # 모든 비디오 파일을 재귀적으로 검색
    all_videos = []
    seen = set()

    extracted_videos, extract_root, source_map, folder_map = _extract_videos_from_archives(input_dir)

    search_roots = [input_dir]
    if extract_root and os.path.exists(extract_root):
        search_roots.append(extract_root)

    for video_path in extracted_videos:
        abs_path = os.path.abspath(video_path)
        if abs_path not in seen:
            seen.add(abs_path)
            origin = source_map.get(video_path, input_dir)
            folder_name = folder_map.get(video_path, "")
            all_videos.append((abs_path, origin, folder_name))

    used_root = os.path.abspath(os.path.join(input_dir, "Used"))

    for root_dir in search_roots:
        if not root_dir or not os.path.exists(root_dir):
            continue

        for root, dirs, files in os.walk(root_dir):
            # Used 폴더는 스킵
            dirs[:] = [
                d for d in dirs
                if not os.path.abspath(os.path.join(root, d)).startswith(used_root)
            ]

            for filename in files:
                if os.path.splitext(filename)[1].lower() in SUPPORTED_VIDEO_EXTENSIONS:
                    full_path = os.path.abspath(os.path.join(root, filename))

                    # Used 폴더 내부의 파일은 스킵
                    if full_path.startswith(used_root):
                        continue

                    if full_path not in seen:
                        seen.add(full_path)
                        origin = source_map.get(full_path, input_dir)
                        folder_name = folder_map.get(full_path, "")
                        if root_dir == input_dir:
                            origin = full_path
                            # Input 폴더에 직접 있는 비디오의 경우 파일명에서 태그 추출
                            extracted_tag = extract_tag_from_filename(filename)
                            if extracted_tag:
                                folder_name = extracted_tag
                                print(f"[TAG] 파일명에서 태그 추출: {filename} → {folder_name}")
                        all_videos.append((full_path, origin, folder_name))

    if not all_videos:
        raise FileNotFoundError(f"'{input_dir}'와 하위 폴더에서 비디오 파일을 찾지 못했습니다.")

    # 경로 기준으로 정렬 (알파벳순)
    all_videos.sort(key=lambda item: item[0])

    print(f"[FOLDER] 발견된 비디오 파일: {len(all_videos)}개")
    print(f"   선택된 파일: {all_videos[0][0]}")

    return all_videos[0]


def move_input_file_to_used(original_path):
    """Input 폴더의 원본 파일을 Used 폴더로 이동."""
    if not original_path or not os.path.exists(original_path):
        return False

    input_dir = get_config_value(["paths", "input_dir"], "Input")
    input_dir_abs = os.path.abspath(input_dir)
    origin_abs = os.path.abspath(original_path)

    # Input 루트 자체를 이동하려는 경우 보호
    try:
        if os.path.isdir(origin_abs) and os.path.samefile(origin_abs, input_dir_abs):
            print(f"[WARNING] Input 루트 폴더는 이동 대상에서 제외합니다: {origin_abs}")
            return False
    except FileNotFoundError:
        return False

    used_root = os.path.join(input_dir, "Used")
    used_root_abs = os.path.abspath(used_root)
    os.makedirs(used_root_abs, exist_ok=True)

    if origin_abs.startswith(used_root_abs):
        return False  # 이미 이동된 파일

    if origin_abs.startswith(input_dir_abs):
        rel_path = os.path.relpath(origin_abs, input_dir_abs)
        dest_path = os.path.join(used_root_abs, rel_path)
    else:
        dest_path = os.path.join(used_root_abs, os.path.basename(origin_abs))

    dest_dir = os.path.dirname(dest_path)
    os.makedirs(dest_dir, exist_ok=True)

    base_name, ext = os.path.splitext(os.path.basename(dest_path))
    counter = 1
    final_dest = dest_path
    while os.path.exists(final_dest):
        final_dest = os.path.join(dest_dir, f"{base_name}_{counter}{ext}")
        counter += 1

    shutil.move(origin_abs, final_dest)
    print(f"[ZIP] 입력 파일 이동: {original_path} -> {final_dest}")
    return True


def cleanup_extracted_video(path_to_video):
    """추출된 임시 비디오 파일과 빈 디렉터리를 정리."""
    if not path_to_video:
        return False

    temp_root = get_config_value(["paths", "temp_dir"], "Temp")
    extract_root = os.path.abspath(os.path.join(temp_root, "extracted_videos"))
    abs_path = os.path.abspath(path_to_video)

    if not abs_path.startswith(extract_root):
        return False

    # 비디오 파일 삭제
    if os.path.exists(abs_path):
        try:
            os.remove(abs_path)
        except (OSError, PermissionError) as e:
            print(f"[WARNING] 임시 파일 삭제 실패 (무시): {e}")
            return False

    # 빈 디렉터리 삭제 (Windows 권한 오류 처리)
    parent = os.path.dirname(abs_path)
    while parent.startswith(extract_root) and parent != extract_root:
        try:
            if not os.listdir(parent):
                os.rmdir(parent)
                parent = os.path.dirname(parent)
            else:
                break
        except (OSError, PermissionError) as e:
            # Windows에서 디렉터리가 사용 중이거나 권한 문제가 있을 수 있음
            # 무시하고 계속 진행
            break
    return True


CONFIG_PATH = os.environ.get("CONFIG_FILE", os.path.join("Config", "config.json"))


def load_config():
    """설정 파일(JSON)을 로드하고 없으면 빈 딕셔너리를 반환"""
    if not os.path.exists(CONFIG_PATH):
        return {}

    with open(CONFIG_PATH, "r", encoding="utf-8") as cfg:
        try:
            return json.load(cfg)
        except json.JSONDecodeError as exc:
            raise ValueError(f"설정 파일 파싱에 실패했습니다: {CONFIG_PATH}") from exc


CONFIG = load_config()


def get_config_value(path, default=None):
    """중첩된 설정 값을 안전하게 조회"""
    current = CONFIG
    for key in path:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    return current if current is not None else default


def get_layout_value(category, key, fallback_path=None, default=None):
    """layout_settings 우선, 없으면 기존 경로에서 값을 반환."""
    layout = get_config_value(["layout_settings", category, key], None)
    if layout is not None:
        return layout
    if fallback_path:
        return get_config_value(fallback_path, default)
    return default


def get_layout_value(category, key, fallback_path=None, default=None):
    """layout_settings 우선, 없으면 기존 경로에서 값을 반환."""
    layout = get_config_value(["layout_settings", category, key], None)
    if layout is not None:
        return layout
    if fallback_path:
        return get_config_value(fallback_path, default)
    return default


def _get_302ai_config():
    """302.ai API 설정 가져오기"""
    api_key = os.getenv("AI_302_API_KEY")
    if not api_key:
        api_key = get_config_value(["ai_settings", "api_key"])

    if not api_key:
        raise RuntimeError(
            "302.ai API 키가 설정되어 있지 않습니다. "
            "AI_302_API_KEY 환경변수를 설정하거나 "
            "`Config/config.json`의 `ai_settings.api_key`에 값을 지정하세요."
        )

    # API 키 공백 제거 및 정리
    api_key = api_key.strip()

    base_url = get_config_value(["ai_settings", "base_url"], "https://api.302.ai/v1")
    model = get_config_value(["ai_settings", "model"], "gemini-2.5-flash")

    # 디버그: API 키 앞 10자와 길이 확인
    print(f"[DEBUG] API 키 시작: {api_key[:10] if len(api_key) > 10 else api_key}...")
    print(f"[DEBUG] API 키 길이: {len(api_key)} 문자")

    return {
        "api_key": api_key,
        "base_url": base_url,
        "model": model
    }


def get_available_chromakey_videos():
    """reaction chromakey 폴더에서 사용 가능한 크로마키 비디오 목록 반환"""
    chromakey_dir = "reaction chromakey"
    if not os.path.exists(chromakey_dir):
        return []

    video_files = []
    for filename in os.listdir(chromakey_dir):
        if filename.lower().endswith(SUPPORTED_VIDEO_EXTENSIONS):
            video_files.append(filename)

    return sorted(video_files)


def _build_gemini_prompt(duration_seconds: float) -> str:
    """Gemini 프롬프트 문자열 생성"""
    duration_text = f"{duration_seconds:.2f} seconds"
    num_highlights = 1  # 항상 1문장만 사용

    # 언어 설정 가져오기
    language = get_config_value(["voice_settings", "language"], "en")

    # 사용 가능한 크로마키 비디오 목록
    chromakey_videos = get_available_chromakey_videos()
    chromakey_list = "\n".join([f"  - {video}" for video in chromakey_videos]) if chromakey_videos else "  (None available)"

    if language == "ko":
        # 한국어 프롬프트
        instructions = f"""
당신은 스포츠 순간을 감동적이고 드라마틱한 이야기로 변환하는 스토리텔러입니다.

⏱️ **중요 제약사항**: 이 비디오는 정확히 {duration_text} 길이입니다. 모든 나레이션 타임스탬프는 이 길이 내에 있어야 합니다!

🎯 필수 분석:
1. 전체 클립을 시청하고 스토리를 구성하세요:
   - 드라마틱한 설정은 무엇인가? (상황, 무엇이 걸려있는가)
   - 어떤 갈등이나 도전이 있는가?
   - 예상치 못한 반전이나 클라이맥스 순간은?
   - 어떻게 해결되는가? (성공, 실패, 놀라움)
   - 가장 중요한 순간의 정확한 타임스탬프
   - 특히 관중 리액션이나 카메라 이동이 아닌 **가장 화려하고 액션이 폭발하는 시점**을 정확히 찾으세요

2. **중요 - 불필요한 인트로 제거 (매우 적극적으로)**:
   - 비디오를 보고 흥미롭거나 중요한 액션이 시작되는 정확한 시점을 찾으세요
   - 그 순간 이전의 모든 것을 잘라내세요 - 지루한 인트로, 준비, 대기, 카메라 조정, 느린 시작
   - **보수적이지 마세요** - 처음 3-5초가 중요하지 않다면 잘라내세요
   - 비디오가 첫 0.5초 이내에 즉시 중요한 액션으로 시작하는 경우에만 trim을 0초로 설정하세요
   - 일반적인 시나리오:
     * 액션 전에 사람이 걷거나 접근 → 걷는 부분 제거
     * 메인 피사체 전에 카메라 패닝/조정 → 패닝 제거
     * 클라이맥스 전의 느린 빌드업 → 클라이맥스 직전으로 이동
     * 지루한 설정 샷 → 완전히 제거
   - 목표: 시청자를 즉시 좋은 부분으로 데려가기
   - 일반적인 trim: 2-5초, 매우 느린 인트로의 경우 8-10초
   - 확실하지 않을 때는 더 많이 자르세요

3. 나레이션 스타일 (짧고 강렬하게):
   - 매우 짧게 - 최대 5-6단어만
   - 임팩트 있고 기억에 남는 단어 사용
   - 불필요한 형용사나 필러 단어 없이
   - 예시: "완벽한 착지", "카르마의 역습", "얼음이 이겼다"
   - **모든 문장은 반드시 완전한 종결 어미(예: \"입니다\", \"이에요\", \"이네요\", \"이죠\", \"인데요\")로 마무리하세요.** 중간에 끊긴 구나 명사형으로 끝나면 안 됩니다.

4. 타이밍 규칙 (원본 비디오 길이: {duration_text}):
   - **중요**: 정확히 1개의 나레이션 라인만 생성하세요. 여러 라인 생성 금지.
   - **중요**: 모든 타임스탬프는 원본 비디오 기준이어야 합니다 (trim 전)
   - Trim은 자동으로 적용되며 타임스탬프가 조정됩니다
   - 단 하나의 나레이션 세그먼트만 생성
   - **짧게 유지**: 최대 5-6단어만 (약 1-1.5초 분량)
   - 강렬하고 임팩트 있는 단어 사용 - 필러 없이
   - 예시: "완벽한 착지", "얼음의 승리", "즉각적인 카르마"
   - 라인은 {duration_text} 이전에 끝나야 합니다
   - 여러 세그먼트로 나누지 마세요 - 총 1개 라인만

5. 제목, 설명:
   - YouTube 제목: 최대 3단어만. 짧고 강렬하게.
   - 설명: 2-4문장으로 스토리를 설정하고 왜 볼 가치가 있는지 암시.

6. 리액션 비디오 선택:
사용 가능한 크로마키 클립 (정확히 하나 선택):
{chromakey_list}

클립의 감정적 분위기와 매칭:
- "Green Screen Laughing Dog Meme.mp4" → 재미있거나 즐거운 순간
- "laughing.mp4" → 가벼운 또는 즐거운 상황
- "surprised.mp4" → 예상치 못한 또는 충격적인 플레이
- "wow.mp4" → 인상적이거나 숙련된 순간
- "wtf.mp4" → 특이하거나 혼란스러운 상황

시청자에게 자연스러워 보일 것을 선택하세요.

7. 출력 형식 (모두 한국어로):
=== 분석 ===
비디오 요약: [무슨 일이 일어나는지, 왜 감정적으로 중요한지 2-3문장으로]
핵심 요소: [드라마틱한 비트, 긴장 포인트, 클라이맥스 순간에 대한 불릿 스타일 설명]
나레이션 전략: [시청자를 어떻게 끌어들이고, 긴장을 구축하고, 클라이맥스를 전달할지 설명]

=== 스크립트 ===
**중요**: 단 하나의 나레이션 라인만 생성하세요. 2개도, 3개도 아닌, 딱 1개!
**중요**: 최대 5-6단어만. 짧고 강렬하게.
**중요**: 원본 비디오 길이는 {duration_text}입니다. 원본 비디오 기준 타임스탬프 사용.
(모든 문장은 반드시 자연스러운 종결어미로 끝나 완전한 문장이 되도록 하세요.)
(MM:SS - MM:SS) [짧고 강렬한 구문 - 최대 5-6단어 - {duration_text} 이전에 끝나야 함]

예시 (얼마나 짧은지 주목):
(00:02 - 00:04) 완벽한 착지였어요.
(00:01 - 00:03) 얼음이 항상 이기네요.
(00:03 - 00:05) 즉각적인 카르마입니다.

=== 시작 부분 자르기 ===
**중요**: 시작 부분의 모든 지루한 콘텐츠를 잘라내세요. 적극적으로!
Trim Start: X.X 초 [왜 이 부분을 자르는지 구체적인 이유]

규칙:
- 흥미롭거나 중요한 일이 발생하는 정확한 초를 찾으세요
- 그 순간 이전의 모든 것을 잘라내세요
- 소수점 정밀도 사용 (예: 3.5, 4.2, 7.8)
- 액션이 즉시 시작하는 경우에만 0.0으로 설정 (0.5초 이내)
- 확실하지 않을 때는 더 많이 자르세요 (덜 자르지 마세요)

예시:
- Trim Start: 3.5 초 [메인 액션 전에 천천히 걷는 사람]
- Trim Start: 5.0 초 [카메라 패닝 및 조정]
- Trim Start: 2.2 초 [지루한 설정 샷]
- Trim Start: 0.0 초 [액션이 즉시 시작]

Key moment: MM:SS [가장 화려한 액션/클라이맥스가 터지는 정확한 초 (trim 적용 후)]
Background Music: [Yes/No]
Reaction Video: [리스트에서 정확한 파일명]
YouTube Title: [최대 3단어 - 짧고 강렬하게]
YouTube Description: [내러티브를 설정하고 클라이맥스를 암시하는 2-4개의 한국어 문장, 관련 해시태그 포함]

비디오 정보:
- **비디오 길이: {duration_text} - 어떤 타임스탬프도 이 길이를 초과하지 마세요!**
- 초점: 설정, 긴장, 클라이맥스, 해결을 포함한 이야기 구조
- 스타일: 드라마, 감정, 시청자를 계속 보게 만드는 훅을 사용한 매력적인 스토리텔링
- 목표: 감정적 연결 생성, 시청자가 흥분, 놀라움, 유머를 느끼게 만들기
- **타이밍 제약**: 각 나레이션 라인은 약 2-3초. {duration_text} 내에 모든 나레이션이 들어가도록 타임스탬프 계산.
- **중요: 모든 나레이션 라인, 자막 텍스트, 제목, 설명을 자연스러운 한국어로 작성하세요.**
- 추가 설명이나 마크다운 없이 일반 텍스트만 출력하세요.
"""
    else:
        # 영어 프롬프트
        instructions = f"""
You are a compelling storyteller who transforms sports moments into engaging narratives with drama and emotion.

⏱️ **CRITICAL CONSTRAINT**: This video is exactly {duration_text} long. ALL narration timestamps MUST fit within this duration!

🎯 Required analysis:
1. Watch the entire clip and craft a story:
   - What's the dramatic setup? (the situation, the stakes)
   - What's the conflict or challenge being faced?
   - What's the unexpected twist or climactic moment?
   - How does it resolve? (success, failure, surprise)
   - The exact timestamp of the most critical moment.
   - This MUST be the flashiest, most intense action beat (not crowd shots or slow reactions) — the instant viewers would replay.

2. Build the narrative context:
   - Set the scene: who, where, what sport/activity
   - Create tension: what makes this moment high-stakes or interesting?
   - Find the human element: effort, skill, surprise, humor, or irony
   - Highlight the payoff: why viewers should care about the outcome

3. **CRITICAL - Trim unnecessary intro (BE VERY AGGRESSIVE)**:
   - Watch the video and identify EXACTLY when the interesting/important action starts
   - Cut EVERYTHING before that moment - boring intros, setup, waiting, camera adjustments, slow lead-ins
   - **DO NOT be conservative** - if the first 3-5 seconds are not critical, CUT THEM
   - Only set trim to 0 seconds if the video IMMEDIATELY starts with critical action (within first 0.5 seconds)
   - Common scenarios:
     * Person walking/approaching before action → CUT the walking part
     * Camera panning/adjusting before main subject → CUT the panning
     * Slow buildup before payoff → CUT to right before the payoff
     * Boring establishing shots → CUT them completely
   - Your goal: Get viewers to the good part INSTANTLY
   - Typical trim: 2-5 seconds, but can be 8-10 seconds for very slow intros
   - When in doubt, trim MORE rather than less

4. Narration style (SHORT and PUNCHY):
   - Keep it EXTREMELY brief - just 5-6 words maximum
   - Use impactful, memorable words
   - No unnecessary adjectives or filler words
   - Think: "Ice wins again" not "The ice completely defeats her once more"
   - Examples: "She crushed it", "Karma strikes back", "Perfect landing nailed"

5. Timing rules (ORIGINAL VIDEO LENGTH: {duration_text}):
   - **CRITICAL**: Deliver EXACTLY 1 narration line ONLY. DO NOT create multiple lines.
   - **IMPORTANT**: All timestamps should be based on the ORIGINAL video (before trim)
   - The trim will be applied automatically, and timestamps will be adjusted
   - Create only ONE single narration segment
   - **KEEP IT SHORT**: Maximum 5-6 words ONLY (about 1-1.5 seconds of speech)
   - Use punchy, impactful words - no filler
   - Examples: "She nailed the move", "Ice wins again", "Karma strikes hard"
   - The line MUST finish before {duration_text}
   - DO NOT split into multiple segments - just ONE line total

6. Title, description:
   - YouTube title: MAXIMUM 3 words ONLY. Keep it SHORT and punchy.
   # - Thumbnail title: 3–4 punchy English words that tease the story or surprise. (비활성화됨)
   - Description: 2–4 sentences that set up the story and hint at why it's worth watching.

7. Reaction video picker:
Available chroma-key clips (choose exactly one):
{chromakey_list}

Match the clip's emotional beat:
- "Green Screen Laughing Dog Meme.mp4" → funny or entertaining moments
- "laughing.mp4" → lighthearted or fun situations
- "surprised.mp4" → unexpected or shocking plays
- "wow.mp4" → impressive or skillful moments
- "wtf.mp4" → unusual or confusing situations

Choose what would look natural for the viewer.

8. Output format (everything in English):
=== ANALYSIS ===
Video Summary: [2–3 sentences about the story: what happens, why it matters emotionally]
Key Elements: [bullet-style description of dramatic beats, tension points, and payoff moments]
Narration Strategy: [explain the narrative arc - how you'll hook viewers, build tension, and deliver the payoff]

=== SCRIPT ===
**CRITICAL**: Create ONLY ONE narration line. NOT 2, NOT 3, JUST 1!
**CRITICAL**: Maximum 5-6 words ONLY. Keep it SHORT and PUNCHY.
**IMPORTANT**: Original video duration is {duration_text}. Use timestamps based on ORIGINAL video.
(MM:SS - MM:SS) [Short punchy phrase - 5-6 words MAX - MUST finish before {duration_text}]

Examples (notice how SHORT they are):
(00:02 - 00:04) She nailed the move.
(00:01 - 00:03) Ice wins every time.
(00:03 - 00:05) Karma strikes instantly.

=== TRIM START ===
**CRITICAL**: Trim ALL boring content from the start. Be AGGRESSIVE!
Trim Start: X.X seconds [specific reason why you're cutting this]

Rules:
- Find the EXACT second when something interesting/important happens
- Cut everything before that moment
- Use decimal precision (e.g., 3.5, 4.2, 7.8)
- Only set to 0.0 if action starts IMMEDIATELY (within 0.5 seconds)
- When unsure, trim MORE (not less)

Examples:
- Trim Start: 3.5 seconds [person walking slowly before main action]
- Trim Start: 5.0 seconds [camera panning and adjusting]
- Trim Start: 2.2 seconds [boring establishing shot]
- Trim Start: 0.0 seconds [action starts immediately]

Key moment: MM:SS [timestamp of the flashiest, most intense action beat - AFTER trim is applied]
# Thumbnail Title: [3–4 word English phrase] (비활성화됨 - 썸네일 타이틀 사용 안 함)
# Core Keyword: [1–3 English words pulled from the thumbnail] (비활성화됨 - 키워드 하이라이트 사용 안 함)
Background Music: [Yes/No]
Reaction Video: [exact filename from the list]
YouTube Title: [MAXIMUM 3 words - SHORT and punchy]
YouTube Description: [2–4 English sentences that set up the narrative and tease the payoff, plus relevant hashtags]

Video info:
- **VIDEO DURATION: {duration_text} - DO NOT exceed this length in any timestamp!**
- Focus: narrative arc with setup, tension, climax, and resolution
- Style: engaging storytelling with drama, emotion, and hooks that keep viewers watching
- Goal: create an emotional connection and make viewers feel the excitement, surprise, or humor
- **Timing constraint**: Each narration line is ~2-3 seconds. Calculate timestamps to fit ALL narration within {duration_text}.
- **Important: write every narration line, subtitle text, thumbnail copy, title, and description in natural English.**
- Output plain text only with zero extra commentary or Markdown.
"""
    return textwrap.dedent(instructions).strip()


def _get_gemini_file_state(file_obj) -> str:
    """Gemini 파일 상태 값을 문자열로 변환"""
    state = getattr(file_obj, "state", None)
    if hasattr(state, "name"):
        return str(state.name)
    if isinstance(state, int):
        state_map = {
            0: "STATE_UNSPECIFIED",
            1: "PROCESSING",
            2: "ACTIVE",
            3: "FAILED",
        }
        return state_map.get(state, str(state))
    if isinstance(state, str):
        return state
    return str(state)


def generate_script_with_gemini(video_path: str) -> str:
    """302.ai API를 사용하여 자동 스크립트 생성"""
    ai_settings = get_config_value(["ai_settings"], {}) or {}
    if not ai_settings.get("enabled", True):
        raise RuntimeError("AI 자동 스크립트 생성이 비활성화되어 있습니다.")

    clip = VideoFileClip(video_path)
    try:
        duration = clip.duration or 0.0
    finally:
        clip.close()

    config = _get_302ai_config()
    prompt = _build_gemini_prompt(duration)

    print("\n[AI] 302.ai API로 스크립트 생성 중...")
    print(f"   비디오: {os.path.basename(video_path)}")
    print(f"   길이: {duration:.2f}초")

    # 302.ai chat completions API 호출
    url = f"{config['base_url']}/chat/completions"
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json"
    }

    # 비디오 정보를 포함한 프롬프트
    video_context = f"이 비디오는 {duration:.1f}초 길이의 소셜 미디어 쇼츠 비디오입니다. 파일명: {os.path.basename(video_path)}"
    full_prompt = f"{video_context}\n\n{prompt}"

    data = {
        "model": config['model'],
        "messages": [
            {"role": "system", "content": "당신은 소셜 미디어 쇼츠 비디오를 위한 스크립트 작성 전문가입니다."},
            {"role": "user", "content": full_prompt}
        ],
        "temperature": ai_settings.get("generation_config", {}).get("temperature", 0.7),
        "max_tokens": 2000
    }

    # API 호출 (재시도 로직 포함)
    max_retries = 3
    retry_delay = 1.0

    for attempt in range(max_retries):
        try:
            response = requests.post(url, headers=headers, json=data, timeout=int(ai_settings.get("timeout", 60)))

            if response.status_code == 200:
                result = response.json()
                script_text = result['choices'][0]['message']['content'].strip()
                print("[OK] 302.ai 스크립트 생성 완료")
                return script_text
            else:
                error_text = response.text
                raise RuntimeError(f"API 오류 (HTTP {response.status_code}): {error_text}")

        except requests.exceptions.Timeout:
            if attempt < max_retries - 1:
                print(f"[WARNING] API 타임아웃 (시도 {attempt + 1}/{max_retries})")
                print(f"[INFO] {retry_delay}초 대기 후 재시도...")
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                raise RuntimeError(f"API 타임아웃 ({max_retries}회 재시도 후)")

        except Exception as exc:
            if attempt < max_retries - 1:
                print(f"[WARNING] API 호출 실패 (시도 {attempt + 1}/{max_retries}): {exc}")
                print(f"[INFO] {retry_delay}초 대기 후 재시도...")
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                raise RuntimeError(f"스크립트 생성 실패 ({max_retries}회 재시도 후): {exc}") from exc


def parse_script(text):
    """
    타임스탬프가 포함된 스크립트를 파싱하여 세그먼트 리스트와 메타데이터로 변환

    Args:
        text (str): 형식:
            === ANALYSIS ===
            Video Summary: ...
            Key Elements: ...
            Narration Strategy: ...
            === SCRIPT ===
            (MM:SS - MM:SS) 텍스트 내용
            Key moment: MM:SS
            Thumbnail Title: 제목
            Background Music: 옵션

    Returns:
        tuple: (segments, metadata)
            segments: [{'start': 초, 'end': 초, 'text': '내용'}]
            metadata: {'key_moment': 초, 'thumbnail_title': '제목', 'background_music': '옵션', 'analysis': {...}}
    """
    segments = []
    metadata = {
        'key_moment': None,
        'thumbnail_title': None,
        'background_music': None,
        'core_keyword': None,
        'youtube_title': None,
        'youtube_description': None,
        'reaction_video': None,
        'trim_start': 0.0,
        'analysis': {
            'video_summary': None,
            'key_elements': None,
            'narration_strategy': None
        }
    }

    # ANALYSIS 섹션 추출
    analysis_match = re.search(
        r'===\s*(?:ANALYSIS|분석)\s*===(.*?)(?:===\s*(?:SCRIPT|스크립트)\s*===|$)',
        text,
        re.DOTALL | re.IGNORECASE
    )
    if analysis_match:
        analysis_text = analysis_match.group(1).strip()

        # Video Summary 추출
        summary_match = re.search(
            r'(?:Video Summary|비디오 요약):\s*(.*?)(?:\n|$)',
            analysis_text,
            re.IGNORECASE
        )
        if summary_match:
            metadata['analysis']['video_summary'] = summary_match.group(1).strip()

        # Key Elements 추출
        elements_match = re.search(
            r'(?:Key Elements|핵심 요소):\s*(.*?)(?:\n|$)',
            analysis_text,
            re.IGNORECASE
        )
        if elements_match:
            metadata['analysis']['key_elements'] = elements_match.group(1).strip()

        # Narration Strategy 추출
        strategy_match = re.search(
            r'(?:Narration Strategy|나레이션 전략):\s*(.*?)(?:\n|$)',
            analysis_text,
            re.IGNORECASE
        )
        if strategy_match:
            metadata['analysis']['narration_strategy'] = strategy_match.group(1).strip()

        # 분석 결과 로그 출력
        print("\n" + "="*60)
        print("[AI 분석] 비디오 분석 결과")
        print("="*60)
        if metadata['analysis']['video_summary']:
            print(f"\n📹 주요 내용:\n   {metadata['analysis']['video_summary']}")
        if metadata['analysis']['key_elements']:
            print(f"\n🎯 핵심 요소:\n   {metadata['analysis']['key_elements']}")
        if metadata['analysis']['narration_strategy']:
            print(f"\n💬 대사 전략:\n   {metadata['analysis']['narration_strategy']}")
        print("\n" + "="*60)

    lines = text.strip().split('\n')

    # SCRIPT 섹션과 CUT SEGMENTS 섹션 분리
    script_section = []
    in_script_section = False

    script_header_patterns = [
        r'=+\s*SCRIPT\s*=+',
        r'=+\s*스크립트\s*=+',
    ]
    trim_header_patterns = [
        r'=+\s*TRIM\s+START\s*=+',
        r'=+\s*시작\s*부분\s*자르기\s*=+',
    ]

    for line in lines:
        line_stripped = line.strip()
        if any(re.match(pattern, line_stripped, re.IGNORECASE) for pattern in script_header_patterns):
            in_script_section = True
            continue
        elif any(re.match(pattern, line_stripped, re.IGNORECASE) for pattern in trim_header_patterns):
            in_script_section = False
            continue

        if in_script_section:
            script_section.append(line_stripped)

    # 정규표현식 패턴들
    dialogue_pattern = r'\((\d{2}:\d{2}(?:\.\d+)?)\s*-\s*(\d{2}:\d{2}(?:\.\d+)?)\)\s*(.*)'
    key_moment_pattern = r'(?:Key moment|Most important timeline):\s*(?:(\d{2}:\d{2})|(\d+)\s*seconds?)'
    thumbnail_pattern = r'Thumbnail Title:\s*(.*)'
    background_pattern = r'Background Music:\s*(.*)'
    core_keyword_pattern = r'Core Keyword:\s*(.*)'
    youtube_title_pattern = r'YouTube Title:\s*(.*)'
    youtube_desc_pattern = r'YouTube Description:\s*(.*)'
    reaction_video_pattern = r'Reaction Video:\s*(.*)'

    # SCRIPT 섹션에서만 대사 파싱
    for line in script_section:
        dialogue_match = re.match(dialogue_pattern, line, flags=re.IGNORECASE)
        if dialogue_match:
            start_time = dialogue_match.group(1)
            end_time = dialogue_match.group(2)
            text_content = dialogue_match.group(3).strip()

            # [ ]로 시작하는 주석/설명은 제외
            if text_content and not text_content.startswith('['):
                segments.append({
                    'start': time_to_seconds(start_time),
                    'end': time_to_seconds(end_time),
                    'text': text_content
                })

    # 메타데이터는 전체 텍스트에서 파싱
    for line in lines:
        line = line.strip()

        # Key moment 파싱
        key_match = re.match(key_moment_pattern, line, flags=re.IGNORECASE)
        if key_match:
            # MM:SS 형식 또는 숫자(초) 형식 둘 다 지원
            if key_match.group(1):  # MM:SS 형식
                metadata['key_moment'] = time_to_seconds(key_match.group(1))
            elif key_match.group(2):  # 숫자(초) 형식
                metadata['key_moment'] = int(key_match.group(2))
            continue

        # Thumbnail title 파싱 - 비활성화됨
        # thumb_match = re.match(thumbnail_pattern, line, flags=re.IGNORECASE)
        # if thumb_match:
        #     metadata['thumbnail_title'] = thumb_match.group(1).strip()
        #     continue

        # Background music 파싱
        background_match = re.match(background_pattern, line, flags=re.IGNORECASE)
        if background_match:
            bg_text = background_match.group(1).strip().lower()
            # "no" 또는 "no background music is present" 같은 문장 모두 처리
            if 'no' in bg_text:
                metadata['background_music'] = 'no'
            else:
                metadata['background_music'] = background_match.group(1).strip()
            continue

        # Core keyword 파싱 - 비활성화됨
        # keyword_match = re.match(core_keyword_pattern, line, flags=re.IGNORECASE)
        # if keyword_match:
        #     keyword_value = keyword_match.group(1).strip()
        #     if len(keyword_value) >= 2 and keyword_value[0] == keyword_value[-1] and keyword_value[0] in {"'", '"'}:
        #         keyword_value = keyword_value[1:-1].strip()
        #     metadata['core_keyword'] = keyword_value
        #     continue

        # YouTube title 파싱
        yt_title_match = re.match(youtube_title_pattern, line, flags=re.IGNORECASE)
        if yt_title_match:
            metadata['youtube_title'] = yt_title_match.group(1).strip()
            continue

        # YouTube description 파싱
        yt_desc_match = re.match(youtube_desc_pattern, line, flags=re.IGNORECASE)
        if yt_desc_match:
            metadata['youtube_description'] = yt_desc_match.group(1).strip()
            continue

        # Reaction video 파싱
        reaction_match = re.match(reaction_video_pattern, line, flags=re.IGNORECASE)
        if reaction_match:
            reaction_filename = reaction_match.group(1).strip()
            # 따옴표 제거
            if len(reaction_filename) >= 2 and reaction_filename[0] == reaction_filename[-1] and reaction_filename[0] in {"'", '"'}:
                reaction_filename = reaction_filename[1:-1].strip()
            metadata['reaction_video'] = reaction_filename
            continue

    # TRIM START 섹션 추출
    trim_start_match = re.search(
        r'===\s*(?:TRIM\s+START|시작\s*부분\s*자르기)\s*===(.*?)(?:Key moment|Background Music|Reaction Video|YouTube Title|YouTube Description|$)',
        text,
        re.DOTALL | re.IGNORECASE
    )
    if trim_start_match:
        trim_text = trim_start_match.group(1).strip()
        # "Trim Start: X.X seconds" 형식 추출
        trim_pattern = r'Trim Start:\s*([\d.]+)\s*(?:seconds?|초)'
        trim_match = re.search(trim_pattern, trim_text, re.IGNORECASE)

        if trim_match:
            trim_seconds = float(trim_match.group(1))
            metadata['trim_start'] = trim_seconds
            print(f"\n✂️  앞부분 제거: {trim_seconds:.2f}초")
        else:
            print(f"[WARNING] TRIM START 값을 파싱할 수 없습니다. 기본값 0초 사용.")

    return segments, metadata


def time_to_seconds(time_str):
    """
    MM:SS 또는 MM:SS.X 형식을 초 단위로 변환

    Args:
        time_str (str): "MM:SS" 또는 "MM:SS.X" 형식

    Returns:
        float: 총 초
    """
    parts = time_str.split(':')
    minutes = int(parts[0])
    seconds = float(parts[1])
    return minutes * 60 + seconds


def get_random_sound_effect():
    """sound effects 폴더에서 랜덤 오디오 파일 선택"""
    sound_effects_dir = "sound effects"

    if not os.path.exists(sound_effects_dir):
        print(f"[WARNING] sound effects 폴더를 찾을 수 없습니다: {sound_effects_dir}")
        return None

    audio_files = [
        f for f in os.listdir(sound_effects_dir)
        if f.lower().endswith(('.mp3', '.wav', '.m4a', '.aac'))
    ]

    if not audio_files:
        print(f"[WARNING] sound effects 폴더에 오디오 파일이 없습니다.")
        return None

    selected = random.choice(audio_files)
    return os.path.join(sound_effects_dir, selected)


def get_random_background_music():
    """background music 폴더에서 랜덤 오디오 파일 선택"""
    music_dir = "background music"

    if not os.path.exists(music_dir):
        print(f"[WARNING] background music 폴더를 찾을 수 없습니다: {music_dir}")
        return None

    audio_files = [
        f for f in os.listdir(music_dir)
        if f.lower().endswith(('.mp3', '.wav', '.m4a', '.aac'))
    ]

    if not audio_files:
        print("[WARNING] background music 폴더에 오디오 파일이 없습니다.")
        return None

    selected = random.choice(audio_files)
    return os.path.join(music_dir, selected)


def get_start_sound():
    """start sound 폴더에서 랜덤 오디오 파일 선택"""
    start_sound_dir = "start sound"

    if not os.path.exists(start_sound_dir):
        print(f"[WARNING] start sound 폴더를 찾을 수 없습니다: {start_sound_dir}")
        return None

    audio_files = [
        f for f in os.listdir(start_sound_dir)
        if f.lower().endswith(('.mp3', '.wav', '.m4a', '.aac'))
    ]

    if not audio_files:
        print("[WARNING] start sound 폴더에 오디오 파일이 없습니다.")
        return None

    selected = random.choice(audio_files)
    return os.path.join(start_sound_dir, selected)


def generate_voice(text, output_path):
    """302.ai MiniMax TTS를 사용하여 음성을 생성"""
    try:
        generate_voice_minimax(text, output_path)
        apply_voice_profile(output_path)
        print(f"[OK] 음성 생성 완료: {output_path}")
    except Exception as exc:
        raise RuntimeError(f"TTS 음성 생성 실패: {exc}") from exc


def generate_voice_minimax(text, output_path):
    """302.ai MiniMax TTS API로 음성을 생성"""
    # API 키 가져오기 (환경변수 또는 config.json)
    api_key = os.getenv("AI_302_API_KEY")
    if not api_key:
        api_key = get_config_value(["minimax_settings", "api_key"])

    if not api_key:
        raise RuntimeError(
            "302.ai API 키가 설정되지 않았습니다. "
            "AI_302_API_KEY 환경변수를 설정하거나 "
            "Config/config.json의 minimax_settings.api_key를 설정해주세요."
        )

    # API 설정 가져오기
    base_url = get_config_value(["minimax_settings", "base_url"], "https://api.302.ai/v1")
    model = get_config_value(["minimax_settings", "model"], "speech-01-turbo")
    voice = get_config_value(["voice_settings", "voice"], "Korean_SweetGirl")
    speed = float(get_config_value(["voice_settings", "speed"], 1.0))

    # API 엔드포인트
    url = f"{base_url}/audio/speech"

    # 요청 헤더
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # 요청 바디
    data = {
        "model": model,
        "input": text,
        "voice": voice,
        "response_format": "mp3",
        "speed": speed
    }

    print(f"[TTS] 302.ai MiniMax TTS 호출 중... (model: {model}, voice: {voice}, speed: {speed})")

    # 재시도 로직
    max_retries = 3
    retry_delay = 1.0

    for attempt in range(max_retries):
        try:
            response = requests.post(url, headers=headers, json=data, timeout=30)

            if response.status_code == 200:
                # 오디오 데이터 저장
                with open(output_path, "wb") as audio_file:
                    audio_file.write(response.content)
                print(f"[TTS] 음성 생성 성공: {len(response.content)} bytes")
                return
            else:
                error_text = response.text
                raise RuntimeError(f"API 오류 (HTTP {response.status_code}): {error_text}")

        except requests.exceptions.Timeout:
            if attempt < max_retries - 1:
                print(f"[WARNING] TTS API 타임아웃 (시도 {attempt + 1}/{max_retries})")
                print(f"[INFO] {retry_delay}초 대기 후 재시도...")
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                raise RuntimeError(f"TTS API 타임아웃 ({max_retries}회 재시도 후)")

        except Exception as exc:
            if attempt < max_retries - 1:
                print(f"[WARNING] TTS API 호출 실패 (시도 {attempt + 1}/{max_retries}): {exc}")
                print(f"[INFO] {retry_delay}초 대기 후 재시도...")
                time.sleep(retry_delay)
                retry_delay *= 2
            else:
                raise RuntimeError(f"TTS 음성 생성 실패 ({max_retries}회 재시도 후): {exc}") from exc


def apply_voice_profile(audio_path):
    """선택된 음성 프로필에 맞춰 음성을 후처리"""
    profile_name = str(get_config_value(["voice_settings", "profile"], "default") or "default").strip()
    profile_key = profile_name.lower()
    if profile_key in {"", "default"}:
        return

    if not os.path.exists(audio_path):
        return

    if AudioSegment is None or PYDUB_IMPORT_ERROR is not None:
        missing_module = getattr(PYDUB_IMPORT_ERROR, "name", "pydub") if PYDUB_IMPORT_ERROR else "pydub"
        print(
            f"[WARNING]  '{profile_name}' 음성 프로필 후처리를 위해 `pydub` 모듈이 필요합니다. "
            f"현재 '{missing_module}'을(를) 불러오지 못해 후처리를 건너뜁니다."
        )
        return

    profile_config = get_config_value(["voice_profiles", profile_key], None)
    if not isinstance(profile_config, dict):
        print(f"[WARNING]  '{profile_name}' 음성 프로필 설정을 찾을 수 없어 후처리를 건너뜁니다.")
        return

    playback_speed = float(profile_config.get("speed", 1.0))
    pitch_shift = float(profile_config.get("pitch_shift", 0.0))
    compression_threshold = float(profile_config.get("compression_threshold", -18.0))
    compression_ratio = float(profile_config.get("compression_ratio", 3.0))
    compression_attack = float(profile_config.get("compression_attack", 5.0))
    compression_release = float(profile_config.get("compression_release", 120.0))
    gain = float(profile_config.get("gain", 0.0))

    audio = AudioSegment.from_file(audio_path)
    original_frame_rate = audio.frame_rate

    if pitch_shift:
        audio = shift_pitch(audio, pitch_shift, original_frame_rate)

    if playback_speed > 1.0:
        audio = speedup(audio, playback_speed=playback_speed, chunk_size=50, crossfade=25)
    elif 0 < playback_speed < 1.0:
        slowed = audio._spawn(audio.raw_data, overrides={"frame_rate": int(audio.frame_rate * playback_speed)})
        audio = slowed.set_frame_rate(original_frame_rate)

    audio = compress_dynamic_range(
        audio,
        threshold=compression_threshold,
        ratio=compression_ratio,
        attack=compression_attack,
        release=compression_release,
    )

    if gain:
        audio = audio.apply_gain(gain)

    audio.export(audio_path, format="mp3")


def shift_pitch(audio_segment, semitones, frame_rate):
    """프레임 레이트를 조정하여 간단히 피치를 이동"""
    if semitones == 0:
        return audio_segment

    factor = 2 ** (semitones / 12)
    pitched = audio_segment._spawn(
        audio_segment.raw_data,
        overrides={"frame_rate": int(audio_segment.frame_rate * factor)}
    )
    return pitched.set_frame_rate(frame_rate)




def detect_scene_changes(video_clip, threshold=30.0, min_scene_duration=1.0):
    """프레임 간 차이를 기반으로 씬 전환 시점을 감지."""
    if threshold <= 0:
        return []

    fps = getattr(video_clip, "fps", None) or 24
    sample_fps = max(2, min(15, int(fps / 2) or 6))

    previous_frame = None
    last_change_time = -min_scene_duration
    change_times = []

    width, height = video_clip.size
    downsample_x = max(1, width // 320)
    downsample_y = max(1, height // 180)

    for index, frame in enumerate(video_clip.iter_frames(fps=sample_fps, dtype="uint8")):
        if downsample_x > 1 or downsample_y > 1:
            frame = frame[::downsample_y, ::downsample_x]

        gray = np.dot(frame[..., :3], [0.2989, 0.5870, 0.1140]).astype("float32")

        if previous_frame is not None:
            diff = np.mean(np.abs(gray - previous_frame))
            current_time = index / sample_fps
            if diff >= threshold and (current_time - last_change_time) >= min_scene_duration:
                change_times.append(current_time)
                last_change_time = current_time

        previous_frame = gray

    return change_times


def remove_chromakey(frame, color='green', threshold=100, blend=1):
    """
    Remove a chroma key background from an RGB frame.

    Args:
        frame: numpy array (H, W, 3) in RGB order.
        color: 'green' or 'blue' indicating the key color.
        threshold: Euclidean color distance treated as keyed (0-255).
        blend: Optional Gaussian blur strength for soft edges.

    Returns:
        Tuple[np.ndarray, np.ndarray]: (cleaned RGB frame, alpha mask 0.0-1.0).
    """
    threshold = float(np.clip(threshold, 0, 255))

    if color.lower() == 'green':
        key_color = np.array([0, 255, 0], dtype=np.float32)
    else:
        key_color = np.array([0, 0, 255], dtype=np.float32)

    frame_float = frame.astype(np.float32)
    distance = np.linalg.norm(frame_float - key_color, axis=2)

    alpha = np.ones(frame.shape[:2], dtype=np.float32)
    keyed_region = distance <= threshold
    alpha[keyed_region] = 0.0

    if blend > 0 and alpha.size:
        try:
            from scipy.ndimage import gaussian_filter
            alpha = gaussian_filter(alpha, sigma=blend)
        except ImportError:
            pass

    alpha = np.clip(alpha, 0.0, 1.0)

    cleaned_frame = frame.copy()
    cleaned_frame[alpha <= 0.01] = 0

    return cleaned_frame.astype(np.uint8), alpha.astype(np.float32)


def create_chromakey_overlay(reaction_video_filename, main_video_duration, scale=0.2, position=('left', 'top')):
    """
    크로마키 비디오를 로드하고 처리하여 오버레이 클립 생성

    Args:
        reaction_video_filename: 크로마키 비디오 파일 이름
        main_video_duration: 메인 비디오 길이 (초)
        scale: 비디오 크기 배율 (0.2 = 1/5)
        position: 위치 ('left', 'top' 등)

    Returns:
        VideoClip with transparency
    """
    chromakey_dir = "reaction chromakey"
    video_path = os.path.join(chromakey_dir, reaction_video_filename)

    if not os.path.exists(video_path):
        print(f"[WARNING] Chromakey video not found: {video_path}")
        return None

    print(f"\n[CHROMAKEY] Loading: {reaction_video_filename}")

    try:
        # 비디오 로드
        reaction_clip = VideoFileClip(video_path)

        # 오디오 제거 (무음)
        reaction_clip = reaction_clip.with_audio(None)

        # 비디오 루프 (메인 비디오 길이만큼 반복)
        if reaction_clip.duration < main_video_duration:
            # 반복 횟수 계산
            num_loops = int(np.ceil(main_video_duration / reaction_clip.duration))
            # 루프 생성
            clips_to_concat = [reaction_clip] * num_loops
            reaction_clip = concatenate_videoclips(clips_to_concat, method="compose")

        # 메인 비디오 길이에 맞춤
        reaction_clip = reaction_clip.subclipped(0, main_video_duration)

        # 크로마키 제거 적용
        print(f"   Removing chromakey...")

        key_threshold = 100
        key_blend = 0  # Windows only uses blend=0
        base_clip = reaction_clip
        frame_cache = {}

        def get_processed_frame(t):
            cache_key = round(float(t), 4)
            if cache_key not in frame_cache:
                cleaned, alpha = remove_chromakey(
                    base_clip.get_frame(t),
                    color='green',
                    threshold=key_threshold,
                    blend=key_blend
                )
                frame_cache[cache_key] = (cleaned, alpha)
            return frame_cache[cache_key]

        processed_clip = VideoClip(
            frame_function=lambda t: get_processed_frame(t)[0],
            duration=base_clip.duration,
            has_constant_size=True
        )
        mask_clip = VideoClip(
            frame_function=lambda t: get_processed_frame(t)[1],
            duration=base_clip.duration,
            is_mask=True,
            has_constant_size=True
        )

        if isinstance(base_clip.size, tuple):
            processed_clip.size = base_clip.size
            mask_clip.size = base_clip.size

        base_fps = getattr(base_clip, "fps", None)
        if base_fps:
            processed_clip = processed_clip.with_fps(base_fps)
            mask_clip = mask_clip.with_fps(base_fps)

        reaction_clip = processed_clip.with_mask(mask_clip)

        # 크기 조정 (1/5)
        new_width = int(reaction_clip.w * scale)
        new_height = int(reaction_clip.h * scale)
        reaction_clip = reaction_clip.resized((new_width, new_height))

        print(f"   [SUCCESS] Chromakey processed (size: {new_width}x{new_height})")

        return reaction_clip

    except Exception as e:
        print(f"[ERROR] Chromakey processing failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def get_windows_font():
    """시스템 폰트 경로 반환 (Windows/Mac 지원, 한글 우선)"""
    import platform
    system = platform.system()
    preferred_language = str(get_config_value(["voice_settings", "language"], "en") or "").lower()
    prefer_cjk = any(
        preferred_language.startswith(prefix)
        for prefix in ("ko", "ja", "zh")
    )

    if system == "Windows":
        # Windows 기본 폰트 우선순위 (썸네일용 굵은 폰트 우선)
        font_paths = [
            r"C:\Windows\Fonts\malgunbd.ttf",     # 맑은 고딕 Bold (굵은 고딕)
            r"C:\Windows\Fonts\gulimb.ttc",       # 굴림 Bold
            r"C:\Windows\Fonts\arialbd.ttf",      # Arial Bold
            r"C:\Windows\Fonts\malgun.ttf",       # 맑은 고딕
            r"C:\Windows\Fonts\malgunsl.ttf",     # 맑은 고딕 Semilight
            r"C:\Windows\Fonts\batang.ttc",       # 바탕
            r"C:\Windows\Fonts\gulim.ttc",        # 굴림
            r"C:\Windows\Fonts\arial.ttf",
        ]
    elif system == "Darwin":  # macOS
        # macOS 한글 자막 우선 (Impact 등은 한글 미지원)
        cjk_priority = [
            "/System/Library/Fonts/Supplemental/AppleSDGothicNeo.ttc",
            "/System/Library/Fonts/AppleSDGothicNeo.ttc",
            "/Library/Fonts/AppleSDGothicNeo.ttc",
            "/System/Library/Fonts/Supplemental/NotoSansKR-Regular.otf",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        ]
        bold_priority = [
            "/System/Library/Fonts/Supplemental/Impact.ttf",  # Impact (YouTube 자막 스탠다드)
            "/System/Library/Fonts/Supplemental/Arial Black.ttf",  # Arial Black (굵고 강렬)
            "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
            "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/HelveticaNeue.ttc",  # Helvetica Neue Bold (index 5)
            "/System/Library/Fonts/SFNS.ttf",  # San Francisco
            "/System/Library/Fonts/Avenir Next.ttc",  # Avenir Next Heavy (index 8)
            "/System/Library/Fonts/Helvetica.ttc",  # Helvetica Bold
            "/Library/Fonts/Arial.ttf",
        ]
        # 모든 언어에서 AppleSDGothicNeo ExtraBold (index 14) 우선 사용
        font_paths = cjk_priority + bold_priority
    else:  # Linux
        cjk_fonts = [
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        ]
        latin_fonts = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ]
        font_paths = cjk_fonts + latin_fonts if prefer_cjk else latin_fonts + cjk_fonts

    for font_path in font_paths:
        if font_path and os.path.exists(font_path):
            normalized = os.path.normpath(font_path)
            # TTC 파일에 대해 굵은 인덱스 및 TextClip용 이름을 등록
            if normalized.lower().endswith(".ttc"):
                if system == "Windows" and "gulim.ttc" in normalized.lower():
                    register_font_override(normalized, index=0, textclip_name="GulimChe")
                elif system == "Darwin":
                    # macOS 폰트별 Bold 인덱스 설정
                    if "helveticaneue" in normalized.lower():
                        register_font_override(normalized, index=5, textclip_name="HelveticaNeue-Bold")  # HelveticaNeue Bold
                    elif "avenir" in normalized.lower():
                        register_font_override(normalized, index=8, textclip_name="Avenir-Heavy")  # Avenir Heavy
                    elif "applesdgothicneo" in normalized.lower():
                        register_font_override(normalized, index=14, textclip_name="AppleSDGothicNeo-ExtraBold")  # ExtraBold
                    elif "helvetica.ttc" in normalized.lower():
                        register_font_override(normalized, index=1, textclip_name="Helvetica-Bold")  # Helvetica Bold
                    else:
                        register_font_override(normalized, index=0)
                else:
                    register_font_override(normalized, index=0)
            else:
                if system == "Windows":
                    if "malgunsl" in normalized.lower():
                        register_font_override(normalized, index=0, textclip_name="Malgun Gothic Semilight")
                    elif "malgunbd" in normalized.lower():
                        register_font_override(normalized, index=0, textclip_name="Malgun Gothic Bold")
                    elif "malgun" in normalized.lower():
                        register_font_override(normalized, index=0, textclip_name="Malgun Gothic")
                elif system == "Darwin" and "applegothic" in normalized.lower():
                    register_font_override(normalized, index=0, textclip_name="AppleGothic")
            return normalized

    # 폰트를 찾지 못한 경우 None 반환 (기본 폰트 사용)
    return None


def sanitize_filename(value, replacement="_"):
    """파일명에 사용할 문자열에서 제어/금지 문자를 제거하면서 한글·공백은 유지."""
    if not isinstance(value, str):
        value = str(value or "")

    normalized = unicodedata.normalize("NFC", value).strip()
    if not normalized:
        return ""

    invalid_chars = set('\\/:*?"<>|')
    sanitized_chars = []

    for char in normalized:
        if char in invalid_chars or ord(char) < 32:
            if replacement:
                sanitized_chars.append(replacement)
            continue
        sanitized_chars.append(char)

    sanitized = "".join(sanitized_chars)

    # 공백은 유지하되 연속 공백은 하나로 축소
    sanitized = re.sub(r"\s+", " ", sanitized)

    if replacement:
        sanitized = re.sub(rf"{re.escape(replacement)}+", replacement, sanitized)

    sanitized = sanitized.strip(" ._")
    return sanitized


def generate_output_basename(base_name, output_dir, extension=".mp4"):
    """출력 파일 기본 이름 생성 (중복 방지, 설정 기반 타임스탬프)."""
    sanitized = sanitize_filename(base_name) or "video"
    use_timestamp_prefix = bool(get_config_value(["paths", "use_timestamp_prefix"], False))

    if use_timestamp_prefix:
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        candidate = f"{timestamp} {sanitized}".strip()
    else:
        candidate = sanitized

    candidate = candidate[:120].strip(" ._") or time.strftime("%Y%m%d-%H%M%S")
    final_candidate = candidate
    counter = 1

    while os.path.exists(os.path.join(output_dir, f"{final_candidate}{extension}")):
        final_candidate = f"{candidate}_{counter}"
        counter += 1

    return final_candidate


def wrap_text_preserving_words(text, font_path, font_size, max_width, stroke_width=0):
    """
    주어진 픽셀 너비를 넘지 않도록 단어 단위로 줄바꿈.
    - 단어 중간이 잘리지 않도록 보장
    - 기존 줄바꿈(\n)을 유지
    """
    if max_width <= 0:
        return text

    font = load_pil_font(font_path, font_size)

    measuring_image = Image.new("RGB", (1, 1), (0, 0, 0))
    draw_ctx = ImageDraw.Draw(measuring_image)

    wrapped_lines = []
    for paragraph in text.splitlines():
        words = paragraph.split()
        if not words:
            wrapped_lines.append("")
            continue

        current_line = words[0]
        for word in words[1:]:
            candidate = f"{current_line} {word}"
            bbox = draw_ctx.textbbox((0, 0), candidate, font=font, stroke_width=stroke_width)
            line_width = bbox[2] - bbox[0]

            if line_width <= max_width:
                current_line = candidate
            else:
                wrapped_lines.append(current_line)
                current_line = word

        wrapped_lines.append(current_line)

    return "\n".join(wrapped_lines)


def parse_color(value, default=(0, 0, 0)):
    """CSS/hex/tuple 기반 색상 문자열을 RGB 튜플로 변환."""
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return default

        try:
            return tuple(ImageColor.getrgb(value))
        except Exception:
            pass

        if value.startswith("#"):
            value = value.lstrip("#")
            if len(value) == 6:
                try:
                    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))
                except ValueError:
                    return default
        parts = [p.strip() for p in value.split(",") if p.strip()]
        if len(parts) == 3:
            try:
                return tuple(max(0, min(255, int(component))) for component in parts)
            except ValueError:
                return default
    elif isinstance(value, (list, tuple)) and len(value) >= 3:
        try:
            return tuple(int(max(0, min(255, round(component)))) for component in value[:3])
        except (TypeError, ValueError):
            return default
    return default


def _create_imageclip_with_mask(rgb_array, alpha_array):
    """RGB + alpha 배열로 ImageClip을 생성 (버전 간 ismask/is_mask 호환)."""
    base_clip = ImageClip(rgb_array)
    alpha_norm = np.array(alpha_array, dtype="float32")
    if alpha_norm.ndim == 3:
        alpha_norm = alpha_norm[..., 0]
    if alpha_norm.max() > 1.0:
        alpha_norm = np.clip(alpha_norm / 255.0, 0.0, 1.0)
    try:
        mask_clip = ImageClip(alpha_norm, ismask=True)
    except TypeError:
        mask_clip = ImageClip(alpha_norm, is_mask=True)
    return base_clip.with_mask(mask_clip)


def convert_textclip_to_slanted_imageclip(text_clip, italic_shear=0.2):
    """TextClip으로 만든 자막을 이미지로 변환 후 기울여서 ImageClip으로 반환."""
    if text_clip is None:
        return None

    try:
        base_frame = text_clip.get_frame(0)
    except Exception:
        return text_clip

    if getattr(text_clip, "mask", None) is not None:
        mask_frame = text_clip.mask.get_frame(0)
        if mask_frame.ndim == 3:
            mask_frame = mask_frame[..., 0]
        if mask_frame.max() <= 1.0:
            mask_frame = (mask_frame * 255).astype("uint8")
        else:
            mask_frame = np.clip(mask_frame, 0, 255).astype("uint8")
    else:
        mask_frame = np.full(base_frame.shape[:2], 255, dtype="uint8")

    if base_frame.dtype != np.uint8:
        base_frame = np.clip(base_frame * 255 if base_frame.max() <= 1.0 else base_frame, 0, 255).astype("uint8")

    rgba = np.dstack([base_frame, mask_frame])
    image = Image.fromarray(rgba, mode="RGBA")

    shear = float(italic_shear or 0.0)
    if abs(shear) > 1e-3:
        shift = abs(shear) * image.height
        new_width = int(image.width + shift)
        if shear >= 0:
            transform = (1, shear, 0, 0, 1, 0)
            offset = 0
        else:
            transform = (1, shear, -shear * image.height, 0, 1, 0)
            new_width = int(image.width + abs(shear) * image.height)
        image = image.transform(
            (new_width, image.height),
            Image.AFFINE,
            transform,
            resample=Image.BICUBIC,
            fillcolor=(0, 0, 0, 0)
        )

    slanted = np.array(image).astype("uint8")
    rgb = slanted[..., :3]
    alpha = slanted[..., 3]
    clip = _create_imageclip_with_mask(rgb, alpha)

    if getattr(text_clip, "fps", None):
        clip = clip.with_fps(text_clip.fps)

    try:
        text_clip.close()
    except Exception:
        pass

    return clip


def _ensure_margin_tuple(margin_value):
    """정수 또는 4튜플을 항상 (top, right, bottom, left) 형태로 변환."""
    if isinstance(margin_value, (list, tuple)) and len(margin_value) >= 4:
        return tuple(int(margin_value[i]) for i in range(4))
    margin_int = int(max(0, round(margin_value or 0)))
    return (margin_int, margin_int, margin_int, margin_int)


def create_pil_subtitle_clip(
    text,
    font_path,
    font_size,
    text_color,
    stroke_color,
    stroke_width,
    margin,
    line_spacing,
    italic_shear=0.0
):
    """PIL을 이용해 두꺼운 외곽선 자막을 생성 (ImageClip 반환)."""
    if not text:
        text = " "

    font = load_pil_font(font_path, font_size)
    margin_top, margin_right, margin_bottom, margin_left = _ensure_margin_tuple(margin)
    rgb_text = parse_color(text_color, (255, 255, 255))
    rgb_stroke = parse_color(stroke_color, (0, 0, 0))
    lines = text.split("\n")
    spacing = max(0, int(round(line_spacing or 0)))

    measuring_image = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(measuring_image)

    line_metrics = []
    max_line_width = 0
    total_text_height = 0

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        max_line_width = max(max_line_width, width)
        line_metrics.append((line, width, height))
        total_text_height += height
    if len(lines) > 1:
        total_text_height += spacing * (len(lines) - 1)

    canvas_width = int(max_line_width + margin_left + margin_right)
    canvas_height = int(total_text_height + margin_top + margin_bottom)
    canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    y = margin_top
    for line, width, height in line_metrics:
        x = margin_left + (max_line_width - width) / 2
        draw.text(
            (x, y),
            line,
            font=font,
            fill=rgb_text,
            stroke_width=stroke_width,
            stroke_fill=rgb_stroke
        )
        y += height + spacing

    shear = float(italic_shear or 0.0)
    if abs(shear) > 1e-3:
        shift = abs(shear) * canvas_height
        new_width = int(canvas_width + shift)
        if shear >= 0:
            transform = (1, shear, 0, 0, 1, 0)
        else:
            transform = (1, shear, -shear * canvas_height, 0, 1, 0)
            new_width = int(canvas_width + abs(shear) * canvas_height)
        canvas = canvas.transform(
            (new_width, canvas_height),
            Image.AFFINE,
            transform,
            resample=Image.BICUBIC,
            fillcolor=(0, 0, 0, 0)
        )

    rgba_array = np.array(canvas).astype("uint8")
    rgb = rgba_array[..., :3]
    alpha = rgba_array[..., 3]
    return _create_imageclip_with_mask(rgb, alpha)


def apply_cinematic_filter(frame):
    """
    시네마틱 필터 적용 함수
    - 비네트 효과 (가장자리 어둡게)
    - 약간의 밝기 감소
    - 채도 조정
    """
    h, w = frame.shape[:2]

    # 1. 강력한 비네트 효과 생성 (가장자리 많이 어둡게)
    # 중앙에서 가장자리로 갈수록 어두워지는 마스크
    Y, X = np.ogrid[:h, :w]
    center_y, center_x = h / 2, w / 2

    # 거리 계산 (정규화)
    dist_from_center = np.sqrt((X - center_x)**2 + (Y - center_y)**2)
    max_dist = np.sqrt(center_x**2 + center_y**2)
    normalized_dist = dist_from_center / max_dist

    # 비네트 강도 조정 (제곱으로 가장자리를 더 어둡게)
    vignette = 1 - (normalized_dist ** 1.8) * 0.85  # 거리의 1.8제곱으로 더 급격하게 어둡게
    vignette = np.clip(vignette, 0.15, 1.0)  # 최소 15% 밝기 (가장자리 매우 어두움)

    # RGB 채널에 비네트 적용
    vignette_3d = np.stack([vignette, vignette, vignette], axis=-1)
    frame = (frame * vignette_3d).astype('uint8')

    # 2. 전체 밝기 살짝 감소 (시네마틱 느낌) - 비활성화됨
    # frame = (frame * 0.92).astype('uint8')  # 8% 어둡게

    # 3. 채도 약간 감소 (desaturated 느낌)
    # RGB를 HSV로 변환하지 않고 간단히 처리
    gray = np.mean(frame, axis=-1, keepdims=True)
    frame = (frame * 0.85 + gray * 0.15).astype('uint8')  # 채도 15% 감소

    return frame


def apply_sharpen_filter(frame):
    """
    Sharpen Edges 필터 적용 (캡컷 스타일)
    - 1차 샤픈: sharpen=15 (radius=2, percent=150%)
    - 2차 샤픈: sharpen=29 (radius=2, percent=290%)
    """
    from PIL import Image, ImageFilter

    # numpy array를 PIL Image로 변환
    pil_image = Image.fromarray(frame)

    # 1차 샤픈 적용 (sharpen=15 기준)
    pil_image = pil_image.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))

    # 2차 샤픈 적용 (sharpen=29 기준, 더 강하게)
    pil_image = pil_image.filter(ImageFilter.UnsharpMask(radius=2, percent=290, threshold=2))

    # PIL Image를 다시 numpy array로 변환
    return np.array(pil_image)


def apply_chromatic_aberration(get_frame, t):
    """
    Chromatic Aberration 효과 적용 (캡컷 스타일 - 동적)
    - Speed: 33 (애니메이션 속도)
    - Strength: 11 (상하 분리 강도)
    - Lateral chromatic aberration: 59 (좌우 분리 강도)
    시간에 따라 offset이 사인파로 변화
    """
    import cv2

    frame = get_frame(t)
    h, w = frame.shape[:2]

    # Speed=33을 사인파 주파수로 변환 (약 0.33Hz)
    speed = 33 / 100.0

    # 시간에 따라 -0.75 ~ +0.75 사이로 변화 (사인파)
    lateral_offset = 0.75 * np.sin(2 * np.pi * speed * t)

    # BGR 채널 분리 (OpenCV는 BGR 순서)
    b, g, r = cv2.split(frame)

    # Red 채널: 오른쪽으로 lateral_offset만큼 이동 (시간에 따라 변화)
    M_red = np.float32([[1, 0, lateral_offset], [0, 1, 0]])
    r_shifted = cv2.warpAffine(r, M_red, (w, h), borderMode=cv2.BORDER_REPLICATE)

    # Blue 채널: 왼쪽으로 lateral_offset만큼 이동 (시간에 따라 변화)
    M_blue = np.float32([[1, 0, -lateral_offset], [0, 1, 0]])
    b_shifted = cv2.warpAffine(b, M_blue, (w, h), borderMode=cv2.BORDER_REPLICATE)

    # 채널 다시 합치기 (Green은 그대로)
    result = cv2.merge([b_shifted, g, r_shifted])

    return result


def apply_wave_effect(get_frame, t):
    """
    웨이브 효과 적용 함수 (미세한 좌우 흔들림 + 물결 왜곡)
    - 시간에 따라 화면이 미세하게 좌우로 움직임
    - 상하로 미세한 물결 왜곡 추가
    """
    import cv2

    frame = get_frame(t)
    h, w = frame.shape[:2]

    # 웨이브 파라미터 (config에서 읽기)
    amplitude_x = float(get_config_value(["video_settings", "wave_effect", "amplitude_x"], 3))
    amplitude_y = float(get_config_value(["video_settings", "wave_effect", "amplitude_y"], 2))
    frequency = float(get_config_value(["video_settings", "wave_effect", "frequency"], 2.0))
    speed = float(get_config_value(["video_settings", "wave_effect", "speed"], 1.5))

    # 좌우 흔들림 계산
    offset_x = int(amplitude_x * np.sin(2 * np.pi * frequency * t))

    # 물결 왜곡 맵 생성
    Y, X = np.meshgrid(np.arange(h), np.arange(w), indexing='ij')

    # 상하 물결 효과 (미세한 sin 파동)
    wave_offset_y = amplitude_y * np.sin(2 * np.pi * (X / w * 3 + t * speed))

    # 새로운 좌표 계산
    map_x = (X + offset_x).astype(np.float32)
    map_y = (Y + wave_offset_y).astype(np.float32)

    # 범위 제한
    map_x = np.clip(map_x, 0, w - 1)
    map_y = np.clip(map_y, 0, h - 1)

    # 리맵핑 적용 (OpenCV 사용)
    warped_frame = cv2.remap(frame, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    return warped_frame


def apply_zoom_pan_effect(clip, zoom_factor=1.1, pan_direction="random"):
    """
    Zoom/Pan 효과 적용 함수 (간단한 버전 - 확대만)
    - zoom_factor: 확대 비율 (1.1 = 10% 확대)
    - pan_direction: 이동 방향 (현재는 중앙 crop만 지원)
    """
    import cv2
    from moviepy.video.fx import Resize, Crop

    # 비디오를 zoom_factor만큼 확대
    zoomed = clip.with_effects([Resize(zoom_factor)])

    # 원본 크기로 중앙 crop
    w, h = clip.size
    zoomed_w, zoomed_h = zoomed.size

    # 중앙에서 crop
    x1 = (zoomed_w - w) // 2
    y1 = (zoomed_h - h) // 2

    return zoomed.with_effects([Crop(x1=x1, y1=y1, x2=x1 + w, y2=y1 + h)])


def create_blur_background(text_clip, video_clip, blur_amount=15, opacity=0.7, padding=20):
    """
    텍스트 클립 뒤에 블러 배경 생성 (개선된 버전)

    Args:
        text_clip: 텍스트 클립
        video_clip: 원본 비디오 클립
        blur_amount: 블러 강도 (픽셀)
        opacity: 배경 어두움 정도 (0.0 ~ 1.0, 낮을수록 밝음)
        padding: 텍스트 주변 여백 (픽셀)

    Returns:
        블러 배경 클립 (ImageClip)
    """
    import cv2

    # 텍스트 클립의 크기와 위치 가져오기
    txt_w, txt_h = text_clip.size
    txt_pos = text_clip.pos
    video_width = video_clip.w
    video_height = video_clip.h

    # 위치 계산
    if callable(txt_pos):
        pos_x, pos_y = txt_pos(0)
    else:
        pos_x, pos_y = txt_pos

    # 'center' 같은 문자열 위치 처리
    if pos_x == 'center':
        pos_x = (video_width - txt_w) / 2
    if pos_y == 'center':
        pos_y = (video_height - txt_h) / 2

    # 블러 박스 영역 계산
    blur_x = max(0, int(pos_x - padding))
    blur_y = max(0, int(pos_y - padding))
    blur_w = min(video_width - blur_x, int(txt_w + padding * 2))
    blur_h = min(video_height - blur_y, int(txt_h + padding * 2))

    def make_blur_frame(get_frame, t):
        """블러 배경 프레임 생성 (텍스트 영역만)"""
        # 원본 프레임 가져오기
        frame = get_frame(t)

        # 블러 영역 추출
        blur_region = frame[blur_y:blur_y+blur_h, blur_x:blur_x+blur_w].copy()

        # 가우시안 블러 적용
        if blur_region.size > 0 and len(blur_region.shape) == 3:
            # RGB 채널 확인
            blurred = cv2.GaussianBlur(blur_region, (blur_amount*2+1, blur_amount*2+1), 0)

            # 어둡게 처리 (opacity 적용) - RGB 각 채널에 적용
            blurred = (blurred * opacity).astype('uint8')

            # 블러 영역의 크기 확인
            actual_h, actual_w = blurred.shape[:2]

            # RGBA 프레임 생성 (알파 채널 포함)
            result = np.zeros((video_height, video_width, 4), dtype='uint8')

            # 블러 영역에만 색상 + 완전 불투명 알파 채널
            if len(blurred.shape) == 3 and blurred.shape[2] == 3:
                # RGB 이미지인 경우
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, :3] = blurred
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, 3] = 255  # 완전 불투명
            else:
                # 그레이스케일인 경우 RGB로 변환
                blurred_rgb = np.stack([blurred, blurred, blurred], axis=-1) if len(blurred.shape) == 2 else blurred
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, :3] = blurred_rgb
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, 3] = 255

            return result
        else:
            # 블러 영역이 없으면 완전 투명 반환
            return np.zeros((video_height, video_width, 4), dtype='uint8')

    return make_blur_frame


def _safe_float(value, default):
    """Safely cast a config value to float with fallback."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _resolve_clip_position(pos_value):
    """Helper that normalizes clip position definitions to a (x, y) tuple."""
    if callable(pos_value):
        try:
            pos_value = pos_value(0)
        except Exception:
            pos_value = None

    if pos_value is None:
        return ("center", "center")

    if isinstance(pos_value, (tuple, list)):
        if len(pos_value) >= 2:
            return pos_value[0], pos_value[1]
        if len(pos_value) == 1:
            return ("center", pos_value[0])

    if isinstance(pos_value, (int, float)):
        return ("center", pos_value)

    # 문자열('center') 등은 x 좌표로 간주
    return (pos_value, "center")


def apply_thumbnail_exit_animation(
    clip,
    fade_duration,
    base_position=None,
    vertical_offset=80,
    scale_reduction=0.08,
):
    """
    텍스트가 사라질 때 살짝 위로 이동하며 축소 + 페이드아웃되는 애니메이션 적용.
    """
    if clip is None or not fade_duration or fade_duration <= 0:
        return clip

    clip_duration = getattr(clip, "duration", None)
    if not clip_duration or clip_duration <= 0:
        return clip

    exit_duration = min(fade_duration, clip_duration)
    exit_start = clip_duration - exit_duration

    anchor_position = _resolve_clip_position(base_position if base_position else getattr(clip, "pos", None))
    anchor_x, anchor_y = anchor_position

    def eased_progress(t):
        """Cubic ease-out for smoother motion."""
        if exit_duration <= 0:
            return 0.0
        raw = (t - exit_start) / exit_duration
        if raw <= 0:
            return 0.0
        if raw >= 1:
            raw = 1.0
        return 1 - pow(1 - raw, 3)

    animated_clip = clip

    if scale_reduction and scale_reduction > 0:
        def scale_func(t):
            progress = eased_progress(t)
            return max(0.3, 1 - scale_reduction * progress)

        animated_clip = animated_clip.with_effects([Resize(scale_func)])

    def animated_position(t):
        progress = eased_progress(t)
        new_y = anchor_y
        if isinstance(anchor_y, (int, float)) and vertical_offset:
            new_y = anchor_y - vertical_offset * progress
        return (anchor_x, new_y)

    animated_clip = animated_clip.with_position(animated_position)
    animated_clip = animated_clip.with_effects([FadeOut(exit_duration)])
    return animated_clip


def sanitize_filename(value, replacement="_"):
    """파일명에 사용할 문자열에서 제어/금지 문자를 제거하면서 한글·공백은 유지."""
    if not isinstance(value, str):
        value = str(value or "")

    normalized = unicodedata.normalize("NFC", value).strip()
    if not normalized:
        return ""

    invalid_chars = set('\\/:*?"<>|')
    sanitized_chars = []

    for char in normalized:
        if char in invalid_chars or ord(char) < 32:
            if replacement:
                sanitized_chars.append(replacement)
            continue
        sanitized_chars.append(char)

    sanitized = "".join(sanitized_chars)

    # 공백은 유지하되 연속 공백은 하나로 축소
    sanitized = re.sub(r"\s+", " ", sanitized)

    if replacement:
        sanitized = re.sub(rf"{re.escape(replacement)}+", replacement, sanitized)

    sanitized = sanitized.strip(" ._")
    return sanitized


def generate_output_basename(base_name, output_dir, extension=".mp4"):
    """출력 파일 기본 이름 생성 (중복 방지, 설정 기반 타임스탬프)."""
    sanitized = sanitize_filename(base_name) or "video"
    use_timestamp_prefix = bool(get_config_value(["paths", "use_timestamp_prefix"], False))

    if use_timestamp_prefix:
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        candidate = f"{timestamp} {sanitized}".strip()
    else:
        candidate = sanitized

    candidate = candidate[:120].strip(" ._") or time.strftime("%Y%m%d-%H%M%S")
    final_candidate = candidate
    counter = 1

    while os.path.exists(os.path.join(output_dir, f"{final_candidate}{extension}")):
        final_candidate = f"{candidate}_{counter}"
        counter += 1

    return final_candidate


def wrap_text_preserving_words(text, font_path, font_size, max_width, stroke_width=0):
    """
    주어진 픽셀 너비를 넘지 않도록 단어 단위로 줄바꿈.
    - 단어 중간이 잘리지 않도록 보장
    - 기존 줄바꿈(\n)을 유지
    """
    if max_width <= 0:
        return text

    font = load_pil_font(font_path, font_size)

    measuring_image = Image.new("RGB", (1, 1), (0, 0, 0))
    draw_ctx = ImageDraw.Draw(measuring_image)

    wrapped_lines = []
    for paragraph in text.splitlines():
        words = paragraph.split()
        if not words:
            wrapped_lines.append("")
            continue

        current_line = words[0]
        for word in words[1:]:
            candidate = f"{current_line} {word}"
            bbox = draw_ctx.textbbox((0, 0), candidate, font=font, stroke_width=stroke_width)
            line_width = bbox[2] - bbox[0]

            if line_width <= max_width:
                current_line = candidate
            else:
                wrapped_lines.append(current_line)
                current_line = word

        wrapped_lines.append(current_line)

    return "\n".join(wrapped_lines)
def apply_cinematic_filter(frame):
    """
    시네마틱 필터 적용 함수
    - 비네트 효과 (가장자리 어둡게)
    - 약간의 밝기 감소
    - 채도 조정
    """
    h, w = frame.shape[:2]

    # 1. 강력한 비네트 효과 생성 (가장자리 많이 어둡게)
    # 중앙에서 가장자리로 갈수록 어두워지는 마스크
    Y, X = np.ogrid[:h, :w]
    center_y, center_x = h / 2, w / 2

    # 거리 계산 (정규화)
    dist_from_center = np.sqrt((X - center_x)**2 + (Y - center_y)**2)
    max_dist = np.sqrt(center_x**2 + center_y**2)
    normalized_dist = dist_from_center / max_dist

    # 비네트 강도 조정 (제곱으로 가장자리를 더 어둡게)
    vignette = 1 - (normalized_dist ** 1.8) * 0.85  # 거리의 1.8제곱으로 더 급격하게 어둡게
    vignette = np.clip(vignette, 0.15, 1.0)  # 최소 15% 밝기 (가장자리 매우 어두움)

    # RGB 채널에 비네트 적용
    vignette_3d = np.stack([vignette, vignette, vignette], axis=-1)
    frame = (frame * vignette_3d).astype('uint8')

    # 2. 전체 밝기 살짝 감소 (시네마틱 느낌) - 비활성화됨
    # frame = (frame * 0.92).astype('uint8')  # 8% 어둡게

    # 3. 채도 약간 감소 (desaturated 느낌)
    # RGB를 HSV로 변환하지 않고 간단히 처리
    gray = np.mean(frame, axis=-1, keepdims=True)
    frame = (frame * 0.85 + gray * 0.15).astype('uint8')  # 채도 15% 감소

    return frame


def apply_sharpen_filter(frame):
    """
    Sharpen Edges 필터 적용 (캡컷 스타일)
    - 1차 샤픈: sharpen=15 (radius=2, percent=150%)
    - 2차 샤픈: sharpen=29 (radius=2, percent=290%)
    """
    from PIL import Image, ImageFilter

    # numpy array를 PIL Image로 변환
    pil_image = Image.fromarray(frame)

    # 1차 샤픈 적용 (sharpen=15 기준)
    pil_image = pil_image.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))

    # 2차 샤픈 적용 (sharpen=29 기준, 더 강하게)
    pil_image = pil_image.filter(ImageFilter.UnsharpMask(radius=2, percent=290, threshold=2))

    # PIL Image를 다시 numpy array로 변환
    return np.array(pil_image)


def apply_chromatic_aberration(get_frame, t):
    """
    Chromatic Aberration 효과 적용 (캡컷 스타일 - 동적)
    - Speed: 33 (애니메이션 속도)
    - Strength: 11 (상하 분리 강도)
    - Lateral chromatic aberration: 59 (좌우 분리 강도)
    시간에 따라 offset이 사인파로 변화
    """
    import cv2

    frame = get_frame(t)
    h, w = frame.shape[:2]

    # Speed=33을 사인파 주파수로 변환 (약 0.33Hz)
    speed = 33 / 100.0

    # 시간에 따라 -0.75 ~ +0.75 사이로 변화 (사인파)
    lateral_offset = 0.75 * np.sin(2 * np.pi * speed * t)

    # BGR 채널 분리 (OpenCV는 BGR 순서)
    b, g, r = cv2.split(frame)

    # Red 채널: 오른쪽으로 lateral_offset만큼 이동 (시간에 따라 변화)
    M_red = np.float32([[1, 0, lateral_offset], [0, 1, 0]])
    r_shifted = cv2.warpAffine(r, M_red, (w, h), borderMode=cv2.BORDER_REPLICATE)

    # Blue 채널: 왼쪽으로 lateral_offset만큼 이동 (시간에 따라 변화)
    M_blue = np.float32([[1, 0, -lateral_offset], [0, 1, 0]])
    b_shifted = cv2.warpAffine(b, M_blue, (w, h), borderMode=cv2.BORDER_REPLICATE)

    # 채널 다시 합치기 (Green은 그대로)
    result = cv2.merge([b_shifted, g, r_shifted])

    return result


def apply_wave_effect(get_frame, t):
    """
    웨이브 효과 적용 함수 (미세한 좌우 흔들림 + 물결 왜곡)
    - 시간에 따라 화면이 미세하게 좌우로 움직임
    - 상하로 미세한 물결 왜곡 추가
    """
    import cv2

    frame = get_frame(t)
    h, w = frame.shape[:2]

    # 웨이브 파라미터 (config에서 읽기)
    amplitude_x = float(get_config_value(["video_settings", "wave_effect", "amplitude_x"], 3))
    amplitude_y = float(get_config_value(["video_settings", "wave_effect", "amplitude_y"], 2))
    frequency = float(get_config_value(["video_settings", "wave_effect", "frequency"], 2.0))
    speed = float(get_config_value(["video_settings", "wave_effect", "speed"], 1.5))

    # 좌우 흔들림 계산
    offset_x = int(amplitude_x * np.sin(2 * np.pi * frequency * t))

    # 물결 왜곡 맵 생성
    Y, X = np.meshgrid(np.arange(h), np.arange(w), indexing='ij')

    # 상하 물결 효과 (미세한 sin 파동)
    wave_offset_y = amplitude_y * np.sin(2 * np.pi * (X / w * 3 + t * speed))

    # 새로운 좌표 계산
    map_x = (X + offset_x).astype(np.float32)
    map_y = (Y + wave_offset_y).astype(np.float32)

    # 범위 제한
    map_x = np.clip(map_x, 0, w - 1)
    map_y = np.clip(map_y, 0, h - 1)

    # 리맵핑 적용 (OpenCV 사용)
    warped_frame = cv2.remap(frame, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    return warped_frame


def apply_zoom_pan_effect(clip, zoom_factor=1.1, pan_direction="random"):
    """
    Zoom/Pan 효과 적용 함수 (간단한 버전 - 확대만)
    - zoom_factor: 확대 비율 (1.1 = 10% 확대)
    - pan_direction: 이동 방향 (현재는 중앙 crop만 지원)
    """
    import cv2
    from moviepy.video.fx import Resize, Crop

    # 비디오를 zoom_factor만큼 확대
    zoomed = clip.with_effects([Resize(zoom_factor)])

    # 원본 크기로 중앙 crop
    w, h = clip.size
    zoomed_w, zoomed_h = zoomed.size

    # 중앙에서 crop
    x1 = (zoomed_w - w) // 2
    y1 = (zoomed_h - h) // 2

    return zoomed.with_effects([Crop(x1=x1, y1=y1, x2=x1 + w, y2=y1 + h)])


def create_blur_background(text_clip, video_clip, blur_amount=15, opacity=0.7, padding=20):
    """
    텍스트 클립 뒤에 블러 배경 생성 (개선된 버전)

    Args:
        text_clip: 텍스트 클립
        video_clip: 원본 비디오 클립
        blur_amount: 블러 강도 (픽셀)
        opacity: 배경 어두움 정도 (0.0 ~ 1.0, 낮을수록 밝음)
        padding: 텍스트 주변 여백 (픽셀)

    Returns:
        블러 배경 클립 (ImageClip)
    """
    import cv2

    # 텍스트 클립의 크기와 위치 가져오기
    txt_w, txt_h = text_clip.size
    txt_pos = text_clip.pos
    video_width = video_clip.w
    video_height = video_clip.h

    # 위치 계산
    if callable(txt_pos):
        pos_x, pos_y = txt_pos(0)
    else:
        pos_x, pos_y = txt_pos

    # 'center' 같은 문자열 위치 처리
    if pos_x == 'center':
        pos_x = (video_width - txt_w) / 2
    if pos_y == 'center':
        pos_y = (video_height - txt_h) / 2

    # 블러 박스 영역 계산
    blur_x = max(0, int(pos_x - padding))
    blur_y = max(0, int(pos_y - padding))
    blur_w = min(video_width - blur_x, int(txt_w + padding * 2))
    blur_h = min(video_height - blur_y, int(txt_h + padding * 2))

    def make_blur_frame(get_frame, t):
        """블러 배경 프레임 생성 (텍스트 영역만)"""
        # 원본 프레임 가져오기
        frame = get_frame(t)

        # 블러 영역 추출
        blur_region = frame[blur_y:blur_y+blur_h, blur_x:blur_x+blur_w].copy()

        # 가우시안 블러 적용
        if blur_region.size > 0 and len(blur_region.shape) == 3:
            # RGB 채널 확인
            blurred = cv2.GaussianBlur(blur_region, (blur_amount*2+1, blur_amount*2+1), 0)

            # 어둡게 처리 (opacity 적용) - RGB 각 채널에 적용
            blurred = (blurred * opacity).astype('uint8')

            # 블러 영역의 크기 확인
            actual_h, actual_w = blurred.shape[:2]

            # RGBA 프레임 생성 (알파 채널 포함)
            result = np.zeros((video_height, video_width, 4), dtype='uint8')

            # 블러 영역에만 색상 + 완전 불투명 알파 채널
            if len(blurred.shape) == 3 and blurred.shape[2] == 3:
                # RGB 이미지인 경우
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, :3] = blurred
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, 3] = 255  # 완전 불투명
            else:
                # 그레이스케일인 경우 RGB로 변환
                blurred_rgb = np.stack([blurred, blurred, blurred], axis=-1) if len(blurred.shape) == 2 else blurred
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, :3] = blurred_rgb
                result[blur_y:blur_y+actual_h, blur_x:blur_x+actual_w, 3] = 255

            return result
        else:
            # 블러 영역이 없으면 완전 투명 반환
            return np.zeros((video_height, video_width, 4), dtype='uint8')

    return make_blur_frame


def build_keyword_highlight_clip(
    txt_clip,
    keyword,
    font_path,
    font_size,
    stroke_width,
    stroke_color,
    text_color,
    margins,
    horizontal_align,
    vertical_align,
    interline,
    max_text_width,
    text_align,
    keyword_color='yellow'
):
    """키워드가 포함된 완전히 새로운 텍스트 클립을 생성 (키워드만 하이라이트 색상)"""
    if not keyword:
        print("[WARNING] 키워드가 없습니다.")
        return None

    keyword = keyword.strip()
    # 키워드에서 따옴표 제거 (AI가 추가한 경우)
    if (keyword.startswith('"') and keyword.endswith('"')) or \
       (keyword.startswith("'") and keyword.endswith("'")):
        keyword = keyword[1:-1].strip()

    if not keyword:
        print("[WARNING] 키워드가 비어있습니다.")
        return None

    full_text = txt_clip.text or ""

    # 줄바꿈을 공백으로 변경해서 검색 (TextClip이 자동으로 줄바꿈하기 때문)
    full_text_normalized = " ".join(full_text.split())
    keyword_lower = keyword.lower()
    text_lower = full_text_normalized.lower()

    print(f"[SEARCH] 키워드 검색 중: '{keyword}'")
    print(f"   썸네일 제목: '{full_text_normalized}'")

    # 키워드 찾기 (대소문자 구분 없이)
    start_idx = text_lower.find(keyword_lower)
    if start_idx == -1:
        print(f"[ERROR] 키워드 '{keyword}'를 찾을 수 없습니다!")
        print(f"   원본 텍스트: '{full_text}'")
        return None

    print(f"[OK] 키워드 찾음: 위치 {start_idx}")

    end_idx = start_idx + len(keyword)

    # normalized 텍스트에서 실제 키워드 추출 (대소문자 보존)
    actual_keyword = full_text_normalized[start_idx:end_idx]
    before_text = full_text_normalized[:start_idx]
    after_text = full_text_normalized[end_idx:]

    # PIL로 직접 그리기
    pil_font = load_pil_font(font_path, font_size)

    # 줄바꿈 처리
    img_width, img_height = txt_clip.size
    left_margin, top_margin, right_margin, bottom_margin = margins
    effective_stroke_width = stroke_width if stroke_color else 0

    # 텍스트를 줄바꿈 (normalized 버전 사용)
    draw_helper = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    wrapped_lines = []
    current_line = ""
    words = full_text_normalized.split()

    for word in words:
        test_line = f"{current_line} {word}".strip()
        bbox = draw_helper.textbbox((0, 0), test_line, font=pil_font, stroke_width=effective_stroke_width)
        if bbox[2] <= max_text_width:
            current_line = test_line
        else:
            if current_line:
                wrapped_lines.append(current_line)
            current_line = word
    if current_line:
        wrapped_lines.append(current_line)

    if not wrapped_lines:
        return None

    # 각 줄에서 키워드 위치 찾기
    combined_text = " ".join(wrapped_lines)
    keyword_start = combined_text.lower().find(keyword_lower)
    if keyword_start == -1:
        return None

    # 이미지 생성
    highlight_image = Image.new("RGBA", (img_width, img_height), (0, 0, 0, 0))
    highlight_draw = ImageDraw.Draw(highlight_image)
    # 키워드 하이라이트 색상 (파라미터로 전달됨)
    highlight_color = keyword_color

    # 줄 높이 계산
    try:
        ascent, descent = pil_font.getmetrics()
    except AttributeError:
        ascent, descent = font_size, 0

    line_height = ascent + descent + interline
    total_text_height = len(wrapped_lines) * (ascent + descent) + (len(wrapped_lines) - 1) * interline

    # 시작 Y 위치
    y = top_margin
    if vertical_align == "center":
        y = (img_height - top_margin - bottom_margin - total_text_height) / 2 + top_margin
    elif vertical_align == "bottom":
        y = img_height - bottom_margin - total_text_height

    # 각 줄 그리기
    char_position = 0
    for line_text in wrapped_lines:
        line_bbox = draw_helper.textbbox((0, 0), line_text, font=pil_font, stroke_width=effective_stroke_width)
        line_width = line_bbox[2]

        # X 위치
        x = left_margin
        if horizontal_align == "center":
            x = (img_width - line_width) / 2
        elif horizontal_align == "right":
            x = img_width - right_margin - line_width

        # 이 줄에서 키워드 위치 찾기
        line_start_in_combined = char_position
        line_end_in_combined = char_position + len(line_text)
        keyword_end = keyword_start + len(actual_keyword)

        # 키워드가 이 줄에 있는지 확인
        if keyword_start < line_end_in_combined and keyword_end > line_start_in_combined:
            # 키워드가 이 줄에 포함됨
            local_keyword_start = max(0, keyword_start - line_start_in_combined)
            local_keyword_end = min(len(line_text), keyword_end - line_start_in_combined)

            before = line_text[:local_keyword_start]
            keyword_part = line_text[local_keyword_start:local_keyword_end]
            after = line_text[local_keyword_end:]

            current_x = x

            # 앞부분 (하얀색)
            if before:
                highlight_draw.text(
                    (current_x, y + ascent),
                    before,
                    font=pil_font,
                    fill=text_color,
                    stroke_width=effective_stroke_width,
                    stroke_fill=stroke_color,
                    anchor="ls"
                )
                before_bbox = draw_helper.textbbox((0, 0), before, font=pil_font, stroke_width=effective_stroke_width)
                current_x += before_bbox[2]

            # 키워드 (노란색)
            if keyword_part:
                highlight_draw.text(
                    (current_x, y + ascent),
                    keyword_part,
                    font=pil_font,
                    fill=highlight_color,
                    stroke_width=effective_stroke_width,
                    stroke_fill=stroke_color,
                    anchor="ls"
                )
                keyword_bbox = draw_helper.textbbox((0, 0), keyword_part, font=pil_font, stroke_width=effective_stroke_width)
                current_x += keyword_bbox[2]

            # 뒷부분 (하얀색)
            if after:
                highlight_draw.text(
                    (current_x, y + ascent),
                    after,
                    font=pil_font,
                    fill=text_color,
                    stroke_width=effective_stroke_width,
                    stroke_fill=stroke_color,
                    anchor="ls"
                )
        else:
            # 키워드가 없는 줄 (전체 하얀색)
            highlight_draw.text(
                (x, y + ascent),
                line_text,
                font=pil_font,
                fill=text_color,
                stroke_width=effective_stroke_width,
                stroke_fill=stroke_color,
                anchor="ls"
            )

        y += line_height
        char_position = line_end_in_combined + 1  # +1 for space

    highlight_np = np.array(highlight_image)
    if highlight_np.shape[2] < 4:
        return None

    alpha = highlight_np[:, :, 3].astype(np.float32) / 255.0
    if not np.any(alpha > 0):
        return None

    rgb = highlight_np[:, :, :3]
    mask = ImageClip(alpha, is_mask=True).with_duration(txt_clip.duration)
    return ImageClip(rgb).with_duration(txt_clip.duration).with_mask(mask)



def overlay_voice_on_video(video_path, segments, output_path, metadata=None, folder_name=None, add_subtitles=True, subtitle_color=None, title_color=None, keyword_color=None):
    """
    비디오에 타임스탬프 기반 AI 음성 나레이션 및 자막 오버레이

    Args:
        video_path (str): 입력 비디오 경로
        segments (list): 파싱된 세그먼트 리스트
        output_path (str): 출력 비디오 경로
        metadata (dict): {'key_moment': 초, 'thumbnail_title': '제목', 'background_music': '옵션'}
        folder_name (str): ZIP 내부 폴더 이름 (세로 텍스트로 표시)
        add_subtitles (bool): 자막 추가 여부
        subtitle_color (str): 자막 색상 (None이면 config 사용)
        title_color (str): 썸네일 타이틀 색상 (None이면 config 사용)
        keyword_color (str): 키워드 하이라이트 색상 (None이면 config 사용)
    """
    if metadata is None:
        metadata = {}
    print(f"\n[VIDEO] 비디오 로딩: {video_path}")
    video = VideoFileClip(video_path)

    # _muted 접미사 확인 및 오디오 제거
    if '_muted' in os.path.basename(video_path):
        print(f"\n[MUTE] 음소거 표시 감지: 원본 오디오를 제거합니다")
        video = video.without_audio()
        print(f"[MUTE] 오디오 제거 완료")

    # 앞부분 제거 (AI가 판정한 불필요한 인트로)
    trim_start = metadata.get('trim_start', 0.0)
    if trim_start > 0:
        print(f"\n[TRIM] AI가 식별한 불필요한 앞부분 제거 중... ({trim_start:.2f}초)")

        original_duration = video.duration

        # 비디오가 12초 이하면 trim 건너뜀
        if original_duration <= 12.0:
            print(f"[TRIM] 비디오가 12초 이하 ({original_duration:.2f}s)이므로 trim 건너뜀")
            trim_start = 0
        # trim_start가 비디오 길이를 초과하지 않도록 확인
        elif trim_start >= video.duration:
            print(f"[WARNING] Trim start ({trim_start:.2f}s)가 비디오 길이 ({video.duration:.2f}s)보다 큽니다. Trim 건너뜀.")
            trim_start = 0
        else:
            # 비디오 앞부분 자르기
            video = video.subclipped(trim_start, video.duration)
            new_duration = video.duration
            print(f"[TRIM] 완료: {trim_start:.2f}초 제거됨 ({original_duration:.2f}s → {new_duration:.2f}s)")

            # 세그먼트와 메타데이터의 타임스탬프 조정 (trim_start만큼 빼기)
            for segment in segments:
                segment['start'] = max(0, segment['start'] - trim_start)
                segment['end'] = max(0, segment['end'] - trim_start)

            # metadata의 key_moment 조정
            if metadata.get('key_moment') is not None:
                metadata['key_moment'] = max(0, metadata['key_moment'] - trim_start)

            print(f"[TRIM] 세그먼트 타임스탬프 조정 완료")

    # 속도 변경 적용 (저작권 회피용)
    speed_factor = float(get_config_value(["video_settings", "speed_factor"], 1.0))
    if speed_factor != 1.0:
        print(f"\n[SPEED] 비디오 속도 변경: {speed_factor}x")
        from moviepy.video.fx import MultiplySpeed
        video = video.with_effects([MultiplySpeed(speed_factor)])

    # _no_filters 접미사 확인 및 필터 건너뛰기
    apply_filters = '_no_filters' not in os.path.basename(video_path)

    if apply_filters:
        # 시네마틱 필터 적용 (비네트 1.8제곱 × 0.85, 채도 15% 감소)
        print(f"\n[FILTER] Cinematic 필터 적용 중 (비네트 1.8^2 × 0.85, 채도 -15%)...")
        video = video.image_transform(apply_cinematic_filter)

        # Sharpen Edges 필터 적용 (1차: 150% threshold=3, 2차: 290% threshold=2)
        print(f"\n[SHARPEN] Sharpen 필터 적용 중 (1차: 150%/t3, 2차: 290%/t2)...")
        video = video.image_transform(apply_sharpen_filter)

        # Chromatic Aberration 효과 적용 (Speed: 0.33Hz, Offset: ±0.75px 사인파)
        print(f"\n[CHROMATIC] Chromatic Aberration 적용 중 (Speed: 0.33Hz, Offset: ±0.75px)...")
        video = video.transform(apply_chromatic_aberration)
    else:
        print(f"\n[FILTER] 필터 비활성화 표시 감지: 시네마틱/샤픈/색수차 필터를 건너뜁니다")
    original_audio = video.audio
    has_original_audio = original_audio is not None
    if not has_original_audio:
        print("\n[AUDIO] 원본 오디오가 없어 무음 상태로 진행합니다.")

    flash_settings_cfg = get_config_value(["video_settings", "scene_change_effect"], {}) or {}
    flash_settings = {
        "enabled": bool(flash_settings_cfg.get("enabled", False)),
        "threshold": float(flash_settings_cfg.get("threshold", 30.0)),
        "min_scene_duration": float(flash_settings_cfg.get("min_scene_duration", 1.0)),
        "flash_duration": float(flash_settings_cfg.get("flash_duration", 0.15)),
        "flash_intensity": float(flash_settings_cfg.get("flash_intensity", 1.5)),
    }
    scene_change_times = []
    if flash_settings["enabled"]:
        print("\n[SCENE] 씬 전환 분석 중...")
        scene_change_times = detect_scene_changes(
            video,
            threshold=flash_settings["threshold"],
            min_scene_duration=flash_settings["min_scene_duration"]
        )
        if scene_change_times:
            print(f"[SCENE] 씬 전환 {len(scene_change_times)}회 감지")
        else:
            print("[SCENE] 씬 전환 감지되지 않음")

    voice_clips = []
    temp_voice_files = []
    voice_volume = float(get_config_value(["audio_settings", "voice_volume"], 1.0))
    sound_effect_volume = float(get_config_value(["audio_settings", "sound_effect_volume"], 1.0))
    background_music_volume = float(get_config_value(["audio_settings", "background_music_volume"], 0.5))
    if voice_volume != 1.0:
        print(f"\n[AUDIO] 보이스 볼륨 증폭: {voice_volume:.2f}x")
    if sound_effect_volume != 1.0:
        print(f"[AUDIO] 사운드 이펙트 볼륨 조정: {sound_effect_volume:.2f}x")

    # 시작 사운드 추가
    start_sound_path = get_start_sound()
    if start_sound_path:
        print(f"\n[START SOUND] 시작 사운드 로딩: {start_sound_path}")
        try:
            start_sound_clip = AudioFileClip(start_sound_path).with_start(0)
            if sound_effect_volume != 1.0:
                start_sound_clip = start_sound_clip.with_effects([MultiplyVolume(sound_effect_volume)])
            voice_clips.append(start_sound_clip)
            print(f"[START SOUND] 시작 사운드 추가 완료 (길이: {start_sound_clip.duration:.2f}초)")
        except Exception as e:
            print(f"[WARNING] 시작 사운드 로드 실패: {e}")

    # 비디오 길이를 초과하는 세그먼트 제거 (음성이 짤리는 것 방지)
    print(f"\n[TIMING] 비디오 길이: {video.duration:.2f}초")
    valid_segments = []

    for idx, segment in enumerate(segments):
        seg_start = segment['start']
        seg_end = segment['end']

        # 세그먼트 시작이 비디오 끝을 넘으면 스킵
        if seg_start >= video.duration:
            print(f"[SKIP] 세그먼트 {idx+1} 제외: 시작({seg_start}초)이 비디오 끝({video.duration:.2f}초)을 초과")
            continue

        # 세그먼트가 비디오 끝에 너무 가까우면 스킵 (최소 1초 여유 필요)
        if seg_start + 1.0 > video.duration:
            print(f"[SKIP] 세그먼트 {idx+1} 제외: 비디오 종료까지 여유 시간 부족 (최소 1초 필요)")
            continue

        valid_segments.append(segment)

    segments = valid_segments

    # Key moment와 겹치지 않도록 세그먼트 타이밍 조정
    key_moment = metadata.get('key_moment')
    if key_moment is not None:
        key_moment_start = key_moment
        # 비디오 길이에 따라 key moment 지속 시간 결정 (20초 초과 시 5초, 이하 시 2초)
        highlight_duration = 5.0 if video.duration > 20 else 2.0
        key_moment_end = min(key_moment + highlight_duration, video.duration)
        print(f"\n[TIMING] Key moment 구간 ({key_moment_start}초 ~ {key_moment_end}초) 감지 (하이라이트 지속: {highlight_duration}초)")

        adjusted_segments = []
        for idx, segment in enumerate(segments):
            seg_start = segment['start']
            seg_end = segment['end']

            # 세그먼트가 key moment와 겹치는지 확인
            if seg_end > key_moment_start and seg_start < key_moment_end:
                # 옵션 0: 세그먼트가 key moment를 감싸고 있으면 (AI 의도) 그대로 유지
                if seg_start <= key_moment_start and seg_end >= key_moment_start:
                    adjusted_segments.append(segment)
                    print(f"[TIMING] 세그먼트 {idx+1} 유지: {seg_start}초~{seg_end}초 (key moment {key_moment_start}초를 포함하도록 설계됨)")
                # 옵션 1: key moment 전에 넣기
                elif seg_start < key_moment_start and key_moment_start - seg_start >= (seg_end - seg_start):
                    # key moment 전에 충분한 공간이 있으면 그대로 유지
                    adjusted_segments.append(segment)
                    print(f"[TIMING] 세그먼트 {idx+1} 유지: {seg_start}초 (key moment 전 공간 충분)")
                else:
                    # 옵션 2: key moment 끝난 후로 이동 (비디오 길이 체크)
                    new_start = key_moment_end
                    duration = seg_end - seg_start
                    new_end = new_start + duration

                    # 조정된 시작 위치가 비디오 끝에 너무 가까우면 그냥 원래대로 유지
                    if new_start + 1.0 > video.duration:
                        print(f"[TIMING] 세그먼트 {idx+1} 유지: {seg_start}초~{seg_end}초 (key moment 후 공간 부족, 원래 위치 유지)")
                        adjusted_segments.append(segment)
                        continue

                    print(f"[TIMING] 세그먼트 {idx+1} 조정: {seg_start}초 → {new_start}초 (key moment 회피)")
                    adjusted_segments.append({
                        'start': new_start,
                        'end': new_end,
                        'text': segment['text']
                    })
            else:
                adjusted_segments.append(segment)

        segments = adjusted_segments

    # 각 세그먼트마다 음성 생성
    print(f"\n[MIC] AI 음성 생성 중... (총 {len(segments)}개 세그먼트)")

    narration_clips = []  # 내레이션 보이스만 저장 (더킹용)
    last_voice_end = 0  # 이전 음성이 끝나는 시간 추적
    min_gap = 0.3  # 음성 간 최소 간격 (초)

    for idx, segment in enumerate(segments):
        print(f"\n[{idx+1}/{len(segments)}] {segment['start']}초 ~ {segment['end']}초")
        print(f"텍스트: {segment['text']}")

        # 임시 음성 파일 생성
        temp_voice_file = f"temp_voice_{idx}.mp3"
        generate_voice(segment['text'], temp_voice_file)

        # 보이스 속도 1.2배로 조정 (pydub 사용)
        if AudioSegment is not None and speedup is not None:
            try:
                audio_seg = AudioSegment.from_file(temp_voice_file)
                audio_seg = speedup(audio_seg, playback_speed=1.2)
                audio_seg.export(temp_voice_file, format="mp3")
                print(f"[SPEED] 보이스 속도 1.2배로 조정 완료")
            except Exception as e:
                print(f"[WARNING] 보이스 속도 조정 실패: {e}")

        # 오디오 클립 로드
        voice_clip = AudioFileClip(temp_voice_file)

        # 시작 시간 조정: 이전 음성과 겹치지 않도록
        adjusted_start = segment['start']
        if idx > 0 and adjusted_start < last_voice_end + min_gap:
            adjusted_start = last_voice_end + min_gap
            print(f"[TIMING] 음성 겹침 방지: 시작 시간 {segment['start']:.2f}초 → {adjusted_start:.2f}초로 조정")

        # 조정된 시작 시간이 비디오 끝을 넘으면 스킵
        if adjusted_start >= video.duration:
            print(f"[SKIP] 조정된 시작 시간({adjusted_start:.2f}초)이 비디오 끝({video.duration:.2f}초)을 초과하여 건너뜀")
            continue

        voice_clip = voice_clip.with_start(adjusted_start)

        # 보이스가 비디오 끝을 넘지 않도록 제한
        voice_end = adjusted_start + voice_clip.duration
        if voice_end > video.duration:
            trim_duration = video.duration - adjusted_start
            if trim_duration > 0.5:  # 최소 0.5초는 남아야 의미 있음
                voice_clip = voice_clip.subclipped(0, trim_duration)
                voice_end = adjusted_start + trim_duration
                print(f"[NOTE] 보이스가 비디오 길이를 초과하여 {trim_duration:.2f}초로 자름")
            else:
                print(f"[SKIP] 남은 시간이 너무 짧아 건너뜀 (여유: {trim_duration:.2f}초)")
                continue

        if voice_volume != 1.0:
            voice_clip = voice_clip.with_effects([MultiplyVolume(voice_volume)])

        voice_clips.append(voice_clip)
        narration_clips.append(voice_clip)  # 내레이션만 따로 저장
        temp_voice_files.append(temp_voice_file)

        # 다음 반복을 위해 현재 음성이 끝나는 시간 저장
        last_voice_end = voice_end

    # Key moment에 사운드 이펙트 추가
    sound_effect_clip = None
    if metadata.get('key_moment') is not None:
        sound_effect_path = get_random_sound_effect()
        if sound_effect_path:
            print(f"\n[AUDIO] Key moment ({metadata['key_moment']}초)에 사운드 이펙트 추가: {os.path.basename(sound_effect_path)}")
            sound_effect_clip = AudioFileClip(sound_effect_path).with_start(metadata['key_moment'])
            if sound_effect_volume != 1.0:
                sound_effect_clip = sound_effect_clip.with_effects([MultiplyVolume(sound_effect_volume)])
            voice_clips.append(sound_effect_clip)

    # Background music: 메타데이터가 'no'일 때만 추가 (원본 비디오에 음악이 없는 경우)
    background_music_clip = None
    bg_music_metadata = str(metadata.get('background_music', '')).lower() if metadata else ''
    enable_background_music = get_config_value(["audio_settings", "enable_background_music"], True)

    if not enable_background_music:
        print(f"\n[MUSIC] 백그라운드 음악 추가 기능이 비활성화되어 있습니다 (config: enable_background_music = false)")
    elif bg_music_metadata == 'no':
        music_path = get_random_background_music()
        if music_path:
            print(f"\n[MUSIC] 원본 비디오에 배경 음악 없음 → 배경 음악 추가: {os.path.basename(music_path)}")
            background_music_clip = AudioFileClip(music_path)
            if background_music_clip.duration < video.duration:
                background_music_clip = background_music_clip.with_effects([AudioLoop(duration=video.duration)])
            background_music_clip = background_music_clip.subclipped(0, video.duration).with_start(0)
            if background_music_volume != 1.0:
                print(f"[AUDIO] 배경 음악 볼륨 조정: {background_music_volume:.2f}x")
                background_music_clip = background_music_clip.with_effects([
                    MultiplyVolume(background_music_volume)
                ])
            voice_clips.append(background_music_clip)
        else:
            print(f"\n[WARNING] 배경 음악 파일을 찾을 수 없습니다 (background music 폴더 확인 필요)")
    else:
        print(f"\n[MUSIC] 원본 비디오에 배경 음악이 이미 있음 (Background Music: {metadata.get('background_music', 'N/A')}) → 추가하지 않음")

    # 오디오 더킹: 보이스 구간에만 원본 오디오 볼륨 감소
    ducking_volume = get_config_value(["audio_settings", "ducking_volume"], 0.3)
    audio_clips = []
    if has_original_audio:
        print(f"\n[AUDIO] 오디오 더킹 적용 (보이스 구간 원본 오디오 {ducking_volume * 100:.0f}% 볼륨)")

        # 내레이션 보이스 클립의 구간들만 수집 (배경음악/사운드이펙트 제외)
        voice_segments = [(clip.start, clip.start + clip.duration)
                          for clip in narration_clips]

        # 원본 오디오를 구간별로 분할하여 더킹 적용
        current_time = 0
        video_duration = video.duration

        for start, end in voice_segments:
            # 비디오 범위를 벗어나는 구간 스킵
            if start >= video_duration:
                continue

            # 보이스 전 구간: 원본 볼륨
            if current_time < start:
                audio_clips.append(
                    original_audio.subclipped(current_time, min(start, video_duration)).with_start(current_time)
                )

            # 보이스 구간: 더킹 적용
            end_clamped = min(end, video_duration)
            if start < end_clamped:
                ducked_segment = original_audio.subclipped(start, end_clamped).with_effects(
                    [MultiplyVolume(ducking_volume)]
                ).with_start(start)
                audio_clips.append(ducked_segment)

            current_time = end

        # 마지막 보이스 이후 구간: 원본 볼륨
        if current_time < video_duration:
            audio_clips.append(
                original_audio.subclipped(current_time, video_duration).with_start(current_time)
            )
    else:
        print("\n[AUDIO] 원본 오디오가 없어 더킹 없이 진행합니다.")

    # 모든 오디오 합성
    print("[MUSIC] 오디오 합성 중...")
    final_audio = CompositeAudioClip(audio_clips + voice_clips)

    # 비디오에 새 오디오 설정
    final_video = video.with_audio(final_audio)

    # 메인 비디오 위치/스케일 조정 (캔버스 내에서 여백 확보용)
    # 중복 블록 - 이미 위에서 스케일/오프셋을 적용했으므로 여기서는 무시
    main_scale = 1.0
    main_offset_y = 0
    print(f"[VIDEO] 메인 영상 오프셋/스케일 적용: offset_y={main_offset_y}, scale={main_scale}")
    base_clip = final_video
    if main_scale != 1.0:
        base_clip = base_clip.resized(main_scale)
    video_w, video_h = final_video.size
    base_w, base_h = base_clip.size
    center_y = (video_h - base_h) / 2.0
    pos_y = center_y + main_offset_y
    background = ColorClip(size=(video_w, video_h), color=(0, 0, 0)).with_duration(final_video.duration)
    positioned = base_clip.with_position(("center", pos_y))
    final_video = CompositeVideoClip([background, positioned])

    # 9:16 레터박스 적용 (메인 영상 중앙 정렬)
    TARGET_WIDTH = 1080
    TARGET_HEIGHT = 1920
    fit_mode = str(get_config_value(["video_settings", "fit_mode"], "letterbox")).lower()
    top_padding = max(0, int(get_config_value(["video_settings", "top_padding"], 0)))
    bottom_padding = max(0, int(get_config_value(["video_settings", "bottom_padding"], 0)))
    current_w, current_h = final_video.size
    if False:  # 중복 Letterbox 블록 비활성화
        # 먼저 너비를 꽉 채우도록 스케일
        scale_factor = TARGET_WIDTH / max(1, current_w)
        print(f"[FIT] Letterbox 모드 적용 (scale={scale_factor:.3f})")
        resized_clip = final_video.resized(scale_factor)

        # 상하단 패딩 적용 (필요하면 비율이 9:16을 약간 벗어나도 일부 영역이 잘릴 수 있음)
        available_height = max(1, TARGET_HEIGHT - top_padding - bottom_padding)
        offset_pixels = float(main_offset_y) * scale_factor
        print(f"[FIT] Letterbox 가용높이={available_height:.1f}, clip_h={resized_clip.h:.1f}, scale_offset={offset_pixels:.1f}")

        letterbox_color = parse_color(get_config_value(["video_settings", "letterbox_color"], "#000000"))
        background = ColorClip(size=(TARGET_WIDTH, TARGET_HEIGHT), color=letterbox_color).with_duration(resized_clip.duration)
        pos_x = (TARGET_WIDTH - resized_clip.w) / 2
        base_pos_y = top_padding + (available_height - resized_clip.h) / 2
        min_pos_y = top_padding + min(0, available_height - resized_clip.h)
        max_pos_y = top_padding + max(0, available_height - resized_clip.h)
        pos_y = base_pos_y + offset_pixels
        pos_y = max(min_pos_y, min(max_pos_y, pos_y))
        print(f"[FIT] Letterbox 위치: pos_x={pos_x:.1f}, pos_y={pos_y:.1f} (범위 {min_pos_y:.1f} ~ {max_pos_y:.1f})")
        final_video = CompositeVideoClip([background, resized_clip.with_position((pos_x, pos_y))])
    else:
        # fit_mode가 letterbox가 아니더라도 비율 유지 (사용자 요청)
        # 원본 비율을 유지하면서 1080x1920 안에 맞춤
        if current_w != TARGET_WIDTH or current_h != TARGET_HEIGHT:
            scale_w = TARGET_WIDTH / max(1, current_w)
            scale_h = TARGET_HEIGHT / max(1, current_h)
            scale_factor = min(scale_w, scale_h)  # 작은 쪽 기준으로 스케일 (비율 유지)
            print(f"[RESIZE] 비율 유지 모드 적용 (scale={scale_factor:.3f})")
            resized_clip = final_video.resized(scale_factor)

            letterbox_color = parse_color(get_config_value(["video_settings", "letterbox_color"], "#000000"))
            background = ColorClip(size=(TARGET_WIDTH, TARGET_HEIGHT), color=letterbox_color).with_duration(resized_clip.duration)
            pos_x = (TARGET_WIDTH - resized_clip.w) / 2
            pos_y = (TARGET_HEIGHT - resized_clip.h) / 2
            print(f"[RESIZE] 비디오 크기: {resized_clip.w:.1f}x{resized_clip.h:.1f}, 위치: ({pos_x:.1f}, {pos_y:.1f})")
            final_video = CompositeVideoClip([background, resized_clip.with_position((pos_x, pos_y))])

    # 메인 비디오 위치/스케일 조정 (캔버스 내에서 여백 확보용)
    main_scale = float(get_layout_value("video", "scale", ["video_settings", "main_video_scale"], 1.0))
    main_offset_y = int(get_layout_value("video", "offset_y", ["video_settings", "main_video_offset_y"], 40))
    print(f"[VIDEO] 메인 영상 오프셋/스케일 적용: offset_y={main_offset_y}, scale={main_scale}")
    base_clip = final_video
    if main_scale != 1.0:
        base_clip = base_clip.resized(main_scale)
    video_w, video_h = final_video.size
    base_w, base_h = base_clip.size
    center_y = (video_h - base_h) / 2.0
    pos_y = center_y + main_offset_y
    background = ColorClip(size=(video_w, video_h), color=(0, 0, 0)).with_duration(final_video.duration)
    positioned = base_clip.with_position(("center", pos_y))
    final_video = CompositeVideoClip([background, positioned])

    # 9:16 레터박스 적용 (메인 영상 중앙 정렬)
    TARGET_WIDTH = 1080
    TARGET_HEIGHT = 1920
    fit_mode = str(get_config_value(["video_settings", "fit_mode"], "letterbox")).lower()
    top_padding = max(0, int(get_config_value(["video_settings", "top_padding"], 0)))
    bottom_padding = max(0, int(get_config_value(["video_settings", "bottom_padding"], 0)))
    current_w, current_h = final_video.size
    if fit_mode == "letterbox":
        # 먼저 너비를 꽉 채우도록 스케일
        scale_factor = TARGET_WIDTH / max(1, current_w)
        print(f"[FIT] Letterbox 모드 적용 (scale={scale_factor:.3f})")
        resized_clip = final_video.resized(scale_factor)

        # 상하단 패딩 적용 (필요하면 비율이 9:16을 약간 벗어나도 일부 영역이 잘릴 수 있음)
        available_height = max(1, TARGET_HEIGHT - top_padding - bottom_padding)
        offset_pixels = float(main_offset_y) * scale_factor
        print(f"[FIT] Letterbox 가용높이={available_height:.1f}, clip_h={resized_clip.h:.1f}, scale_offset={offset_pixels:.1f}")

        letterbox_color = parse_color(get_config_value(["video_settings", "letterbox_color"], "#000000"))
        background = ColorClip(size=(TARGET_WIDTH, TARGET_HEIGHT), color=letterbox_color).with_duration(resized_clip.duration)
        pos_x = (TARGET_WIDTH - resized_clip.w) / 2
        base_pos_y = top_padding + (available_height - resized_clip.h) / 2
        min_pos_y = top_padding + min(0, available_height - resized_clip.h)
        max_pos_y = top_padding + max(0, available_height - resized_clip.h)
        pos_y = base_pos_y + offset_pixels
        pos_y = max(min_pos_y, min(max_pos_y, pos_y))
        print(f"[FIT] Letterbox 위치: pos_x={pos_x:.1f}, pos_y={pos_y:.1f} (범위 {min_pos_y:.1f} ~ {max_pos_y:.1f})")
        final_video = CompositeVideoClip([background, resized_clip.with_position((pos_x, pos_y))])
    else:
        # fit_mode가 letterbox가 아니더라도 비율 유지 (사용자 요청)
        # 원본 비율을 유지하면서 1080x1920 안에 맞춤
        if current_w != TARGET_WIDTH or current_h != TARGET_HEIGHT:
            scale_w = TARGET_WIDTH / max(1, current_w)
            scale_h = TARGET_HEIGHT / max(1, current_h)
            scale_factor = min(scale_w, scale_h)  # 작은 쪽 기준으로 스케일 (비율 유지)
            print(f"[RESIZE] 비율 유지 모드 적용 (scale={scale_factor:.3f})")
            resized_clip = final_video.resized(scale_factor)

            letterbox_color = parse_color(get_config_value(["video_settings", "letterbox_color"], "#000000"))
            background = ColorClip(size=(TARGET_WIDTH, TARGET_HEIGHT), color=letterbox_color).with_duration(resized_clip.duration)
            pos_x = (TARGET_WIDTH - resized_clip.w) / 2
            pos_y = (TARGET_HEIGHT - resized_clip.h) / 2
            print(f"[RESIZE] 비디오 크기: {resized_clip.w:.1f}x{resized_clip.h:.1f}, 위치: ({pos_x:.1f}, {pos_y:.1f})")
            final_video = CompositeVideoClip([background, resized_clip.with_position((pos_x, pos_y))])

    if flash_settings["enabled"] and scene_change_times:
        print(f"\n[FLASH] 씬 전환 플래시 적용 ({len(scene_change_times)}회)")
        flash_opacity = max(0.05, min(1.0, flash_settings["flash_intensity"] / 2.0))
        flash_clips = []
        for change_time in scene_change_times:
            start_time = max(0.0, change_time - flash_settings["flash_duration"] / 2)
            if start_time >= video.duration:
                continue
            flash_clip = ColorClip(size=video.size, color=(255, 255, 255))
            flash_clip = flash_clip.with_duration(flash_settings["flash_duration"]).with_start(start_time)
            flash_clip = flash_clip.with_opacity(flash_opacity)
            flash_clips.append(flash_clip)
        if flash_clips:
            final_video = CompositeVideoClip([final_video, *flash_clips])

    # 선택적 리액션 비디오 추가
    reaction_cfg = get_config_value(["reaction_video"], {}) or {}
    if reaction_cfg.get("enabled"):
        reaction_video_dir = "reaction video"
        height_ratio = float(reaction_cfg.get("height_ratio", 0.2))
        height_ratio = max(0.05, min(0.5, height_ratio))
        if os.path.exists(reaction_video_dir):
            reaction_files = [
                f for f in os.listdir(reaction_video_dir)
                if f.lower().endswith(('.mp4', '.mov', '.avi', '.mkv'))
            ]
            if reaction_files:
                reaction_path = os.path.join(reaction_video_dir, reaction_files[0])
                print(f"\n[REACTION] 최하단에 리액션 비디오 추가: {reaction_path}")

                try:
                    reaction_clip = VideoFileClip(reaction_path)

                    video_width = final_video.w
                    video_height = final_video.h

                    reaction_clip = reaction_clip.resized(width=video_width)
                    target_height = int(video_height * height_ratio)

                    if reaction_clip.duration < final_video.duration:
                        reaction_clip = reaction_clip.looped(duration=final_video.duration)
                    else:
                        reaction_clip = reaction_clip.subclipped(0, final_video.duration)

                    reaction_clip = reaction_clip.cropped(y1=0, y2=target_height, x1=0, x2=video_width)

                    pos_x = 0
                    pos_y = video_height - target_height

                    reaction_clip = reaction_clip.with_position((pos_x, pos_y))
                    final_video = CompositeVideoClip([final_video, reaction_clip])

                    print(f"   [SUCCESS] 리액션 비디오 추가 완료 (너비: {video_width}px, 표시 높이: {target_height}px, 위치: 하단)")
                except Exception as e:
                    print(f"   [WARNING] 리액션 비디오 추가 실패: {e}")

    # 썸네일 타이틀 텍스트 오버레이 추가 - 비활성화됨
    # if metadata.get('thumbnail_title'):
    #     print(f"\n[NOTE] 썸네일 타이틀 추가: {metadata['thumbnail_title']}")
    #     ... (코드 제거됨)

    # 크로마키 리액션 비디오 오버레이 - 비활성화됨 (성능 최적화)
    # chromakey_cfg = get_config_value(["chromakey_settings"], {}) or {}
    # chromakey_enabled = chromakey_cfg.get("enabled", True)
    # ... (코드 제거됨)

    # AI 대사 자막은 맨 마지막에 추가 (리액션 비디오 뒤)
    # 자막 클립을 먼저 생성만 함
    subtitle_clips = []
    if add_subtitles and segments:
        print(f"\n[NOTE] AI 대사 자막 추가 중... (총 {len(segments)}개)")

        # 자막 설정
        subtitle_font = get_windows_font()
        subtitle_font_path = get_config_value(["subtitle_settings", "text_font"], subtitle_font)
        if not subtitle_font_path or not os.path.exists(subtitle_font_path):
            subtitle_font_path = subtitle_font

        # 9:16 비율 기준으로 고정된 자막 크기 (1080x1920 기준)
        # 원본 비율과 관계없이 항상 일정한 크기로 표시
        STANDARD_WIDTH = 1080
        STANDARD_HEIGHT = 1920

        # 자막 폰트 크기: 1080x1920 기준 35px
        subtitle_font_size = int(get_layout_value("subtitle", "font_size", ["subtitle_settings", "text_size"], 35))

        # 자막 색상: 파라미터로 전달된 색상 우선, 없으면 config 사용
        if subtitle_color is None:
            subtitle_color = get_config_value(["subtitle_settings", "text_color"], "pink")
        subtitle_stroke_width = int(get_config_value(["subtitle_settings", "stroke_width"], 5))
        subtitle_stroke_color = get_config_value(["subtitle_settings", "stroke_color"], "black")
        subtitle_style = str(get_config_value(["subtitle_settings", "style"], "capcut") or "capcut").lower()
        subtitle_line_spacing = int(get_config_value(
            ["subtitle_settings", "line_spacing"],
            max(6, subtitle_font_size // 6)
        ))
        italic_shear = float(get_config_value(["subtitle_settings", "italic_shear"], 0.22))
        use_slanted_style = subtitle_style in {"sports_slant", "k-wave", "hangul_slant", "kwave", "bold_slant"}
        language_code = str(get_config_value(["voice_settings", "language"], "en") or "").lower()
        prefer_cjk_language = any(language_code.startswith(prefix) for prefix in ("ko", "ja", "zh"))
        force_pil_renderer = prefer_cjk_language or bool(get_config_value(["subtitle_settings", "force_pil_renderer"], False))

        # 랜덤 색상 설정
        random_colors_enabled = get_config_value(["subtitle_settings", "random_colors", "enabled"], False)
        random_colors_list = get_config_value(["subtitle_settings", "random_colors", "colors"], ["pink"])
        current_color_index = 0

        # 하단 여백: 1920 기준 600px - 더 위쪽에 표시
        subtitle_bottom_margin = int(get_layout_value("subtitle", "bottom_margin", ["subtitle_settings", "bottom_margin"], 600))

        # 자막 최대 너비: 현재 비디오 너비의 85%로 설정 (화면 밖으로 나가지 않도록)
        video_width = final_video.w
        side_margin = int(get_layout_value("subtitle", "side_margin", ["subtitle_settings", "side_margin"], 90))
        video_height = final_video.h
        TARGET_WIDTH = 1080
        TARGET_HEIGHT = 1920
        display_scale = min(TARGET_WIDTH / max(1, video_width), TARGET_HEIGHT / max(1, video_height))
        font_scale = min(1.0, display_scale)
        subtitle_font_size = max(18, int(round(subtitle_font_size * font_scale)))
        subtitle_stroke_width = max(1, int(round(subtitle_stroke_width * font_scale)))
        subtitle_line_spacing = max(0, int(round(subtitle_line_spacing * font_scale)))
        subtitle_bottom_margin = max(40, int(round(subtitle_bottom_margin * font_scale)))
        side_margin = int(round(side_margin * font_scale))
        subtitle_margin = max(10, int(round(20 * font_scale)))

        # 실제 비디오 너비 기준으로 계산 (좌우 여백 포함)
        subtitle_max_width = max(200, video_width - (2 * side_margin))
        print(f"[SUBTITLE] 자막 설정: 폰트={subtitle_font_size}px, 최대너비={subtitle_max_width}px (비디오: {video_width}px)")

        subtitle_exit_cfg = get_config_value(["subtitle_settings", "exit_animation"], {}) or {}
        subtitle_exit_vertical_offset = _safe_float(subtitle_exit_cfg.get("vertical_offset"), 60)
        subtitle_exit_scale_reduction = _safe_float(subtitle_exit_cfg.get("scale_reduction"), 0.08)
        subtitle_clips = []
        last_subtitle_end = 0  # 이전 자막이 끝나는 시간 추적
        min_subtitle_gap = 0.2  # 자막 간 최소 간격 (초)

        for idx, segment in enumerate(segments):
            text = segment['text'].strip()
            start_time = float(segment['start'])
            end_time = float(segment['end'])

            # 자막 지속 시간 계산
            duration = end_time - start_time
            min_duration = float(get_config_value(["subtitle_settings", "min_duration"], 1.2))
            extra_hold = float(get_config_value(["subtitle_settings", "extra_hold"], 0.6))
            duration = max(duration + extra_hold, min_duration)

            # 자막 겹침 방지: 이전 자막과 겹치면 시작 시간 조정
            adjusted_start = start_time
            if idx > 0 and start_time < last_subtitle_end + min_subtitle_gap:
                adjusted_start = last_subtitle_end + min_subtitle_gap
                print(f"   [TIMING] 자막 겹침 방지: {start_time:.2f}초 → {adjusted_start:.2f}초")

            # 조정된 끝 시간 계산
            adjusted_end = adjusted_start + duration

            # 비디오 길이를 초과하는 경우 조정
            if adjusted_start >= video.duration:
                print(f"   [SKIP] 자막 {idx+1} 제외: 시작({adjusted_start:.2f}초)이 비디오 끝({video.duration:.2f}초)을 초과")
                continue

            if adjusted_end > video.duration:
                duration = video.duration - adjusted_start
                adjusted_end = video.duration
                if duration < 0.5:
                    print(f"   [SKIP] 자막 {idx+1} 제외: 남은 시간이 너무 짧음")
                    continue

            start_time = adjusted_start

            try:
                # 자막 클립 생성 (method="caption"으로 자동 줄바꿈)
                effective_width = max(50, subtitle_max_width - subtitle_margin * 2)  # 좌우 margin 고려
                wrapped_text = wrap_text_preserving_words(
                    text,
                    subtitle_font_path,
                    subtitle_font_size,
                    effective_width,
                    subtitle_stroke_width
                )

                # 랜덤 색상 선택 (활성화된 경우)
                if random_colors_enabled and random_colors_list:
                    current_subtitle_color = random_colors_list[current_color_index % len(random_colors_list)]
                    current_color_index += 1
                else:
                    current_subtitle_color = subtitle_color

                subtitle_clip = None
                textclip_error = None

                if not force_pil_renderer:
                    try:
                        subtitle_clip = TextClip(
                            text=wrapped_text,
                            font=get_textclip_font_name(subtitle_font_path),
                            font_size=subtitle_font_size,
                            color=current_subtitle_color,
                            stroke_color=subtitle_stroke_color,
                            stroke_width=subtitle_stroke_width,
                            margin=(subtitle_margin, subtitle_margin, subtitle_margin, subtitle_margin),
                            interline=subtitle_line_spacing,
                            method="caption",  # 줄바꿈은 wrap_text_preserving_words 에서 제어
                            size=(effective_width, None),  # margin을 제외한 텍스트 영역 너비 (3270번 줄에서 계산됨)
                            text_align="center"  # 중앙 정렬
                        )
                    except Exception as exc:
                        textclip_error = exc

                if subtitle_clip is None:
                    if textclip_error:
                        print(f"   [FALLBACK] TextClip 자막 생성 실패, PIL 렌더링 사용 ({textclip_error})")
                    elif force_pil_renderer:
                        print("   [FALLBACK] 한국어/일본어/중국어 모드 → PIL 자막 렌더러 사용")

                    subtitle_clip = create_pil_subtitle_clip(
                        wrapped_text,
                        subtitle_font_path,
                        subtitle_font_size,
                        current_subtitle_color,
                        subtitle_stroke_color,
                        subtitle_stroke_width,
                        (subtitle_margin, subtitle_margin, subtitle_margin, subtitle_margin),
                        subtitle_line_spacing,
                        italic_shear if use_slanted_style else 0.0
                    )
                elif use_slanted_style:
                    subtitle_clip = convert_textclip_to_slanted_imageclip(subtitle_clip, italic_shear)

                # 화면 하단에 위치 (1920 기준 400px 위)
                # 현재 비디오 높이에 맞춰 비율 조정
                y_position = video_height - subtitle_bottom_margin

                # 자막이 화면 밖으로 나가지 않도록 조정
                if y_position < 0:
                    y_position = video_height // 2  # 너무 작으면 중앙에 표시
                elif y_position + subtitle_clip.h > video_height:
                    y_position = video_height - subtitle_clip.h - 50  # 최소 50px 여백

                subtitle_clip = (
                    subtitle_clip.with_start(start_time)
                               .with_duration(duration)
                               .with_position(('center', y_position))
                )

                # 자막이 사라질 때 opacity만 낮춰지면서 빠르게 페이드아웃
                subtitle_exit_duration = min(0.25, max(0.15, duration * 0.2))
                subtitle_clip = subtitle_clip.with_effects([FadeOut(subtitle_exit_duration)])

                subtitle_clips.append(subtitle_clip)
                print(f"   [OK] [{idx+1}/{len(segments)}] {start_time:.1f}초 (y={y_position}): {text[:40]}...")

                # 다음 자막을 위해 현재 자막의 끝나는 시간 저장
                last_subtitle_end = start_time + duration

            except Exception as e:
                print(f"   [WARNING] 자막 생성 실패 [{idx+1}]: {e}")
                continue

        if subtitle_clips:
            print(f"[OK] {len(subtitle_clips)}개 자막 클립 생성 완료 (하단에서 {subtitle_bottom_margin}px 위)")
        else:
            print("[WARNING] 생성된 자막이 없습니다")

    # 폴더 이름 세로 텍스트 오버레이 추가 (비활성화됨)
    if folder_name:
        print(f"\n[FOLDER] 폴더 이름 세로 텍스트 추가: {folder_name}")
        folder_overlay_cfg = get_config_value(["folder_overlay"], {}) or {}
        # 폴더 오버레이 기능 비활성화 - 기본값 False로 설정
        if folder_overlay_cfg.get("enabled", False):
            # 활성화된 경우에만 오버레이 추가
            # 텍스트 설정 (비디오 높이의 3%에서 40% 더 작게 = 1.8%)
            video_height = final_video.h
            folder_font_size = int(video_height * 0.03 * 0.6)  # 40% 더 작게

            # 폴더 이름만 (이모지 제거)
            vertical_text = folder_name

            # 텍스트 설정 (Windows 폰트 사용)
            default_font = get_windows_font()
            folder_font_path = get_config_value(["text_settings", "font"], default_font)

            # config에 폰트가 없거나 존재하지 않으면 Windows 폰트 사용
            if not folder_font_path or not os.path.exists(folder_font_path):
                folder_font_path = default_font

            # PIL로 텍스트 이미지 생성
            try:
                pil_font = load_pil_font(folder_font_path, folder_font_size)
            except OSError:
                pil_font = ImageFont.load_default()

            # 카메라 아이콘 로드
            camera_icon_path = "asset/camera-icon-design-template-d8c5370c36c44621de2fd64718718d58_screen.png"
            camera_icon = Image.open(camera_icon_path).convert("RGBA")

            # 카메라 아이콘 크기 조정 (텍스트보다 10% 크게)
            icon_size = int(folder_font_size * 1.1)  # 텍스트보다 10% 크게
            camera_icon = camera_icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)

            # 카메라 아이콘 투명도 조정 (60% 불투명도)
            if camera_icon.mode == 'RGBA':
                alpha = camera_icon.split()[3]
                alpha = alpha.point(lambda p: int(p * 0.6))  # 60% 불투명도
                camera_icon.putalpha(alpha)

            # 텍스트 스트로크 설정 및 크기 측정 (스트로크 포함)
            text_stroke_width = 3
            measure_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
            text_bbox = measure_draw.textbbox(
                (0, 0),
                vertical_text,
                font=pil_font,
                stroke_width=text_stroke_width
            )
            text_width = text_bbox[2] - text_bbox[0]
            text_height = text_bbox[3] - text_bbox[1]

            # 여백과 간격
            padding = 3
            spacing = 3  # 아이콘과 텍스트 사이 간격

            # 전체 이미지 높이를 아이콘과 텍스트 중 더 큰 것으로 맞춤
            max_height = max(icon_size, text_height)

            # 전체 이미지 크기 (가로: 아이콘 + 간격 + 텍스트)
            img_width = icon_size + spacing + text_width + padding * 2
            img_height = max_height + padding * 2

            # 이미지 생성 (가로로 배치)
            combined_image = Image.new("RGBA", (img_width, img_height), (0, 0, 0, 0))

            # 카메라 아이콘과 텍스트를 수직 중앙 정렬
            icon_y = (img_height - icon_size) // 2
            text_y = (img_height - text_height) // 2

            # 카메라 아이콘 붙이기 (왼쪽, 중앙 정렬)
            combined_image.paste(camera_icon, (padding, icon_y), camera_icon)

            # 텍스트 그리기 (오른쪽, 중앙 정렬) - 투명도 적용
            text_draw = ImageDraw.Draw(combined_image)
            text_x = padding + icon_size + spacing
            text_draw.text(
                (text_x, text_y),
                vertical_text,
                font=pil_font,
                fill=(255, 255, 255, 153),  # 흰색 60% 불투명도 (255 * 0.6 = 153)
                stroke_width=text_stroke_width,  # 스트로크 더 굵게
                stroke_fill=(0, 0, 0, 153)  # 검정 60% 불투명도
            )

            # 아이콘/텍스트 마스크 생성 (분리 위치 계산용)
            icon_mask = Image.new("L", combined_image.size, 0)
            icon_alpha = camera_icon.split()[-1] if camera_icon.getbands()[-1] == "A" else None
            if icon_alpha is None:
                icon_mask.paste(255, (padding, icon_y, padding + icon_size, icon_y + icon_size))
            else:
                icon_mask.paste(icon_alpha, (padding, icon_y))

            text_mask = Image.new("L", combined_image.size, 0)
            text_mask_draw = ImageDraw.Draw(text_mask)
            text_mask_draw.text(
                (text_x, text_y),
                vertical_text,
                font=pil_font,
                fill=255,
                stroke_width=text_stroke_width,
                stroke_fill=255
            )

            # 이미지를 90도 회전 (반시계 방향)
            rotated_image = combined_image.rotate(90, expand=True)
            rotated_icon_mask = icon_mask.rotate(90, expand=True, resample=Image.Resampling.NEAREST)
            rotated_text_mask = text_mask.rotate(90, expand=True, resample=Image.Resampling.NEAREST)

            def _mask_bbox(mask_image):
                arr = np.array(mask_image)
                ys, xs = np.where(arr > 0)
                if ys.size == 0 or xs.size == 0:
                    return None
                x_min, x_max = int(xs.min()), int(xs.max()) + 1
                y_min, y_max = int(ys.min()), int(ys.max()) + 1
                return x_min, y_min, x_max, y_max

            def _expand_bbox(bbox, padding, width, height):
                if not bbox:
                    return None
                x_min, y_min, x_max, y_max = bbox
                x_min = max(0, x_min - padding)
                y_min = max(0, y_min - padding)
                x_max = min(width, x_max + padding)
                y_max = min(height, y_max + padding)
                if x_min >= x_max or y_min >= y_max:
                    return None
                return x_min, y_min, x_max, y_max

            icon_bbox = _mask_bbox(rotated_icon_mask)
            text_rotated_bbox = _mask_bbox(rotated_text_mask)
            padding_px = max(6, int(text_stroke_width) * 2)
            if text_rotated_bbox:
                text_rotated_bbox = _expand_bbox(
                    text_rotated_bbox,
                    padding_px,
                    rotated_image.width,
                    rotated_image.height
                )
            if icon_bbox:
                icon_bbox = _expand_bbox(
                    icon_bbox,
                    max(2, int(text_stroke_width)),
                    rotated_image.width,
                    rotated_image.height
                )

            # 기본 위치 계산
            base_cfg = folder_overlay_cfg.get("base_position") or {}
            base_x = float(base_cfg.get("x", 30))
            base_y_offset = float(base_cfg.get("y_offset", -50))
            base_y = (video_height - rotated_image.height) / 2 + base_y_offset

            def _parse_xy(value, default=(0.0, 0.0)):
                if isinstance(value, dict):
                    try:
                        return float(value.get("x", default[0])), float(value.get("y", default[1]))
                    except (TypeError, ValueError):
                        return default
                if isinstance(value, (list, tuple)) and len(value) == 2:
                    try:
                        return float(value[0]), float(value[1])
                    except (TypeError, ValueError):
                        return default
                return default

            def _parse_xy_optional(value):
                if value is None:
                    return None
                if isinstance(value, dict):
                    try:
                        return float(value.get("x")), float(value.get("y"))
                    except (TypeError, ValueError):
                        return None
                if isinstance(value, (list, tuple)) and len(value) == 2:
                    try:
                        return float(value[0]), float(value[1])
                    except (TypeError, ValueError):
                        return None
                return None

            text_offset = _parse_xy(folder_overlay_cfg.get("text_offset", {}), (0.0, 0.0))
            icon_offset = _parse_xy(folder_overlay_cfg.get("icon_offset", {}), (0.0, 0.0))
            text_position_override = _parse_xy_optional(folder_overlay_cfg.get("text_position"))
            icon_position_override = _parse_xy_optional(folder_overlay_cfg.get("icon_position"))

            overlays = []

            if text_rotated_bbox:
                cropped_text = rotated_image.crop(text_rotated_bbox)
                text_np = np.array(cropped_text)
                if text_np.size:
                    text_clip = ImageClip(text_np).with_duration(video.duration)
                    if text_position_override is not None:
                        text_position = text_position_override
                    else:
                        text_position = (
                            base_x + text_rotated_bbox[0] + text_offset[0],
                            base_y + text_rotated_bbox[1] + text_offset[1]
                        )
                    overlays.append(text_clip.with_position(text_position))

            if icon_bbox:
                cropped_icon = rotated_image.crop(icon_bbox)
                icon_np = np.array(cropped_icon)
                if icon_np.size:
                    icon_clip = ImageClip(icon_np).with_duration(video.duration)
                    if icon_position_override is not None:
                        icon_position = icon_position_override
                    else:
                        icon_position = (
                            base_x + icon_bbox[0] + icon_offset[0],
                            base_y + icon_bbox[1] + icon_offset[1]
                        )
                    overlays.append(icon_clip.with_position(icon_position))

            if overlays:
                final_video = CompositeVideoClip([final_video, *overlays])
            else:
                print("[WARNING] 폴더 오버레이를 생성하지 못했습니다.")

    # 프레임 오버레이 추가
    frame_overlay_cfg = get_config_value(["frame_overlay"], {}) or {}
    if frame_overlay_cfg.get("enabled", False):
        image_path = frame_overlay_cfg.get("image_path")
        resolved_path = image_path
        if resolved_path and not os.path.isabs(resolved_path):
            resolved_path = os.path.join(os.getcwd(), resolved_path)
        if resolved_path and os.path.exists(resolved_path):
            try:
                frame_clip = ImageClip(resolved_path).with_duration(final_video.duration)

                video_w, video_h = final_video.size
                scale = float(frame_overlay_cfg.get("scale", 1.0))
                target_w = max(1, int(video_w * scale))
                target_h = max(1, int(video_h * scale))
                frame_clip = frame_clip.resized((target_w, target_h))
                print(f"[FRAME] 오버레이 크기 조정: {target_w}x{target_h} (scale={scale})")

                opacity = float(frame_overlay_cfg.get("opacity", 1.0))
                if 0.0 <= opacity < 1.0:
                    frame_clip = frame_clip.with_opacity(opacity)

                position_cfg = frame_overlay_cfg.get("position", "center") or "center"
                if isinstance(position_cfg, str) and position_cfg == "center":
                    position = ("center", "center")
                else:
                    position = position_cfg
                frame_clip = frame_clip.with_position(position)

                final_video = CompositeVideoClip([final_video, frame_clip])
                print(f"\n[FRAME] 프레임 오버레이 적용: {image_path}")
            except Exception as e:
                print(f"\n[FRAME] 프레임 오버레이 적용 실패: {e}")
        else:
            print(f"\n[FRAME] 프레임 오버레이 이미지를 찾을 수 없습니다: {image_path}")

    # 자막을 맨 마지막에 추가 (최상단 레이어)
    if subtitle_clips:
        print(f"\n[SUBTITLE] 자막을 최상단 레이어로 추가 중... ({len(subtitle_clips)}개)")
        final_video = CompositeVideoClip([final_video] + subtitle_clips)
        print(f"[OK] 자막이 최상단에 추가되었습니다")

    # 최종 크기 확인 및 9:16 강제
    final_w, final_h = final_video.size
    print(f"[VIDEO] 현재 비디오 크기: {final_w}x{final_h}")

    TARGET_WIDTH = 1080
    TARGET_HEIGHT = 1920

    if final_w != TARGET_WIDTH or final_h != TARGET_HEIGHT:
        print(f"[RESIZE] 최종 크기 조정: {final_w}x{final_h} → {TARGET_WIDTH}x{TARGET_HEIGHT} (9:16)")
        final_video = final_video.resized((TARGET_WIDTH, TARGET_HEIGHT))
    else:
        print(f"[OK] 이미 올바른 크기 (9:16): {TARGET_WIDTH}x{TARGET_HEIGHT}")

    print("[VIDEO] 최종 비디오 생성 중...")

    # 비디오 저장 (H.264 코덱, AAC 오디오)
    # 동시 인코딩을 위한 인스턴스별 temp 파일명
    temp_dir = get_config_value(["paths", "temp_dir"], "Temp")
    temp_audio_file = os.path.join(temp_dir, f"temp-audio-{os.getpid()}.m4a")

    video_write_kwargs = {
        "codec": get_config_value(["audio_settings", "codec"], "libx264"),
        "audio_codec": get_config_value(["audio_settings", "audio_codec"], "aac"),
        "temp_audiofile": temp_audio_file,
        "remove_temp": True,
        "threads": 2,  # FFmpeg 스레드 수 제한 (동시 인코딩 대응)
        "fps": 30,
    }

    configured_bitrate = get_config_value(["video_settings", "bitrate"])
    if configured_bitrate:
        video_write_kwargs["bitrate"] = configured_bitrate

    configured_preset = get_config_value(["video_settings", "preset"])
    if configured_preset:
        video_write_kwargs["preset"] = configured_preset

    ffmpeg_params = get_config_value(["video_settings", "ffmpeg_params"])
    if ffmpeg_params:
        video_write_kwargs["ffmpeg_params"] = ffmpeg_params

    final_video.write_videofile(
        output_path,
        **video_write_kwargs,
    )

    # 리소스 정리
    video.close()
    final_video.close()
    for clip in voice_clips:
        clip.close()

    for temp_file in temp_voice_files:
        if os.path.exists(temp_file):
            os.remove(temp_file)

    print(f"\n[OK] 음성 오버레이 및 자막 완료: {output_path}")
    return output_path


def auto_upload_processed_video(video_path=None, metadata=None):
    """처리된 비디오를 자동으로 업로드 (환경 설정에 따라 멀티 계정 지원)."""
    if not get_config_value(["youtube_settings", "auto_upload"], False):
        return

    if video_path is not None and not os.path.exists(video_path):
        print(f"[WARNING] 자동 업로드를 건너뜁니다. 출력 비디오를 찾을 수 없습니다: {video_path}")
        return

    if video_path is None:
        output_dir = get_config_value(["paths", "output_dir"], "Output")
        candidate_path = os.path.join(output_dir, "final_video.mp4")
        if not os.path.exists(candidate_path):
            print("[WARNING] 자동 업로드를 건너뜁니다. 출력 비디오를 찾을 수 없습니다.")
            return
        video_path = candidate_path

    accounts_config_path = os.path.join("Config", "accounts.json")
    use_multi_account = False

    if os.path.exists(accounts_config_path):
        try:
            with open(accounts_config_path, "r", encoding="utf-8") as accounts_file:
                accounts_config = json.load(accounts_file)
            use_multi_account = bool(accounts_config.get("accounts"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[WARNING] 계정 설정을 불러오지 못했습니다 ({exc}). 단일 계정 업로드를 시도합니다.")

    uploader = None

    if use_multi_account:
        try:
            from youtube_upload_multi import upload_from_output as uploader
        except ImportError as exc:
            print(f"[WARNING] 멀티 계정 업로드 모듈 로드 실패: {exc}. 단일 계정 업로드로 전환합니다.")
            use_multi_account = False

    if not use_multi_account:
        try:
            from youtube_upload import upload_from_output as uploader
        except ImportError as exc:
            print(f"[ERROR] 자동 업로드를 위한 업로드 모듈을 찾을 수 없습니다: {exc}")
            return

    if uploader is None:
        print("[ERROR] 자동 업로드를 위한 업로드 함수가 설정되지 않았습니다.")
        return

    try:
        video_id = uploader(video_path=video_path, metadata=metadata)
        if video_id:
            print(f"[UPLOAD] 자동 업로드 완료: {video_id}")
    except Exception as exc:
        print(f"[ERROR] 자동 업로드 실패: {exc}")


def main():
    """메인 실행 함수"""

    # MoviePy 임시 디렉토리를 인스턴스별로 분리 (동시 인코딩 대응)
    temp_dir = get_config_value(["paths", "temp_dir"], "Temp")
    moviepy_temp_dir = os.path.join(temp_dir, f"moviepy_{os.getpid()}")
    os.makedirs(moviepy_temp_dir, exist_ok=True)
    os.environ["MOVIEPY_TEMP_DIR"] = moviepy_temp_dir
    print(f"[INIT] MoviePy temp 디렉토리: {moviepy_temp_dir}")

    # 입력/출력 경로 설정
    input_dir = get_config_value(["paths", "input_dir"], "Input")
    try:
        input_video, original_source, folder_name = find_first_video_file(input_dir)
    except FileNotFoundError as exc:
        print(f"[ERROR] {exc}")
        return
    print(f"\n[VIDEO] 분석 대상 비디오: {input_video}")
    if folder_name:
        print(f"[FOLDER] 폴더 이름: {folder_name}")

    try:
        script = generate_script_with_gemini(input_video)
    except Exception as exc:
        import traceback
        print(f"\n[ERROR] Gemini 스크립트 생성 중 에러 발생:")
        print(f"   에러 타입: {type(exc).__name__}")
        print(f"   에러 메시지: {exc}")
        print(f"\n상세 스택 트레이스:")
        traceback.print_exc()

        # PROHIBITED_CONTENT 에러인 경우 파일을 건너뛰기 폴더로 이동
        if "PROHIBITED_CONTENT" in str(exc) or "block_reason" in str(exc):
            print(f"\n[WARNING] Gemini에 의해 차단된 콘텐츠입니다. 이 비디오를 건너뜁니다.")

            # 임시 파일 삭제
            cleaned = cleanup_extracted_video(input_video)
            if cleaned:
                print(f"[DELETE] 추출된 임시 비디오 삭제: {input_video}")

            # 원본 파일을 Used/Blocked 폴더로 이동
            if original_source:
                used_root = os.path.join(input_dir, "Used", "Blocked")
                os.makedirs(used_root, exist_ok=True)
                dest_path = os.path.join(used_root, os.path.basename(original_source))

                # 파일명 중복 처리
                counter = 1
                while os.path.exists(dest_path):
                    base, ext = os.path.splitext(os.path.basename(original_source))
                    dest_path = os.path.join(used_root, f"{base}_{counter}{ext}")
                    counter += 1

                try:
                    shutil.move(original_source, dest_path)
                    print(f"[BLOCKED] 차단된 파일 이동: {original_source} -> {dest_path}")
                except Exception as move_err:
                    print(f"[WARNING] 파일 이동 실패: {move_err}")

            return

        fallback_path = get_config_value(["ai_settings", "fallback_script_path"])
        if fallback_path and os.path.exists(fallback_path):
            print(f"\n[WARNING] 대체 스크립트 사용: {fallback_path}")
            with open(fallback_path, "r", encoding="utf-8") as script_file:
                script = script_file.read()
        else:
            print(f"\n[ERROR] 대체 스크립트도 없습니다. 처리를 중단합니다.")

            # 에러 발생 시에도 파일 정리
            cleaned = cleanup_extracted_video(input_video)
            if cleaned:
                print(f"[DELETE] 추출된 임시 비디오 삭제: {input_video}")

            return

    print("\n[NOTE] 스크립트 파싱 중...")
    segments, metadata = parse_script(script)

    if folder_name:
        credit_line = f"credit: {folder_name}"
        if metadata.get('youtube_description'):
            if credit_line not in metadata['youtube_description']:
                metadata['youtube_description'] = metadata['youtube_description'].rstrip() + "\n" + credit_line
        else:
            metadata['youtube_description'] = credit_line

        if credit_line not in script:
            script = script.rstrip() + "\n" + credit_line + "\n"

    print(f"\n총 {len(segments)}개의 세그먼트가 발견되었습니다:")
    for seg in segments:
        print(f"  - {seg['start']}초 ~ {seg['end']}초: {seg['text'][:50]}...")

    if metadata.get('key_moment'):
        print(f"\n[KEY] Key moment: {metadata['key_moment']}초")
    # if metadata.get('thumbnail_title'):  # 비활성화됨
    #     print(f"[NOTE] Thumbnail title: {metadata['thumbnail_title']}")

    output_dir = get_config_value(["paths", "output_dir"], "Output")
    os.makedirs(output_dir, exist_ok=True)

    base_name = (
        metadata.get("youtube_title")
        # or metadata.get("thumbnail_title")  # 비활성화됨
        or os.path.splitext(os.path.basename(input_video))[0]
    )
    # 출력 파일명 생성 (설정에 따라 타임스탬프 접두어 추가)
    output_base = generate_output_basename(base_name, output_dir, extension=".mp4")
    final_output_video = os.path.join(output_dir, f"{output_base}.mp4")

    # 생성된 스크립트 로그 저장 옵션
    script_log_path = get_config_value(["ai_settings", "last_script_path"])
    if script_log_path:
        try:
            os.makedirs(os.path.dirname(script_log_path), exist_ok=True)
            with open(script_log_path, "w", encoding="utf-8") as log_file:
                log_file.write(script)
        except Exception:
            pass

    # 비디오와 같은 이름의 메타데이터 텍스트 파일 저장
    try:
        metadata_filename = f"{output_base}.txt"
        metadata_file_path = os.path.join(output_dir, metadata_filename)
        meta_counter = 1
        while os.path.exists(metadata_file_path):
            metadata_filename = f"{output_base}_{meta_counter}.txt"
            metadata_file_path = os.path.join(output_dir, metadata_filename)
            meta_counter += 1
        with open(metadata_file_path, "w", encoding="utf-8") as meta_file:
            meta_file.write(script)
        print(f"[METADATA] 메타데이터 저장: {metadata_filename}")
    except Exception as e:
        print(f"[WARNING] 메타데이터 저장 실패: {e}")

    # 비디오 카운트에 따라 색상 결정
    # Output 폴더의 비디오 파일 개수 세기
    try:
        video_count = len([f for f in os.listdir(output_dir)
                          if f.lower().endswith(('.mp4', '.mov', '.avi', '.mkv'))])

        # 첫 번째 비디오(count=0): 썸네일 타이틀 분홍색, 키워드 빨간색, 자막 빨간색
        # 두 번째 비디오(count=1): 썸네일 타이틀 하얀색, 키워드 노란색, 자막 파란색
        if video_count % 2 == 0:
            # 첫 번째, 세 번째, 다섯 번째... 비디오
            title_color = "pink"
            keyword_color = "red"
            subtitle_color = "red"
        else:
            # 두 번째, 네 번째, 여섯 번째... 비디오
            title_color = "white"
            keyword_color = "yellow"
            subtitle_color = "blue"

        print(f"[COLOR] 비디오 카운트: {video_count + 1}")
        print(f"  - 썸네일 타이틀: {title_color}")
        print(f"  - 키워드: {keyword_color}")
        print(f"  - 자막: {subtitle_color}")
    except Exception as e:
        print(f"[WARNING] 비디오 카운트 확인 실패: {e}, 기본 색상 사용")
        title_color = None
        keyword_color = None
        subtitle_color = None

    # 비디오 처리 실행 (음성 + 자막 한 번에 처리)
    final_output_path = overlay_voice_on_video(
        input_video,
        segments,
        final_output_video,
        metadata,
        folder_name,
        add_subtitles=True,  # 자막 추가 활성화
        subtitle_color="white",  # 하얀색 자막
        title_color="white",  # 하얀색 타이틀
        keyword_color="white"  # 하얀색 키워드
    )

    print(f"\n[OK] 최종 출력 파일: {final_output_path}")

    # 자동 업로드 (필요 시)
    auto_upload_processed_video(final_output_path, metadata)

    # 처리 완료 후 입력 파일 이동/정리
    cleaned = cleanup_extracted_video(input_video)
    if cleaned:
        print(f"\n[DELETE]  추출된 임시 비디오 삭제: {input_video}")

    moved_paths = set()
    if original_source:
        if move_input_file_to_used(original_source):
            moved_paths.add(os.path.abspath(original_source))

    input_abs = os.path.abspath(input_video)
    if input_abs not in moved_paths and not cleaned:
        move_input_file_to_used(input_video)


def process_all_videos():
    """Input 폴더의 모든 비디오를 순차적으로 처리"""
    import hashlib

    input_dir = get_config_value(["paths", "input_dir"], "Input")
    processed_count = 0
    processed_hashes = set()  # 처리된 비디오 해시 저장

    print("[VIDEO] 비디오 자동 처리 시작...")
    print("=" * 60)

    while True:
        try:
            # 비디오 파일 찾기
            next_video, next_video_origin, _ = find_first_video_file(input_dir)
        except FileNotFoundError:
            # 더 이상 비디오가 없으면 종료
            break

        # 비디오 파일 해시 계산 (중복 체크)
        try:
            with open(next_video, 'rb') as f:
                file_hash = hashlib.md5(f.read()).hexdigest()

            if file_hash in processed_hashes:
                print(f"\n[SKIP] 이미 처리된 비디오입니다 (중복): {os.path.basename(next_video)}")
                # 중복 파일 삭제
                cleanup_extracted_video(next_video)
                # 원본 ZIP 파일도 이동
                if next_video_origin:
                    move_input_file_to_used(next_video_origin)
                continue

            processed_hashes.add(file_hash)
        except Exception as e:
            print(f"\n[WARNING] 해시 계산 실패: {e}")

        processed_count += 1
        print(f"\n{'=' * 60}")
        print(f"[VIDEO] 처리 중: {processed_count}번째 비디오")
        print(f"{'=' * 60}")

        # 메인 처리 함수 호출
        main()

        # 3개마다 자동 병합 (비활성화 - run_mac.sh에서 일괄 병합)
        # if processed_count % 3 == 0:
        #     print("\n" + "="*60)
        #     print(f"[MERGE] 비디오 3개 생성 완료! 자동 병합 시작...")
        #     print("="*60)
        #
        #     try:
        #         import subprocess
        #         merge_script = "Scripts/merge_with_transition.py"
        #         result = subprocess.run(
        #             [sys.executable, merge_script],
        #             check=True,
        #             capture_output=False,
        #             text=True
        #         )
        #         print("\n[SUCCESS] 자동 병합 완료!")
        #     except subprocess.CalledProcessError as e:
        #         print(f"\n[WARNING] 자동 병합 실패: {e}")
        #     except Exception as e:
        #         print(f"\n[WARNING] 자동 병합 중 오류: {e}")

        # 처리 완료 후 잠시 대기
        print("\n[WAIT] 다음 비디오 처리 준비 중...\n")

    print(f"\n{'=' * 60}")
    print(f"[OK] 모든 비디오 처리 완료!")
    print(f"   총 {processed_count}개의 비디오 처리됨")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    # Gemini API와의 충돌을 방지하기 위해 GOOGLE_APPLICATION_CREDENTIALS를 전역적으로 제거
    # (TTS 사용 시 함수 내부에서 다시 설정됨)
    SAVED_GOOGLE_CREDS = os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)

    # 연속 처리 모드
    process_all_videos()

    # 프로그램 종료 전 환경변수 복원
    if SAVED_GOOGLE_CREDS:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = SAVED_GOOGLE_CREDS
