import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin SDK
let adminInitialized = false;

function initializeFirebaseAdmin() {
    if (adminInitialized) return true;

    try {
        // Option 1: Using service account JSON file
        const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
        if (fs.existsSync(serviceAccountPath)) {
            const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            adminInitialized = true;
            console.log('Firebase Admin SDK initialized with service account file');
            return true;
        }

        // Option 2: Using environment variables
        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
                })
            });
            adminInitialized = true;
            console.log('Firebase Admin SDK initialized with environment variables');
            return true;
        }

        console.warn('Firebase Admin SDK not configured - authentication will be disabled');
        console.warn('To enable authentication, either:');
        console.warn('  1. Place firebase-service-account.json in project root');
        console.warn('  2. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env');
        return false;
    } catch (error) {
        console.error('Firebase Admin initialization error:', error);
        return false;
    }
}

// Initialize on module load
const firebaseReady = initializeFirebaseAdmin();

// Auth middleware - verify Firebase ID token
export async function requireAuth(req, res, next) {
    if (!firebaseReady) {
        // Skip auth if Firebase not configured (development mode)
        console.warn('Auth middleware skipped - Firebase not configured');
        return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: '인증이 필요합니다. 로그인해주세요.'
        });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        // Check if user exists and is approved in Firestore
        const userDoc = await admin.firestore()
            .collection('users')
            .doc(decodedToken.uid)
            .get();

        if (!userDoc.exists) {
            return res.status(403).json({
                error: 'Forbidden',
                message: '등록되지 않은 사용자입니다.'
            });
        }

        const userData = userDoc.data();

        if (!userData.isApproved) {
            return res.status(403).json({
                error: 'Forbidden',
                message: '계정이 승인되지 않았습니다. 관리자에게 문의하세요.'
            });
        }

        // Attach user info to request
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            isAdmin: userData.isAdmin || false,
            isApproved: userData.isApproved
        };

        next();
    } catch (error) {
        console.error('Token verification error:', error.code || error.message);

        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: '세션이 만료되었습니다. 다시 로그인해주세요.'
            });
        }

        return res.status(401).json({
            error: 'Unauthorized',
            message: '유효하지 않은 인증 토큰입니다.'
        });
    }
}

// Admin middleware - require admin privileges
export async function requireAdmin(req, res, next) {
    // First verify authentication
    if (!firebaseReady) {
        console.warn('Admin middleware skipped - Firebase not configured');
        return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: '인증이 필요합니다.'
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
            return res.status(403).json({
                error: 'Forbidden',
                message: '등록되지 않은 사용자입니다.'
            });
        }

        const userData = userDoc.data();

        if (!userData.isAdmin) {
            return res.status(403).json({
                error: 'Forbidden',
                message: '관리자 권한이 필요합니다.'
            });
        }

        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            isAdmin: true,
            isApproved: userData.isApproved
        };

        next();
    } catch (error) {
        console.error('Admin verification error:', error);
        return res.status(401).json({
            error: 'Unauthorized',
            message: '인증에 실패했습니다.'
        });
    }
}

// Check if Firebase Admin is ready
export function isFirebaseReady() {
    return firebaseReady;
}

// Export admin instance for use in routes
export { admin };
