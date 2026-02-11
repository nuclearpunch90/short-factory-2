#!/bin/bash

# Ranking Video Script Runner (2-Step Workflow)
# STEP 1: Voice Overlay - Input 비디오들을 처리하여 Output으로
# STEP 2: Ranking Video - Output 비디오들을 랭킹 컴필레이션으로

# Script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Config file setup
export CONFIG_FILE="Config/config.json"

# .env 파일에서 API 키 읽기 (여러 경로 시도)
echo "====================================="
echo "API 키 로드 중..."
echo "====================================="

ENV_PATHS=(
    "../.env"
    "../../.env"
    "$SCRIPT_DIR/../.env"
    "/Users/office/Library/CloudStorage/OneDrive-개인/Bureau/Scripts/shorts-factory-main/.env"
)

ENV_LOADED=false
for ENV_FILE in "${ENV_PATHS[@]}"; do
    if [ -f "$ENV_FILE" ]; then
        echo "[INFO] .env 파일 발견: $ENV_FILE"

        # .env 파일에서 API 키 직접 읽기
        while IFS='=' read -r key value; do
            # 주석과 빈 줄 무시
            if [[ ! "$key" =~ ^#.* ]] && [ -n "$key" ]; then
                # AI_302_API_KEY만 export
                if [[ "$key" == "AI_302_API_KEY" ]]; then
                    export "$key=$value"
                    echo "[INFO] $key 설정됨"
                fi
            fi
        done < "$ENV_FILE"

        ENV_LOADED=true
        break
    fi
done

if [ "$ENV_LOADED" = false ]; then
    echo "[WARNING] .env 파일을 찾을 수 없습니다!"
    echo "[INFO] 시도한 경로:"
    for path in "${ENV_PATHS[@]}"; do
        echo "  - $path"
    done
fi

# API 키 상태 확인
if [ -n "$AI_302_API_KEY" ]; then
    # 공백 제거
    export AI_302_API_KEY=$(echo "$AI_302_API_KEY" | tr -d ' \t\r\n')

    # 키 유효성 검사
    if [[ "$AI_302_API_KEY" == "YOUR_302AI_API_KEY_HERE" ]] || [[ ${#AI_302_API_KEY} -lt 20 ]]; then
        echo "[ERROR] 302.ai API 키가 설정되지 않았습니다!"
        echo "[INFO] .env 파일에서 AI_302_API_KEY를 실제 키로 교체하세요"
        echo "[INFO] 키 받기: https://dash.302.ai/apis/markets"
        exit 1
    fi

    echo "[OK] AI_302_API_KEY 사용 가능"
    echo "[DEBUG] API 키 길이: ${#AI_302_API_KEY} 문자"
    echo "[DEBUG] API 키 시작: ${AI_302_API_KEY:0:10}..."
else
    echo "[ERROR] AI_302_API_KEY가 설정되지 않았습니다!"
    echo "[INFO] .env 파일에 AI_302_API_KEY를 추가하세요"
    exit 1
fi
echo ""

# Activate virtual environment
source venv/bin/activate

# Clean Temp folder (로그 파일 제외)
echo ""
echo "====================================="
echo "Temp 폴더 정리 중..."
echo "====================================="
if [ -d "Temp" ]; then
    # 로그 파일을 제외하고 정리
    find Temp -mindepth 1 -not -name 'ranking_video.log' -delete
    echo "✓ Temp 폴더 정리 완료 (로그 제외)"
else
    mkdir -p Temp
    echo "✓ Temp 폴더 생성 완료"
fi

# STEP 1: Voice Overlay (개별 비디오 처리)
echo ""
echo "====================================="
echo "STEP 1: 개별 비디오 처리 (Voice Overlay)"
echo "====================================="
./venv/bin/python3 scripts/voice_overlay.py

# STEP 2: Ranking Video Creation (랭킹 컴필레이션)
echo ""
echo "====================================="
echo "STEP 2: 랭킹 비디오 생성 (TOP 5)"
echo "====================================="
./venv/bin/python3 scripts/create_ranking_video.py

# Completion message
echo ""
echo "====================================="
echo "전체 스크립트 실행 완료!"
echo "====================================="
