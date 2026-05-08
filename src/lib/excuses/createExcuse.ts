/**
 * Phase 9 sub-chantier 5 commit 1/4 — createExcuse.
 *
 * User crée une excuse pré-session. Si créée ≥ 2h avant session.startAt (Q1=A),
 * markNoShow skip le threshold compute (audit trail préservé via /excuses/{id}).
 *
 * Validations :
 *  - userId, sessionId non vides
 *  - reason ≤ 300 chars (Q1=A EXCUSE_REASON_MAX_LENGTH)
 *  - session existe + session.startAt - now ≥ EXCUSE_WINDOW_HOURS_BEFORE_SESSION (2h)
 *  - userId a un booking confirmed sur cette session
 *  - Anti-doublon : pas d'excuse existante pour {userId, sessionId}
 *
 * Side-effects :
 *  - Create /excuses/{excuseId} doc (immutable audit)
 *  - Update bookings/{bookingId}.excusedAt = serverTimestamp() (denorm fast-check)
 *
 * Best-effort : update Booking.excusedAt n'invalide pas l'excuse si rules deny update
 * (markNoShow query /excuses/ direct — Booking flag est cosmétique fast-check).
 *
 * @throws ExcuseError typed code = 'invalid-input' | 'session-not-found' | 'not-confirmed-booker'
 *         | 'window-closed' | 'already-excused' | 'reason-too-long'
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Booking, Session } from '@/types/firestore';
import {
  EXCUSE_REASON_MAX_LENGTH,
  EXCUSE_WINDOW_HOURS_BEFORE_SESSION,
  ExcuseError,
  getExcusesDb,
} from './_internal';

export interface CreateExcuseInput {
  userId: string;
  sessionId: string;
  /** Raison libre 0-300 chars (optionnelle). */
  reason?: string;
  /** Override pour tests time-travel. Défaut new Date(). */
  now?: Date;
}

export interface CreateExcuseResult {
  excuseId: string;
  /** True si Booking.excusedAt update succeeded. False si best-effort fail (excuse créée OK). */
  bookingFlagUpdated: boolean;
}

export async function createExcuse(input: CreateExcuseInput): Promise<CreateExcuseResult> {
  // 1. Validation inputs
  if (!input.userId || !input.sessionId) {
    throw new ExcuseError('invalid-input', {
      userId: input.userId,
      sessionId: input.sessionId,
    });
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length > EXCUSE_REASON_MAX_LENGTH) {
    throw new ExcuseError('reason-too-long', {
      length: reason.length,
      max: EXCUSE_REASON_MAX_LENGTH,
    });
  }

  const now = input.now ?? new Date();
  const fbDb = getExcusesDb();

  // 2. Session existe
  const sessionSnap = await getDoc(doc(fbDb, 'sessions', input.sessionId));
  if (!sessionSnap.exists()) {
    throw new ExcuseError('session-not-found', { sessionId: input.sessionId });
  }
  const session = sessionSnap.data() as Session;

  // 3. Window check : session.startAt - now ≥ 2h
  const startAtMs = session.startAt.toMillis();
  const windowEndMs = startAtMs - EXCUSE_WINDOW_HOURS_BEFORE_SESSION * 60 * 60 * 1000;
  if (now.getTime() > windowEndMs) {
    throw new ExcuseError('window-closed', {
      sessionId: input.sessionId,
      sessionStartAtMs: startAtMs,
      windowEndMs,
      nowMs: now.getTime(),
      hoursBefore: EXCUSE_WINDOW_HOURS_BEFORE_SESSION,
    });
  }

  // 4. userId a booking confirmed sur cette session
  const bookingsSnap = await getDocs(
    query(
      collection(fbDb, 'bookings'),
      where('userId', '==', input.userId),
      where('sessionId', '==', input.sessionId),
    ),
  );
  const confirmedBooking = bookingsSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as Booking }))
    .find((b) => b.data.status === 'confirmed');
  if (!confirmedBooking) {
    throw new ExcuseError('not-confirmed-booker', {
      userId: input.userId,
      sessionId: input.sessionId,
    });
  }

  // 5. Anti-doublon : excuse existante pour {userId, sessionId} → reject
  const existingSnap = await getDocs(
    query(
      collection(fbDb, 'excuses'),
      where('userId', '==', input.userId),
      where('sessionId', '==', input.sessionId),
    ),
  );
  if (!existingSnap.empty) {
    throw new ExcuseError('already-excused', {
      userId: input.userId,
      sessionId: input.sessionId,
      existingExcuseId: existingSnap.docs[0].id,
    });
  }

  // 6. Create /excuses/{excuseId}
  const excuseRef = doc(collection(fbDb, 'excuses'));
  const excuseId = excuseRef.id;
  await setDoc(excuseRef, {
    excuseId,
    userId: input.userId,
    sessionId: input.sessionId,
    bookingId: confirmedBooking.id,
    reason,
    createdAt: serverTimestamp(),
  });

  // 7. Best-effort : update Booking.excusedAt (denorm fast-check)
  let bookingFlagUpdated = false;
  try {
    await updateDoc(doc(fbDb, 'bookings', confirmedBooking.id), {
      excusedAt: serverTimestamp(),
    });
    bookingFlagUpdated = true;
  } catch (err) {
    console.warn('[createExcuse] Booking.excusedAt update failed (non-blocking)', {
      excuseId,
      bookingId: confirmedBooking.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { excuseId, bookingFlagUpdated };
}
