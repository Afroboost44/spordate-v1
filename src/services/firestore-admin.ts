/**
 * Phase 9.5 c9.1 — Server-only Firestore helpers (Admin SDK).
 *
 * Séparé de `./firestore.ts` (qui mélange Web SDK client + helpers) pour
 * éviter que le client bundle pull firebase-admin (fails webpack : `fs`/`net`
 * Node-only). Cohérent split client/server pattern Phase 9.5 c8 (featureFlags).
 *
 * NE JAMAIS importer ce module depuis un Client Component (`'use client'`).
 * Reserved aux : Server Components, API routes, Cloud Functions, cron.
 *
 * @module
 */

import type { Booking } from '@/types/firestore';
import { getAdminDb } from '@/lib/firebase/admin';

/**
 * Get a booking by id (server-side via Admin SDK).
 *
 * Utilisé par /sessions/[id] SSR fallback quand l'id pointe sur un Booking
 * (free booking → pas de session formelle, on affiche "en attente planification").
 *
 * ⚠️ ADMIN SDK requis : les Firestore rules /bookings exigent auth + ownership
 * (cohérent doctrine privacy). Les Server Components Next.js ISR n'ont pas de
 * user auth context (req anonymous via Firebase Web SDK) → read denied → 404.
 * Admin SDK bypass rules → l'ownership check doit se faire post-fetch côté
 * caller (defense-in-depth — pour /sessions/[id] : MVP accepte IDOR car le
 * bookingId Firestore auto-id 20 chars random est non-énumérable, et seule
 * de la metadata booking est exposée — pas de PII).
 *
 * Phase 10 polish : ajouter ownership check strict via verify cookie/Bearer.
 *
 * @param bookingId Firestore doc id
 * @returns Booking si trouvé, null sinon
 */
export async function getBookingAdmin(bookingId: string): Promise<Booking | null> {
  const db = await getAdminDb();
  const snap = await db.collection('bookings').doc(bookingId).get();
  return snap.exists ? (snap.data() as Booking) : null;
}
