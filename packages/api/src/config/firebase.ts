// ============================================
// LeadChat API — Firebase Admin SDK Initialization
// Used for: token verification, user management
// ============================================

import admin from 'firebase-admin';
import { config } from './index.js';

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK.
 * Uses service account credentials from environment variables.
 * Safe to call multiple times — only initializes once.
 */
export function initializeFirebase(): void {
  if (firebaseInitialized) return;

  const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = config;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    console.warn('⚠️  Firebase credentials not configured — auth will use dev bypass only');
    return;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        // The private key comes escaped from .env — unescape newlines
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: FIREBASE_CLIENT_EMAIL,
      }),
      storageBucket: config.FIREBASE_STORAGE_BUCKET,
    });

    firebaseInitialized = true;
    console.log('🔥 Firebase Admin SDK initialized');
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed:', error);
  }
}

/**
 * Get Firebase Auth instance.
 * Initialize on first call if needed.
 */
export function getFirebaseAuth(): admin.auth.Auth {
  if (!firebaseInitialized) {
    initializeFirebase();
  }
  return admin.auth();
}

/**
 * Verify a Firebase ID token and return the decoded claims.
 * Returns null if verification fails.
 */
export async function verifyFirebaseToken(
  idToken: string,
): Promise<admin.auth.DecodedIdToken | null> {
  try {
    const auth = getFirebaseAuth();
    const decoded = await auth.verifyIdToken(idToken);
    return decoded;
  } catch (error) {
    console.error('❌ Firebase token verification failed:', error);
    return null;
  }
}

export { admin };
