/**
 * Phase 7 sub-chantier 3 commit 5/5 — <SanctionBanner>.
 *
 * Banner sticky top affiché si user logged a une UserSanction active.
 * Q4 décision : banner sticky + lien recours mailto contact@spordateur.com.
 * Q6 décision : check au login + setInterval 5 min (custom claims Phase 9).
 *
 * Render selon level :
 *  - warning : background #D91CD2/20 + texte avertissement
 *  - suspension_7d/30d : background red/30 + texte "compte suspendu jusqu'au {endsAt}"
 *  - ban_permanent : background red/50 + texte "compte banni définitivement"
 *
 * Si appealable et appealUsed=false : lien mailto "Faire appel" avec subject
 * "Appel sanction {sanctionId}" pré-rempli.
 *
 * Charte stricte : pas de couleurs hors black/#D91CD2/white (red ici utilisé
 * sémantiquement pour signaler danger sanction effective — exception consentie
 * pour signal critique vs charte décorative).
 */

'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getActiveUserSanction } from '@/lib/reports';
import type { UserSanction } from '@/types/firestore';

const SANCTION_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 min (Q6)
const APPEAL_EMAIL = 'contact@spordateur.com';

function formatEndsAt(sanction: UserSanction): string {
  if (!sanction.endsAt) return '';
  const date = sanction.endsAt.toDate();
  return date.toLocaleDateString('fr-CH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function getLevelMessage(sanction: UserSanction): { headline: string; toneClass: string } {
  switch (sanction.level) {
    case 'warning':
      return {
        headline: 'Avertissement enregistré sur ton compte',
        toneClass: 'bg-[#D91CD2]/20 border-[#D91CD2]/40',
      };
    case 'suspension_7d':
    case 'suspension_30d': {
      const endsAt = formatEndsAt(sanction);
      return {
        headline: endsAt
          ? `Compte suspendu jusqu'au ${endsAt}`
          : `Compte suspendu (${sanction.level === 'suspension_7d' ? '7 jours' : '30 jours'})`,
        toneClass: 'bg-red-900/40 border-red-700/60',
      };
    }
    case 'ban_permanent':
      return {
        headline: 'Compte banni définitivement',
        toneClass: 'bg-red-900/60 border-red-700/80',
      };
    default:
      return { headline: 'Sanction active', toneClass: 'bg-white/10 border-white/20' };
  }
}

export function SanctionBanner() {
  const { user } = useAuth();
  const [sanction, setSanction] = useState<UserSanction | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setSanction(null);
      return;
    }

    let cancelled = false;
    const fetchSanction = async () => {
      try {
        const s = await getActiveUserSanction(user.uid);
        if (!cancelled) setSanction(s);
      } catch (err) {
        console.warn('[SanctionBanner] getActiveUserSanction failed (non-blocking)', err);
      }
    };

    fetchSanction();
    const intervalId = setInterval(fetchSanction, SANCTION_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [user?.uid]);

  if (!sanction) return null;

  const { headline, toneClass } = getLevelMessage(sanction);
  const showAppeal = sanction.appealable && !sanction.appealUsed;
  const mailtoSubject = encodeURIComponent(`Appel sanction ${sanction.sanctionId}`);
  const mailtoBody = encodeURIComponent(
    `Bonjour,\n\nJe souhaite faire appel de la sanction ${sanction.level} appliquée à mon compte.\n\nMon UID : ${user?.uid ?? ''}\nMa version des faits :\n\n[Décris ici ta version des faits et joins tout élément contradictoire]\n\nCordialement`,
  );
  const mailtoHref = `mailto:${APPEAL_EMAIL}?subject=${mailtoSubject}&body=${mailtoBody}`;

  return (
    <div
      className={`sticky top-0 z-50 w-full border-b ${toneClass} backdrop-blur-sm`}
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <ShieldAlert className="h-4 w-4 text-white shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium leading-tight">{headline}</p>
          {showAppeal && (
            <p className="text-xs text-white/70 font-light mt-0.5">
              Tu peux faire appel 1× —{' '}
              <a
                href={mailtoHref}
                className="text-white underline hover:text-[#D91CD2] transition-colors"
              >
                écris-nous à {APPEAL_EMAIL}
              </a>
            </p>
          )}
          {sanction.appealUsed === true && (
            <p className="text-xs text-white/50 font-light mt-0.5">
              Appel reçu — l&apos;équipe modération te répondra sous 7 jours.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
