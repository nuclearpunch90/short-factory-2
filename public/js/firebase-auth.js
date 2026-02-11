// Firebase Authentication Helper Functions
// Requires firebase-config.js to be loaded first

// Generate unique session ID
function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Check if user has active session elsewhere
async function checkExistingSession(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw new Error('등록되지 않은 사용자입니다. 관리자에게 문의하세요.');
    }

    const userData = userDoc.data();

    if (!userData.isApproved) {
        throw new Error('계정이 승인되지 않았습니다. 관리자에게 문의하세요.');
    }

    return {
        hasActiveSession: !!userData.activeSessionId,
        activeSessionId: userData.activeSessionId,
        isAdmin: userData.isAdmin || false
    };
}

// Custom error class for session conflict
class SessionConflictError extends Error {
    constructor(message, uid, isAdmin) {
        super(message);
        this.name = 'SessionConflictError';
        this.uid = uid;
        this.isAdmin = isAdmin;
    }
}

// Login function with single session enforcement
async function login(email, password, forceOverride = false) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // Check for existing session
        const sessionInfo = await checkExistingSession(user.uid);

        // Get stored session ID from localStorage
        const storedSessionId = localStorage.getItem('sessionId');

        // If there's an active session that isn't ours, check if we should override
        if (sessionInfo.hasActiveSession && sessionInfo.activeSessionId !== storedSessionId) {
            if (!forceOverride) {
                await auth.signOut();
                throw new SessionConflictError(
                    '이미 다른 기기에서 로그인 중입니다.',
                    user.uid,
                    sessionInfo.isAdmin
                );
            }
            // If forceOverride is true, continue and override the session
        }

        // Create new session
        const newSessionId = generateSessionId();
        await db.collection('users').doc(user.uid).update({
            activeSessionId: newSessionId,
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Store session info locally
        localStorage.setItem('sessionId', newSessionId);
        localStorage.setItem('isAdmin', sessionInfo.isAdmin);
        localStorage.setItem('userEmail', user.email);

        // Get ID token for API calls
        const idToken = await user.getIdToken();
        localStorage.setItem('authToken', idToken);

        return {
            success: true,
            user: user,
            isAdmin: sessionInfo.isAdmin
        };
    } catch (error) {
        console.error('Login error:', error);
        // Re-throw SessionConflictError as-is
        if (error instanceof SessionConflictError) {
            throw error;
        }
        // Translate Firebase error messages
        if (error.code === 'auth/user-not-found') {
            throw new Error('등록되지 않은 이메일입니다.');
        } else if (error.code === 'auth/wrong-password') {
            throw new Error('비밀번호가 올바르지 않습니다.');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('올바른 이메일 형식이 아닙니다.');
        } else if (error.code === 'auth/too-many-requests') {
            throw new Error('너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.');
        }
        throw error;
    }
}

// Logout function
async function logout() {
    try {
        const user = auth.currentUser;
        if (user) {
            // Clear session in Firestore
            try {
                await db.collection('users').doc(user.uid).update({
                    activeSessionId: null
                });
            } catch (e) {
                console.warn('Could not clear session in Firestore:', e);
            }
        }

        await auth.signOut();

        // Clear local storage
        localStorage.removeItem('sessionId');
        localStorage.removeItem('authToken');
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('userEmail');

        // Redirect to login
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
        // Force redirect even on error
        localStorage.clear();
        window.location.href = '/login.html';
    }
}

// Check authentication status
async function checkAuth() {
    return new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            unsubscribe(); // Stop listening after first check

            if (user) {
                try {
                    // Verify session is still valid
                    const userDoc = await db.collection('users').doc(user.uid).get();

                    if (!userDoc.exists) {
                        await auth.signOut();
                        localStorage.clear();
                        resolve(null);
                        return;
                    }

                    const userData = userDoc.data();
                    const storedSessionId = localStorage.getItem('sessionId');

                    if (userData.activeSessionId !== storedSessionId) {
                        // Session invalidated (logged in elsewhere or forced logout)
                        await auth.signOut();
                        localStorage.clear();
                        resolve(null);
                        return;
                    }

                    if (!userData.isApproved) {
                        await auth.signOut();
                        localStorage.clear();
                        resolve(null);
                        return;
                    }

                    // Refresh token
                    const idToken = await user.getIdToken(true);
                    localStorage.setItem('authToken', idToken);
                    localStorage.setItem('isAdmin', userData.isAdmin || false);

                    resolve({
                        user: user,
                        isAdmin: userData.isAdmin || false,
                        isApproved: userData.isApproved || false,
                        email: user.email
                    });
                } catch (error) {
                    console.error('Auth check error:', error);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
    });
}

// Auth guard for protected pages
async function requireAuth() {
    const authState = await checkAuth();
    if (!authState) {
        window.location.href = '/login.html';
        return null;
    }
    return authState;
}

// Admin guard for admin pages
async function requireAdmin() {
    const authState = await checkAuth();
    if (!authState) {
        window.location.href = '/login.html';
        return null;
    }
    if (!authState.isAdmin) {
        window.location.href = '/';
        return null;
    }
    return authState;
}

// Get auth token for API calls
function getAuthToken() {
    return localStorage.getItem('authToken');
}

// Fetch wrapper with auth header
async function authFetch(url, options = {}) {
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/login.html';
        throw new Error('Not authenticated');
    }

    const authOptions = {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${token}`
        }
    };

    const response = await fetch(url, authOptions);

    if (response.status === 401) {
        // Token expired or invalid
        await logout();
        throw new Error('Session expired');
    }

    return response;
}

// Initialize auth UI components on page
function initAuthUI(authState) {
    if (!authState) return;

    // Make body visible
    document.body.style.visibility = 'visible';

    // Find or create logout button
    const header = document.querySelector('.header');
    if (header) {
        // Add user info and logout button
        let authContainer = header.querySelector('.auth-container');
        if (!authContainer) {
            authContainer = document.createElement('div');
            authContainer.className = 'auth-container';
            header.appendChild(authContainer);
        }

        // Always set style and clear existing content
        authContainer.style.cssText = 'display: flex; align-items: center; gap: 1rem;';
        authContainer.innerHTML = '';

        const userInfo = document.createElement('span');
        userInfo.className = 'user-email';
        userInfo.textContent = authState.email;
        userInfo.style.cssText = 'color: var(--color-gray-600); font-size: 0.875rem;';

        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'logout-btn';
        logoutBtn.style.cssText = 'display: flex; align-items: center; gap: 0.4rem; background: var(--color-bg-tertiary); border: 1px solid var(--color-gray-300); font-size: 0.85rem; cursor: pointer; padding: 0.5rem 0.85rem; color: var(--color-gray-700); border-radius: 8px; font-weight: 500; transition: all 0.2s;';
        logoutBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>로그아웃</span>';
        logoutBtn.onclick = logout;

        authContainer.appendChild(userInfo);
        authContainer.appendChild(logoutBtn);

        // Add admin link if user is admin
        if (authState.isAdmin) {
            const nav = header.querySelector('.header-nav');
            if (nav && !nav.querySelector('[href="/admin.html"]')) {
                const adminLink = document.createElement('a');
                adminLink.href = '/admin.html';
                adminLink.innerHTML = '<span>관리자</span>';
                nav.appendChild(adminLink);
            }
        }
    }
}

// Token refresh interval (every 50 minutes)
let tokenRefreshInterval = null;

function startTokenRefresh() {
    if (tokenRefreshInterval) return;

    tokenRefreshInterval = setInterval(async () => {
        const user = auth.currentUser;
        if (user) {
            try {
                const idToken = await user.getIdToken(true);
                localStorage.setItem('authToken', idToken);
            } catch (error) {
                console.error('Token refresh error:', error);
            }
        }
    }, 50 * 60 * 1000); // 50 minutes
}

function stopTokenRefresh() {
    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
        tokenRefreshInterval = null;
    }
}
