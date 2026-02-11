import express from 'express';

const router = express.Router();

const AI_302_CHAT_URL = 'https://api.302.ai/v1/chat/completions';

// Generate thumbnail title from script using AI
router.post('/generate-title', async (req, res) => {
    try {
        const { script } = req.body;
        const apiKey = process.env.AI_302_API_KEY;

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'AI_302_API_KEY not configured. 설정에서 API 키를 입력해주세요.'
            });
        }

        if (!script || script.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: '대본을 입력해주세요.'
            });
        }

        const prompt = `다음 대본을 분석해서 유튜브 썸네일에 들어갈 제목을 만들어줘.

대본:
${script}

조건:
1. 첫 번째 줄(topText): 짧은 서브 타이틀 (10~15자 내외, 호기심 유발)
2. 두 번째 줄(bottomText): 메인 타이틀 (6~10자 내외, 핵심 키워드, 강렬하게)
3. 유튜브 클릭을 유도하는 자극적이고 강렬한 표현 사용
4. 반드시 JSON 형식으로만 응답

응답 형식:
{"topText": "첫 번째 줄", "bottomText": "두 번째 줄"}`;

        const response = await fetch(AI_302_CHAT_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // Parse JSON from response
        let result;
        try {
            // Try to extract JSON from the response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('JSON not found in response');
            }
        } catch (parseError) {
            console.error('Failed to parse AI response:', content);
            // Fallback: try to extract text manually
            result = {
                topText: '충격 실화',
                bottomText: '대박 사건'
            };
        }

        res.json({
            success: true,
            topText: result.topText || '제목 생성 실패',
            bottomText: result.bottomText || '다시 시도해주세요'
        });

    } catch (error) {
        console.error('Thumbnail title generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
