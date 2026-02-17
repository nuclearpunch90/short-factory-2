import express from 'express';

const router = express.Router();

// 이모지 제거 함수 (더 포괄적)
function removeEmojis(text) {
    if (!text) return text;

    // 이모지와 특수 기호를 제거하는 정규식 (더 포괄적)
    return text
        // 이모지 기본 범위 (😀-🫿)
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
        // 기호 및 픽토그램 (☀-⛿)
        .replace(/[\u{2600}-\u{26FF}]/gu, '')
        // 잡다한 기호 (✂-⯿)
        .replace(/[\u{2702}-\u{27BF}]/gu, '')
        // 추가 기호 범위 (⌀-⏿)
        .replace(/[\u{2300}-\u{23FF}]/gu, '')
        // 별표 및 기타 (⭐-⭕)
        .replace(/[\u{2B50}-\u{2B55}]/gu, '')
        // 이모지 확장 범위
        .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
        .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, '')
        .replace(/[\u{1F100}-\u{1F64F}]/gu, '')
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
        .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
        .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
        // 변형 선택자 (이모지 스타일 변경)
        .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
        // 국기 이모지 (🇦-🇿)
        .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
        // 기타 특수문자 (❤, ✨, ✅, ❌ 등)
        .replace(/[\u{2000}-\u{2BFF}]/gu, '')
        // Zero Width Joiner (피부톤 조합용)
        .replace(/\u200D/g, '')
        // 연속된 공백을 하나로
        .replace(/\s+/g, ' ')
        .trim();
}

// POST /api/script/generate - AI로 대본 생성
router.post('/generate', async (req, res) => {
    try {
        const { theme, topic, tone } = req.body;

        console.log(`[Script] Generation request received - Topic: "${topic}", Theme: "${theme}", Tone: "${tone}"`);

        if (!topic) {
            console.warn('[Script] Missing topic in request');
            return res.status(400).json({ error: '주제를 입력해주세요' });
        }

        // 말투 설정
        const toneDescriptions = {
            casual: '친근한 해요체 (~해요, ~예요, ~죠). 부드럽고 친근하게.',
            formal: '정중한 합니다체 (~합니다, ~습니다). 뉴스 앵커처럼 신뢰감 있게.',
            info: '정보 전달형. 팩트 중심, 간결하고 명확하게. ~이다, ~한다 체.',
            hype: '흥분 자극형! 느낌표 많이! 대박! 충격! 미쳤다! 이거 실화냐? 식으로.',
            community: '커뮤 감성 중립. ~함, ~임 체. 담백하게 정보 전달. ㅋㅋ 적당히.',
            rough: '거친 직설형. 시비 거는 느낌. 뭐? 이것도 몰라? 진짜? 답답하네.',
            sarcastic: '냉소적 비꼼. 아~ 그렇구나~ 대단하시네~ 비꼬는 느낌.',
            cute: '귀여운 애교 (~용, ~당, ~쪄). 응~ 그래용~ 대박이당~ 느낌.'
        };
        const toneHint = toneDescriptions[tone] || toneDescriptions.casual;
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[Script] GEMINI_API_KEY is missing');
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        }

        const themeDescriptions = {
            money: '재테크, 돈 관리, 부자 습관',
            motivation: '동기부여, 힘이 되는 말',
            selfdev: '자기계발, 성장',
            love: '연애, 썸, 관계',
            horror: '공포, 괴담, 무서운 이야기',
            tips: '생활 꿀팁, 유용한 정보',
            facts: '신기한 상식, 몰랐던 사실',
            health: '건강, 운동, 다이어트',
            korea: '한국의 장점, 국뽕',
            international: '국제커플, 국제결혼'
        };

        const themeHint = themeDescriptions[theme] || '';

        console.log('[Script] Constructing prompt for Gemini...');
        const prompt = `너는 유튜브 쇼츠 바이럴 대본 작가야.

주제: ${topic}
${themeHint ? `분위기: ${themeHint}` : ''}
말투: ${toneHint}

예시 1:
"일본 여자 꼬시려다 망신당한 한국 남자들.
첫 번째 카톡으로 고백하다 차임.
일본은 직접 만나서 고백하는게 예의인데 카톡으로 해서 실패.
두 번째 술김에 고백하다 거절.
술먹고 고백하면 진정성 없다고 판단해서 즉시 거절.
세 번째 공항에서 프로포즈하다 망신.
공개 프로포즈 부담스러워하는 일본 문화 몰라서 대형 사고.
네 번째 부모님 먼저 소개하다 이별.
사귀는 사이도 아닌데 부모 소개해서 부담 줘서 도망.
다섯 번째 비싼 선물로 마음 사려다 실패.
돈으로 해결하려는 천박한 남자로 오해받아 차임.
여섯 번째 일본어 못해서 통역 데려가다 망신.
데이트에 통역 데려간 한심한 모습에 여자가 떠남.
일곱 번째 한국이 더 잘산다고 무시하다 이별.
일본 무시하는 발언해서 즉시 관계 정리당함."

예시 2:
"일본 여자와 한국 여자 동시에 만난 남자 후기.
첫 번째 데이트 비용 차이.
한국 여자는 10만원 일본 여자는 3만원으로 해결.
두 번째 연락 빈도 차이.
한국 여자는 1분마다 카톡 일본 여자는 하루 한번.
세 번째 스킨십 속도 차이.
한국 여자는 한달 일본 여자는 3개월 걸림.
네 번째 결혼 압박 차이.
한국 여자는 1년되면 압박 일본은 3년도 여유.
다섯 번째 이벤트 기대치 차이.
한국 여자는 매달 이벤트 일본은 생일만 챙겨도 OK.
여섯 번째 질투 강도 차이.
한국 여자는 여자 친구도 못만나게 일본은 쿨함.
일곱 번째 결론 일본 여자가 편함.
정신적 육체적 경제적으로 일본 여자가 부담 없음."

예시 3:
"일본 여자가 한국 생활하며 가장 힘든 점.
첫 번째 매운 음식 지옥.
김치 떡볶이 매운탕 다 매워서 먹을게 없음.
두 번째 한국 여자들의 텃세.
일본 여자라고 무시하고 따돌리는 한국 여자들.
세 번째 미세먼지 때문에 죽을것 같음.
일본은 공기 깨끗한데 한국은 마스크 필수.
네 번째 전월세 시스템 이해 불가.
일본은 보증금 적은데 한국은 억단위라 충격.
다섯 번째 배달 음식 중독.
너무 편해서 매일 시켜먹다가 살찜.
여섯 번째 한국어 존댓말 너무 어려움.
일본보다 복잡한 존댓말 때문에 스트레스.
일곱 번째 그래도 한국 남자 때문에 버팀.
힘들어 사랑하는 남자 있어서 행복하다고."

작성 규칙:
1. 후킹 문장으로 시작 (자극적, 충격적, 궁금증 유발)
2. "첫 번째", "두 번째" 등 번호 매겨서 5~7개 포인트
3. 각 포인트는 제목 한줄 + 구체적 설명 한줄 (총 2문장씩)
4. 비교/대조 형식 적극 활용 (A는 이런데 B는 저럼)
5. 위에서 지정한 말투를 반드시 일관되게 사용
6. 숫자/통계 적극 활용 (10만원, 3개월, 100번 등)
7. **40~59초 분량 (350~450자) - 절대 59초 초과 금지**
8. 마지막에 구독/좋아요 유도 또는 다음 영상 암시
9. **이모지 절대 사용하지 마세요!** (😱❌⭕💸 등 모든 이모지, 특수문자, 그림 기호 금지)
10. **순수한 한글, 영어, 숫자, 문장부호만 사용**
11. **느낌표, 물음표는 사용 가능하지만 이모지 절대 불가**

CRITICAL: 이모지를 단 하나라도 사용하면 TTS가 읽을 수 없어서 영상 제작이 불가능합니다!

JSON 형식으로만 답변 (이모지 없이):
{
  "script": "대본 (줄바꿈은 \\n, 이모지 없이 순수 텍스트만)",
  "title": "자극적 제목 15자 이내 (이모지 없이)",
  "description": "설명 2줄\\n\\n#해시태그 5~7개 (이모지 없이)"
}`;

        console.log('[Script] Sending request to Gemini API...');
        // apiKey is already declared above
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 1024
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[Script] Gemini API responded with error:', errorData);
            throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        console.log('[Script] Received response from Gemini API');

        if (data.promptFeedback?.blockReason) {
            console.warn(`[Script] Content blocked: ${data.promptFeedback.blockReason}`);
            throw new Error(`Script blocked by safety filters: ${data.promptFeedback.blockReason}`);
        }

        const content = data.candidates[0].content.parts[0].text.trim();
        console.log('[Script] Generated content length:', content.length);

        // JSON 파싱 시도
        let result;
        try {
            // JSON 블록 추출 (```json ... ``` 형식 처리)
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                content.match(/```\s*([\s\S]*?)\s*```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : content;
            result = JSON.parse(jsonStr);
        } catch (parseError) {
            console.warn('[Script] JSON parse failed, using raw content');
            // JSON 파싱 실패 시 원본 텍스트를 script로 사용
            result = {
                script: content,
                title: topic,
                description: `${topic} #쇼츠 #유튜브`
            };
        }

        // 이모지 제거
        if (result.script) result.script = removeEmojis(result.script);
        if (result.title) result.title = removeEmojis(result.title);
        if (result.description) result.description = removeEmojis(result.description);

        console.log('[Script] Successfully generated and processed script');
        res.json({ success: true, data: result });

    } catch (error) {
        console.error('[Script] Generation error:', error);
        res.status(500).json({
            error: '대본 생성 중 오류가 발생했습니다',
            details: error.message
        });
    }
});

// POST /api/script/generate-batch - 여러 주제로 대본 일괄 생성
router.post('/generate-batch', async (req, res) => {
    try {
        const { topics, count, theme, tone } = req.body;

        console.log(`[Script Batch] Request received - Topics: ${topics?.length}, Count per topic: ${count}, Theme: ${theme}, Tone: ${tone}`);

        if (!topics || !Array.isArray(topics) || topics.length === 0) {
            console.warn('[Script Batch] No topics provided');
            return res.status(400).json({ error: '주제를 최소 1개 이상 입력해주세요' });
        }

        if (topics.length > 10) {
            return res.status(400).json({ error: '주제는 최대 10개까지 입력 가능합니다' });
        }

        const generationCount = parseInt(count) || 1;
        if (generationCount < 1 || generationCount > 10) {
            return res.status(400).json({ error: '생성 개수는 1~10개 사이여야 합니다' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[Script Batch] GEMINI_API_KEY is missing');
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        }

        // 말투 설정
        const toneDescriptions = {
            casual: '친근한 해요체 (~해요, ~예요, ~죠). 부드럽고 친근하게.',
            formal: '정중한 합니다체 (~합니다, ~습니다). 뉴스 앵커처럼 신뢰감 있게.',
            info: '정보 전달형. 팩트 중심, 간결하고 명확하게. ~이다, ~한다 체.',
            hype: '흥분 자극형! 느낌표 많이! 대박! 충격! 미쳤다! 이거 실화냐? 식으로.',
            community: '커뮤 감성 중립. ~함, ~임 체. 담백하게 정보 전달. ㅋㅋ 적당히.',
            rough: '거친 직설형. 시비 거는 느낌. 뭐? 이것도 몰라? 진짜? 답답하네.',
            sarcastic: '냉소적 비꼼. 아~ 그렇구나~ 대단하시네~ 비꼬는 느낌.',
            cute: '귀여운 애교 (~용, ~당, ~쪄). 응~ 그래용~ 대박이당~ 느낌.'
        };

        const themeDescriptions = {
            money: '재테크, 돈 관리, 부자 습관',
            motivation: '동기부여, 힘이 되는 말',
            selfdev: '자기계발, 성장',
            love: '연애, 썸, 관계',
            horror: '공포, 괴담, 무서운 이야기',
            tips: '생활 꿀팁, 유용한 정보',
            facts: '신기한 상식, 몰랐던 사실',
            health: '건강, 운동, 다이어트',
            korea: '한국의 장점, 국뽕',
            international: '국제커플, 국제결혼'
        };

        const toneHint = toneDescriptions[tone] || toneDescriptions.casual;
        const themeHint = themeDescriptions[theme] || '';

        const allScripts = [];
        let totalGenerated = 0;
        let totalRequested = topics.length * generationCount;

        console.log(`[Script Batch] Starting generation of ${totalRequested} scripts total...`);

        // 각 주제별로 대본 생성
        for (const topic of topics) {
            const topicScripts = [];
            console.log(`[Script Batch] Processing topic: "${topic}"`);

            for (let i = 0; i < generationCount; i++) {
                try {
                    const prompt = `너는 유튜브 쇼츠 바이럴 대본 작가야.

주제: ${topic}
${themeHint ? `분위기: ${themeHint}` : ''}
말투: ${toneHint}

예시 1:
"일본 여자 꼬시려다 망신당한 한국 남자들.
첫 번째 카톡으로 고백하다 차임.
일본은 직접 만나서 고백하는게 예의인데 카톡으로 해서 실패.
두 번째 술김에 고백하다 거절.
술먹고 고백하면 진정성 없다고 판단해서 즉시 거절.
세 번째 공항에서 프로포즈하다 망신.
공개 프로포즈 부담스러워하는 일본 문화 몰라서 대형 사고.
네 번째 부모님 먼저 소개하다 이별.
사귀는 사이도 아닌데 부모 소개해서 부담 줘서 도망.
다섯 번째 비싼 선물로 마음 사려다 실패.
돈으로 해결하려는 천박한 남자로 오해받아 차임.
여섯 번째 일본어 못해서 통역 데려가다 망신.
데이트에 통역 데려간 한심한 모습에 여자가 떠남.
일곱 번째 한국이 더 잘산다고 무시하다 이별.
일본 무시하는 발언해서 즉시 관계 정리당함."

작성 규칙:
1. 후킹 문장으로 시작 (자극적, 충격적, 궁금증 유발)
2. "첫 번째", "두 번째" 등 번호 매겨서 5~7개 포인트
3. 각 포인트는 제목 한줄 + 구체적 설명 한줄 (총 2문장씩)
4. 비교/대조 형식 적극 활용 (A는 이런데 B는 저럼)
5. 위에서 지정한 말투를 반드시 일관되게 사용
6. 숫자/통계 적극 활용 (10만원, 3개월, 100번 등)
7. **40~59초 분량 (350~450자) - 절대 59초 초과 금지**
8. 마지막에 구독/좋아요 유도 또는 다음 영상 암시
9. 같은 주제라도 매번 다른 각도와 내용으로 작성
10. **이모지 절대 사용하지 마세요!** (😱❌⭕💸 등 모든 이모지, 특수문자, 그림 기호 금지)
11. **순수한 한글, 영어, 숫자, 문장부호만 사용**
12. **느낌표, 물음표는 사용 가능하지만 이모지 절대 불가**

CRITICAL: 이모지를 단 하나라도 사용하면 TTS가 읽을 수 없어서 영상 제작이 불가능합니다!

JSON 형식으로만 답변 (이모지 없이):
{
  "script": "대본 (줄바꿈은 \\n, 이모지 없이 순수 텍스트만)",
  "title": "자극적 제목 15자 이내 (이모지 없이)",
  "description": "설명 2줄\\n\\n#해시태그 5~7개 (이모지 없이)"
}`;

                    console.log(`[Script Batch] Generating script ${i + 1}/${generationCount} for topic "${topic}"...`);
                    // apiKey is already declared above
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: {
                                temperature: 0.8 + (i * 0.1), // 다양성을 위해 temperature 조금씩 증가
                                maxOutputTokens: 1024
                            }
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        console.error(`[Script Batch] Gemini API error for topic "${topic}":`, errorData);
                        throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
                    }

                    const data = await response.json();

                    if (data.promptFeedback?.blockReason) {
                        console.warn(`[Script Batch] Content blocked: ${data.promptFeedback.blockReason}`);
                        throw new Error(`Script blocked by safety filters: ${data.promptFeedback.blockReason}`);
                    }

                    const content = data.candidates[0].content.parts[0].text.trim();
                    console.log(`[Script Batch] Generated content length: ${content.length}`);

                    // JSON 파싱
                    let result;
                    try {
                        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                            content.match(/```\s*([\s\S]*?)\s*```/);
                        const jsonStr = jsonMatch ? jsonMatch[1] : content;
                        result = JSON.parse(jsonStr);
                    } catch (parseError) {
                        console.warn(`[Script Batch] JSON parse failed, using raw content`);
                        result = {
                            script: content,
                            title: topic,
                            description: `${topic} #쇼츠 #유튜브`
                        };
                    }

                    // 이모지 제거
                    if (result.script) result.script = removeEmojis(result.script);
                    if (result.title) result.title = removeEmojis(result.title);
                    if (result.description) result.description = removeEmojis(result.description);

                    topicScripts.push({
                        ...result,
                        topicIndex: topics.indexOf(topic),
                        scriptIndex: i,
                        topic: topic
                    });

                    totalGenerated++;

                } catch (error) {
                    console.error(`[Script Batch] Error generating script for topic "${topic}" (${i + 1}/${generationCount}):`, error);
                    // 에러가 나도 계속 진행
                }
            }

            allScripts.push({
                topic: topic,
                scripts: topicScripts
            });
        }

        console.log(`[Script Batch] Completed. Generated ${totalGenerated}/${totalRequested}`);

        res.json({
            success: true,
            data: allScripts,
            stats: {
                totalRequested: totalRequested,
                totalGenerated: totalGenerated,
                topics: topics.length,
                countPerTopic: generationCount
            }
        });

    } catch (error) {
        console.error('[Script Batch] Global error:', error);
        res.status(500).json({
            error: '대본 일괄 생성 중 오류가 발생했습니다',
            details: error.message
        });
    }
});

export default router;
