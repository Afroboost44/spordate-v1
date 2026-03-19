/**
 * Spordateur V2 — Partner Request API
 * Saves partner requests via Firebase Admin (bypasses Firestore security rules)
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

let _db: FirebaseFirestore.Firestore | null = null;

async function initAdmin() {
  if (_db) return _db;

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude' });
    }
  }

  _db = getFirestore();
  return _db;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, phone, activity, city } = body;

    if (!name || !email || !activity || !city) {
      return NextResponse.json({ error: 'Champs obligatoires manquants.' }, { status: 400 });
    }

    const db = await initAdmin();

    // Save to partnerRequests collection
    const requestRef = db.collection('partnerRequests').doc();
    await requestRef.set({
      requestId: requestRef.id,
      name,
      email,
      phone: phone || '',
      activity,
      city,
      status: 'pending',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create admin notification
    const notifRef = db.collection('notifications').doc();
    await notifRef.set({
      notificationId: notifRef.id,
      userId: 'admin',
      type: 'partner_request',
      title: 'Nouvelle demande partenaire',
      body: `${name} (${city}) souhaite rejoindre Spordateur.`,
      data: { requestId: requestRef.id, partnerName: name, email },
      isRead: false,
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, requestId: requestRef.id });
  } catch (err: any) {
    console.error('[Partner Request API]', err);
    return NextResponse.json({ error: err.message || 'Erreur serveur.' }, { status: 500 });
  }
}

// GET: list partner requests (for admin)
export async function GET(req: NextRequest) {
  try {
    const db = await initAdmin();
    const snap = await db.collection('partnerRequests').orderBy('createdAt', 'desc').limit(50).get();
    const requests = snap.docs.map(d => ({ ...d.data(), requestId: d.id }));
    return NextResponse.json({ requests });
  } catch (err: any) {
    console.error('[Partner Request API GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
