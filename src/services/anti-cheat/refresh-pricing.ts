/**
 * Spordateur — Phase 6 (anti-cheat)
 * Helper de refresh server-side du pricing tier+price des sessions ouvertes.
 *
 * Vecteur fix : V5 du rapport audit Phase 6 — sans booking, currentTier reste stale
 * au passage du temps (ex: 'early' au-delà de J-7 alors que 'standard' devrait s'appliquer).
 *
 * Architecture :
 * - Pure helper Phase 2 réutilisé : computePricingTier(session, now, participants)
 * - Admin SDK Firestore (lazy init, pattern identique à webhooks/stripe/handler.ts)
 * - Race-safe via runTransaction (Firestore SDK retry 5× automatique sur conflit)
 *
 * Trigger-agnostic — consommateurs :
 * - Firebase Cloud Functions Scheduler Phase 6 (option B retenue, mai 2026)
 * - Phase 8 admin UI (refresh manuel single-session via refreshSessionPricing)
 *
 * Logging : préfixe [anti-cheat:cron], format JSON-stringifié → Sentry-ready Phase 8.
 *
 * Cf. architecture.md §10 Phase 6 + audit Phase 6 mai 2026.
 */

import { computePricingTier } from '@/services/firestore';
import type { Session, SessionStatus, PricingTierKind } from '@/types/firestore';

// =============================================================
// Lazy init Admin SDK (pattern webhooks/stripe/handler.ts)
// =============================================================

type AdminFirestore = import('firebase-admin/firestore').Firestore;
type AdminFieldValue = typeof import('firebase-admin/firestore').FieldValue;

let _db: AdminFirestore | null = null;
let _FV: AdminFieldValue | null = null;

async function initAdmin(): Promise<{ db: AdminFirestore; FV: AdminFieldValue }> {
  if (_db && _FV) return { db: _db, FV: _FV };

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
      });
    } else {
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spordateur-claude',
      });
    }
  }

  _db = getFirestore();
  _FV = FieldValue;
  return { db: _db, FV: _FV };
}

// =============================================================
// Constants & types
// =============================================================

const LOG_PREFIX = '[anti-cheat:cron]';
const REFRESH_BATCH_LIMIT = 500;
const VALID_REFRESH_STATUSES: readonly SessionStatus[] = ['scheduled', 'open'] as const;

export type SessionRefreshStatus =
  | 'updated' // tx update committed
  | 'skipped-fresh' // tier+price déjà corrects (incluant cas race-detected dans la tx)
  | 'skipped-started' // session.startAt < now
  | 'skipped-status' // session.status ∉ ['scheduled', 'open']
  | 'dry-run-would-update' // dryRun=true et un changement aurait eu lieu
  | 'error'; // exception capturée

export interface RefreshOptions {
  /** Limite max de sessions traitées dans le batch. Défaut REFRESH_BATCH_LIMIT (500). */
  limit?: number;
  /** Override de l'heure courante. Utile pour tests time-travel. Défaut new Date(). */
  now?: Date;
  /** Si true, log + retourne ce qui SERAIT changé sans write Firestore. Audit prod. Défaut false. */
  dryRun?: boolean;
  /** Si true, batch retourne outcomes[] détaillé. Utile tests/admin Phase 8. Défaut false. */
  includeDetails?: boolean;
}

export interface SessionRefreshOutcome {
  sessionId: string;
  status: SessionRefreshStatus;
  oldTier?: PricingTierKind;
  newTier?: PricingTierKind;
  oldPrice?: number;
  newPrice?: number;
  /** Populated uniquement si status === 'error'. */
  error?: string;
  /** Wall-clock pour debug perf single-session. */
  durationMs?: number;
}

export interface RefreshResult {
  processed: number;
  updated: number;
  /** Count des status='skipped-fresh' (incluant les race-detected dans la tx). */
  skipped: number;
  startedSkipped: number;
  statusSkipped: number;
  dryRunWouldUpdate: number;
  errors: Array<{ sessionId: string; error: string }>;
  durationMs: number;
  /** ISO timestamp du début du batch. */
  ranAt: string;
  dryRun: boolean;
  /** Populated si opts.includeDetails === true. */
  outcomes?: SessionRefreshOutcome[];
}

// =============================================================
// Internal logger
// =============================================================

type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, payload: Record<string, unknown>): void {
  const fn =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(LOG_PREFIX, JSON.stringify({ level, ts: new Date().toISOString(), ...payload }));
}

// =============================================================
// Single-session refresh
// =============================================================

/**
 * Refresh pricing tier+price pour UNE session.
 *
 * Ne throw jamais — errors capturées dans l'outcome retourné.
 *
 * Cas race condition (autre process refresh entre nos 2 reads dans la tx) :
 * - log 'tx-conflict-detected' (warn level)
 * - retourne 'skipped-fresh' (sémantique : ce tick n'a rien committé lui-même)
 *
 * Utilisé par :
 * - refreshAllOpenSessionsPricing (boucle batch)
 * - Phase 8 admin UI (refresh manuel d'une session)
 */
export async function refreshSessionPricing(
  sessionId: string,
  opts?: RefreshOptions,
): Promise<SessionRefreshOutcome> {
  const start = Date.now();
  const now = opts?.now ?? new Date();
  const dryRun = opts?.dryRun ?? false;

  try {
    const { db, FV } = await initAdmin();
    const sessionRef = db.collection('sessions').doc(sessionId);
    const snap = await sessionRef.get();

    if (!snap.exists) {
      const error = 'not-found';
      log('error', { event: 'session-error', sessionId, error });
      return { sessionId, status: 'error', error, durationMs: Date.now() - start };
    }

    const session = snap.data() as Session;

    if (!VALID_REFRESH_STATUSES.includes(session.status)) {
      log('info', { event: 'session-skipped-status', sessionId, status: session.status });
      return { sessionId, status: 'skipped-status', durationMs: Date.now() - start };
    }

    if (session.startAt.toMillis() < now.getTime()) {
      log('info', {
        event: 'session-skipped-started',
        sessionId,
        startAtMs: session.startAt.toMillis(),
      });
      return { sessionId, status: 'skipped-started', durationMs: Date.now() - start };
    }

    const { tier: newTier, price: newPrice } = computePricingTier(
      session,
      now,
      session.currentParticipants,
    );

    if (newTier === session.currentTier && newPrice === session.currentPrice) {
      log('info', { event: 'session-fresh', sessionId, currentTier: newTier });
      return {
        sessionId,
        status: 'skipped-fresh',
        oldTier: newTier,
        newTier,
        oldPrice: newPrice,
        newPrice,
        durationMs: Date.now() - start,
      };
    }

    if (dryRun) {
      log('info', {
        event: 'session-dry-run',
        sessionId,
        oldTier: session.currentTier,
        newTier,
        oldPrice: session.currentPrice,
        newPrice,
      });
      return {
        sessionId,
        status: 'dry-run-would-update',
        oldTier: session.currentTier,
        newTier,
        oldPrice: session.currentPrice,
        newPrice,
        durationMs: Date.now() - start,
      };
    }

    // Write réel via tx race-safe — Firestore SDK retry 5× automatique sur conflit
    let raceConflict = false;

    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(sessionRef);
      const freshSession = freshSnap.data() as Session;

      if (!VALID_REFRESH_STATUSES.includes(freshSession.status)) {
        // Status changed mid-tx (e.g. devenu 'full' par booking concurrent) — abandon
        throw new Error('status-changed-mid-tx');
      }

      const { tier: reTier, price: rePrice } = computePricingTier(
        freshSession,
        now,
        freshSession.currentParticipants,
      );

      if (reTier === freshSession.currentTier && rePrice === freshSession.currentPrice) {
        // Race : un autre process a déjà refresh entre nos 2 reads → no-op
        raceConflict = true;
        return;
      }

      tx.update(sessionRef, {
        currentTier: reTier,
        currentPrice: rePrice,
        updatedAt: FV.serverTimestamp(),
      });
    });

    if (raceConflict) {
      log('warn', { event: 'tx-conflict-detected', sessionId });
      return {
        sessionId,
        status: 'skipped-fresh',
        oldTier: newTier,
        newTier,
        oldPrice: newPrice,
        newPrice,
        durationMs: Date.now() - start,
      };
    }

    log('info', {
      event: 'session-updated',
      sessionId,
      oldTier: session.currentTier,
      newTier,
      oldPrice: session.currentPrice,
      newPrice,
      durationMs: Date.now() - start,
    });

    return {
      sessionId,
      status: 'updated',
      oldTier: session.currentTier,
      newTier,
      oldPrice: session.currentPrice,
      newPrice,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log('error', {
      event: 'session-error',
      sessionId,
      error: errMsg,
      durationMs: Date.now() - start,
    });
    return { sessionId, status: 'error', error: errMsg, durationMs: Date.now() - start };
  }
}

// =============================================================
// Batch refresh — entry point cron (trigger-agnostic)
// =============================================================

/**
 * Batch refresh — entry point cron (trigger-agnostic).
 *
 * Query Admin SDK : sessions WHERE status IN ('scheduled','open') LIMIT opts.limit ?? 500.
 * Pour chaque session : appelle refreshSessionPricing.
 * Agrège les counts par status, errors[] séparé.
 *
 * Ne throw jamais — errors agrégées dans result.errors[] (incl. erreurs query batch sous
 * sessionId='__BATCH__').
 *
 * Compatible :
 * - Firebase Cloud Functions Scheduler (functions/scheduler.ts) — option retenue Phase 6
 * - Vercel Cron Job (Pro plan, fallback option)
 * - Tests directs (avec opts.now override)
 */
export async function refreshAllOpenSessionsPricing(
  opts?: RefreshOptions,
): Promise<RefreshResult> {
  const start = Date.now();
  const ranAt = new Date(start).toISOString();
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? REFRESH_BATCH_LIMIT;
  const dryRun = opts?.dryRun ?? false;
  const includeDetails = opts?.includeDetails ?? false;

  log('info', { event: 'batch-started', limit, dryRun });

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let startedSkipped = 0;
  let statusSkipped = 0;
  let dryRunWouldUpdate = 0;
  const errors: Array<{ sessionId: string; error: string }> = [];
  const outcomes: SessionRefreshOutcome[] = [];

  try {
    const { db } = await initAdmin();
    const snap = await db
      .collection('sessions')
      .where('status', 'in', ['scheduled', 'open'])
      .limit(limit)
      .get();

    processed = snap.size;

    for (const doc of snap.docs) {
      const outcome = await refreshSessionPricing(doc.id, { now, dryRun });
      switch (outcome.status) {
        case 'updated':
          updated++;
          break;
        case 'skipped-fresh':
          skipped++;
          break;
        case 'skipped-started':
          startedSkipped++;
          break;
        case 'skipped-status':
          statusSkipped++;
          break;
        case 'dry-run-would-update':
          dryRunWouldUpdate++;
          break;
        case 'error':
          errors.push({
            sessionId: outcome.sessionId,
            error: outcome.error ?? 'unknown',
          });
          break;
      }
      if (includeDetails) outcomes.push(outcome);
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log('error', { event: 'session-error', sessionId: '__BATCH__', error: errMsg });
    errors.push({ sessionId: '__BATCH__', error: errMsg });
  }

  const durationMs = Date.now() - start;

  const result: RefreshResult = {
    processed,
    updated,
    skipped,
    startedSkipped,
    statusSkipped,
    dryRunWouldUpdate,
    errors,
    durationMs,
    ranAt,
    dryRun,
  };
  if (includeDetails) result.outcomes = outcomes;

  log('info', {
    event: 'batch-completed',
    processed,
    updated,
    skipped,
    startedSkipped,
    statusSkipped,
    dryRunWouldUpdate,
    errorCount: errors.length,
    durationMs,
    dryRun,
  });

  return result;
}
