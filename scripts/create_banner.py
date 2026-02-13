#!/usr/bin/env python3
"""
광고 배너 이미지 생성 스크립트
파란색 배경에 흰색 텍스트로 "🚀 무료 팔로워 100명: 인스트라이크.COM" 배너 생성
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_banner(
    text="🚀 무료 팔로워 100명: 인스트라이크.COM",
    width=1080,
    height=120,
    bg_color="#2B4D8C",  # 진한 파란색
    text_color="#FFFFFF",  # 흰색
    output_path=None
):
    """
    광고 배너 이미지 생성

    Args:
        text: 배너에 표시할 텍스트
        width: 이미지 너비 (기본: 1080px, 9:16 쇼츠에 맞춤)
        height: 이미지 높이 (기본: 120px)
        bg_color: 배경색 (hex 코드)
        text_color: 텍스트 색상 (hex 코드)
        output_path: 저장 경로
    """
    # 이미지 생성
    img = Image.new('RGB', (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    # 폰트 설정 (시스템 폰트 사용, 크기 조절)
    try:
        # macOS 기본 폰트
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 50)
    except:
        try:
            # 대체 폰트
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 50)
        except:
            # 기본 폰트
            font = ImageFont.load_default()

    # 텍스트 중앙 정렬
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = (width - text_width) // 2
    y = (height - text_height) // 2

    # 텍스트 그리기
    draw.text((x, y), text, font=font, fill=text_color)

    # 저장
    if output_path is None:
        # 기본 저장 경로: data/common/ads/banner.png
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        output_path = os.path.join(project_root, 'data', 'common', 'ads', 'banner.png')

    # 디렉토리가 없으면 생성
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # 이미지 저장
    img.save(output_path, 'PNG')
    print(f"✅ 배너 이미지 생성 완료: {output_path}")
    print(f"   크기: {width}x{height}px")
    print(f"   배경색: {bg_color}")
    print(f"   텍스트: {text}")

    return output_path


if __name__ == '__main__':
    # 배너 생성
    banner_path = create_banner()
    print(f"\n배너가 저장되었습니다: {banner_path}")
