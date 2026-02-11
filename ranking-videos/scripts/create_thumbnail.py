"""YouTube 썸네일 생성 스크립트 - 상단 35% 타이틀 오버레이"""

import os
from PIL import Image, ImageDraw, ImageFont
from moviepy import VideoFileClip
import json
import sys


def load_config(config_path="Config/config.json"):
    """설정 파일 로드"""
    if not os.path.exists(config_path):
        config_path = "Config/config.example.json"

    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_thumbnail_config(config_path=None):
    """썸네일 설정 파일 로드"""
    if config_path is None:
        # 환경변수에서 CONFIG_FILE을 읽고 thumbnail_config로 변환
        config_file = os.environ.get("CONFIG_FILE", "Config/config.json")
        # config.json -> thumbnail_config.json, config1.json -> thumbnail_config1.json
        config_path = config_file.replace("config", "thumbnail_config")

    if not os.path.exists(config_path):
        print(f"[WARNING] 썸네일 설정 파일을 찾을 수 없습니다: {config_path}")
        return None

    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def extract_frame_from_video(video_path, time_seconds=None):
    """비디오에서 프레임 추출"""
    try:
        clip = VideoFileClip(video_path)

        # 시간 지정이 없으면 중간 프레임 사용
        if time_seconds is None:
            time_seconds = clip.duration / 2

        # 프레임 추출
        frame = clip.get_frame(time_seconds)
        clip.close()

        # numpy array를 PIL Image로 변환
        return Image.fromarray(frame)

    except Exception as e:
        print(f"[ERROR] 비디오 프레임 추출 실패: {e}")
        return None


def create_thumbnail_with_overlay(video_path, title_line1=None, title_line2=None, output_path=None, time_seconds=None):
    """
    썸네일 생성: 상단 35%는 검은 배경 + 타이틀, 하단 65%는 비디오 프레임

    Args:
        video_path: 비디오 파일 경로
        title_line1: 첫 번째 줄 텍스트 (호환성 유지, None이면 JSON 설정 사용)
        title_line2: 두 번째 줄 텍스트 (호환성 유지, None이면 JSON 설정 사용)
        output_path: 저장 경로 (None이면 자동 생성)
        time_seconds: 프레임 추출 시간 (None이면 중간)
    """

    print(f"\n{'='*60}")
    print("썸네일 생성 시작")
    print(f"{'='*60}")
    print(f"비디오: {os.path.basename(video_path)}")

    # 썸네일 설정 로드
    thumbnail_config = load_thumbnail_config()

    # JSON 설정이 있으면 사용, 없으면 기존 파라미터 사용
    if thumbnail_config and 'title_lines' in thumbnail_config and len(thumbnail_config['title_lines']) > 0:
        print("\n[INFO] thumbnail_config.json에서 설정을 읽어옵니다.")
        title_lines = thumbnail_config['title_lines']
        for i, line in enumerate(title_lines, 1):
            words_text = ' '.join([w['text'] for w in line.get('words', [])])
            print(f"타이틀 {i}줄: {words_text}")
    else:
        # 호환성 유지: 기존 방식 사용
        if title_line1 is None and title_line2 is None:
            print("[ERROR] 썸네일 설정 파일이 없고 title_line1, title_line2도 제공되지 않았습니다.")
            return None

        print(f"타이틀 1줄: {title_line1}")
        print(f"타이틀 2줄: {title_line2}")

        # 기존 형식으로 변환
        title_lines = [
            {
                "text": title_line1,
                "words": [{"text": title_line1, "color": "#00FF00"}]
            },
            {
                "text": title_line2,
                "words": [{"text": title_line2, "color": "#FFFFFF"}]
            }
        ]

    # 1. 비디오에서 프레임 추출
    print("\n[STEP 1] 비디오 프레임 추출 중...")
    frame_img = extract_frame_from_video(video_path, time_seconds)

    if frame_img is None:
        print("[ERROR] 썸네일 생성 실패")
        return None

    # 2. 썸네일 크기 설정 (YouTube 권장: 1280x720)
    thumbnail_width = 1280
    thumbnail_height = 720

    # 상단 오버레이 영역 (35% - 더 많은 여백)
    overlay_height = int(thumbnail_height * 0.35)

    # 3. 프레임 이미지 리사이즈 (하단까지 꽉 차도록)
    print("\n[STEP 2] 이미지 리사이즈 중...")
    frame_height = thumbnail_height - overlay_height

    # 비율 유지하며 리사이즈 (높이 기준으로 맞춤)
    aspect_ratio = frame_img.width / frame_img.height
    new_height = frame_height
    new_width = int(new_height * aspect_ratio)

    # 너비가 부족하면 너비 기준으로 리사이즈
    if new_width < thumbnail_width:
        new_width = thumbnail_width
        new_height = int(new_width / aspect_ratio)

    frame_img = frame_img.resize((new_width, new_height), Image.Resampling.LANCZOS)

    # 중앙 크롭
    left = (new_width - thumbnail_width) // 2
    top = (new_height - frame_height) // 2
    right = left + thumbnail_width
    bottom = top + frame_height

    frame_img = frame_img.crop((left, top, right, bottom))

    # 최종 확인 (정확히 frame_height가 맞는지)
    if frame_img.height != frame_height:
        frame_img = frame_img.resize((thumbnail_width, frame_height), Image.Resampling.LANCZOS)

    print(f"  프레임 크기: {frame_img.width}x{frame_img.height}")
    print(f"  필요한 크기: {thumbnail_width}x{frame_height}")
    print(f"  오버레이 높이: {overlay_height}")

    # 4. 새 썸네일 이미지 생성
    print("\n[STEP 3] 썸네일 합성 중...")
    thumbnail = Image.new('RGB', (thumbnail_width, thumbnail_height), 'black')

    # 하단에 프레임 이미지 붙이기 (정확히 맞춰서)
    thumbnail.paste(frame_img, (0, overlay_height))

    print(f"  프레임 붙이기: (0, {overlay_height}) 위치")
    print(f"  총 높이: {overlay_height + frame_img.height} (목표: {thumbnail_height})")

    # 5. 상단 검은색 오버레이 추가 (이미 검은색이므로 패스)

    # 6. 텍스트 추가 (단어별 색상 지원)
    print("\n[STEP 4] 텍스트 오버레이 추가 중...")
    draw = ImageDraw.Draw(thumbnail)

    # 폰트 설정 (한글 지원 ExtraBold)
    try:
        # macOS 한글 지원 폰트 우선 (ExtraBold 사용)
        extrabold_font_candidates = [
            ("/System/Library/Fonts/Supplemental/AppleSDGothicNeo.ttc", [14], "AppleSDGothicNeo.ttc"),  # ExtraBold
            ("/System/Library/Fonts/AppleSDGothicNeo.ttc", [14, 6, 5], "AppleSDGothicNeo.ttc"),  # ExtraBold, Bold
            ("/Library/Fonts/AppleGothic.ttf", [0], "AppleGothic.ttf"),
            ("/System/Library/Fonts/Supplemental/AppleGothic.ttf", [0], "AppleGothic.ttf"),
            ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", [0], "Arial Bold.ttf"),
        ]

        fonts = []
        loaded = False
        for font_path, indexes, label in extrabold_font_candidates:
            if not os.path.exists(font_path):
                continue

            for idx in indexes:
                try:
                    # 첫 번째 줄: 105, 두 번째 줄: 112 (자막 35px의 3.0~3.2배)
                    fonts = [
                        ImageFont.truetype(font_path, 105, index=idx),
                        ImageFont.truetype(font_path, 112, index=idx)
                    ]
                    idx_info = f" (index={idx})" if len(indexes) > 1 or idx != 0 else ""
                    print(f"  폰트 로드: {label}{idx_info}")
                    loaded = True
                    break
                except Exception:
                    continue

            if loaded:
                break

        if not fonts:
            print("  [WARNING] 기본 폰트 사용")
            fonts = [ImageFont.load_default(), ImageFont.load_default()]

    except Exception as e:
        print(f"  [WARNING] 폰트 로드 실패: {e}, 기본 폰트 사용")
        fonts = [ImageFont.load_default(), ImageFont.load_default()]

    # 각 줄 그리기
    y_positions = [int(overlay_height * 0.25), int(overlay_height * 0.6)]

    for line_idx, line in enumerate(title_lines):
        if line_idx >= len(fonts):
            # 폰트 개수보다 줄이 많으면 마지막 폰트 재사용
            font = fonts[-1]
        else:
            font = fonts[line_idx]

        if line_idx >= len(y_positions):
            # Y 위치 개수보다 줄이 많으면 동적으로 계산
            y_pos = y_positions[-1] + 80 * (line_idx - len(y_positions) + 1)
        else:
            y_pos = y_positions[line_idx]

        words = line.get('words', [])
        if not words:
            continue

        # 전체 줄의 너비 계산 (단어 간 간격 포함)
        total_width = 0
        word_widths = []
        spacing = 10  # 단어 간 간격

        for word in words:
            bbox = draw.textbbox((0, 0), word['text'], font=font)
            word_width = bbox[2] - bbox[0]
            word_widths.append(word_width)
            total_width += word_width

        # 단어 간 간격 추가
        total_width += spacing * (len(words) - 1)

        # 시작 X 위치 (중앙 정렬)
        current_x = (thumbnail_width - total_width) // 2

        # 각 단어 그리기
        for word_idx, word in enumerate(words):
            word_text = word['text']
            word_color = word.get('color', '#FFFFFF')

            # 외곽선 효과 (검은색, 통일된 굵기)
            stroke_width = 8
            for offset_x in range(-stroke_width, stroke_width + 1):
                for offset_y in range(-stroke_width, stroke_width + 1):
                    if offset_x != 0 or offset_y != 0:
                        draw.text((current_x + offset_x, y_pos + offset_y),
                                 word_text, font=font, fill='black')

            # 컬러 텍스트
            draw.text((current_x, y_pos), word_text, font=font, fill=word_color)

            # 다음 단어 위치로 이동
            current_x += word_widths[word_idx] + spacing

    # 7. 저장
    if output_path is None:
        # 비디오 파일명 기반으로 썸네일 파일명 생성
        base_name = os.path.splitext(os.path.basename(video_path))[0]
        output_path = os.path.join(os.path.dirname(video_path), f"{base_name}_thumbnail.jpg")

    print(f"\n[STEP 5] 썸네일 저장 중: {os.path.basename(output_path)}")
    thumbnail.save(output_path, 'JPEG', quality=95)

    print(f"\n{'='*60}")
    print("썸네일 생성 완료!")
    print(f"저장 위치: {output_path}")
    print(f"{'='*60}\n")

    return output_path


def main():
    """메인 실행 함수"""

    print("\n" + "="*60)
    print("  YouTube 썸네일 생성기 (단어별 색상 지원)")
    print("="*60 + "\n")

    # 썸네일 설정 확인
    thumbnail_config = load_thumbnail_config()

    # 사용법 안내
    if len(sys.argv) < 2:
        print("사용법:")
        print("  방법 1 (JSON 설정 사용 - 권장):")
        print("    python create_thumbnail.py <비디오_경로> [프레임_시간]")
        print("    * 웹앱(http://192.168.0.8:3000)에서 썸네일 제목/색상 설정 후 사용")
        print("\n  방법 2 (직접 입력 - 기존 방식):")
        print("    python create_thumbnail.py <비디오_경로> <타이틀_1줄> <타이틀_2줄> [프레임_시간]")
        print("\n예시:")
        print("  python create_thumbnail.py Output/video.mp4")
        print("  python create_thumbnail.py Output/video.mp4 '피지컬 아시아 몽골' '어르걸 빼빼머리의 비밀'")
        print("  python create_thumbnail.py Output/video.mp4 5.5")
        print("\n프레임 시간: 생략하면 비디오 중간 프레임 사용 (초 단위)")
        return

    video_path = sys.argv[1]

    # 비디오 파일 존재 확인
    if not os.path.exists(video_path):
        print(f"[ERROR] 비디오 파일을 찾을 수 없습니다: {video_path}")
        return

    # 파라미터 파싱
    if len(sys.argv) >= 4:
        # 방법 2: 직접 입력
        title_line1 = sys.argv[2]
        title_line2 = sys.argv[3]
        time_seconds = float(sys.argv[4]) if len(sys.argv) > 4 else None

        create_thumbnail_with_overlay(
            video_path=video_path,
            title_line1=title_line1,
            title_line2=title_line2,
            time_seconds=time_seconds
        )
    else:
        # 방법 1: JSON 설정 사용
        try:
            time_seconds = float(sys.argv[2]) if len(sys.argv) > 2 else None
        except ValueError:
            time_seconds = None

        if not thumbnail_config or 'title_lines' not in thumbnail_config or len(thumbnail_config['title_lines']) == 0:
            print("\n[ERROR] thumbnail_config.json 파일이 없거나 비어 있습니다.")
            print("웹앱(http://192.168.0.8:3000)에서 썸네일 제목을 설정하거나,")
            print("직접 입력 방식을 사용하세요.")
            return

        create_thumbnail_with_overlay(
            video_path=video_path,
            time_seconds=time_seconds
        )


if __name__ == "__main__":
    main()
