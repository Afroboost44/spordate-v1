/**
 * Phase 8 sub-chantier 4 commit 5/6 — Page user-facing /invite/[id].
 *
 * Server Component (Next.js 15 async params). Charge invite + activity + session
 * + fromUser/toUser names via Admin SDK. Render selon status :
 *   - 'pending' : header invite + activity + sessionDate + message? + actions client
 *   - 'accepted' : "Invitation acceptée ✅" + lien session
 *   - 'declined' : "Invitation refusée"
 *   - 'expired' : "Invitation expirée"
 *   - 'not-found' : 404
 *
 * Doctrine §E inline message bot card SC3 → SuggestionCard avec InviteButton SC4 →
 * /invite/[id] page (cette page) → click "Accepter" → Stripe checkout → success
 * redirect /sessions/[id] (webhook update Invite.status='accepted' SC4 c4/6).
 *
 * Privacy : page accessible avec inviteId (link sharing) — affiche infos publiques
 * (activityTitle, sessionDate, fromUserName). Auth restriction sur les actions
 * (accept/decline) gérée par InviteActionsClient (toUserId only). Hardening Phase 9
 * peut ajouter rule-level access check.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Calendar, MapPin, MessageSquare } from 'lucide-react';
import { InviteActionsClient, InviteRefundBanner } from '@/components/invites/InviteActionsClient';
import {
  InviteBackLink,
  InviteHeading,
  InviteViewSessionLink,
  InviteDeclinedRetry,
  InviteExpiredMessage,
} from '@/components/invites/InvitePageTexts';
import { getAdminDb } from '@/lib/firebase/admin';

export const dynamic = 'force-dynamic'; // Toujours fresh status

// =====================================================================
// Lazy Admin SDK init (cohérent /api/checkout, /api/invites)
// =====================================================================

type RefundStatusUI =
  | 'pending'
  | 'in-progress'
  | 'succeeded'
  | 'failed'
  | 'manual-review'
  | 'not-applicable'
  | null;

interface InvitePageData {
  inviteId: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  activityId: string;
  activityTitle: string;
  city: string;
  sport: string;
  sessionDate: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  message?: string;
  isExpired: boolean;
  sessionId?: string;
  refundStatus: RefundStatusUI;
  refundedAtISO: string | null;
}

const FR_DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const FR_MONTHS = ['jan', 'fév', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

function formatDateFR(date: Date): string {
  const day = FR_DAYS[date.getDay()];
  const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
  const dateNum = date.getDate();
  const month = FR_MONTHS[date.getMonth()];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${dayLabel} ${dateNum} ${month} · ${hours}h${minutes !== '00' ? minutes : ''}`;
}

async function loadInviteData(inviteId: string): Promise<InvitePageData | null> {
  try {
    const db = await getAdminDb();
    const inviteSnap = await db.collection('invites').doc(inviteId).get();
    if (!inviteSnap.exists) return null;
    const invite = inviteSnap.data();

    const [fromSnap, toSnap, activitySnap, sessionSnap] = await Promise.all([
      db.collection('users').doc(invite.fromUserId).get(),
      db.collection('users').doc(invite.toUserId).get(),
      db.collection('activities').doc(invite.activityId).get(),
      invite.sessionId ? db.collection('sessions').doc(invite.sessionId).get() : Promise.resolve(null),
    ]);

    const sessionStartAt = sessionSnap?.data()?.startAt;
    const sessionDate =
      sessionStartAt && typeof sessionStartAt.toDate === 'function'
        ? formatDateFR(sessionStartAt.toDate())
        : '';

    // Compute effective status (read can be 'pending' but expiresAt passé)
    const expiresAtMs =
      invite.expiresAt && typeof invite.expiresAt.toMillis === 'function' ? invite.expiresAt.toMillis() : 0;
    const isExpired = invite.status === 'pending' && expiresAtMs <= Date.now();
    const effectiveStatus = isExpired ? ('expired' as const) : (invite.status as InvitePageData['status']);

    // Fix audit refund visibility — extrait refundState pour rendu UI conditionnel
    const refundStatusRaw = invite.refundState?.status as string | undefined;
    const validRefundStatuses: RefundStatusUI[] = [
      'pending',
      'in-progress',
      'succeeded',
      'failed',
      'manual-review',
      'not-applicable',
    ];
    const refundStatus: RefundStatusUI = validRefundStatuses.includes(refundStatusRaw as RefundStatusUI)
      ? (refundStatusRaw as RefundStatusUI)
      : null;
    const refundedAtVal = invite.refundState?.refundedAt;
    const refundedAtISO =
      refundedAtVal && typeof refundedAtVal.toDate === 'function'
        ? (refundedAtVal.toDate() as Date).toISOString()
        : null;

    return {
      inviteId,
      fromUserId: invite.fromUserId,
      fromUserName: (fromSnap.data()?.displayName as string) || 'Un membre Spordateur',
      toUserId: invite.toUserId,
      toUserName: (toSnap.data()?.displayName as string) || 'Membre Spordateur',
      activityId: invite.activityId,
      activityTitle: (activitySnap.data()?.title as string) || 'Activity',
      city: (activitySnap.data()?.city as string) || '',
      sport: (activitySnap.data()?.sport as string) || '',
      sessionDate,
      status: effectiveStatus,
      message: invite.message as string | undefined,
      isExpired,
      sessionId: invite.sessionId as string | undefined,
      refundStatus,
      refundedAtISO,
    };
  } catch (err) {
    console.error('[/invite/[id]] loadInviteData error:', err);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await loadInviteData(id);
  if (!data) return { title: 'Invitation introuvable — Spordateur' };
  return {
    title: `Invitation : ${data.activityTitle} — Spordateur`,
    description: `${data.fromUserName} t'invite à ${data.activityTitle}${data.sessionDate ? ` (${data.sessionDate})` : ''}`,
  };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadInviteData(id);

  if (!data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <InviteBackLink />

        {/* Header status badge */}
        <div className="mb-6">
          <StatusBadge status={data.status} />
        </div>

        <InviteHeading status={data.status} fromUserName={data.fromUserName} />

        {/* Activity card */}
        <div className="bg-white/5 rounded-2xl p-6 mt-6 space-y-3">
          <h2 className="text-xl text-white font-medium">{data.activityTitle}</h2>
          <div className="flex items-center gap-2 text-white/50 text-sm font-light">
            <span className="capitalize">{data.sport}</span>
            {data.city && (
              <>
                <span className="text-white/20">•</span>
                <MapPin className="h-3.5 w-3.5" />
                <span>{data.city}</span>
              </>
            )}
          </div>
          {data.sessionDate && (
            <div className="flex items-center gap-2 text-white/70 text-sm font-light">
              <Calendar className="h-4 w-4 text-accent" />
              <span>{data.sessionDate}</span>
            </div>
          )}
          {data.message && data.status === 'pending' && (
            <div className="border-l-2 border-accent/40 pl-3 py-2 mt-4">
              <div className="flex items-start gap-2 text-white/60 text-sm italic font-light">
                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>« {data.message} »</span>
              </div>
            </div>
          )}
        </div>

        {/* Actions ou message status */}
        <div className="mt-6">
          {data.status === 'pending' && (
            <InviteActionsClient
              inviteId={data.inviteId}
              fromUserId={data.fromUserId}
              toUserId={data.toUserId}
              toUserName={data.toUserName}
            />
          )}

          {data.status === 'accepted' && data.sessionId && (
            <div className="space-y-3">
              <p className="text-white/70 font-light text-sm leading-relaxed">
                {data.toUserName} a accepté et payé. Vous êtes tous les deux confirmés sur cette session.
              </p>
              <InviteViewSessionLink sessionId={data.sessionId} />
            </div>
          )}

          {data.status === 'declined' && (
            <>
              <InviteDeclinedRetry toUserName={data.toUserName} />
              <InviteRefundBanner
                refundStatus={data.refundStatus}
                refundedAtISO={data.refundedAtISO}
              />
            </>
          )}

          {data.status === 'expired' && (
            <>
              <InviteExpiredMessage />
              <InviteRefundBanner
                refundStatus={data.refundStatus}
                refundedAtISO={data.refundedAtISO}
              />
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-12 pt-6 border-t border-zinc-800">
          <p className="text-xs text-white/30 font-light leading-relaxed">
            Doctrine §E mode Individuel Phase 8 : chacun paie sa part en acceptant. Les modes Split / Gift sont
            planifiés pour Phase 9.{' '}
            <Link href="/terms" className="hover:text-white/50 underline">
              CGU
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: InvitePageData['status'] }) {
  const labels: Record<InvitePageData['status'], { text: string; cls: string }> = {
    pending: { text: 'En attente', cls: 'bg-accent/10 text-accent border-accent/30' },
    accepted: { text: 'Acceptée', cls: 'bg-green-600/10 text-green-400 border-green-600/30' },
    declined: { text: 'Refusée', cls: 'bg-zinc-800 text-white/50 border-zinc-700' },
    expired: { text: 'Expirée', cls: 'bg-orange-600/10 text-orange-400 border-orange-600/30' },
  };
  const { text, cls } = labels[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}
