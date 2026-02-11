# 쇼츠공장 폴더 구조

이 문서는 각 기능별로 사용되는 폴더 구조를 설명합니다.

## 📁 전체 폴더 구조

```
shorts-factory-main/
├── public/                          # 프론트엔드 파일
│   ├── images/
│   │   ├── templates/              # 썸네일 템플릿 이미지
│   │   └── video-sources/          # [업로드] AI 동영상 숏폼용 소스 이미지
│   ├── css/
│   ├── js/
│   └── *.html                      # 각 기능 페이지
├── Output/                          # 생성된 결과물
│   └── ai-videos/                  # [생성] AI 동영상 숏폼 결과
├── ranking-videos/                  # 랭킹 비디오 프로젝트 폴더
│   ├── Input/                      # [업로드] 랭킹 비디오 입력 파일
│   ├── Output/                     # [생성] 랭킹 비디오 결과
│   ├── Temp/                       # 임시 파일
│   └── Config/                     # 설정 파일
├── uploads/                         # 일반 업로드 파일
├── data/                            # 데이터 파일
├── temp/                            # 임시 파일
└── routes/                          # 백엔드 API 라우트
    ├── ai-video.js
    ├── ranking-video.js
    └── ...

```

## 🎬 기능별 폴더 사용

### 1. AI 동영상 숏폼 생성기 (`/ai-video`)
**파일**: `public/ai-video.html`, `routes/ai-video.js`

#### 업로드 (Input):
- **경로**: `public/images/video-sources/`
- **파일 형식**: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- **설명**: 사용자가 업로드하거나 드래그앤드롭으로 추가한 소스 이미지

#### 생성 (Output):
- **경로**: `Output/ai-videos/`
- **파일 형식**: `.mp4`
- **파일명 형식**: `{이미지명}_{카메라워크}_{타임스탬프}.mp4`
- **예시**: `food_image_zoom_out_1767234567890.mp4`

---

### 2. 랭킹 숏폼 생성기 (`/ranking-video`)
**파일**: `public/ranking-video.html`, `routes/ranking-video.js`

#### 업로드 (Input):
- **경로**: `ranking-videos/Input/`
- **파일 형식**: 이미지, 동영상, 음악 파일
- **설명**: 랭킹 비디오 생성에 필요한 미디어 파일

#### 생성 (Output):
- **경로**: `ranking-videos/Output/`
- **파일 형식**: `.mp4`
- **설명**: Python 스크립트로 생성된 랭킹 비디오

#### 기타:
- **설정**: `ranking-videos/Config/` - JSON 설정 파일
- **임시**: `ranking-videos/Temp/` - 처리 중 임시 파일

---

### 3. AI 숏폼 생성기 (`/ai-shorts`)
**파일**: `public/ai-shorts.html`

#### 업로드 (Input):
- **경로**: `uploads/` (추정)
- **설명**: 사용자가 업로드한 소스 미디어

#### 생성 (Output):
- **경로**: `data/` 또는 `Output/` (추정)
- **설명**: AI로 생성된 숏폼 비디오

---

### 4. AI 롱폼 생성기 (`/ai-longform`)
**파일**: `public/ai-longform.html`

#### 업로드 (Input):
- **경로**: `uploads/` (추정)
- **설명**: 사용자가 업로드한 소스 미디어

#### 생성 (Output):
- **경로**: `data/` 또는 `Output/` (추정)
- **설명**: AI로 생성된 롱폼 비디오

---

### 5. 썸네일 생성기 (`/thumbnail-maker`)
**파일**: `public/thumbnail-maker.html`

#### 업로드 (Input):
- **템플릿 이미지**: `public/images/templates/`
- **설명**: 썸네일 생성에 사용할 배경 이미지/템플릿

#### 생성 (Output):
- **경로**: 클라이언트 다운로드 (서버에 저장하지 않음)
- **파일 형식**: `.png`, `.jpg`
- **설명**: 브라우저에서 직접 생성하여 다운로드

---

## 📋 권장 사항

### 폴더 통일화
현재 각 기능마다 다른 폴더 구조를 사용하고 있습니다. 다음과 같이 통일하는 것을 권장합니다:

```
shorts-factory-main/
├── Input/                          # 모든 업로드 파일
│   ├── ai-video-sources/          # AI 동영상용 이미지
│   ├── ranking-media/             # 랭킹 비디오용 미디어
│   ├── ai-shorts-sources/         # AI 숏폼용 소스
│   └── ai-longform-sources/       # AI 롱폼용 소스
└── Output/                         # 모든 생성 파일
    ├── ai-videos/                 # AI 동영상 결과
    ├── ranking-videos/            # 랭킹 비디오 결과
    ├── ai-shorts/                 # AI 숏폼 결과
    └── ai-longform/               # AI 롱폼 결과
```

### 현재 상태
- ✅ **AI 동영상 숏폼**: 잘 정리됨 (`public/images/video-sources/` → `Output/ai-videos/`)
- ✅ **랭킹 비디오**: 잘 정리됨 (`ranking-videos/Input/` → `ranking-videos/Output/`)
- ⚠️ **AI 숏폼**: 폴더 구조 확인 필요
- ⚠️ **AI 롱폼**: 폴더 구조 확인 필요
- ✅ **썸네일**: 클라이언트 사이드 처리

---

## 🔧 환경 변수

`.env` 파일에서 관리되는 설정:
- `AI_302_API_KEY`: 302.AI API 키
- `SEEDANCE_API_KEY`: BytePlus Seedance API 키
- `PORT`: 서버 포트 (기본: 4567)

---

**마지막 업데이트**: 2026-01-01
