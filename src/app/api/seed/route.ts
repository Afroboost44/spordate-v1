/**
 * API Seed — Pré-remplit Firestore avec Afroboost comme partenaire unique
 * Usage: GET /api/seed?secret=spordate2026
 * À appeler UNE seule fois en production, puis supprimer ou désactiver.
 */

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  // Sécurité basique
  if (secret !== 'spordate2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Import Firebase Admin dynamiquement pour éviter les erreurs côté client
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');

    // Initialiser Firebase Admin si pas déjà fait
    if (getApps().length === 0) {
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (serviceAccount) {
        initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
      } else {
        // Fallback: utilise les variables d'environnement individuelles
        initializeApp({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
        });
      }
    }

    const db = getFirestore();
    const now = new Date();

    // ─── 1. CRÉER LE PARTENAIRE AFROBOOST ───
    const partnerId = 'afroboost-geneve';
    const partnerData = {
      partnerId,
      name: 'Afroboost Genève',
      email: 'contact.artboost@gmail.com',
      phone: '+41 XX XXX XX XX',
      address: 'Genève, Suisse',
      city: 'Genève',
      canton: 'GE',
      geoPoint: { latitude: 46.2044, longitude: 6.1432 },
      type: 'dance_studio',
      description: 'Studio de danse afro #1 à Genève. Cours d\'Afroboost, Afro Dance, Zumba et Dance Fitness dans une ambiance unique. Énergie, cardio et bonne humeur garantis !',
      logo: '/images/afroboost-logo.png',
      images: [
        'https://picsum.photos/seed/afroboost-studio1/800/600',
        'https://picsum.photos/seed/afroboost-studio2/800/600',
        'https://picsum.photos/seed/afroboost-studio3/800/600',
      ],
      subscriptionStatus: 'active',
      subscriptionEnd: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
      monthlyFee: 4900,
      promoCode: 'AFROBOOST2026',
      referralId: '',
      isApproved: true,
      isActive: true,
      totalBookings: 0,
      totalRevenue: 0,
      rating: 4.8,
      reviewCount: 12,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection('partners').doc(partnerId).set(partnerData);

    // ─── 2. CRÉER LES ACTIVITÉS D'AFROBOOST ───
    const activities = [
      {
        title: 'Afroboost — Cours collectif',
        sport: 'afroboost',
        description: 'Cours d\'Afroboost : mélange unique de danse africaine et de fitness cardio. Énergie pure, mouvements intuitifs, bonne humeur contagieuse. Tous niveaux bienvenus !',
        price: 2500, // 25.00 CHF
        duration: 60,
        maxParticipants: 20,
        tags: ['danse', 'afro', 'cardio', 'fitness', 'énergie'],
        schedule: [
          { day: 'mardi', start: '19:00', end: '20:00' },
          { day: 'jeudi', start: '19:00', end: '20:00' },
          { day: 'samedi', start: '10:00', end: '11:00' },
        ],
      },
      {
        title: 'Afro Dance — Session libre',
        sport: 'afro_dance',
        description: 'Mouvements africains authentiques, expression libre du corps. Chorégraphies modernes sur des rythmes afrobeats.',
        price: 2500,
        duration: 60,
        maxParticipants: 15,
        tags: ['danse', 'afro', 'chorégraphie', 'afrobeats'],
        schedule: [
          { day: 'mercredi', start: '18:30', end: '19:30' },
          { day: 'samedi', start: '11:30', end: '12:30' },
        ],
      },
      {
        title: 'Dance Fitness — Cardio dansé',
        sport: 'dance_fitness',
        description: 'Sculpte ton corps en t\'éclatant ! Mix de mouvements fitness sur des rythmes afro, latino et pop. Brûle des calories sans t\'en rendre compte.',
        price: 2000, // 20.00 CHF
        duration: 45,
        maxParticipants: 25,
        tags: ['fitness', 'danse', 'cardio', 'sculpt'],
        schedule: [
          { day: 'lundi', start: '12:15', end: '13:00' },
          { day: 'vendredi', start: '18:00', end: '18:45' },
        ],
      },
      {
        title: 'Zumba Afro — Party fitness',
        sport: 'zumba',
        description: 'La Zumba version Afroboost : rythmes africains et latins, ambiance party, résultats fitness. Aucune expérience requise !',
        price: 2000,
        duration: 50,
        maxParticipants: 30,
        tags: ['zumba', 'danse', 'party', 'latino', 'afro'],
        schedule: [
          { day: 'mardi', start: '12:15', end: '13:05' },
          { day: 'samedi', start: '14:00', end: '14:50' },
        ],
      },
    ];

    for (const act of activities) {
      const actRef = db.collection('activities').doc();
      await actRef.set({
        activityId: actRef.id,
        ...act,
        partnerId,
        partnerName: 'Afroboost Genève',
        city: 'Genève',
        address: 'Genève, Suisse',
        geoPoint: { latitude: 46.2044, longitude: 6.1432 },
        currency: 'CHF',
        currentParticipants: 0,
        images: [
          `https://picsum.photos/seed/${act.sport}-1/800/600`,
          `https://picsum.photos/seed/${act.sport}-2/800/600`,
        ],
        isActive: true,
        rating: 0,
        reviewCount: 0,
        createdBy: 'seed',
        createdAt: now,
        updatedAt: now,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Afroboost pré-rempli comme partenaire unique',
      partner: partnerId,
      activitiesCreated: activities.length,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
