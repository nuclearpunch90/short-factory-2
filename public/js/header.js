// Shared Header Component
// This file provides a common header with authentication UI for all pages
// Works with firebase-auth.js for authentication

// Get current page path to set active nav item
function getCurrentPage() {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') return '/';
    if (path.includes('ai-shorts')) return '/ai-shorts';
    if (path.includes('ai-video')) return '/ai-video';
    if (path.includes('ai-longform')) return '/ai-longform';
    if (path.includes('ranking-video')) return '/ranking-video';
    if (path.includes('thumbnail-maker')) return '/thumbnail-maker';
    return path;
}

// Header HTML template
function getHeaderHTML() {
    const currentPage = getCurrentPage();
    const isShortsPage = ['/', '/ai-shorts', '/ai-video', '/ranking-video'].includes(currentPage);
    const isLongformPage = currentPage === '/ai-longform';

    return `
    <style>
        .nav-dropdown {
            position: relative;
        }
        .nav-dropdown-trigger {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.5rem 1rem;
            background: transparent;
            color: var(--color-gray-600);
            text-decoration: none;
            border-radius: calc(var(--radius-sm) - 2px);
            font-size: 0.875rem;
            font-weight: 600;
            transition: all 0.15s ease;
            cursor: pointer;
            border: none;
        }
        .nav-dropdown-trigger:hover {
            color: var(--color-gray-900);
            background: var(--color-bg-primary);
        }
        .nav-dropdown-trigger.active {
            background: var(--color-bg-primary);
            color: var(--color-primary);
            box-shadow: var(--shadow-sm);
        }
        .nav-dropdown-trigger svg {
            width: 12px;
            height: 12px;
            transition: transform 0.2s;
        }
        .nav-dropdown:hover .nav-dropdown-trigger svg {
            transform: rotate(180deg);
        }
        .nav-dropdown-menu {
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            margin-top: 0.25rem;
            background: var(--color-bg-primary);
            border: 1px solid var(--color-gray-200);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            min-width: 160px;
            opacity: 0;
            visibility: hidden;
            transition: all 0.15s;
            z-index: 1000;
        }
        .nav-dropdown:hover .nav-dropdown-menu {
            opacity: 1;
            visibility: visible;
        }
        .nav-dropdown-menu a {
            display: block;
            padding: 0.6rem 1rem;
            color: var(--color-gray-700);
            text-decoration: none;
            font-size: 0.85rem;
            font-weight: 500;
            transition: all 0.15s;
        }
        .nav-dropdown-menu a:first-child {
            border-radius: 8px 8px 0 0;
        }
        .nav-dropdown-menu a:last-child {
            border-radius: 0 0 8px 8px;
        }
        .nav-dropdown-menu a:hover {
            background: var(--color-bg-tertiary);
            color: var(--color-primary);
        }
        .nav-dropdown-menu a.active {
            background: rgba(59, 130, 246, 0.1);
            color: var(--color-primary);
        }
    </style>
    <div class="header">
        <div class="header-content">
            <div class="header-brand" style="display: flex; align-items: center; gap: 0.5rem;">
                <img src="/logo.svg" alt="쇼츠공장" style="width: 36px; height: 36px;">
                <h1 style="font-size: 1.2rem; font-weight: 800; color: var(--color-gray-900);">쇼츠공장</h1>
            </div>
            <div class="header-nav">
                <div class="nav-dropdown">
                    <button class="nav-dropdown-trigger ${isShortsPage ? 'active' : ''}">
                        🎬 숏폼 만들기
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    <div class="nav-dropdown-menu">
                        <a href="/" ${currentPage === '/' ? 'class="active"' : ''}>🎬 리믹스 숏폼</a>
                        <a href="/ai-shorts" ${currentPage === '/ai-shorts' ? 'class="active"' : ''}>🤖 AI 이미지 숏폼</a>
                        <a href="/ai-video" ${currentPage === '/ai-video' ? 'class="active"' : ''}>🎥 AI 동영상 숏폼</a>
                        <a href="/ranking-video" ${currentPage === '/ranking-video' ? 'class="active"' : ''}>🏆 랭킹 숏폼</a>
                    </div>
                </div>
                <div class="nav-dropdown">
                    <button class="nav-dropdown-trigger ${isLongformPage ? 'active' : ''}">
                        🎥 롱폼 만들기
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    <div class="nav-dropdown-menu">
                        <a href="/ai-longform" ${currentPage === '/ai-longform' ? 'class="active"' : ''}>🤖 AI 이미지 롱폼</a>
                    </div>
                </div>
                <a href="/thumbnail-maker" ${currentPage === '/thumbnail-maker' ? 'class="active"' : ''}>🖼️ 썸네일 메이커</a>
            </div>
            <div class="header-right">
                <div class="header-user-box" id="headerUserBox" style="display: flex; align-items: center; gap: 0.5rem; background: var(--color-bg-tertiary); border: 1px solid var(--color-gray-300); border-radius: 8px; padding: 0.35rem 0.5rem;">
                    <span class="auth-email" id="authEmail" style="display: none; color: var(--color-gray-600); font-size: 0.85rem; padding: 0 0.5rem;"></span>
                    <button id="logoutBtn" style="display: none; align-items: center; gap: 0.35rem; background: transparent; border: none; font-size: 0.8rem; cursor: pointer; padding: 0.4rem 0.6rem; color: var(--color-gray-700); border-radius: 6px; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='var(--color-gray-200)'" onmouseout="this.style.background='transparent'">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        <span>로그아웃</span>
                    </button>
                    <button onclick="openSettingsModal()" class="header-settings-btn" title="설정" style="display: flex; align-items: center; gap: 0.35rem; background: transparent; border: none; font-size: 0.8rem; cursor: pointer; padding: 0.4rem 0.6rem; color: var(--color-gray-700); border-radius: 6px; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='var(--color-gray-200)'" onmouseout="this.style.background='transparent'">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                        <span>설정</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;
}

// Note: Settings modal is page-specific - each page defines its own openSettingsModal function

// Auth state management (set by page after authentication)
let headerAuthState = { isLoggedIn: false, email: null, isAdmin: false };

// Set auth state from page (called by each page after requireAuth())
// This is the main way to update header auth state
function setHeaderAuthState(authState) {
    if (authState) {
        headerAuthState = {
            isLoggedIn: true,
            email: authState.email,
            isAdmin: authState.isAdmin || false
        };
    } else {
        headerAuthState = { isLoggedIn: false, email: null, isAdmin: false };
    }
    updateHeaderAuthUI();
}

// Update auth UI in header
function updateHeaderAuthUI() {
    const authEmail = document.getElementById('authEmail');
    const logoutBtn = document.getElementById('logoutBtn');

    if (!authEmail || !logoutBtn) return;

    if (headerAuthState.isLoggedIn && headerAuthState.email) {
        // Show email and logout button
        authEmail.textContent = headerAuthState.email;
        authEmail.style.display = 'inline';
        logoutBtn.style.display = 'flex';
        // Use logout() from firebase-auth.js if available, otherwise fallback
        logoutBtn.onclick = function () {
            if (typeof logout === 'function') {
                logout();
            } else {
                // Fallback: clear localStorage and redirect
                localStorage.clear();
                window.location.href = '/login.html';
            }
        };
    } else {
        // Hide email and logout button
        authEmail.style.display = 'none';
        logoutBtn.style.display = 'none';
    }
}

// Settings modal functions are defined by each page (page-specific settings)

// Initialize header (only inserts HTML, does NOT check auth)
function initHeader() {
    // Find header placeholder or body
    const headerPlaceholder = document.getElementById('header-placeholder');

    if (headerPlaceholder) {
        headerPlaceholder.outerHTML = getHeaderHTML();
    } else {
        // Insert header at the beginning of body
        document.body.insertAdjacentHTML('afterbegin', getHeaderHTML());
    }

    // Auth state will be set by the page after requireAuth() completes
    // via setHeaderAuthState(authState)
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeader);
} else {
    initHeader();
}
