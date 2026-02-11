import express from 'express';

const router = express.Router();

// MiniMax 사용 가능한 voice 목록
const VOICE_LIST = [
  // 프랑스어 voices
  { voice_id: 'French_MaleNarrator', voice_name: '남성 내레이터 (Male Narrator)', language: 'French' },
  { voice_id: 'French_Female Journalist', voice_name: '여성 저널리스트 (Female Journalist)', language: 'French' },
  { voice_id: 'French_MovieLeadFemale', voice_name: '영화 주연 여성 (Movie Lead Female)', language: 'French' },
  { voice_id: 'French_FemaleAnchor', voice_name: '여성 앵커 (Female Anchor)', language: 'French' },
  { voice_id: 'French_Female_News Anchor', voice_name: '여성 뉴스 앵커 (Female News Anchor)', language: 'French' },
  { voice_id: 'French_Male_Speech_New', voice_name: '남성 스피치 (Male Speech)', language: 'French' },

  // 영어 voices
  { voice_id: 'English_Trustworth_Man', voice_name: '신뢰할 수 있는 남성 (Trustworthy Man)', language: 'English' },
  { voice_id: 'English_CaptivatingStoryteller', voice_name: '매혹적인 스토리텔러 (Captivating Storyteller)', language: 'English' },
  { voice_id: 'English_ManWithDeepVoice', voice_name: '깊은 목소리의 남성 (Man With Deep Voice)', language: 'English' },

  // Moss Audio
  { voice_id: 'moss_audio_c12a59b9-7115-11f0-a447-9613c873494c', voice_name: 'Moss Audio 1', language: 'Moss Audio' },
];

// MiniMax voice 목록 제공
router.get('/list', async (req, res) => {
  try {
    console.log(`Returning ${VOICE_LIST.length} voices`);

    // MiniMax API 응답 형식에 맞춰서 반환
    res.json({
      success: true,
      voices: {
        data: {
          voice_list: VOICE_LIST
        }
      }
    });

  } catch (error) {
    console.error('Voice List Error:', error.message);

    res.status(500).json({
      error: 'Voice 목록을 가져오는 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

export default router;
