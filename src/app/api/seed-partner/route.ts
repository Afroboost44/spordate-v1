/**
 * Seed Partner API — Creates a test partner account
 * Uses Firebase Admin for Firestore + Auth
 * Usage: POST /api/seed-partner?secret=spordate2026
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

let _admin: { db: FirebaseFirestore.Firestore; auth: any } | null = null;

async function initAdmin() {
  if (_admin) return _admin;

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude' });
    }
  }

  _admin = { db: getFirestore(), auth: getAuth() };
  return _admin;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== 'spordate2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { email, password, name, city, phone, type } = body;

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'email, password, name requis' }, { status: 400 });
    }

    const { db, auth } = await initAdmin();

    // 1. Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: name,
      });
    } catch (authErr: any) {
      if (authErr.code === 'auth/email-already-exists') {
        // User already exists, get their record
        userRecord = await auth.getUserByEmail(email);
      } else {
        throw authErr;
      }
    }

    // 2. Create partner document in Firestore
    const partnerId = `partner-${userRecord.uid}`;
    const now = new Date();

    await db.collection('partners').doc(partnerId).set({
      partnerId,
      name,
      email,
      phone: phone || '',
      address: city || '',
      city: city || 'Genève',
      canton: '',
      geoPoint: { latitude: 46.2044, longitude: 6.1432 },
      type: type || 'studio',
      description: '',
      logo: '',
      images: [],
      subscriptionStatus: 'active', // Free access for test
      subscriptionEnd: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
      monthlyFee: 0,
      promoCode: 'TEST',
      referralId: '',
      isApproved: true,
      isActive: true,
      totalBookings: 0,
      totalRevenue: 0,
      rating: 0,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    // 3. Also create/update user document
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      displayName: name,
      email,
      role: 'partner',
      city: city || 'Genève',
      isPremium: false,
      credits: 0,
      createdAt: now,
    }, { merge: true });

    return NextResponse.json({
      success: true,
      message: `Partenaire "${name}" créé avec succès`,
      uid: userRecord.uid,
      partnerId,
      email,
      loginUrl: '/partner/login',
    });
  } catch (err: any) {
    console.error('[Seed Partner]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
