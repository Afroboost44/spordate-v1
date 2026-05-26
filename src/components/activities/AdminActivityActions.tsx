/**
 * AdminActivityActions — Client island affiché sur /activities/[id] pour
 * permettre à l'admin d'éditer ou supprimer N'IMPORTE QUELLE activité depuis
 * sa page publique. Silencieux pour les non-admins (return null).
 *
 * Sécurité :
 *  - Rendu conditionné sur `userProfile.role === 'admin'` côté client (UX).
 *  - L'écriture réelle est protégée par firestore.rules `match /activities/{id}`
 *    qui require `isAdmin()` OU `request.auth.uid == resource.data.partnerId`.
 *  - Modifier → redirect /partner/offers?edit={activityId} (l'admin layout
 *    bypass accessDenied + la page offers charge toutes les activités si admin).
 *  - Supprimer → confirm + deleteDoc (Firestore SDK), cascade des sessions
 *    futures via cascadeCancelFutureSessions (DRY avec la logique partner).
 *
 * @module
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Edit, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection, query, where, getDocs, doc, deleteDoc, writeBatch,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { shouldCancelSessionOnActivityRemoval } from '@/lib/activities/lifecycle';

interface Props {
  activityId: string;
  activityTitle: string;
  ownerPartnerId?: string;
}

/**
 * Cascade cancel future sessions (mirror de partner/offers handleDelete).
 * Marque sessions futures non-annulées → status='cancelled'.
 */
async function cascadeCancelFutureSessions(activityId: string): Promise<number> {
  if (!db) return 0;
  const now = Timestamp.now();
  const sessionsSnap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('activityId', '==', activityId),
      where('startAt', '>', now),
    ),
  );
  const nowMs = now.toMillis();
  const toCancel = sessionsSnap.docs.filter((sdoc) =>
    shouldCancelSessionOnActivityRemoval(
      sdoc.data() as { status?: string; startAt?: { toMillis?: () => number } },
      nowMs,
    ),
  );
  if (toCancel.length === 0) return 0;
  const batch = writeBatch(db);
  for (const sdoc of toCancel) {
    batch.update(sdoc.ref, { status: 'cancelled', updatedAt: serverTimestamp() });
  }
  await batch.commit();
  return toCancel.length;
}

export function AdminActivityActions({ activityId, activityTitle, ownerPartnerId }: Props) {
  const { user, userProfile } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const isAdmin = userProfile?.role === 'admin';
  const isOwner = !!user && !!ownerPartnerId && user.uid === ownerPartnerId;

  // N'afficher les boutons que pour admin OU owner. (Owner a déjà accès via
  // /partner/offers, mais on garde la cohérence du pattern : si tu es owner,
  // tu vois aussi les actions ici sans devoir naviguer.)
  if (!isAdmin && !isOwner) return null;

  const handleEdit = () => {
    router.push(`/partner/offers?edit=${encodeURIComponent(activityId)}`);
  };

  const handleDelete = async () => {
    if (!db) return;
    const confirmed = window.confirm(
      t('admin_activity_actions_confirm_delete', { name: activityTitle }),
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      // Cascade : annule les sessions futures avant le hard-delete.
      const cancelled = await cascadeCancelFutureSessions(activityId);
      await deleteDoc(doc(db, 'activities', activityId));
      toast({
        title: t('admin_activity_actions_toast_deleted_title'),
        description: cancelled > 0
          ? t('admin_activity_actions_toast_sessions_cancelled', { count: cancelled })
          : undefined,
      });
      router.push('/activities');
    } catch (err) {
      console.error('[AdminActivityActions] delete failed', err);
      toast({
        variant: 'destructive',
        title: t('admin_activity_actions_toast_error_title'),
        description: String(err),
      });
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">
          {isAdmin && !isOwner
            ? t('admin_activity_actions_admin_label')
            : t('admin_activity_actions_owner_label')}
        </span>
        <span className="text-xs text-white/60 font-light">
          {t('admin_activity_actions_hint')}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={handleEdit}
          variant="outline"
          size="sm"
          className="border-white/10 text-white/70 hover:text-white"
        >
          <Edit className="h-3.5 w-3.5 mr-1.5" />
          {t('admin_activity_actions_edit_btn')}
        </Button>
        <Button
          onClick={handleDelete}
          variant="outline"
          size="sm"
          disabled={deleting}
          className="border-red-500/20 text-red-400 hover:text-red-300 hover:bg-red-500/10"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          )}
          {t('admin_activity_actions_delete_btn')}
        </Button>
      </div>
    </div>
  );
}
