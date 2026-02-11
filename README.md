# Shorts Maker - YouTube Shorts 제작 도구

MiniMax TTS와 OpenAI Whisper를 활용하여 YouTube Shorts용 오디오와 자막을 생성하는 Node.js 애플리케이션입니다.

## 기능

- 🎙️ **MiniMax TTS**: 한국어 sweet girl 음성으로 텍스트를 오디오로 변환
- 📝 **OpenAI Whisper**: 생성된 오디오에서 자동으로 SRT 자막 파일 생성
- 🎨 **웹 UI**: 사용하기 쉬운 웹 인터페이스
- 💾 **다운로드**: 생성된 오디오와 자막 파일 다운로드 지원

## 설치 방법

1. 저장소 클론
```bash
cd shortsmaker
```

2. 의존성 설치
```bash
npm install
```

3. 환경 변수 설정
```bash
cp .env.example .env
```

`.env` 파일을 열고 다음 값들을 설정:
- `MINIMAX_API_KEY`: MiniMax API 키
- `MINIMAX_GROUP_ID`: MiniMax 그룹 ID
- `OPENAI_API_KEY`: OpenAI API 키

## 실행 방법

### 개발 모드
```bash
npm run dev
```

### 프로덕션 모드
```bash
npm start
```

서버가 시작되면 브라우저에서 `http://localhost:3000`으로 접속하세요.

### 데스크톱 앱(Electron) 실행
```bash
npm run electron-dev
```

- macOS/Windows 모두 지원합니다.
- 이 명령은 내부에서 Express 서버를 띄우고, 네이티브 폴더 선택기(업로드 없이 경로만 등록)를 사용해 로컬 폴더를 바로 연결합니다.

## 사용 방법

1. 웹 브라우저에서 애플리케이션 열기
2. 제목과 내용 입력
3. "생성하기" 버튼 클릭
4. 생성된 오디오와 SRT 자막 파일 다운로드

## API 엔드포인트

### POST /api/minimax/generate-tts
텍스트를 오디오로 변환

**요청 본문:**
```json
{
  "title": "제목",
  "content": "변환할 텍스트 내용"
}
```

### POST /api/whisper/generate-srt
오디오에서 SRT 자막 생성

**요청 본문:**
```json
{
  "audioPath": "오디오 파일 경로",
  "title": "제목"
}
```

## 프로젝트 구조

```
shorts-factory-main/
├── public/                          # 프론트엔드 파일
│   ├── images/
│   │   ├── templates/              # 썸네일 템플릿
│   │   └── video-sources/          # [업로드] AI 동영상용 소스 이미지
│   ├── css/                        # 스타일시트
│   ├── js/                         # 클라이언트 JavaScript
│   ├── index.html                  # 메인 페이지
│   ├── ai-video.html               # AI 동영상 숏폼 생성기
│   ├── ai-shorts.html              # AI 숏폼 생성기
│   ├── ai-longform.html            # AI 롱폼 생성기
│   ├── ranking-video.html          # 랭킹 비디오 생성기
│   └── thumbnail-maker.html        # 썸네일 생성기
├── routes/                          # API 라우트
│   ├── ai-video.js                 # AI 동영상 API
│   ├── ranking-video.js            # 랭킹 비디오 API
│   └── ...
├── Output/                          # 생성된 결과물
│   ├── ai-videos/                  # [생성] AI 동영상 결과
│   ├── ai-shorts/                  # [생성] AI 숏폼 결과
│   ├── ai-longform/                # [생성] AI 롱폼 결과
│   └── ranking-videos/             # [생성] 랭킹 비디오 결과
├── ranking-videos/                  # 랭킹 비디오 프로젝트
│   ├── Input/                      # [업로드] 입력 미디어
│   ├── Output/                     # [생성] 랭킹 비디오
│   ├── Temp/                       # 임시 파일
│   └── Config/                     # 설정 파일
├── uploads/                         # 일반 업로드
├── data/                            # 데이터 파일
├── server.js                        # Express 서버
├── package.json                     # 프로젝트 설정
└── .env                            # 환경 변수

```

**📁 상세 폴더 구조는 [FOLDER_STRUCTURE.md](FOLDER_STRUCTURE.md)를 참조하세요.**

## 기술 스택

- **Backend**: Node.js, Express
- **APIs**: MiniMax TTS API, OpenAI Whisper API
- **Frontend**: HTML, CSS, Vanilla JavaScript

## 주의사항

- MiniMax API와 OpenAI API 키가 필요합니다
- 생성된 파일은 `outputs/` 폴더에 저장됩니다
- 한국어 TTS와 자막 생성에 최적화되어 있습니다

## 라이선스

ISC
