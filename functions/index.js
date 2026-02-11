import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (!getApps().length) {
    initializeApp();
}

const auth = getAuth();
const db = getFirestore();

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper: Verify admin token
async function verifyAdmin(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.split('Bearer ')[1];
    try {
        const decoded = await auth.verifyIdToken(token);
        const userDoc = await db.collection('users').doc(decoded.uid).get();

        if (!userDoc.exists || !userDoc.data().isAdmin) {
            return null;
        }

        return { uid: decoded.uid, ...userDoc.data() };
    } catch (error) {
        console.error('Token verification error:', error);
        return null;
    }
}

// GET /api/auth/users - List all users (admin only)
export const getUsers = onRequest({ cors: true }, async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.set(corsHeaders);
        res.status(204).send('');
        return;
    }

    res.set(corsHeaders);

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }

    try {
        const usersSnapshot = await db.collection('users').get();
        const users = [];

        for (const doc of usersSnapshot.docs) {
            const userData = doc.data();
            users.push({
                uid: doc.id,
                email: userData.email,
                isAdmin: userData.isAdmin || false,
                isApproved: userData.isApproved || false,
                activeSessionId: userData.activeSessionId || null,
                createdAt: userData.createdAt?.toDate?.() || null,
                lastLoginAt: userData.lastLoginAt?.toDate?.() || null
            });
        }

        res.json({ success: true, users });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/auth/create-user - Create new user (admin only)
export const createUser = onRequest({ cors: true }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set(corsHeaders);
        res.status(204).send('');
        return;
    }

    res.set(corsHeaders);

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }

    try {
        const { email, password, isAdmin: newUserIsAdmin } = req.body;

        if (!email || !password) {
            res.status(400).json({ error: 'Email and password required' });
            return;
        }

        // Create Firebase Auth user
        const userRecord = await auth.createUser({
            email,
            password,
            emailVerified: true
        });

        // Create Firestore document
        await db.collection('users').doc(userRecord.uid).set({
            email,
            createdAt: new Date(),
            isAdmin: newUserIsAdmin || false,
            isApproved: true,
            activeSessionId: null,
            createdBy: admin.uid
        });

        res.json({
            success: true,
            user: {
                uid: userRecord.uid,
                email,
                isAdmin: newUserIsAdmin || false,
                isApproved: true
            }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/auth/delete-user - Delete user (admin only)
export const deleteUser = onRequest({ cors: true }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set(corsHeaders);
        res.status(204).send('');
        return;
    }

    res.set(corsHeaders);

    if (req.method !== 'DELETE' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }

    try {
        const { uid } = req.body;

        if (!uid) {
            res.status(400).json({ error: 'User UID required' });
            return;
        }

        if (uid === admin.uid) {
            res.status(400).json({ error: 'Cannot delete yourself' });
            return;
        }

        // Delete from Firebase Auth
        await auth.deleteUser(uid);

        // Delete from Firestore
        await db.collection('users').doc(uid).delete();

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/auth/update-user - Update user (admin only)
export const updateUser = onRequest({ cors: true }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set(corsHeaders);
        res.status(204).send('');
        return;
    }

    res.set(corsHeaders);

    if (req.method !== 'PUT' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const adminUser = await verifyAdmin(req);
    if (!adminUser) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }

    try {
        const { uid, isAdmin, isApproved } = req.body;

        if (!uid) {
            res.status(400).json({ error: 'User UID required' });
            return;
        }

        const updateData = {};
        if (typeof isAdmin === 'boolean') updateData.isAdmin = isAdmin;
        if (typeof isApproved === 'boolean') updateData.isApproved = isApproved;

        await db.collection('users').doc(uid).update(updateData);

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/auth/force-logout - Force logout user (admin only)
export const forceLogout = onRequest({ cors: true }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set(corsHeaders);
        res.status(204).send('');
        return;
    }

    res.set(corsHeaders);

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const admin = await verifyAdmin(req);
    if (!admin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }

    try {
        const { uid } = req.body;

        if (!uid) {
            res.status(400).json({ error: 'User UID required' });
            return;
        }

        // Clear active session
        await db.collection('users').doc(uid).update({
            activeSessionId: null
        });

        // Revoke refresh tokens
        await auth.revokeRefreshTokens(uid);

        res.json({ success: true });
    } catch (error) {
        console.error('Error forcing logout:', error);
        res.status(500).json({ error: error.message });
    }
});
