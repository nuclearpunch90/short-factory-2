#!/bin/bash

# YouTube 계정 전환 스크립트
# 사용법: ./scripts/switch_youtube_account.sh [1-8]

ACCOUNT=$1

if [ -z "$ACCOUNT" ]; then
    echo "📊 등록된 YouTube 계정 목록:"
    echo ""
    for i in {1..8}; do
        if [ -f "youtube-token-account${i}.json" ]; then
            echo "  ✅ Account $i: 등록됨"
        else
            echo "  ⬜ Account $i: 미등록"
        fi
    done
    echo ""
    if [ -f "youtube-token.json" ]; then
        echo "📍 현재 활성 계정: youtube-token.json 존재"
    else
        echo "📍 현재 활성 계정: 없음"
    fi
    echo ""
    echo "사용법: ./scripts/switch_youtube_account.sh [1-8]"
    echo "예시: ./scripts/switch_youtube_account.sh 3"
    exit 0
fi

# 계정 번호 검증 (1-8)
if ! [[ "$ACCOUNT" =~ ^[1-8]$ ]]; then
    echo "❌ 잘못된 계정 번호입니다. 1부터 8 사이의 숫자를 입력하세요."
    exit 1
fi

# 토큰 파일 존재 확인
if [ ! -f "youtube-token-account${ACCOUNT}.json" ]; then
    echo "❌ Account ${ACCOUNT} 토큰 파일이 없습니다."
    echo ""
    echo "💡 Account ${ACCOUNT}를 등록하려면:"
    echo "   node scripts/youtube_auth.js --account ${ACCOUNT}"
    exit 1
fi

# 계정 전환
cp "youtube-token-account${ACCOUNT}.json" youtube-token.json
echo "✅ Account ${ACCOUNT}로 전환되었습니다."
