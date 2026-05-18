/**
 * BUG #36 COMMIT 2 — Helpers UI render activity_invite.
 *
 *  - formatNextSessionLabel : convertit timestamp Date/Firestore en label
 *    humanisé FR ("Aujourd'hui 19h", "Demain 14h30", "mer. 20 mai 19h",
 *    "Date à venir").
 *  - resolveInviteCardView : décide rendu UI selon msg + currentUserId
 *    (isSender/isReceiver, status label/color, boutons visibles).
 *
 * Composants <ActivityInviteMessage> + <ActivitySelectorModal> +
 * <InviteModeModal> consomment ces helpers pour rendu cohérent.
 *
 * @module
 */

// =====================================================================
// formatNextSessionLabel
// =====================================================================

/** Type input flexible : Date, Firestore Timestamp, ou null/undefined. */
interface MaybeTimestamp {
  toDate?: () => Date;
  toMillis?: () => number;
}

const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;

function toDateMs(input: Date | MaybeTimestamp | null | undefined): number | null {
  if (!input) return null;
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'object') {
    if (typeof input.toMillis === 'function') return input.toMillis();
    if (typeof input.toDate === 'function') return input.toDate().getTime();
  }
  return null;
}

/**
 * Convertit un timestamp en label FR humanisé pour affichage card invite.
 *  - null/undefined → "Date à venir"
 *  - <24h → "Aujourd'hui {Hh}"
 *  - 24-48h → "Demain {Hh}"
 *  - 2-7j → "{jour-court} {jj mmm} {Hh}"
 *  - >7j → "{jj mmm yyyy}"
 */
export function formatNextSessionLabel(
  input: Date | MaybeTimestamp | null | undefined,
  nowMs: number = Date.now(),
): string {
  const ts = toDateMs(input);
  if (!ts) return 'Date à venir';
  const target = new Date(ts);
  const diff = ts - nowMs;
  const hours = target.getHours();
  const minutes = target.getMinutes();
  const timePart = minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, '0')}`;

  if (diff < DAY_MS && diff > -DAY_MS) {
    return `Aujourd'hui ${timePart}`;
  }
  if (diff < 2 * DAY_MS) {
    return `Demain ${timePart}`;
  }
  if (diff < WEEK_MS) {
    const dayLabel = target.toLocaleDateString('fr-CH', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${dayLabel} ${timePart}`;
  }
  return target.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' });
}

// =====================================================================
// resolveInviteCardView
// =====================================================================

interface InviteMessageShape {
  senderId: string;
  type?: string;
  inviteStatus?: 'pending' | 'accepted' | 'declined' | 'expired';
  invite?: { inviteMode?: 'individual' | 'duo' };
}

export interface InviteCardView {
  isSender: boolean;
  isReceiver: boolean;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  statusLabel: string;
  statusBadgeClass: string;
  showAcceptButton: boolean;
  showDeclineButton: boolean;
}

/**
 * Décide tout le rendu UI pour un msg activity_invite selon le user courant.
 *
 * Règles UX (alignées spec Bassi) :
 *  - sender (auteur) : voit le status, JAMAIS de boutons accept/decline
 *  - receiver + pending : voit les 2 boutons Accepter/Refuser
 *  - receiver + finalisé (accepted/declined/expired) : pas de boutons, juste status
 *  - défaut status si absent : 'pending'
 */
export function resolveInviteCardView(
  msg: InviteMessageShape,
  currentUserId: string,
): InviteCardView {
  const isSender = msg.senderId === currentUserId;
  const isReceiver = !isSender;
  const status = msg.inviteStatus ?? 'pending';

  let statusLabel: string;
  let statusBadgeClass: string;
  switch (status) {
    case 'accepted':
      statusLabel = 'Acceptée ✓';
      statusBadgeClass = 'bg-green-500/15 text-green-400 border-green-500/30';
      break;
    case 'declined':
      statusLabel = 'Refusée';
      statusBadgeClass = 'bg-white/5 text-white/40 border-white/10';
      break;
    case 'expired':
      statusLabel = 'Expirée';
      statusBadgeClass = 'bg-white/5 text-white/40 border-white/10';
      break;
    case 'pending':
    default:
      statusLabel = 'En attente';
      statusBadgeClass = 'bg-accent/15 text-accent border-accent/30';
      break;
  }

  const isPending = status === 'pending';
  return {
    isSender,
    isReceiver,
    status,
    statusLabel,
    statusBadgeClass,
    showAcceptButton: isReceiver && isPending,
    showDeclineButton: isReceiver && isPending,
  };
}
