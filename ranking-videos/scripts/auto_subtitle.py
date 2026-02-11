"""Gemini를 사용한 자동 자막 생성 스크립트 (Windows 버전)"""

import os
import json
import re
import subprocess
from moviepy import VideoFileClip, TextClip, CompositeVideoClip
from PIL import ImageFont, ImageDraw, Image
from tqdm import tqdm
import numpy as np

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    GEMINI_AVAILABLE = False


def load_config():
    """설정 파일 로드"""
    config_path = os.path.join("Config", "config.json")
    if not os.path.exists(config_path):
        return {}

    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_config_value(keys, default=None):
    """중첩된 설정 값 가져오기"""
    config = load_config()
    value = config
    for key in keys:
        if isinstance(value, dict):
            value = value.get(key)
        else:
            return default
    return value if value is not None else default


def get_system_font():
    """시스템 폰트 경로 반환 (한글 지원)"""
    import platform
    system = platform.system()

    if system == "Darwin":  # macOS
        mac_fonts = [
            "/System/Library/Fonts/Supplemental/AppleGothic.ttf",  # 애플고딕
            "/System/Library/Fonts/Supplemental/AppleMyungjo.ttf",  # 애플명조
            "/System/Library/Fonts/Supplemental/NotoSansGothic-Regular.ttf",  # Noto Sans Gothic
            "/Library/Fonts/AppleGothic.ttf",
        ]
        for font_path in mac_fonts:
            if os.path.exists(font_path):
                return font_path

    elif system == "Windows":
        windows_fonts = [
            r"C:\Windows\Fonts\malgun.ttf",      # 맑은 고딕
            r"C:\Windows\Fonts\arial.ttf",       # Arial
            r"C:\Windows\Fonts\arialbd.ttf",     # Arial Bold
        ]
        for font_path in windows_fonts:
            if os.path.exists(font_path):
                return font_path

    return None


def get_windows_font():
    """Windows 시스템 폰트 경로 반환 (한글 지원) - 하위 호환성"""
    return get_system_font()


def apply_cinematic_filter(get_frame, t):
    """
    강력한 시네마틱 필터 적용 함수 (움직임 추가)
    - 강한 비네트 효과 (가장자리 많이 어둡게)
    - 밝기 감소
    - 채도 대폭 감소 (desaturated 느낌)
    - Contrast 증가
    - 시간에 따른 미묘한 밝기 변화 (breathing 효과)
    - 약한 필름 그레인 효과
    """
    frame = get_frame(t)
    h, w = frame.shape[:2]

    # 1. 강한 비네트 효과 생성
    Y, X = np.ogrid[:h, :w]
    center_y, center_x = h / 2, w / 2

    # 거리 계산
    dist_from_center = np.sqrt((X - center_x)**2 + (Y - center_y)**2)
    max_dist = np.sqrt(center_x**2 + center_y**2)

    # 비네트 강도 대폭 증가 (가장자리를 더 어둡게)
    vignette = 1 - (dist_from_center / max_dist) * 0.7
    vignette = np.clip(vignette, 0.4, 1.0)  # 최소 40% 밝기 (더 어두움)

    # RGB 채널에 비네트 적용
    vignette_3d = np.stack([vignette, vignette, vignette], axis=-1)
    frame = (frame * vignette_3d).astype('uint8')

    # 2. 전체 밝기 감소 + 시간에 따른 breathing 효과
    breathing = 0.85 + 0.08 * np.sin(2 * np.pi * t / 3.5)  # 3.5초 주기로 더 강하게 밝아졌다 어두워졌다
    frame = (frame * breathing).astype('uint8')

    # 3. 채도도 시간에 따라 변화 (살아있는 느낌)
    gray = np.mean(frame, axis=-1, keepdims=True)
    saturation_factor = 0.65 + 0.05 * np.sin(2 * np.pi * t / 5.0)  # 채도도 약간 변화
    frame = (frame * saturation_factor + gray * (1 - saturation_factor)).astype('uint8')

    # 4. Contrast 증가 (명암비 강화)
    frame = np.clip((frame - 128) * 1.15 + 128, 0, 255).astype('uint8')

    # 5. 필름 그레인 효과 (미묘한 노이즈)
    grain = np.random.randint(-3, 4, frame.shape, dtype=np.int16)
    frame = np.clip(frame.astype(np.int16) + grain, 0, 255).astype('uint8')

    return frame


class GeminiSubtitleGenerator:
    """Gemini를 사용한 자막 생성 클래스"""

    def __init__(self, video_path, text_color="white", text_size=40, text_font=None, y_offset=0, bottom_margin=220, ai_voice_audio_path=None):
        """
        Args:
            video_path (str): 비디오 파일 경로
            text_color (str): 자막 색상
            text_size (int): 자막 크기
            text_font (str): 폰트 경로
            y_offset (int): 하단에서 위로 올릴 거리 (픽셀)
            bottom_margin (int): 화면 하단으로부터 확보할 최소 여백
            ai_voice_audio_path (str): AI 음성만 포함된 오디오 파일 경로 (자막 생성용)
        """
        if not GEMINI_AVAILABLE:
            raise RuntimeError("google-generativeai 패키지가 설치되지 않았습니다.")

        self.video_path = video_path
        self.ai_voice_audio_path = ai_voice_audio_path  # AI 음성 오디오 경로
        self.text_color = text_color
        self.text_size = text_size

        # 랜덤 색상 설정 로드
        self.random_colors_enabled = get_config_value(["subtitle_settings", "random_colors", "enabled"], False)
        self.random_colors_list = get_config_value(["subtitle_settings", "random_colors", "colors"], ["white"])
        self.current_color_index = 0

        # 시스템 폰트 자동 감지 (한글 지원)
        if text_font and os.path.exists(text_font):
            self.text_font = text_font
        else:
            detected_font = get_system_font()
            if detected_font:
                self.text_font = detected_font
                print(f"   📝 한글 폰트 감지: {os.path.basename(detected_font)}")
            else:
                # 폴백: 기본 폰트
                self.text_font = None
                print("   ⚠️ 한글 폰트를 찾을 수 없습니다. 기본 폰트 사용")

        self.y_offset = y_offset
        self.bottom_margin = max(0, int(bottom_margin))
        # 좌우 안전 여백 (자막 줄바꿈 폭 계산용)
        self.side_margin = int(get_config_value(["subtitle_settings", "side_margin"], 80))
        # 하단 클리핑 방지용 여유 패딩 (비디오 바닥과의 추가 간격)
        self.bottom_safety = int(get_config_value(["subtitle_settings", "bottom_safety"], 8))
        # 자막 겹침 방지 세부 설정
        self.overlap_gap = max(0.0, float(get_config_value(["subtitle_settings", "safe_gap"], 0.1)))
        self.min_visible_duration = max(0.1, float(get_config_value(["subtitle_settings", "min_visible_duration"], 0.35)))
        self.strict_timing = bool(get_config_value(["subtitle_settings", "strict_timing"], True))
        self.script_match_ratio = float(get_config_value(["subtitle_settings", "script_match_ratio"], 0.7))
        self.script_min_chars = int(get_config_value(["subtitle_settings", "script_min_chars"], 6))

        # 자막 표시 시간 제어: 끝나고 조금 더 머무르게 + 너무 짧은 자막은 최소 시간 보장
        self.extra_hold = float(get_config_value(["subtitle_settings", "extra_hold"], 0.6))
        self.min_duration = float(get_config_value(["subtitle_settings", "min_duration"], 1.2))

        self.video = VideoFileClip(video_path)
        self.width = self.video.w
        self.height = self.video.h
        self.sub_clips = []

        # Configure AI-script-only filtering
        self.require_ai_script_only = bool(get_config_value(["subtitle_settings", "require_ai_script_only"], True))
        self.script_filter_keep_ratio = max(0.0, min(1.0, float(
            get_config_value(["subtitle_settings", "script_keep_ratio"], 0.5)
        )))
        self.ai_script_lines = self._load_ai_script_lines() if self.require_ai_script_only else []
        self._allowed_subtitle_texts = [self._normalize_text(line) for line in self.ai_script_lines if line]

        # Gemini 설정
        api_key = get_config_value(["ai_settings", "api_key"])
        if not api_key:
            raise ValueError("config.json에 ai_settings.api_key가 설정되지 않았습니다.")

        genai.configure(api_key=api_key)
        model_name = get_config_value(["subtitle_settings", "model"], "models/gemini-2.0-flash-exp")
        self.model = genai.GenerativeModel(model_name)

    def _normalize_text(self, text):
        """Normalize text for comparison."""
        normalized = re.sub(r"\s+", " ", (text or "")).strip().lower()
        normalized = re.sub(r"[^\w\s\u3131-\u318e\uac00-\ud7a3]", "", normalized)
        return re.sub(r"\s+", " ", normalized).strip()

    def _load_ai_script_lines(self):
        """Load AI generated dialogue lines if available."""
        script_path = get_config_value(["ai_settings", "last_script_path"], "Temp/last_script.txt")
        if not script_path:
            return []

        script_path = os.path.abspath(script_path)
        if not os.path.exists(script_path):
            return []

        dialogue_lines = []
        timing_pattern = re.compile(r"^\s*\([^)]*\)\s*(.+)$")
        skip_prefixes = (
            "key moment",
            "thumbnail title",
            "core keyword",
            "background music",
            "youtube title",
            "youtube description",
        )

        with open(script_path, "r", encoding="utf-8") as script_file:
            for raw_line in script_file:
                stripped = raw_line.strip()
                if not stripped:
                    continue

                match = timing_pattern.match(stripped)
                if match:
                    stripped = match.group(1).strip()

                lowered = stripped.lower()
                if any(lowered.startswith(prefix) for prefix in skip_prefixes):
                    continue

                dialogue_lines.append(stripped)

        return dialogue_lines

    def _is_allowed_subtitle_text(self, normalized_text):
        """Return True if the subtitle text is allowed under AI-only filtering."""
        if not normalized_text:
            return False

        if not self._allowed_subtitle_texts:
            # No AI script available; allow everything.
            return True

        for allowed in self._allowed_subtitle_texts:
            if not allowed:
                continue
            if normalized_text == allowed:
                return True
            allowed_len = len(allowed)
            text_len = len(normalized_text)
            min_chars = max(1, self.script_min_chars)
            ratio = max(0.0, min(1.0, self.script_match_ratio))

            if text_len >= min_chars and allowed_len >= min_chars:
                if normalized_text in allowed and (text_len / allowed_len) >= ratio:
                    return True
                if allowed in normalized_text and (allowed_len / text_len) >= ratio:
                    return True

        return False

    def _measure_text_width(self, text, font_size, stroke_width=0):
        """PIL을 사용해 텍스트 픽셀 폭 측정"""
        try:
            font = ImageFont.truetype(self.text_font, font_size)
        except Exception:
            font = ImageFont.load_default()

        dummy_img = Image.new("RGB", (1, 1))
        draw = ImageDraw.Draw(dummy_img)
        bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
        return bbox[2] - bbox[0]

    def _wrap_text_for_width(self, text, font_size, stroke_width, max_width):
        """주어진 폭에 맞춰 자동 줄바꿈 (영문은 단어 단위, CJK는 글자 단위)"""
        if not text:
            return ""

        is_word_based = (" " in text)
        tokens = text.split(" ") if is_word_based else list(text)

        lines = []
        line = ""

        def add_token(cur, tok):
            if not cur:
                return tok
            return (cur + (" " if is_word_based else "") + tok)

        for tok in tokens:
            candidate = add_token(line, tok)
            width = self._measure_text_width(candidate, font_size, stroke_width)
            if width <= max_width:
                line = candidate
            else:
                if line:
                    # 현재 줄을 저장하고 토큰을 다음 줄로
                    lines.append(line)
                    line = tok
                else:
                    # 첫 토큰부터 넘치는 경우 - 단어를 그대로 다음 줄에 배치
                    line = tok

        if line:
            lines.append(line)

        # 각 줄 트리밍 후 합치기
        return "\n".join(l.rstrip() for l in lines if l is not None)

    def detect_silence_offset(self, noise_threshold="-30dB", min_silence=0.5):
        """
        비디오 시작 부분의 침묵 구간 감지

        Returns:
            float: 침묵 끝 시간 (초)
        """
        try:
            cmd = [
                "ffmpeg", "-i", self.video_path,
                "-af", f"silencedetect=noise={noise_threshold}:d={min_silence}",
                "-f", "null", "-"
            ]

            process = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            _, stderr = process.communicate()

            matches = re.findall(r"silence_end:\s*([0-9.]+)", stderr)
            if matches:
                return float(matches[0])
        except (FileNotFoundError, OSError) as e:
            # ffmpeg가 없으면 침묵 감지 건너뛰기
            print(f"   ⚠️ ffmpeg를 찾을 수 없어 침묵 감지를 건너뜁니다.")
        return 0.0

    def transcribe_with_gemini(self):
        """Gemini로 비디오 음성 인식 및 자막 생성"""
        import time

        print("📝 Gemini로 음성 인식 중...")

        # AI 음성 오디오 파일이 있으면 사용, 없으면 비디오 사용
        if self.ai_voice_audio_path and os.path.exists(self.ai_voice_audio_path):
            upload_file_path = self.ai_voice_audio_path
            print(f"   🎙️ AI 음성 오디오 사용: {os.path.basename(upload_file_path)}")
            print(f"   ✅ 원본 비디오 오디오는 자막화하지 않음")
        else:
            upload_file_path = self.video_path
            print(f"   ⚠️ AI 음성 오디오 없음, 전체 비디오 사용: {os.path.basename(upload_file_path)}")

        # 파일 업로드
        print(f"   파일 업로드 중...")
        video_file = genai.upload_file(upload_file_path)

        # 파일이 ACTIVE 상태가 될 때까지 대기
        print(f"   파일 처리 대기 중...", end="", flush=True)
        while video_file.state.name == "PROCESSING":
            print(".", end="", flush=True)
            time.sleep(2)
            video_file = genai.get_file(video_file.name)

        if video_file.state.name == "FAILED":
            raise ValueError(f"파일 업로드 실패: {video_file.state.name}")

        print(" ✅")

        # Gemini에게 자막 생성 요청
        prompt = """
Transcribe all spoken words in this audio/video with precise timestamps.

Return ONLY a JSON array in this exact format:
[
  {"start": 0.0, "end": 2.5, "text": "First sentence"},
  {"start": 2.5, "end": 5.0, "text": "Second sentence"}
]

Requirements:
- Each segment should be a complete sentence or phrase
- Timestamps must be in seconds (float)
- Include ALL spoken content
- Do not include ANY other text or explanation
- Return ONLY the JSON array
"""

        response = self.model.generate_content([video_file, prompt])

        # JSON 파싱
        try:
            # 코드 블록에서 JSON 추출
            json_text = response.text.strip()
            if "```json" in json_text:
                match = re.search(r'```json\s*([\s\S]*?)\s*```', json_text, re.DOTALL)
                if match:
                    json_text = match.group(1).strip()
            elif "```" in json_text:
                match = re.search(r'```\s*([\s\S]*?)\s*```', json_text, re.DOTALL)
                if match:
                    json_text = match.group(1).strip()

            # JSON 수정: 닫는 괄호가 없으면 추가
            if json_text.startswith('[') and not json_text.rstrip().endswith(']'):
                json_text = json_text.rstrip()
                # 마지막 객체가 완료되었는지 확인
                if json_text.rstrip().endswith('}'):
                    json_text += '\n]'
                elif json_text.rstrip().endswith(','):
                    # 마지막 쉼표 제거하고 닫기
                    json_text = json_text.rstrip().rstrip(',') + '\n]'

            segments = json.loads(json_text)

        except (json.JSONDecodeError, AttributeError) as e:
            print(f"⚠️  JSON 파싱 실패, 원본 응답:\n{response.text}")
            print(f"⚠️  처리된 JSON:\n{json_text}")
            raise ValueError(f"Gemini 응답을 JSON으로 파싱할 수 없습니다: {e}")

        # 침묵 오프셋 감지 및 적용 (모든 세그먼트에 적용)
        silence_offset = self.detect_silence_offset()
        if silence_offset > 0 and len(segments) > 0:
            for seg in segments:
                seg['start'] += silence_offset
                seg['end'] += silence_offset
            print(f"   침묵 오프셋 적용: +{silence_offset:.2f}초")

        print(f"✅ {len(segments)}개의 자막 세그먼트 생성 완료")
        return segments

    def get_optimal_font_size(self, text, max_width, stroke_width=0):
        """텍스트가 화면에 맞는 최적 폰트 크기 계산"""
        font_size = self.text_size

        try:
            font = ImageFont.truetype(self.text_font, font_size)
        except:
            # 폰트 로드 실패 시 기본 크기 반환
            return min(font_size, 50)

        # PIL로 텍스트 너비 측정
        dummy_img = Image.new("RGB", (1, 1))
        draw = ImageDraw.Draw(dummy_img)
        bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
        text_width = bbox[2] - bbox[0]

        # 텍스트가 최대 너비를 초과하면 폰트 크기 줄이기
        while text_width > max_width and font_size > 20:
            font_size = max(font_size - 2, 12)
            font = ImageFont.truetype(self.text_font, font_size)
            bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
            text_width = bbox[2] - bbox[0]

        return font_size

    def _build_subtitle_clips(self, segments, enforce_script_filter=True, show_progress=True):
        """Build subtitle clips and report how many were filtered out."""
        iterator = tqdm(segments, desc="Subtitle Clips") if show_progress else segments
        sub_clips = []
        last_clip_start = None
        last_clip_end = 0.0
        skipped_by_filter = 0

        for seg in iterator:
            try:
                text = seg["text"].strip()
                if ((text.startswith('"') and text.endswith('"')) or
                        (text.startswith("'") and text.endswith("'"))):
                    text = text[1:-1]

                if not text:
                    continue

                normalized_text = self._normalize_text(text)
                if enforce_script_filter and not self._is_allowed_subtitle_text(normalized_text):
                    skipped_by_filter += 1
                    continue

                original_start = float(seg["start"])
                original_end = float(seg["end"])
                original_start = max(0.0, original_start)
                original_end = max(original_start, original_end)

                if sub_clips and last_clip_start is not None:
                    prev_clip = sub_clips[-1]
                    prev_start = last_clip_start
                    prev_end = last_clip_end
                    cutoff = original_start - self.overlap_gap
                    trimmed_end = min(prev_end, cutoff)
                    if trimmed_end < prev_start:
                        trimmed_end = prev_start
                    trimmed_duration = max(0.0, trimmed_end - prev_start)
                    sub_clips[-1] = prev_clip.with_duration(trimmed_duration)
                    last_clip_end = prev_start + trimmed_duration

                if self.strict_timing:
                    start_time = original_start
                    duration = max((original_end - original_start) + self.extra_hold, self.min_duration)
                    duration = max(duration, self.min_visible_duration)
                else:
                    if sub_clips:
                        start_time = max(original_start, last_clip_end + self.overlap_gap)
                    else:
                        start_time = original_start

                    base_duration = max(original_end - start_time, 0.0)
                    duration = max(base_duration + self.extra_hold, self.min_duration)
                    duration = max(duration, self.min_visible_duration)

                stroke_width = 3
                fixed_font_size = self.text_size
                inner_lr_margin = 40  # margin=(20,20,20,20) left/right total
                max_text_width = max(50, self.width - (2 * self.side_margin) - inner_lr_margin)

                wrapped_text = self._wrap_text_for_width(
                    text=text,
                    font_size=fixed_font_size,
                    stroke_width=stroke_width,
                    max_width=max_text_width,
                )

                # 랜덤 색상 선택 (활성화된 경우)
                if self.random_colors_enabled and self.random_colors_list:
                    current_color = self.random_colors_list[self.current_color_index % len(self.random_colors_list)]
                    self.current_color_index += 1
                else:
                    current_color = self.text_color

                # 한글 지원을 위해 method="caption" 사용
                txt = TextClip(
                    text=wrapped_text,
                    font=self.text_font,
                    font_size=fixed_font_size,
                    color=current_color,
                    stroke_color="black",
                    stroke_width=stroke_width,
                    size=(max_text_width + inner_lr_margin, None),
                    method="caption",
                    align="center"
                )

                y_position = self.height - self.bottom_margin - txt.h
                if y_position < 0:
                    y_position = 0

                txt = (
                    txt.with_start(start_time)
                       .with_duration(duration)
                       .with_position(("center", y_position))
                )

                sub_clips.append(txt)
                last_clip_start = start_time
                last_clip_end = start_time + duration

            except Exception as e:
                print(f"[warn] subtitle clip build failed: {seg['text'][:30]}... ({e})")
                continue

        return sub_clips, skipped_by_filter

    def create_subtitle_clips(self, segments):
        """Create subtitle clips (default style)."""
        print("[subtitle] building caption clips...")

        sub_clips, skipped_by_filter = self._build_subtitle_clips(
            segments,
            enforce_script_filter=self.require_ai_script_only,
            show_progress=True
        )

        total_segments = len(segments)
        produced_count = len(sub_clips)

        if skipped_by_filter and self.require_ai_script_only:
            print(f"[subtitle] {skipped_by_filter} segments skipped by AI script filter")

        should_fallback = False
        if self.require_ai_script_only and total_segments > 0:
            matched_ratio = produced_count / total_segments if total_segments else 0.0
            if produced_count == 0 or matched_ratio < self.script_filter_keep_ratio:
                should_fallback = True
                print(
                    f"[subtitle] fallback: only {produced_count}/{total_segments} segments matched AI script"
                )

        if should_fallback:
            sub_clips, _ = self._build_subtitle_clips(
                segments,
                enforce_script_filter=False,
                show_progress=False
            )
            produced_count = len(sub_clips)

        self.sub_clips = sub_clips
        print(f"[subtitle] {produced_count} subtitle clips ready")

    def create_video_with_subtitles(self, output_path):
        """자막이 추가된 비디오 생성"""
        print("🎥 자막 비디오 생성 중...")

        if not self.sub_clips:
            raise ValueError("자막 클립이 없습니다. 먼저 transcribe_with_gemini()를 실행하세요.")

        # 시네마틱 필터 적용 (시간 기반 효과)
        print("   🎨 시네마틱 필터 적용 중...")
        filtered_video = self.video.fl(apply_cinematic_filter)

        # 비디오와 자막 합성
        final_video = CompositeVideoClip([filtered_video] + self.sub_clips).with_duration(self.video.duration)

        # 비디오 출력
        final_video.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            fps=self.video.fps
        )

        print(f"✅ 자막 비디오 생성 완료: {output_path}")

    def generate(self, output_path):
        """전체 프로세스 실행"""
        segments = self.transcribe_with_gemini()
        self.create_subtitle_clips(segments)
        self.create_video_with_subtitles(output_path)


def find_video_file(input_dir):
    """Input 폴더에서 비디오 파일 찾기"""
    supported_extensions = ('.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm')

    if not os.path.exists(input_dir):
        raise FileNotFoundError(f"Input 폴더를 찾을 수 없습니다: {input_dir}")

    video_files = [f for f in os.listdir(input_dir)
                   if f.lower().endswith(supported_extensions) and not f.startswith('.')]

    if not video_files:
        raise FileNotFoundError(f"Input 폴더에 비디오 파일이 없습니다: {input_dir}")

    # 가장 최근에 수정된 파일 선택
    video_files_with_time = [(f, os.path.getmtime(os.path.join(input_dir, f)))
                              for f in video_files]
    latest_video = max(video_files_with_time, key=lambda x: x[1])[0]

    return os.path.join(input_dir, latest_video)


def main():
    """메인 실행 함수"""
    import sys

    # 비디오 경로 결정
    if len(sys.argv) >= 2:
        video_path = sys.argv[1]
        if not os.path.exists(video_path):
            print(f"❌ 비디오 파일을 찾을 수 없습니다: {video_path}")
            return
    else:
        # 인자가 없으면 Input 폴더에서 자동으로 찾기
        input_dir = get_config_value(["paths", "input_dir"], "Input")
        try:
            video_path = find_video_file(input_dir)
            print(f"🎥 발견된 비디오: {os.path.basename(video_path)}")
        except FileNotFoundError as e:
            print(f"❌ {e}")
            return

    # 출력 경로 생성
    output_dir = get_config_value(["paths", "output_dir"], "Output")
    os.makedirs(output_dir, exist_ok=True)

    video_name = os.path.splitext(os.path.basename(video_path))[0]
    output_path = os.path.join(output_dir, f"{video_name}_subtitled.mp4")

    # 설정 로드
    text_color = get_config_value(["subtitle_settings", "text_color"], "white")
    text_size = get_config_value(["subtitle_settings", "text_size"], 40)
    text_font = get_config_value(["subtitle_settings", "text_font"])
    y_offset = get_config_value(["subtitle_settings", "y_offset"], 0)
    bottom_margin = get_config_value(["subtitle_settings", "bottom_margin"], 220)

    # 자막 생성
    try:
        generator = GeminiSubtitleGenerator(
            video_path=video_path,
            text_color=text_color,
            text_size=text_size,
            text_font=text_font,
            y_offset=y_offset,
            bottom_margin=bottom_margin
        )
        generator.generate(output_path)
        print(f"\n🎉 완료! 출력: {output_path}")
    except Exception as e:
        print(f"\n❌오류 발생: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
