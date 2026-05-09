/**
 * Phase 8 sub-chantier 4 commit 3/6 — POST /api/invites.
 *
 * Doctrine §E.Q1 mode Individuel Phase 8 : User A invite User B à une activity/session.
 * B reçoit notification + lien vers /invite/[id] pour accepter (Stripe checkout)
 * ou décliner.
 *
 * Pipeline :
 *   1. Verify Bearer ID token → fromUserId (auth uid)
 *   2. Validate body shape (toUserId, activityId, sessionId required)
 *   3. Call createInvite() service (helper SC4 commit 2/6)
 *   4. Best-effort sendEmail inviteReceived to toUserId (Q5=C — template SC4 commit 4/6)
 *   5. Best-effort createNotification in-app for toUserId (Q5=C)
 *   6. Return { inviteId, status: 'pending' }
 *
 * Error mapping HTTP :
 *   - missing/invalid Bearer → 401
 *   - InviteError 'invalid-input' / 'self-invite-forbidden' / 'session-too-soon' → 400
 *   - InviteError 'session-not-found' → 404
 *   - InviteError 'forbidden' → 403
 *   - autres → 500
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { createInvite, InviteError } from '@/lib/invites/service';
import { sendEmail } from '@/lib/email/sendEmail';
import type { Timestamp } from 'firebase-admin/firestore';

export const runtime = 'nodejs'; // firebase-admin requires Node.js
// DI seam `__setInvitesDbForTesting` est exporté depuis '@/lib/invites/service'
// (Next.js limite exports route à HTTP handlers + config — pas de re-export).

// =====================================================================
// Lazy Admin SDK init (cohérent /api/checkout, /api/suggest-activities)
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminDb: any = null;

async function getAdminDb() {
  if (_adminDb) return _adminDb;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
      initializeApp({
        projectId:
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          'spordateur-claude',
      });
    }
  }
  _adminDb = getFirestore();
  return _adminDb;
}

/** Format FR date courte cohérent SuggestionMessage component (ex: "Sam 18 mai · 14h00"). */
function formatSessionDateFR(ts: Timestamp | { toDate?: () => Date } | null | undefined): string {
  if (!ts || typeof ts !== 'object') return '';
  const date = typeof (ts as { toDate?: () => Date }).toDate === 'function'
    ? (ts as { toDate: () => Date }).toDate()
    : null;
  if (!date) return '';
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const months = ['jan', 'fév', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} · ${hours}h${minutes !== '00' ? minutes : ''}`;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Verify Bearer
    const fromUserId = await verifyAuth(request);
    if (!fromUserId) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    // 2. Parse + validate body
    const body = await request.json();
    if (
      typeof body?.toUserId !== 'string' ||
      typeof body?.activityId !== 'string' ||
      typeof body?.sessionId !== 'string' ||
      body.toUserId.length === 0 ||
      body.activityId.length === 0 ||
      body.sessionId.length === 0
    ) {
      return NextResponse.json(
        { error: 'invalid-input', detail: 'toUserId, activityId, sessionId required (non-empty strings)' },
        { status: 400 },
      );
    }

    // 3. Phase 9 SC2 c2/6 — parse mode + splitInviterRatio + resolve totalCents server-side
    const message = typeof body.message === 'string' ? body.message : undefined;
    const requestedMode = body.mode as string | undefined;
    let mode: 'individual' | 'split' | 'gift' = 'individual';
    if (requestedMode === 'split' || requestedMode === 'gift' || requestedMode === 'individual') {
      mode = requestedMode;
    } else if (requestedMode !== undefined) {
      return NextResponse.json(
        { error: 'invalid-mode', detail: `mode must be 'individual'|'split'|'gift' (reçu: ${requestedMode})` },
        { status: 400 },
      );
    }
    const splitInviterRatio =
      typeof body.splitInviterRatio === 'number' ? body.splitInviterRatio : undefined;

    // Resolve totalCents server-side via session.currentPrice (anti-cheat — pattern /api/checkout)
    let totalCents: number | undefined;
    if (mode !== 'individual') {
      try {
        const adminDb = await getAdminDb();
        const sessionSnap = await adminDb.collection('sessions').doc(body.sessionId).get();
        if (!sessionSnap.exists) {
          return NextResponse.json(
            { error: 'session-not-found', detail: `Session ${body.sessionId} introuvable` },
            { status: 404 },
          );
        }
        const sessionData = sessionSnap.data();
        totalCents = sessionData?.currentPrice as number | undefined;
        if (!totalCents || totalCents <= 0) {
          return NextResponse.json(
            { error: 'invalid-total-cents', detail: 'Session.currentPrice non disponible pour mode Split/Gift' },
            { status: 400 },
          );
        }
      } catch (err) {
        console.warn('[/api/invites] totalCents resolve failed', err);
        return NextResponse.json(
          { error: 'internal-error', detail: 'totalCents resolve failed' },
          { status: 500 },
        );
      }
    }

    const inviteId = await createInvite({
      fromUserId,
      toUserId: body.toUserId,
      activityId: body.activityId,
      sessionId: body.sessionId,
      message,
      mode,
      splitInviterRatio,
      totalCents,
    });

    // 4-5. Best-effort sendEmail + createNotification in-app (Phase 8 SC4 commit 4/6)
    // Q5=C both notifications. Failure non-bloquant (cohérent pattern Phase 7 wires).
    try {
      const adminDb = await getAdminDb();
      const [toUserSnap, fromUserSnap, activitySnap, sessionSnap] = await Promise.all([
        adminDb.collection('users').doc(body.toUserId).get(),
        adminDb.collection('users').doc(fromUserId).get(),
        adminDb.collection('activities').doc(body.activityId).get(),
        adminDb.collection('sessions').doc(body.sessionId).get(),
      ]);
      const toUserEmail = toUserSnap.data()?.email as string | undefined;
      const toUserName = toUserSnap.data()?.displayName as string | undefined;
      const fromUserName = (fromUserSnap.data()?.displayName as string | undefined) || 'Un membre Spordateur';
      const activityTitle = (activitySnap.data()?.title as string | undefined) || 'une activité';
      const sessionDate = formatSessionDateFR(sessionSnap.data()?.startAt);
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';

      // 4. sendEmail (mode-aware Phase 9 SC2 c2/6 — best-effort)
      if (toUserEmail) {
        const inviteLink = `${baseUrl}/invite/${inviteId}`;
        try {
          if (mode === 'split' && totalCents) {
            // Re-compute amounts pour template (cohérent service)
            const { computeSplitAmounts } = await import('@/lib/invites/splitMath');
            const amounts = computeSplitAmounts({ totalCents, mode: 'split', splitInviterRatio });
            await sendEmail({
              to: toUserEmail,
              templateName: 'inviteReceivedSplit',
              templateData: {
                fromUserName,
                toUserName,
                activityTitle,
                sessionDate,
                inviteLink,
                message,
                inviterAmountChf: (amounts.inviterCents / 100).toFixed(2),
                inviteeAmountChf: (amounts.inviteeCents / 100).toFixed(2),
                totalAmountChf: (totalCents / 100).toFixed(2),
              },
            });
          } else if (mode === 'gift' && totalCents) {
            await sendEmail({
              to: toUserEmail,
              templateName: 'inviteReceivedGift',
              templateData: {
                fromUserName,
                toUserName,
                activityTitle,
                sessionDate,
                inviteLink,
                message,
                totalAmountChf: (totalCents / 100).toFixed(2),
              },
            });
          } else {
            // mode === 'individual' (default + legacy compat Phase 8 SC4)
            await sendEmail({
              to: toUserEmail,
              templateName: 'inviteReceived',
              templateData: {
                fromUserName,
                toUserName,
                activityTitle,
                sessionDate,
                inviteLink,
                message,
              },
            });
          }
        } catch (err) {
          console.warn('[/api/invites] sendEmail invite (mode-aware) failed (non-bloquant)', err);
        }
      }

      // 5. createNotification in-app (best-effort) pour toUserId
      try {
        const { FieldValue } = await import('firebase-admin/firestore');
        const notifRef = adminDb.collection('notifications').doc();
        await notifRef.set({
          notificationId: notifRef.id,
          userId: body.toUserId,
          type: 'invite_received',
          title: `${fromUserName} t'invite à ${activityTitle}`,
          body: sessionDate || activityTitle,
          data: { inviteId, fromUserId, fromUserName, activityTitle },
          isRead: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn('[/api/invites] createNotification failed (non-bloquant)', err);
      }
    } catch (err) {
      // Reads Admin SDK fail (rare) — skip notifs entirely
      console.warn('[/api/invites] Admin SDK reads failed (notifs skipped)', err);
    }

    return NextResponse.json(
      {
        inviteId,
        status: 'pending',
        mode,
        // Phase 9 SC2 c2/6 — Stripe checkout pre-pay URL pour modes Split/Gift sera
        // ajoutée par commit 3/6 (extension /api/checkout mode='invite-prepay').
        // Pour ce commit, on persiste l'invite avec montants ; le client (commit 5/6)
        // déclenchera le pre-pay checkout séparément si mode!='individual'.
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof InviteError) {
      const status =
        err.code === 'invalid-input' ||
        err.code === 'self-invite-forbidden' ||
        err.code === 'session-too-soon' ||
        err.code === 'invalid-mode' ||
        err.code === 'invalid-split-ratio' ||
        err.code === 'invalid-total-cents'
          ? 400
          : err.code === 'session-not-found'
            ? 404
            : err.code === 'forbidden'
              ? 403
              : 500;
      return NextResponse.json({ error: err.code, detail: err.message }, { status });
    }
    console.error('[/api/invites POST] unexpected error:', err);
    return NextResponse.json(
      { error: 'internal-error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
