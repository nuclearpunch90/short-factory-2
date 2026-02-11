import express from 'express';
import { admin, requireAdmin, isFirebaseReady } from '../middleware/auth.js';

const router = express.Router();

// Create new user (admin only)
router.post('/create-user', requireAdmin, async (req, res) => {
    const { email, password, isAdmin = false } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: '이메일과 비밀번호가 필요합니다.'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            error: '비밀번호는 최소 6자리 이상이어야 합니다.'
        });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            error: '올바른 이메일 형식이 아닙니다.'
        });
    }

    try {
        // Check if user already exists
        try {
            const existingUser = await admin.auth().getUserByEmail(email);
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: '이미 등록된 이메일입니다.'
                });
            }
        } catch (e) {
            // User not found - this is expected
            if (e.code !== 'auth/user-not-found') {
                throw e;
            }
        }

        // Create user in Firebase Auth
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            emailVerified: true
        });

        // Create user document in Firestore
        await admin.firestore().collection('users').doc(userRecord.uid).set({
            email: email,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isAdmin: isAdmin,
            isApproved: true,
            activeSessionId: null,
            createdBy: req.user.uid
        });

        res.json({
            success: true,
            uid: userRecord.uid,
            message: '사용자가 생성되었습니다.'
        });
    } catch (error) {
        console.error('Create user error:', error);

        let errorMessage = '사용자 생성에 실패했습니다.';
        if (error.code === 'auth/email-already-exists') {
            errorMessage = '이미 등록된 이메일입니다.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = '올바른 이메일 형식이 아닙니다.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = '비밀번호가 너무 약합니다.';
        }

        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
});

// Delete user (admin only)
router.delete('/delete-user', requireAdmin, async (req, res) => {
    const { uid } = req.body;

    if (!uid) {
        return res.status(400).json({
            success: false,
            error: '사용자 ID가 필요합니다.'
        });
    }

    // Prevent self-deletion
    if (uid === req.user.uid) {
        return res.status(400).json({
            success: false,
            error: '자기 자신은 삭제할 수 없습니다.'
        });
    }

    try {
        // Delete from Firebase Auth
        await admin.auth().deleteUser(uid);

        // Delete from Firestore
        await admin.firestore().collection('users').doc(uid).delete();

        res.json({
            success: true,
            message: '사용자가 삭제되었습니다.'
        });
    } catch (error) {
        console.error('Delete user error:', error);

        let errorMessage = '사용자 삭제에 실패했습니다.';
        if (error.code === 'auth/user-not-found') {
            errorMessage = '존재하지 않는 사용자입니다.';
        }

        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
});

// Update user (admin only)
router.put('/update-user', requireAdmin, async (req, res) => {
    const { uid, isAdmin, isApproved } = req.body;

    if (!uid) {
        return res.status(400).json({
            success: false,
            error: '사용자 ID가 필요합니다.'
        });
    }

    try {
        const updateData = {};
        if (isAdmin !== undefined) updateData.isAdmin = isAdmin;
        if (isApproved !== undefined) updateData.isApproved = isApproved;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                error: '수정할 데이터가 없습니다.'
            });
        }

        await admin.firestore().collection('users').doc(uid).update(updateData);

        res.json({
            success: true,
            message: '사용자 정보가 수정되었습니다.'
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            error: '사용자 정보 수정에 실패했습니다.'
        });
    }
});

// Force logout user (admin only)
router.post('/force-logout', requireAdmin, async (req, res) => {
    const { uid } = req.body;

    if (!uid) {
        return res.status(400).json({
            success: false,
            error: '사용자 ID가 필요합니다.'
        });
    }

    try {
        await admin.firestore().collection('users').doc(uid).update({
            activeSessionId: null
        });

        // Revoke refresh tokens
        await admin.auth().revokeRefreshTokens(uid);

        res.json({
            success: true,
            message: '사용자가 강제 로그아웃 되었습니다.'
        });
    } catch (error) {
        console.error('Force logout error:', error);
        res.status(500).json({
            success: false,
            error: '강제 로그아웃에 실패했습니다.'
        });
    }
});

// Get all users (admin only)
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const snapshot = await admin.firestore()
            .collection('users')
            .orderBy('createdAt', 'desc')
            .get();

        const users = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            users.push({
                uid: doc.id,
                email: data.email,
                isAdmin: data.isAdmin || false,
                isApproved: data.isApproved || false,
                hasActiveSession: !!data.activeSessionId,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                lastLoginAt: data.lastLoginAt ? data.lastLoginAt.toDate().toISOString() : null
            });
        });

        res.json({
            success: true,
            users: users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: '사용자 목록을 불러오는데 실패했습니다.'
        });
    }
});

// Get current user info
router.get('/me', async (req, res) => {
    if (!isFirebaseReady()) {
        return res.json({
            success: true,
            user: null,
            message: 'Authentication not configured'
        });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: '인증이 필요합니다.'
        });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(decodedToken.uid)
            .get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                error: '사용자를 찾을 수 없습니다.'
            });
        }

        const userData = userDoc.data();

        res.json({
            success: true,
            user: {
                uid: decodedToken.uid,
                email: decodedToken.email,
                isAdmin: userData.isAdmin || false,
                isApproved: userData.isApproved || false
            }
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(401).json({
            success: false,
            error: '인증에 실패했습니다.'
        });
    }
});

// Check auth status (public endpoint)
router.get('/status', (req, res) => {
    res.json({
        success: true,
        authEnabled: isFirebaseReady()
    });
});

export default router;
