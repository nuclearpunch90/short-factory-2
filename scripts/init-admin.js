import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

async function createAdminUser(email, password) {
    console.log(`Creating admin user: ${email}`);

    try {
        // Check if user already exists
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(email);
            console.log(`User already exists with UID: ${userRecord.uid}`);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Create new user
                userRecord = await auth.createUser({
                    email: email,
                    password: password,
                    emailVerified: true
                });
                console.log(`Created new user with UID: ${userRecord.uid}`);
            } else {
                throw error;
            }
        }

        // Create or update Firestore document
        const userRef = db.collection('users').doc(userRecord.uid);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            // Update existing document to ensure admin status
            await userRef.update({
                isAdmin: true,
                isApproved: true
            });
            console.log('Updated existing user document to admin');
        } else {
            // Create new document
            await userRef.set({
                email: email,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isAdmin: true,
                isApproved: true,
                activeSessionId: null,
                createdBy: 'system'
            });
            console.log('Created new user document in Firestore');
        }

        console.log('\n✅ Admin user setup complete!');
        console.log(`   Email: ${email}`);
        console.log(`   UID: ${userRecord.uid}`);
        console.log(`   Admin: true`);
        console.log(`   Approved: true`);

    } catch (error) {
        console.error('Error creating admin user:', error);
        throw error;
    }
}

// Run
const email = 'moonlight8909@gmail.com';
const password = '10421243';

createAdminUser(email, password)
    .then(() => {
        console.log('\nDone!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Failed:', error);
        process.exit(1);
    });
