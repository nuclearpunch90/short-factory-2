document.addEventListener('DOMContentLoaded', () => {
    // 배치 작업 요소들
    const batchGenerateBtn = document.getElementById('generateAllBtn');
    const batchBtnText = document.getElementById('generateBtnText');
    const batchLoading = document.getElementById('generateLoading');
    const batchGrid = document.getElementById('batchGrid');
    const batchResults = document.getElementById('batchResults');
    const batchResultsGrid = document.getElementById('batchResultsGrid');
    const status = document.getElementById('batchStatus');
    const statusMessages = document.getElementById('batchStatusMessages');

    // 헤더 상태 요소
    const headerStatusText = document.getElementById('headerStatusText');
    const headerStatus = document.getElementById('headerStatus');
    const statusDot = headerStatus?.querySelector('.status-dot');

    let batchData = [];
    let batchImages = {}; // 배치 이미지 저장
    let availableMusic = []; // 사용 가능한 음악 파일들
    let availableTemplates = []; // 사용 가능한 템플릿 파일들
    let availableOutros = []; // 사용 가능한 outro 영상들
    let availableFolders = []; // 사용 가능한 입력 폴더들

    // 로딩 상태 추적
    let loadingStatus = { folders: false, music: false, templates: false, outros: false };

    // API 키 설정 여부 체크
    async function checkApiKeyConfigured() {
        try {
            console.log('[API 키 체크] /api/settings/keys 요청 시작');
            const response = await authFetch('/api/settings/keys');
            const data = await response.json();
            console.log('[API 키 체크] 응답 데이터:', data);

            const hasGemini = data.success && data.keys?.GEMINI_API_KEY;
            const hasOpenAI = data.success && data.keys?.OPENAI_API_KEY;

            console.log('[API 키 체크] Gemini 키 있음?', hasGemini);
            console.log('[API 키 체크] OpenAI 키 있음?', hasOpenAI);

            // 리믹스 쇼츠는 Gemini만 필요 (STT용)
            const result = !!hasGemini;
            console.log('[API 키 체크] 최종 결과 (Gemini 기준):', result);
            return result;
        } catch (e) {
            console.error('[API 키 체크] 오류 발생:', e);
            return false;
        }
    }

    // API 키 미설정 시 안내 팝업
    function showApiKeyRequiredPopup() {
        const existingPopup = document.getElementById('apiKeyRequiredPopup');
        if (existingPopup) existingPopup.remove();

        const popup = document.createElement('div');
        popup.id = 'apiKeyRequiredPopup';
        popup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        popup.innerHTML = `
            <div style="
                background: var(--color-bg-secondary, #fff);
                border-radius: 16px;
                padding: 2rem;
                max-width: 400px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            ">
                <div style="font-size: 3rem; margin-bottom: 1rem;">🔑</div>
                <h3 style="color: var(--color-gray-900, #333); margin-bottom: 0.75rem; font-size: 1.25rem;">Gemini API 키가 필요해요!</h3>
                <p style="color: var(--color-gray-600, #666); font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.5rem;">
                    리믹스 쇼츠 영상을 생성하려면 <strong>Gemini API 키</strong>가 필요해요.<br>
                    오른쪽 위 설정 버튼(⚙️)을 눌러 Gemini API 키를 입력해주세요!
                </p>
                <div style="display: flex; gap: 0.75rem; justify-content: center;">
                    <button onclick="this.closest('#apiKeyRequiredPopup').remove()" style="
                        padding: 0.75rem 1.5rem;
                        border: 1px solid var(--color-gray-300, #ddd);
                        background: transparent;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.9rem;
                        color: var(--color-gray-600, #666);
                    ">닫기</button>
                    <button onclick="this.closest('#apiKeyRequiredPopup').remove(); openSettingsModal();" style="
                        padding: 0.75rem 1.5rem;
                        background: var(--color-primary, #3b82f6);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.9rem;
                        font-weight: 600;
                    ">설정 열기</button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);
        popup.addEventListener('click', (e) => {
            if (e.target === popup) popup.remove();
        });
    }

    function updateHeaderStatus() {
        if (!headerStatusText || !statusDot) return;

        const loaded = Object.values(loadingStatus).filter(v => v).length;
        const total = Object.keys(loadingStatus).length;

        if (loaded === total) {
            statusDot.className = 'status-dot ready';
            const counts = [
                availableFolders.length > 0 ? `영상${availableFolders.length}` : null,
                availableMusic.length > 0 ? `음악${availableMusic.length}` : null,
                availableTemplates.length > 0 ? `배경${availableTemplates.length}` : null,
                availableOutros.length > 0 ? `엔딩${availableOutros.length}` : null
            ].filter(Boolean).join(' · ');
            headerStatusText.textContent = counts ? `준비완료 · ${counts}` : '준비완료';
        } else {
            statusDot.className = 'status-dot loading';
            headerStatusText.textContent = `불러오는 중...`;
        }
    }

    // 배치 아이템 생성 (6개)
    function createBatchItems(count = 6) {
        batchGrid.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const item = document.createElement('div');
            item.className = 'batch-item';
            item.dataset.index = i;
            item.innerHTML = `
                <div class="batch-item-header">
                    <h4>작업 ${i + 1} <span class="status-indicator pending">대기</span></h4>
                    <div style="display: flex; gap: 0.5rem;">
                        ${i === 0 ? `<button type="button" onclick="applyFirstItemSettingsToAll()" style="padding: 2px 8px; font-size: 0.8rem; background: var(--color-bg-tertiary); border: 1px solid var(--color-gray-600); border-radius: 4px; color: var(--color-text-primary); cursor: pointer;">🔽 전체 적용</button>` : ''}
                        <button class="remove-batch-btn" onclick="removeBatchItem(${i})">&times;</button>
                    </div>
                </div>

                <label>대본 입력</label>
                <textarea class="batch-json" placeholder='{"script": "대본 내용...", "title": "제목", "description": "설명"}' required></textarea>

                <div class="json-preview" style="display: none; margin-top: 0.5rem; padding: 0.75rem; background: #000000; border: 1px solid #1a1a1a; border-radius: 4px; font-size: 0.8125rem;">
                    <div style="color: #888888; margin-bottom: 0.25rem;"><strong style="color: #ffffff;">제목:</strong> <span class="preview-title"></span></div>
                    <div style="color: #888888;"><strong style="color: #ffffff;">설명:</strong> <span class="preview-description"></span></div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-top: 0.75rem;">
                    <div>
                        <label>AI 목소리</label>
                        <select class="emotion-select">
                            <option value="random">Random</option>
                            <option value="Korean_SweetGirl">Korean_SweetGirl (달콤한 여성)</option>
                            <option value="Korean_CheerfulBoyfriend">Korean_CheerfulBoyfriend (쾌활한 남자친구)</option>
                            <option value="Korean_BraveYouth">Korean_BraveYouth (용감한 청년)</option>
                            <option value="Korean_CharmingElderSister">Korean_CharmingElderSister (매력적인 언니)</option>
                            <option value="Korean_OptimisticYouth">Korean_OptimisticYouth (낙천적인 청년)</option>
                            <option value="Korean_energetic_marketer_v1" selected>Korean_energetic_marketer_v1 (활기찬 마케터)</option>
                        </select>
                    </div>

                    <div>
                        <label>영상 소스</label>
                        <select class="folder-select"></select>
                    </div>

                    <div>
                        <label>배경음악</label>
                        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <select class="music-folder-select" style="flex: 1;" onchange="updateBatchMusicFiles(this)">
                                <option value="">폴더 선택...</option>
                                <option value="__ALL_RANDOM__" selected>🎲 전체 폴더 (랜덤)</option>
                            </select>
                        </div>
                        <select class="music-select">
                            <option value="__RANDOM__" selected>🎲 랜덤 선택</option>
                        </select>
                    </div>

                    <div>
                        <label>배경 화면</label>
                        <select class="template-select">
                            <option value="">없음</option>
                        </select>
                    </div>

                    <div>
                        <label>엔딩 영상</label>
                        <select class="outro-select">
                            <option value="">없음</option>
                        </select>
                    </div>

                    </div>
                </div>

                <button class="btn btn-block generate-single-btn" style="margin-top: 1rem;">
                    <span class="generate-single-text">생성하기</span>
                    <span class="loading generate-single-loading" style="display: none;"></span>
                </button>
            `;
            batchGrid.appendChild(item);
        }
    }

    // [New] 외부에서 배치 아이템 채우기
    window.populateBatchFromScripts = function (scripts) {
        if (!scripts || !Array.isArray(scripts) || scripts.length === 0) return;

        console.log('📋 배치 스크립트 추가:', scripts.length, '개');
        scripts.forEach((s, i) => {
            console.log(`  [${i + 1}] 우선순위: ${s.priority || '없음'}, 제목: ${s.title}`);
        });

        // 1. 필요한 개수만큼 생성
        createBatchItems(scripts.length);

        // 2. 데이터 채우기
        const items = batchGrid.querySelectorAll('.batch-item');
        scripts.forEach((data, i) => {
            if (i >= items.length) return;
            const item = items[i];
            const textarea = item.querySelector('.batch-json');
            const header = item.querySelector('.batch-item-header h4');

            const jsonData = {
                script: data.script,
                title: data.title,
                description: data.description,
                priority: data.priority || 0  // 우선순위 태그 (1, 2, 3)
            };

            // 우선순위 배지 추가
            if (data.priority && data.priority > 0) {
                const priorityColors = {
                    1: '#FFD700',  // 금색
                    2: '#C0C0C0',  // 은색
                    3: '#CD7F32'   // 동색
                };
                const color = priorityColors[data.priority] || '#666';
                const priorityBadge = `<span style="background: ${color}; color: #000; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; margin-left: 8px; font-weight: 700;">우선순위 ${data.priority}</span>`;
                header.innerHTML = `작업 ${i + 1} ${priorityBadge} <span class="status-indicator pending">대기</span>`;
            }

            textarea.value = JSON.stringify(jsonData, null, 2);

            // Trigger input event for preview
            const event = new Event('input', { bubbles: true });
            textarea.dispatchEvent(event);
        });

        // 3. 드롭다운 다시 로드 (기존 캐시된 데이터 사용)
        loadInputFolders();
        loadMusicList();
        loadTemplateList();
        loadOutroList();

        // 4. 배치 섹션 표시 및 스크롤
        const content = document.getElementById('batchContent');
        const icon = document.getElementById('batchToggleIcon');
        if (content && content.style.display === 'none') {
            content.style.display = 'block';
            if (icon) icon.textContent = '▲ 접기';
        }

        const batchSection = document.getElementById('batchSection') || batchGrid;
        if (batchSection) batchSection.scrollIntoView({ behavior: 'smooth' });
    };

    // 페이지 로드 시 배치 아이템 생성
    createBatchItems();

    // JSON 입력 시 title과 description 미리보기
    batchGrid.addEventListener('input', (e) => {
        if (e.target.classList.contains('batch-json')) {
            const textarea = e.target;
            const item = textarea.closest('.batch-item');
            const preview = item.querySelector('.json-preview');
            const previewTitle = item.querySelector('.preview-title');
            const previewDescription = item.querySelector('.preview-description');

            try {
                const jsonData = JSON.parse(textarea.value);
                if (jsonData.title || jsonData.description) {
                    previewTitle.textContent = jsonData.title || '(없음)';
                    previewDescription.textContent = jsonData.description || '(없음)';
                    preview.style.display = 'block';
                } else {
                    preview.style.display = 'none';
                }
            } catch (e) {
                // JSON 파싱 실패 시 미리보기 숨김
                preview.style.display = 'none';
            }
        }
    });

    // 배치 아이템 생성 후 데이터 로드
    loadInputFolders();
    loadMusicList();
    loadTemplateList();
    loadOutroList();

    // 영상 파일 목록 로드 (페이지 로드 시 자동)
    setTimeout(() => {
        if (window.updateVideoFileList) {
            window.updateVideoFileList();
        }
    }, 500);

    // 입력 폴더 목록 로드
    async function loadInputFolders() {
        try {
            const response = await authFetch('/api/inputs/folders');
            const data = await response.json();
            if (data.success) {
                availableFolders = data.folders;
                // 전역 선택 드롭다운 업데이트
                const globalSelect = document.getElementById('inputFolderSelect');
                if (globalSelect) {
                    globalSelect.innerHTML = '';
                    data.folders.forEach(folder => {
                        const option = document.createElement('option');
                        option.value = folder;
                        option.textContent = folder.charAt(0).toUpperCase() + folder.slice(1);
                        globalSelect.appendChild(option);
                    });
                }

                // 개별 폴더 선택 드롭다운 업데이트
                const folderSelects = document.querySelectorAll('.folder-select');
                folderSelects.forEach(select => {
                    // Skip hidden inputs (handled by modal)
                    if (select.type === 'hidden') {
                        // ... logic for hidden inputs ...
                        return;
                    }

                    const currentValue = select.value;
                    select.innerHTML = '';

                    let defaultSelected = false;

                    data.folders.forEach(folder => {
                        const option = document.createElement('option');
                        option.value = folder;
                        option.textContent = folder.charAt(0).toUpperCase() + folder.slice(1);

                        // Default to ai-videos if no current value or strictly ai-videos
                        if (folder === 'ai-videos' && (!currentValue || select.id === 'singleFolder')) {
                            option.selected = true;
                            defaultSelected = true;
                        } else if (folder === currentValue) {
                            option.selected = true;
                            defaultSelected = true;
                        }

                        select.appendChild(option);
                    });

                    // Trigger video list update on page load
                    if (select.id === 'singleFolder' && defaultSelected) {
                        setTimeout(() => {
                            if (window.updateVideoFileList) {
                                try { window.updateVideoFileList(); } catch (e) { }
                            }
                        }, 100);
                    }
                });

                loadingStatus.folders = true;
                updateHeaderStatus();
                updateHeaderStatus();
            } else {
                console.error('영상 소스 로드 실패');
            }
        } catch (error) {
            console.error('영상 소스 목록 로드 실패:', error);
        }
    }

    // 음성 모드 토글 (window scope)
    window.toggleVoiceMode = function (mode) {
        const fileSection = document.getElementById('voiceFileSection');
        const countSection = document.getElementById('singleVideoCount').parentElement;
        // emotion section works differently now, it's inside ttsEmotionSection
        // We will just toggle visibility of fileSection vs standard single generator parts if needed

        if (mode === 'file') {
            fileSection.style.display = 'block';
            countSection.style.display = 'none'; // 파일 개수만큼 자동 생성되므로 개수 입력 숨김
        } else {
            fileSection.style.display = 'none';
            countSection.style.display = 'block';
        }
    };

    // toggleVideoMode removed - video list is always visible

    // 전체 선택/해제 토글
    window.toggleAllCheckboxes = function (containerId, isChecked) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = isChecked);
    };

    // 영상 파일 목록 업데이트 (체크박스 생성)
    window.updateVideoFileList = async function () {
        const folderName = document.getElementById('singleFolder').value;
        // 이제 select가 아니라 div 컨테이너를 타겟팅
        const videoList = document.getElementById('videoFileList');

        if (!folderName) {
            videoList.innerHTML = '<div class="empty-message" style="color: var(--color-gray-500); text-align: center; padding: 1rem;">폴더를 먼저 선택해주세요</div>';
            return;
        }

        try {
            videoList.innerHTML = '<div class="empty-message" style="color: var(--color-gray-500); text-align: center; padding: 1rem;">로딩 중...</div>';
            const response = await authFetch(`/api/inputs/files?folder=${encodeURIComponent(folderName)}`);
            const data = await response.json();

            videoList.innerHTML = '';

            if (data.success && data.files.length > 0) {
                data.files.forEach(file => {
                    const div = document.createElement('div');
                    div.style.padding = '0.25rem 0';
                    div.style.display = 'flex';
                    div.style.alignItems = 'center';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.value = file;
                    checkbox.id = 'video_' + file.replace(/[\s\.]/g, '_'); // safe id
                    checkbox.style.marginRight = '0.5rem';

                    const label = document.createElement('label');
                    label.htmlFor = checkbox.id;
                    label.textContent = file;
                    label.style.fontSize = '0.85rem';
                    label.style.cursor = 'pointer';
                    label.style.wordBreak = 'break-all';

                    div.appendChild(checkbox);
                    div.appendChild(label);
                    videoList.appendChild(div);
                });
            } else {
                videoList.innerHTML = `
                    <div class="empty-message" style="color: var(--color-gray-500); text-align: center; padding: 1rem;">
                        <div style="margin-bottom: 0.5rem;">📂</div>
                        <div>비디오 파일이 없습니다.</div>
                        <div style="font-size: 0.7rem; margin-top: 0.5rem; color: var(--color-gray-400);">
                            AI 동영상 숏폼 생성기에서<br>
                            영상을 드래그 앤 드롭으로 업로드하세요
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('비디오 파일 목록 로드 실패:', error);
            videoList.innerHTML = '<div class="empty-message" style="color: var(--color-error); text-align: center; padding: 1rem;">비디오 파일 목록 로드 실패</div>';
        }
    };

    // 영상 파일 목록 새로고침 버튼 핸들러
    window.refreshVideoFiles = async function (btn) {
        if (btn) {
            btn.style.transition = 'transform 0.5s';
            btn.style.transform = 'rotate(360deg)';
            setTimeout(() => btn.style.transform = 'none', 500);
        }
        await window.updateVideoFileList();
    };

    // 오디오 파일 목록 새로고침 버튼 핸들러
    window.refreshVoiceFiles = async function (btn) {
        if (btn) {
            btn.style.transition = 'transform 0.5s';
            btn.style.transform = 'rotate(360deg)';
            setTimeout(() => btn.style.transform = 'none', 500);
        }
        await loadMusicList(); // loadMusicList가 오디오 파일 목록도 업데이트함
    };

    // 음악 폴더 및 파일 목록 관리
    window.updateBatchMusicFiles = async function (folderSelect) {
        const batchItem = folderSelect.closest('.batch-item');
        const fileSelect = batchItem.querySelector('.music-select');
        const folderName = folderSelect.value;

        // 전체 폴더 랜덤 선택 시
        if (folderName === '__ALL_RANDOM__') {
            fileSelect.innerHTML = '<option value="__RANDOM__" selected>🎲 랜덤 선택</option>';
            return;
        }

        fileSelect.innerHTML = '<option value="">로딩 중...</option>';

        if (!folderName) {
            fileSelect.innerHTML = '<option value="">폴더를 먼저 선택하세요</option><option value="__RANDOM__">🎲 랜덤 선택</option>';
            return;
        }

        try {
            const response = await authFetch(`/api/music/files?folder=${encodeURIComponent(folderName)}`);
            const data = await response.json();

            fileSelect.innerHTML = '<option value="">음악 선택...</option>';

            if (data.success && data.files.length > 0) {
                // 랜덤 옵션 추가
                const randomOption = document.createElement('option');
                randomOption.value = "__RANDOM__";
                randomOption.textContent = "🎲 랜덤 선택";
                fileSelect.appendChild(randomOption);

                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file;
                    option.textContent = file.replace(/\.[^/.]+$/, '');
                    fileSelect.appendChild(option);
                });
            } else {
                fileSelect.innerHTML = '<option value="">파일 없음</option>';
            }
        } catch (error) {
            console.error('음악 파일 로드 실패:', error);
            fileSelect.innerHTML = '<option value="">로드 실패</option>';
        }
    };

    // 음악 폴더 목록 로드
    async function loadMusicList() {
        try {
            const response = await authFetch('/api/music/folders');
            const data = await response.json();
            if (data.success) {
                const folders = data.folders;

                // 배치 아이템의 폴더 선택 업데이트
                const folderSelects = document.querySelectorAll('.music-folder-select');
                folderSelects.forEach(select => {
                    const currentVal = select.value;
                    select.innerHTML = '<option value="">폴더 선택...</option>';
                    // 전체 폴더 랜덤 옵션 추가
                    const randomAllOption = document.createElement('option');
                    randomAllOption.value = '__ALL_RANDOM__';
                    randomAllOption.textContent = '🎲 전체 폴더 (랜덤)';
                    if ('__ALL_RANDOM__' === currentVal) randomAllOption.selected = true;
                    select.appendChild(randomAllOption);
                    // 폴더 목록 추가
                    folders.forEach(folder => {
                        const option = document.createElement('option');
                        option.value = folder;
                        option.textContent = folder;
                        if (folder === currentVal) option.selected = true;
                        select.appendChild(option);
                    });
                });

                // (Optional) Initialize global/single folder lists if needed, 
                // but Single Generator uses Modal, handled separately.

                loadingStatus.music = true;
                updateHeaderStatus();
            } else {
                console.error('배경음악 폴더 로드 실패');
            }
        } catch (error) {
            console.error('음악 목록 로드 실패:', error);
        }
    }

    // ... (rest of music update logic) ...

    // ...

    // 단일 생성 이벤트
    const singleGenerateBtn = document.getElementById('singleGenerateBtn');
    if (singleGenerateBtn) {
        singleGenerateBtn.addEventListener('click', async () => {
            console.log('=== [단일 생성 버튼] 클릭됨 ===');

            // API 키 체크 제거 (수동 입력/파일 모드이므로 Gemini 키 불필요)
            console.log('[단일 생성] API 키 체크 건너뜀');

            const jsonText = document.getElementById('singleJson').value.trim();
            const emotion = document.getElementById('singleEmotion').value;
            const folder = document.getElementById('singleFolder').value;
            const music = document.getElementById('singleMusic').value;
            const musicFolderInput = document.getElementById('singleMusicFolder');
            const musicFolder = musicFolderInput ? musicFolderInput.value : '';
            const template = document.getElementById('singleTemplate').value;
            const outro = document.getElementById('singleOutro').value;
            const includeTitle = document.getElementById('singleIncludeTitle').checked;

            // Check Voice Mode
            const voiceMode = document.querySelector('input[name="voiceMode"]:checked')?.value || 'tts';

            // Collect Selected Video Files (optional - if none selected, will use random)
            // Collect Selected Video Files (checkboxes)
            const videoList = document.getElementById('videoFileList');
            let selectedVideoFiles = [];
            if (videoList) {
                const checkedBoxes = videoList.querySelectorAll('input[type="checkbox"]:checked');
                selectedVideoFiles = Array.from(checkedBoxes).map(cb => cb.value);
            }

            // Parse JSON/Text Input
            let jsonData;
            try {
                // 1. Try JSON parsing first
                jsonData = JSON.parse(jsonText);
            } catch (e) {
                // 2. Fallback to Plain Text Parsing
                console.log('JSON parsing failed, trying plain text parsing...');

                // Regex patterns to capture content
                // Support both Korean (제목, 대본, 설명) and English (Title, Script, Description)
                // Use [\s\S]*? for non-greedy match across lines
                const titleMatch = jsonText.match(/(?:제목|Title)\s*:\s*(.*?)(?:\n|$)/i);
                const descMatch = jsonText.match(/(?:설명|Description)\s*:\s*(.*?)(?:\n|$)/i);

                // Script usually comes last or takes up the bulk. We'll try to find "Script:" and take everything after it, 
                // OR if "Script:" is not explicitly there but we have Title, treat the rest as script.
                // Let's stick to explicit keys first for safety.
                const scriptMatch = jsonText.match(/(?:대본|Script)\s*:\s*([\s\S]+)/i);

                if (titleMatch || scriptMatch) {
                    jsonData = {
                        title: titleMatch ? titleMatch[1].trim() : "제목 없음",
                        script: scriptMatch ? scriptMatch[1].trim() : "",
                        description: descMatch ? descMatch[1].trim() : "#Shorts #AI"
                    };

                    // Cleanup script if it captured other keys (simple heuristic)
                    if (jsonData.script) {
                        jsonData.script = jsonData.script
                            .replace(/(?:제목|Title)\s*:.*$/gim, '')
                            .replace(/(?:설명|Description)\s*:.*$/gim, '')
                            .trim();
                    }

                } else {
                    // Both JSON and Plain Text failed
                    alert('유효하지 않은 형식입니다.\nJSON 또는 "제목: ... 대본: ..." 형식으로 입력해주세요.');
                    return;
                }
            }

            if (!jsonData.script || !jsonData.title) {
                // Description is optional
                alert('필수 내용이 부족합니다. (제목, 대본은 필수입니다)');
                return;
            }

            const btnText = document.getElementById('singleGenerateBtnText');
            const loading = document.getElementById('singleGenerateLoading');

            singleGenerateBtn.disabled = true;
            btnText.style.display = 'none';
            loading.style.display = 'inline-block';

            try {
                addStatusMessage(`🎬 "${jsonData.title}" 생성 시작...`, 'info');

                if (voiceMode === 'file') {
                    // Voiceover File Mode
                    // Re-collect selected files here or use the ones from earlier? 
                    // Better to re-collect to be safe or rely on what we validated.
                    // Let's use the checkboxes again to be sure.
                    const voiceList = document.getElementById('voiceFileList');
                    const checkedBoxes = voiceList ? voiceList.querySelectorAll('input[type="checkbox"]:checked') : [];
                    const selectedFiles = Array.from(checkedBoxes).map(cb => cb.value);

                    if (selectedFiles.length === 0) {
                        throw new Error('오디오 파일을 선택해주세요.');
                    }

                    let successCount = 0;

                    for (let i = 0; i < selectedFiles.length; i++) {
                        const audioFilename = selectedFiles[i];
                        const videoIndex = i + 1;

                        addStatusMessage(`🎥 [파일모드] 영상 ${videoIndex}/${selectedFiles.length} 생성 중 (${audioFilename})...`, 'info');

                        const response = await authFetch('/api/shorts/generate-video-from-file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                audioFilename,
                                jsonData,
                                backgroundMusic: music,
                                musicFolder: musicFolder,
                                inputFolder: folder,
                                template,
                                outro,
                                videoIndex,
                                includeAds: false,
                                includeTitle,
                                selectedVideoFiles, // Pass manual video selection
                                videoFilter: document.getElementById('singleVideoFilter') && document.getElementById('singleVideoFilter').checked ? 'western' : 'none'
                            })
                        });

                        if (!response.ok) {
                            const errData = await response.json();
                            throw new Error(errData.error || `영상 ${videoIndex} 생성 실패`);
                        }

                        addStatusMessage(`✅ 영상 ${videoIndex}/${selectedFiles.length} 완료`, 'success');
                        successCount++;
                    }
                    addStatusMessage(`🎉 "${jsonData.title}" 총 ${successCount}개 영상 생성 완료 (파일 모드)!`, 'success');

                } else {
                    // Traditional TTS Mode

                    // TTS 생성
                    addStatusMessage(`🎤 TTS 생성 중...`, 'info');
                    const ttsResponse = await authFetch('/api/shorts/generate-tts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jsonData, emotion })
                    });

                    if (!ttsResponse.ok) {
                        throw new Error('TTS 생성 실패');
                    }

                    const ttsData = await ttsResponse.json();
                    addStatusMessage(`✅ TTS 생성 완료`, 'success');

                    // 비디오 생성
                    // Video count is determined by explicit count
                    const count = parseInt(document.getElementById('singleVideoCount').value) || 1;
                    // Basic logic: if manual videos selected, do we make 1 video using those clips? Yes.
                    // Video Count input is handling "How many variations to make".
                    // If Manual Video Mode: We likely use the selected clips for the single video generation.
                    // If multiple videos requested, we reuse the same selected clips for all? Yes.

                    const videoCount = parseInt(document.getElementById('singleVideoCount').value) || 1;

                    for (let i = 0; i < videoCount; i++) {
                        addStatusMessage(`🎥 영상 ${i + 1}/${videoCount} 생성 중...`, 'info');

                        const videoResponse = await authFetch('/api/shorts/generate-video-only', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                ttsData,
                                jsonData,
                                backgroundMusic: music,
                                musicFolder: musicFolder,
                                inputFolder: folder,
                                template,
                                outro,
                                videoIndex: i + 1,
                                includeTitle,
                                selectedVideoFiles, // Pass manual video selection
                                videoFilter: document.getElementById('singleVideoFilter') && document.getElementById('singleVideoFilter').checked ? 'western' : 'none'
                            })
                        });

                        if (!videoResponse.ok) {
                            throw new Error(`영상 ${i + 1} 생성 실패`);
                        }

                        const videoData = await videoResponse.json();
                        addStatusMessage(`✅ 영상 ${i + 1}/${videoCount} 완료`, 'success');
                    }

                    addStatusMessage(`🎉 "${jsonData.title}" 총 ${videoCount}개 영상 생성 완료!`, 'success');
                }

                // Show Open Folder Button
                const openFolderBtn = document.getElementById('singleOpenFolderBtn');
                if (openFolderBtn) {
                    openFolderBtn.style.display = 'block';
                }

            } catch (error) {
                console.error('생성 오류:', error);
                addStatusMessage(`❌ 생성 실패: ${error.message}`, 'error');
            } finally {
                singleGenerateBtn.disabled = false;
                btnText.style.display = 'inline';
                loading.style.display = 'none';
            }
        });
    }

    // 결과 폴더 열기
    window.openResultFolder = async function () {
        try {
            const response = await authFetch('/api/settings/open-folder', {
                method: 'POST'
            });
            const data = await response.json();
            if (!data.success) {
                alert('폴더 열기 실패: ' + data.error);
            }
        } catch (error) {
            console.error('폴더 열기 오류:', error);
            alert('폴더 열기 중 오류가 발생했습니다.');
        }
    };

    // 모든 음악 선택 드롭다운 업데이트
    function updateMusicSelectors() {
        const musicSelects = document.querySelectorAll('.music-select');
        musicSelects.forEach(select => {
            // Skip hidden inputs (handled by modal)
            if (select.type === 'hidden') {
                // Set default value if not already set
                if (!select.value && availableMusic.length > 0 && availableMusic.includes('1.mp3')) {
                    select.value = '1.mp3';
                    // Update button text if this is singleMusic
                    if (select.id === 'singleMusic') {
                        const btnText = document.getElementById('musicSelectText');
                        if (btnText) {
                            btnText.textContent = '1';
                        }
                    }
                }
                return;
            }
            // 기존 옵션 제거 (첫 번째 옵션 제외)
            while (select.children.length > 1) {
                select.removeChild(select.lastChild);
            }

            // 음악 파일 옵션 추가
            availableMusic.forEach(musicFile => {
                const option = document.createElement('option');
                option.value = musicFile;
                option.textContent = musicFile;
                // 1.mp3를 기본값으로 설정
                if (musicFile === '1.mp3') {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            // 글로벌 음악 선택기의 경우 1.mp3를 기본값으로
            if (select.id === 'globalMusicSelect') {
                select.value = '1.mp3';
            }
        });
    }

    // 템플릿 파일 목록 로드
    async function loadTemplateList() {
        try {
            const response = await authFetch('/api/templates');
            const data = await response.json();
            if (data.success) {
                availableTemplates = data.templates;
                updateTemplateSelector();
                loadingStatus.templates = true;
                updateHeaderStatus();
            } else {
                console.error('배경 화면 로드 실패');
            }
        } catch (error) {
            console.error('배경 화면 목록 로드 실패:', error);
        }
    }

    // 템플릿 선택 드롭다운 업데이트
    function updateTemplateSelector() {
        // 전역 템플릿 선택 업데이트
        const globalTemplateSelect = document.getElementById('globalTemplateSelect');
        if (globalTemplateSelect) {
            globalTemplateSelect.innerHTML = '<option value="">템플릿 선택...</option>';

            availableTemplates.forEach(template => {
                const option = document.createElement('option');
                option.value = template;
                option.textContent = template;
                // 2.png를 기본값으로 설정
                if (template === '2.png') {
                    option.selected = true;
                }
                globalTemplateSelect.appendChild(option);
            });

            // 템플릿이 하나뿐이면 자동 선택
            if (availableTemplates.length === 1) {
                globalTemplateSelect.value = availableTemplates[0];
            }
        }

        // 개별 템플릿 선택 드롭다운 업데이트
        const templateSelects = document.querySelectorAll('.template-select');
        templateSelects.forEach(select => {
            select.innerHTML = '<option value="">선택사항</option>';

            availableTemplates.forEach(template => {
                const option = document.createElement('option');
                option.value = template;
                option.textContent = template;
                // 2.png를 기본값으로 설정
                if (template === '2.png') {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        });
    }

    // Outro 영상 목록 로드
    async function loadOutroList() {
        try {
            const response = await authFetch('/api/outros');
            const data = await response.json();
            if (data.success) {
                availableOutros = data.outros;
                updateOutroSelectors();
                loadingStatus.outros = true;
                updateHeaderStatus();
            } else {
                console.error('엔딩 영상 로드 실패');
            }
        } catch (error) {
            console.error('엔딩 영상 목록 로드 실패:', error);
        }
    }

    // 모든 outro 선택 드롭다운 업데이트
    function updateOutroSelectors() {
        // 전역 outro 선택 업데이트
        const globalOutroSelect = document.getElementById('globalOutroSelect');
        if (globalOutroSelect) {
            globalOutroSelect.innerHTML = '<option value="">Outro 선택 (선택사항)</option>';

            availableOutros.forEach(outro => {
                const option = document.createElement('option');
                option.value = outro;
                option.textContent = outro;
                globalOutroSelect.appendChild(option);
            });
        }

        // 개별 outro 선택 드롭다운 업데이트
        const outroSelects = document.querySelectorAll('.outro-select');
        outroSelects.forEach(select => {
            // Skip hidden inputs (handled by modal)
            if (select.type === 'hidden') {
                return;
            }
            select.innerHTML = '<option value="">선택사항</option>';

            availableOutros.forEach(outro => {
                const option = document.createElement('option');
                option.value = outro;
                option.textContent = outro;
                select.appendChild(option);
            });
        });
    }

    // 페이지 로드시 음악 목록, 템플릿, outro 및 입력 폴더 로드 (이미 위에서 호출됨 - 중복 제거)

    // 드래그 앤 드롭 기능 초기화
    initDragAndDrop();

    // 드래그 앤 드롭 기능 구현
    function initDragAndDrop() {
        const dropZones = document.querySelectorAll('.image-drop-zone');

        dropZones.forEach((dropZone, index) => {
            // 인덱스 설정 (HTML에서 설정되지 않은 경우)
            if (!dropZone.dataset.index) {
                dropZone.dataset.index = index.toString();
            }

            const fileInput = dropZone.querySelector('.batch-image');
            const dropContent = dropZone.querySelector('.drop-content');

            // 클릭으로 파일 선택
            dropZone.addEventListener('click', () => {
                fileInput.click();
            });

            // 드래그 오버
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('dragover');
            });

            // 드래그 떠남
            dropZone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!dropZone.contains(e.relatedTarget)) {
                    dropZone.classList.remove('dragover');
                }
            });

            // 드롭
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('dragover');

                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    const file = files[0];
                    if (file.type.startsWith('image/')) {
                        handleImageFile(file, index);
                    } else {
                        alert('이미지 파일만 업로드 가능합니다.');
                    }
                }
            });

            // 파일 입력 변경
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    handleImageFile(e.target.files[0], index);
                }
            });
        });
    }

    // 이미지 파일 처리 함수
    function handleImageFile(file, index) {
        const dropZone = document.querySelector(`[data-index="${index}"] .image-drop-zone`);
        const dropContent = dropZone.querySelector('.drop-content');

        // 파일 저장
        batchImages[index] = file;

        // 미리보기 생성
        const reader = new FileReader();
        reader.onload = (e) => {
            dropZone.classList.add('has-image');
            dropContent.innerHTML = `
                <div class="image-preview-container">
                    <img src="${e.target.result}" class="preview-image-small" alt="미리보기">
                    <div>
                        <div class="drop-zone-text">✅ ${file.name}</div>
                        <div class="drop-zone-subtext">클릭해서 변경하기</div>
                        <button class="remove-image-btn" onclick="removeImage(${index})" style="background: #ff4444; color: white; border: none; border-radius: 3px; padding: 2px 6px; font-size: 0.7em; margin-top: 2px; cursor: pointer;">제거</button>
                    </div>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    }

    // 이미지 제거 함수 (전역 함수로 선언)
    window.removeImage = function (index) {
        const dropZone = document.querySelector(`[data-index="${index}"] .image-drop-zone`);
        const dropContent = dropZone.querySelector('.drop-content');
        const fileInput = dropZone.querySelector('.batch-image');

        // 파일 제거
        delete batchImages[index];
        fileInput.value = '';

        // 원래 상태로 복원
        dropZone.classList.remove('has-image');
        dropContent.innerHTML = `
            <div class="drop-zone-text">📷 이미지를 드래그하거나 클릭</div>
            <div class="drop-zone-subtext">JPG, PNG, GIF 지원</div>
        `;
    };

    // 전체 배경음악 일괄 적용 버튼 이벤트 (legacy - 새 디자인에서는 사용 안 함)
    const applyGlobalFolderBtn = document.getElementById('applyGlobalFolderBtn');
    if (applyGlobalFolderBtn) {
        applyGlobalFolderBtn.addEventListener('click', () => {
            const globalFolder = document.getElementById('inputFolderSelect').value;
            const folderSelects = document.querySelectorAll('.folder-select');

            folderSelects.forEach(select => {
                select.value = globalFolder;
            });

            if (globalFolder) {
                addStatusMessage(`모든 작업에 "${globalFolder}" 영상 소스 폴더가 적용되었습니다.`, 'success');
            }
        });
    }

    // 전역 음악 일괄 적용 (legacy)
    const applyGlobalMusicBtn = document.getElementById('applyGlobalMusicBtn');
    if (applyGlobalMusicBtn) {
        applyGlobalMusicBtn.addEventListener('click', () => {
            const globalMusic = document.getElementById('globalMusicSelect').value;
            const batchMusicSelects = document.querySelectorAll('.batch-music');

            batchMusicSelects.forEach(select => {
                select.value = globalMusic;
            });

            if (globalMusic) {
                addStatusMessage(`모든 작업에 "${globalMusic}" 배경음악이 적용되었습니다.`, 'success');
            } else {
                addStatusMessage('모든 작업에서 배경음악이 제거되었습니다.', 'info');
            }
        });
    }

    // 전역 템플릿 일괄 적용 (legacy)
    const applyGlobalTemplateBtn = document.getElementById('applyGlobalTemplateBtn');
    if (applyGlobalTemplateBtn) {
        applyGlobalTemplateBtn.addEventListener('click', () => {
            const globalTemplate = document.getElementById('globalTemplateSelect').value;
            const templateSelects = document.querySelectorAll('.template-select');

            templateSelects.forEach(select => {
                select.value = globalTemplate;
            });

            if (globalTemplate) {
                addStatusMessage(`모든 작업에 "${globalTemplate}" 배경 화면이 적용되었습니다.`, 'success');
            } else {
                addStatusMessage('배경 화면을 선택해주세요.', 'warning');
            }
        });
    }

    // 전역 Outro 일괄 적용 (legacy)
    const applyGlobalOutroBtn = document.getElementById('applyGlobalOutroBtn');
    if (applyGlobalOutroBtn) {
        applyGlobalOutroBtn.addEventListener('click', () => {
            const globalOutro = document.getElementById('globalOutroSelect').value;
            const outroSelects = document.querySelectorAll('.outro-select');

            outroSelects.forEach(select => {
                select.value = globalOutro;
            });

            if (globalOutro) {
                addStatusMessage(`모든 작업에 "${globalOutro}" 엔딩 영상이 적용되었습니다.`, 'success');
            } else {
                addStatusMessage('엔딩 영상이 제거되었습니다.', 'success');
            }
        });
    }

    // 전역 광고 설정 일괄 적용 (legacy)
    const applyGlobalAdsBtn = document.getElementById('applyGlobalAdsBtn');
    if (applyGlobalAdsBtn) {
        applyGlobalAdsBtn.addEventListener('click', () => {
            const globalIncludeAds = document.getElementById('globalIncludeAds').checked;
            const adsCheckboxes = document.querySelectorAll('.include-ads-checkbox');

            adsCheckboxes.forEach(checkbox => {
                checkbox.checked = globalIncludeAds;
            });

            if (globalIncludeAds) {
                addStatusMessage('모든 작업에 광고 추가가 활성화되었습니다.', 'success');
            } else {
                addStatusMessage('모든 작업에 광고 추가가 비활성화되었습니다.', 'info');
            }
        });
    }

    function addStatusMessage(message, type) {
        // 토스트 알림으로 표시
        const toast = document.createElement('div');
        toast.className = `toast-message ${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 0.75rem 1.5rem;
            background: ${type === 'success' ? 'var(--color-success)' : type === 'error' ? 'var(--color-error)' : 'var(--color-primary)'};
            color: white;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            animation: toastIn 0.3s ease;
        `;
        document.body.appendChild(toast);

        // 3초 후 제거
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);

        // 콘솔에도 출력
        console.log(`[${type}] ${message}`);
    }



    // 배치 생성 이벤트
    batchGenerateBtn.addEventListener('click', async () => {
        console.log('=== [전체 생성 버튼] 클릭됨 ===');

        console.log('[전체 생성] API 키 체크 건너뜀 (대본 존재 시 불필요)');

        console.log('[전체 생성] API 키 확인됨 - 배치 생성 진행');

        const batchItems = collectBatchData();

        if (batchItems.length === 0) {
            alert('최소 하나 이상의 작업을 입력해주세요.');
            return;
        }

        await processBatchGeneration(batchItems);
    });

    // 개별 생성하기 버튼 이벤트 (이벤트 위임 사용)
    batchGrid.addEventListener('click', async (e) => {
        if (e.target.classList.contains('generate-single-btn') ||
            e.target.closest('.generate-single-btn')) {

            console.log('=== [개별 배치 생성 버튼] 클릭됨 ===');

            console.log('[개별 생성] API 키 체크 건너뜀');

            console.log('[개별 생성] API 키 확인됨 - 생성 진행');

            const button = e.target.classList.contains('generate-single-btn') ?
                e.target : e.target.closest('.generate-single-btn');
            const batchItem = button.closest('.batch-item');
            const index = parseInt(batchItem.dataset.index);

            const jsonText = batchItem.querySelector('.batch-json').value.trim();
            const emotion = batchItem.querySelector('.emotion-select').value;
            const folder = batchItem.querySelector('.folder-select').value;
            const music = batchItem.querySelector('.music-select').value;
            const template = batchItem.querySelector('.template-select').value;
            const outro = batchItem.querySelector('.outro-select').value;
            const videoCountInput = batchItem.querySelector('.video-count-input');
            const videoCount = videoCountInput ? videoCountInput.value : 1;
            const includeTitleCheck = batchItem.querySelector('.include-title-check');
            const includeTitle = includeTitleCheck ? includeTitleCheck.checked : true;

            if (!jsonText) {
                alert('대본을 입력해주세요.');
                return;
            }

            let jsonData;
            try {
                jsonData = JSON.parse(jsonText);
                if (!jsonData.script || !jsonData.title || !jsonData.description) {
                    throw new Error('필수 필드가 누락되었습니다.');
                }
            } catch (e) {
                alert('유효하지 않은 JSON 형식입니다: ' + e.message);
                return;
            }

            await processSingleItem(index, {
                jsonData,
                emotion,
                folder,
                music,
                template,
                outro,
                includeTitle,
                videoCount: parseInt(videoCount)
            });
        }
    });

    // 단일 항목 처리 함수
    async function processSingleItem(index, item) {
        const batchItem = document.querySelector(`.batch-item[data-index="${index}"]`);
        const button = batchItem.querySelector('.generate-single-btn');
        const btnText = button.querySelector('.generate-single-text');
        const loading = button.querySelector('.generate-single-loading');

        // 버튼 상태 변경
        button.disabled = true;
        btnText.style.display = 'none';
        loading.style.display = 'inline-block';

        try {
            addStatusMessage(`작업 ${index + 1} 시작: ${item.jsonData.title}`, 'info');

            // 배치 처리와 동일한 로직 사용
            await processBatchGeneration([{ index, ...item, status: 'pending' }]);

            addStatusMessage(`작업 ${index + 1} 완료!`, 'success');
        } catch (error) {
            console.error(`작업 ${index + 1} 실패:`, error);
            addStatusMessage(`작업 ${index + 1} 실패: ${error.message}`, 'error');
        } finally {
            // 버튼 상태 복원
            button.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';
        }
    }

    function collectBatchData() {
        const items = [];
        const batchItems = document.querySelectorAll('.batch-item');

        batchItems.forEach((item) => {
            const index = parseInt(item.dataset.index);
            const jsonText = item.querySelector('.batch-json').value.trim();
            const emotion = item.querySelector('.emotion-select').value;
            const folder = item.querySelector('.folder-select').value;
            const music = item.querySelector('.music-select').value;
            const musicFolder = item.querySelector('.music-folder-select').value;
            const template = item.querySelector('.template-select').value;
            const outro = item.querySelector('.outro-select').value;
            const videoCountInput = item.querySelector('.video-count-input');
            const videoCount = videoCountInput ? parseInt(videoCountInput.value) : 1;
            const includeTitleCheck = item.querySelector('.include-title-check');
            const includeTitle = includeTitleCheck ? includeTitleCheck.checked : false;

            if (jsonText) {
                try {
                    const jsonData = JSON.parse(jsonText);
                    if (jsonData.script && jsonData.title && jsonData.description) {
                        items.push({
                            index,
                            jsonData,
                            emotion,
                            folder,
                            music,
                            musicFolder,
                            template,
                            outro,
                            videoCount,
                            includeTitle,
                            priority: jsonData.priority || 0,  // 우선순위 태그
                            status: 'pending'
                        });
                    }
                } catch (e) {
                    console.error(`Invalid JSON in item ${index + 1}:`, e);
                }
            }
        });

        // 우선순위 순서대로 정렬 (1 -> 2 -> 3, 0은 맨 뒤)
        items.sort((a, b) => {
            const aPriority = a.priority || 999;  // priority 없으면 맨 뒤로
            const bPriority = b.priority || 999;
            return aPriority - bPriority;
        });

        // 콘솔에 우선순위 순서 출력
        console.log('🎬 비디오 생성 순서 (우선순위별 정렬):');
        items.forEach((item, idx) => {
            const priorityTag = item.priority ? `[우선순위 ${item.priority}]` : '[우선순위 없음]';
            console.log(`  ${idx + 1}. ${priorityTag} ${item.jsonData.title}`);
        });

        return items;
    }

    // 개별 항목 처리 함수
    async function processIndividualItem(index, item) {
        const gridItem = document.querySelector(`[data-index="${index}"]`);
        const button = gridItem.querySelector('.individual-generate');
        const btnText = button.querySelector('.individual-btn-text');
        const loading = button.querySelector('.individual-loading');

        // 버튼 상태 변경
        button.disabled = true;
        btnText.style.display = 'none';
        loading.style.display = 'inline-block';

        try {
            updateBatchItemStatus(index, 'processing');

            // 선택된 배경음악
            const gridItem = document.querySelector(`[data-index="${index}"]`);
            const musicSelect = gridItem.querySelector('.batch-music');
            const selectedMusic = musicSelect ? musicSelect.value : '1.mp3';

            // 선택된 음악 폴더
            const musicFolderSelect = gridItem.querySelector('.music-folder-select');
            const selectedMusicFolder = musicFolderSelect ? musicFolderSelect.value : '';

            // 선택된 입력 폴더 (개별 선택 사용)
            const folderSelect = gridItem.querySelector('.folder-select');
            const selectedInputFolder = folderSelect ? folderSelect.value : 'japan';

            // 선택된 템플릿 가져오기 (개별 선택 우선)
            const templateSelect = gridItem.querySelector('.template-select');
            const selectedTemplate = templateSelect ? (templateSelect.value || '2.png') : '2.png';

            // 선택된 Outro 가져오기
            const outroSelect = gridItem.querySelector('.outro-select');
            const selectedOutro = outroSelect ? outroSelect.value : '';

            // 광고 추가 옵션 확인 (개별 체크박스 우선, 없으면 전역 설정 사용)
            const individualAdsCheckbox = gridItem.querySelector('.include-ads-checkbox');
            const includeAds = individualAdsCheckbox ? individualAdsCheckbox.checked : document.getElementById('globalIncludeAds').checked;

            // 생성할 영상 개수 가져오기
            const videoCountInput = gridItem.querySelector('.video-count-input');
            const videoCount = videoCountInput ? parseInt(videoCountInput.value) || 1 : 1;

            // 여러 영상 생성
            const allResults = [];

            // 1. 먼저 TTS 생성 (한 번만)
            addStatusMessage(`"${item.jsonData.title}" TTS 생성 중...`, 'info');
            const ttsResponse = await authFetch('/api/shorts/generate-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonData: item.jsonData,
                    emotion: item.emotion
                })
            });

            if (!ttsResponse.ok) {
                throw new Error(`TTS 생성 실패: ${item.jsonData.title}`);
            }

            const ttsData = await ttsResponse.json();
            addStatusMessage(`"${item.jsonData.title}" TTS 생성 완료!`, 'success');

            // 2. TTS를 사용해 여러 비디오 생성
            for (let i = 0; i < videoCount; i++) {
                addStatusMessage(`"${item.jsonData.title}" 영상 ${i + 1}/${videoCount} 생성 중...`, 'info');

                // 비디오만 생성하는 API 호출 (TTS 재사용)
                const videoResponse = await authFetch('/api/shorts/generate-video-only', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ttsData: ttsData,
                        jsonData: item.jsonData,
                        jsonData: item.jsonData,
                        backgroundMusic: selectedMusic,
                        musicFolder: selectedMusicFolder,
                        inputFolder: selectedInputFolder,
                        template: selectedTemplate,
                        outro: selectedOutro,
                        videoIndex: i + 1,
                        includeAds: includeAds,
                        includeTitle: false,
                        videoFilter: document.getElementById('videoFilter') ? document.getElementById('videoFilter').value : 'none'
                    })
                });

                if (!videoResponse.ok) {
                    throw new Error(`비디오 생성 실패: ${item.jsonData.title} (영상 ${i + 1})`);
                }

                const videoData = await videoResponse.json();
                allResults.push(videoData);

                addStatusMessage(`"${item.jsonData.title}" 영상 ${i + 1}/${videoCount} 완료!`, 'success');
            }

            updateBatchItemStatus(index, 'completed');

            // 결과를 배치 결과에 추가 (모든 생성된 영상 포함)
            const resultData = {
                index,
                title: item.jsonData.title,
                content: item.jsonData.script,
                description: item.jsonData.description,
                shortsData: allResults[0], // 첫 번째 결과를 기본으로 표시
                allShortsData: allResults, // 모든 결과 저장
                videoCount: videoCount,
                success: true
            };

            // 기존 배치 데이터에서 같은 인덱스 제거 후 추가
            batchData = batchData.filter(data => data.index !== index);
            batchData.push(resultData);

            // 결과 표시 업데이트
            if (batchData.length > 0) {
                displayBatchResults();
                downloadAllBtn.style.display = 'inline-block';
            }

            addStatusMessage(`"${item.jsonData.title}" 총 ${videoCount}개 영상 생성 완료!`, 'success');

        } catch (error) {
            console.error(`Error processing item ${index}:`, error);
            updateBatchItemStatus(index, 'error');
            addStatusMessage(`"${item.jsonData?.title || 'Unknown'}" 생성 실패: ${error.message}`, 'error');
        } finally {
            // 버튼 상태 복원
            button.disabled = false;
            btnText.style.display = 'inline';
            loading.style.display = 'none';
        }
    }

    async function processBatchGeneration(items) {
        batchGenerateBtn.disabled = true;
        batchBtnText.style.display = 'none';
        batchLoading.style.display = 'inline-block';
        status.classList.add('show');
        statusMessages.innerHTML = '';
        batchResults.classList.remove('show');
        batchData = [];

        addStatusMessage(`${items.length}개 작업을 순차적으로 시작합니다...`, 'info');

        let successCount = 0;
        let failCount = 0;

        // 순차 처리 (Sequential Processing) to avoid server overload
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
                console.log(`=== [배치 ${i + 1}/${items.length}] 시작: "${item.jsonData.title}" ===`);
                addStatusMessage(`[${i + 1}/${items.length}] "${item.jsonData.title}" 처리 중...`, 'info');

                // 개별 항목 처리 대기 (Wait for completion)
                const result = await processSingleBatchItem(item);

                batchData.push(result);
                successCount++;
                console.log(`=== [배치 ${i + 1}/${items.length}] 완료 ===`);
                addStatusMessage(`[${i + 1}/${items.length}] 완료`, 'success');

                // API 레이트 리미팅 방지를 위한 딜레이 (마지막 아이템은 제외)
                if (i < items.length - 1) {
                    console.log(`⏳ 다음 작업 전 2초 대기... (레이트 리미팅 방지)`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (error) {
                console.error(`=== [배치 ${i + 1}/${items.length}] 실패 ===`);
                console.error('에러 상세:', error);
                console.error('에러 스택:', error.stack);
                failCount++;
                updateBatchItemStatus(item.index, 'error');
                addStatusMessage(`[${i + 1}/${items.length}] 실패: ${error.message}`, 'error');

                // 에러 발생 후에도 2초 대기 (서버 안정화)
                if (i < items.length - 1) {
                    console.log(`⏳ 에러 후 다음 작업 전 2초 대기...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        console.log(`=== 전체 배치 완료: 성공 ${successCount}, 실패 ${failCount} ===`);

        addStatusMessage(`전체 작업 완료! 성공: ${successCount}, 실패: ${failCount}`,
            successCount > 0 ? 'success' : 'error');

        if (successCount > 0) {
            displayBatchResults();
        }

        batchGenerateBtn.disabled = false;
        batchBtnText.style.display = 'inline';
        batchLoading.style.display = 'none';
    }

    async function processSingleBatchItem(item) {
        updateBatchItemStatus(item.index, 'processing');

        try {
            console.log(`  🎤 TTS 생성 시작: "${item.jsonData.title}"`);
            // 1. TTS 생성
            const ttsResponse = await authFetch('/api/shorts/generate-tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonData: item.jsonData,
                    emotion: item.emotion
                })
            });

            if (!ttsResponse.ok) {
                const err = await ttsResponse.text();
                console.error(`  ❌ TTS API 응답 실패:`, err);
                throw new Error(`TTS 생성 실패: ${err}`);
            }

            const ttsData = await ttsResponse.json();
            console.log(`  ✅ TTS 생성 완료`);
            console.log(`  🎥 비디오 생성 시작...`);

            // 2. 비디오 생성 (TTS 데이터 사용)
            // 선택된 배경음악
            const musicSelect = document.querySelector(`[data-index="${item.index}"] .music-select`);
            const selectedMusic = musicSelect ? musicSelect.value : '1.mp3';

            // 선택된 음악 폴더
            const musicFolderSelect = document.querySelector(`[data-index="${item.index}"] .music-folder-select`);
            const selectedMusicFolder = musicFolderSelect ? musicFolderSelect.value : '';

            // 선택된 입력 폴더
            const folderSelect = document.querySelector(`[data-index="${item.index}"] .folder-select`);
            const selectedInputFolder = folderSelect ? folderSelect.value : 'japan';

            // 선택된 템플릿
            const templateSelect = document.querySelector(`[data-index="${item.index}"] .template-select`);
            const selectedTemplate = templateSelect ? (templateSelect.value || '2.png') : '2.png';

            // 선택된 Outro
            const outroSelect = document.querySelector(`[data-index="${item.index}"] .outro-select`);
            const selectedOutro = outroSelect ? outroSelect.value : '';

            const videoResponse = await authFetch('/api/shorts/generate-video-only', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ttsData: ttsData,
                    jsonData: item.jsonData,
                    backgroundMusic: selectedMusic,
                    musicFolder: selectedMusicFolder,
                    inputFolder: selectedInputFolder,
                    template: selectedTemplate,
                    outro: selectedOutro,
                    videoIndex: 1, // 배치에서는 각 아이템당 1개라고 가정 (또는 videoCount 루프 필요하지만 단순화를 위해)
                    includeAds: document.getElementById('globalIncludeAds') ? document.getElementById('globalIncludeAds').checked : false,
                    includeTitle: item.includeTitle !== undefined ? item.includeTitle : false,
                    videoFilter: document.getElementById('videoFilter') ? document.getElementById('videoFilter').value : 'none'
                })
            });

            if (!videoResponse.ok) {
                const err = await videoResponse.text();
                console.error(`  ❌ 비디오 API 응답 실패:`, err);
                throw new Error(`비디오 생성 실패: ${err}`);
            }

            const shortsData = await videoResponse.json();
            console.log(`  ✅ 비디오 생성 완료`);

            updateBatchItemStatus(item.index, 'completed');

            return {
                ...item,
                title: item.jsonData.title,
                content: item.jsonData.script,
                description: item.jsonData.description,
                shortsData: { videoData: shortsData }, // 구조 맞춤
                allShortsData: [{ videoData: shortsData }], // 구조 맞춤 (배치 결과 표시 호환성)
                success: true
            };

        } catch (error) {
            console.error(`Error processing item ${item.index}:`, error);
            updateBatchItemStatus(item.index, 'error');
            throw error;
        }
    }

    function updateBatchItemStatus(index, status) {
        const gridItem = document.querySelector(`[data-index="${index}"]`);
        const statusIndicator = gridItem.querySelector('.status-indicator');

        statusIndicator.className = `status-indicator ${status}`;

        const statusText = {
            'pending': '대기',
            'processing': '처리중',
            'completed': '완료',
            'error': '오류'
        };

        statusIndicator.textContent = statusText[status] || status;
    }

    function displayBatchResults() {
        batchResults.classList.add('show');
        batchResultsGrid.innerHTML = '';

        batchData.forEach((item, index) => {
            if (item.success) {
                const resultItem = createBatchResultItem(item, index);
                batchResultsGrid.appendChild(resultItem);
            }
        });
    }

    function createBatchResultItem(item, index) {
        const div = document.createElement('div');
        div.className = 'batch-result-item';

        // 여러 영상이 있는 경우 처리
        if (item.allShortsData && item.allShortsData.length > 1) {
            // 여러 영상이 있는 경우
            let videosHtml = '';
            item.allShortsData.forEach((shortsData, idx) => {
                if (shortsData?.videoData && shortsData.videoData.success) {
                    videosHtml += `
                        <div style="margin-bottom: 15px; padding: 10px; background: #1a1a1a; border-radius: 5px;">
                            <h5 style="color: #ffffff; margin-bottom: 8px;">영상 ${idx + 1} (v${idx + 1})</h5>
                            <video controls style="width: 100%; max-height: 150px; object-fit: contain; margin-bottom: 8px;">
                                <source src="${shortsData.videoData.videoUrl}" type="video/mp4">
                            </video>
                            <div>
                                <a href="${shortsData.videoData.videoUrl}" download class="download-btn">
                                    <span>📥</span> 비디오 다운로드
                                </a>
                            </div>
                            <div style="margin-top: 5px; font-size: 0.8em; color: #888;">
                                폴더: ${shortsData.mainProjectFolder || shortsData.projectFolder}
                            </div>
                        </div>
                    `;
                }
            });

            div.innerHTML = `
                <h4>${item.title}</h4>
                <p style="font-size: 0.9em; color: #888; margin-bottom: 10px;">
                    총 ${item.videoCount}개 영상 생성됨
                </p>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${videosHtml}
                </div>
            `;

            return div;
        }

        // 단일 영상인 경우 (기존 코드)
        // 폴더명 표시 추가
        const folderName = item.shortsData?.projectFolder || item.shortsData?.mainProjectFolder || 'Unknown';

        // 비디오가 있는 경우와 없는 경우 다르게 표시
        let mediaContent = '';
        let downloadButtons = '';

        if (item.shortsData?.videoData && item.shortsData.videoData.success) {
            // 비디오가 있는 경우
            const videoUrl = item.shortsData.videoData.videoUrl;
            mediaContent = `
                <video controls style="width: 100%; max-height: 150px; object-fit: contain; margin-bottom: 8px;">
                    <source src="${videoUrl}" type="video/mp4">
                </video>
            `;
            downloadButtons = `
                <a href="${videoUrl}" class="batch-download-btn" download="${item.title}_video.mp4">비디오</a>
                <a href="#" class="batch-download-btn folder-download" data-index="${index}">모든파일</a>
            `;
        } else {
            // 비디오 생성 실패한 경우
            mediaContent = `
                <p style="color: #ff6666; font-size: 0.9em;">비디오 생성 실패</p>
            `;
            downloadButtons = `
                <span style="color: #888; font-size: 0.9em;">다운로드할 파일이 없습니다</span>
            `;
        }

        div.innerHTML = `
            <h5>${item.title}</h5>
            <p style="font-size: 0.8em; color: #666; margin-bottom: 8px;">📁 ${folderName}</p>
            ${mediaContent}
            <div>
                ${downloadButtons}
            </div>
        `;

        // 폴더 다운로드 이벤트 (모든 파일)
        const folderBtn = div.querySelector('.folder-download');
        if (folderBtn) {
            folderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                downloadFolderContent(item);
            });
        }

        return div;
    }

    function downloadFolderContent(item) {
        let downloadCount = 0;

        // 비디오 파일 다운로드 (있는 경우)
        if (item.shortsData?.videoData && item.shortsData.videoData.success) {
            const videoLink = document.createElement('a');
            videoLink.href = item.shortsData.videoData.videoUrl;
            videoLink.download = `${item.title}_video.mp4`;
            videoLink.click();
            downloadCount++;
        }

        // 음성 파일 다운로드
        if (item.shortsData?.ttsData?.audioUrl) {
            setTimeout(() => {
                const audioLink = document.createElement('a');
                audioLink.href = item.shortsData.ttsData.audioUrl;
                audioLink.download = `${item.title}_audio.mp3`;
                audioLink.click();
                downloadCount++;
            }, 100);
        }

        // 제목 파일 다운로드
        if (item.shortsData?.titleFile) {
            setTimeout(() => {
                const titleLink = document.createElement('a');
                titleLink.href = item.shortsData.titleFile;
                titleLink.download = `${item.title}_title.txt`;
                titleLink.click();
                downloadCount++;
            }, 200);
        }

        // 설명 파일 다운로드
        if (item.shortsData?.descriptionFile) {
            setTimeout(() => {
                const descLink = document.createElement('a');
                descLink.href = item.shortsData.descriptionFile;
                descLink.download = `${item.title}_description.txt`;
                descLink.click();
                downloadCount++;
            }, 300);
        }

        setTimeout(() => {
            const fileTypes = item.shortsData?.videoData?.success ? '비디오, 음성, 제목, 설명' : '음성, 제목, 설명';
            addStatusMessage(`${item.title} 폴더의 모든 파일(${fileTypes})을 다운로드했습니다.`, 'success');
        }, 400);
    }

    function downloadSrtFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }


    // 모두 다운로드 (legacy - 새 디자인에서는 사용 안 함)
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', () => {
            if (batchData.length === 0) return;

            let totalFiles = 0;
            let delay = 0;

            batchData.forEach(item => {
                if (item.success) {
                    // 비디오 파일 다운로드 (있는 경우)
                    if (item.shortsData?.videoData && item.shortsData.videoData.success) {
                        setTimeout(() => {
                            const videoLink = document.createElement('a');
                            videoLink.href = item.shortsData.videoData.videoUrl;
                            videoLink.download = `${item.title}_video.mp4`;
                            videoLink.click();
                        }, delay);
                        delay += 150;
                        totalFiles++;
                    }

                    // 음성 파일 다운로드
                    if (item.shortsData?.ttsData?.audioUrl) {
                        setTimeout(() => {
                            const audioLink = document.createElement('a');
                            audioLink.href = item.shortsData.ttsData.audioUrl;
                            audioLink.download = `${item.title}_audio.mp3`;
                            audioLink.click();
                        }, delay);
                        delay += 150;
                        totalFiles++;
                    }

                    // 제목 파일 다운로드
                    if (item.shortsData?.titleFile) {
                        setTimeout(() => {
                            const titleLink = document.createElement('a');
                            titleLink.href = item.shortsData.titleFile;
                            titleLink.download = `${item.title}_title.txt`;
                            titleLink.click();
                        }, delay);
                        delay += 150;
                        totalFiles++;
                    }

                    // 설명 파일 다운로드
                    if (item.shortsData?.descriptionFile) {
                        setTimeout(() => {
                            const descLink = document.createElement('a');
                            descLink.href = item.shortsData.descriptionFile;
                            descLink.download = `${item.title}_description.txt`;
                            descLink.click();
                        }, delay);
                        delay += 150;
                        totalFiles++;
                    }
                }
            });

            const videoCount = batchData.filter(item => item.success && item.shortsData?.videoData?.success).length;
            const fileTypes = videoCount > 0 ? '비디오, 음성, 제목, 설명' : '음성, 제목, 설명';
            addStatusMessage(`${totalFiles}개의 파일(${fileTypes}) 다운로드를 시작했습니다.`, 'success');
        });
    }

    // [New] 첫 번째 항목의 설정을 전체 항목에 적용 (Apply settings from Item 1 to All)
    window.applyFirstItemSettingsToAll = async function () {
        if (!confirm('작업 1의 설정을 다른 모든 작업에 적용하시겠습니까? (대본 내용은 변경되지 않습니다)')) {
            return;
        }

        const firstItem = document.querySelector('.batch-item[data-index="0"]');
        if (!firstItem) return;

        // 1. 값 가져오기
        const emotion = firstItem.querySelector('.emotion-select').value;
        const folder = firstItem.querySelector('.folder-select').value;
        const musicFolder = firstItem.querySelector('.music-folder-select').value;
        const music = firstItem.querySelector('.music-select').value;
        const template = firstItem.querySelector('.template-select').value;
        const outro = firstItem.querySelector('.outro-select').value;

        // 2. 다른 모든 항목에 적용
        const allItems = document.querySelectorAll('.batch-item');

        let updateCount = 0;

        // 순차적으로 적용 (비동기 처리 특히 음악 목록 로딩을 위해)
        for (let i = 1; i < allItems.length; i++) {
            const item = allItems[i];

            // 감정
            item.querySelector('.emotion-select').value = emotion;

            // 영상 소스
            item.querySelector('.folder-select').value = folder;

            // 배경 화면
            item.querySelector('.template-select').value = template;

            // 엔딩 영상
            item.querySelector('.outro-select').value = outro;

            // 배경 음악 (폴더 변경 시 파일 목록 로드 필요)
            const musicFolderSelect = item.querySelector('.music-folder-select');
            const musicSelect = item.querySelector('.music-select');

            if (musicFolderSelect.value !== musicFolder) {
                musicFolderSelect.value = musicFolder;
                // Trigger change event manually or call update function
                await window.updateBatchMusicFiles(musicFolderSelect);
                // 파일 목록 로드 후 값 설정
                musicSelect.value = music;
            } else {
                musicSelect.value = music;
            }
            updateCount++;
        }

        addStatusMessage(`총 ${updateCount}개 작업에 설정이 적용되었습니다.`, 'success');
    };

});
