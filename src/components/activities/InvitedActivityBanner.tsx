/**
 * BUG #36 COMMIT 3 — Banner affichée sur /activities/[id] quand le user
 * arrive depuis une invitation acceptée (URL ?inviteId=X).
 *
 * Le receiver clique "Accepter" dans la card chat → updateDoc inviteStatus
 * + router.push('/activities/[id]?inviteId=X'). Cette banner welcome lui
 * rappelle de réserver sa place (mode individual = il paie sa part).
 *
 * Pour mode 'duo' : pas affiché ici (le sender a déjà payé, le booking
 * est créé via webhook côté serveur — receiver n'a rien à faire).
 *
 * @module
 */

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';

export function InvitedActivityBanner() {
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const inviteId = searchParams?.get('inviteId');
    if (inviteId) {
      setVisible(true);
    }
  }, [searchParams]);

  if (!visible) return null;

  return (
    <div className="rounded-xl bg-gradient-to-br from-[#D91CD2]/15 to-[#E91E63]/10 border border-[#D91CD2]/40 p-4 mb-6 flex items-start gap-3">
      <Sparkles className="h-5 w-5 text-[#D91CD2] flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium">Invitation acceptée 🎉</p>
        <p className="text-xs text-white/60 mt-0.5">
          Réserve maintenant ta place ci-dessous pour confirmer ta participation.
        </p>
      </div>
    </div>
  );
}
