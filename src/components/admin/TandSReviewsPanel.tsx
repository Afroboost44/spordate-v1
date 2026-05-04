/**
 * Phase 7 sub-chantier 4 commit 2/4 — <TandSReviewsPanel>.
 *
 * Panel admin queue Reviews modération pré-publication (1-2★ status='pending').
 * Doctrine §C.1 : modération obligatoire avant publication des reviews 1-2★.
 *
 * Render :
 *  - Table FIFO (createdAt ASC — oldest first via service)
 *  - Colonnes : Date / Reviewer (uid abrégé) / Activity / Rating / Comment preview / Actions
 *  - 2 actions par ligne : "Publier" (vert) / "Rejeter" (rouge) → ReviewModerationActionsDialog
 *  - Empty state : "Aucune review en attente — Inbox zero 🎉"
 *
 * Style admin (bg-gray-900 — exception charte stricte Q9).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getPendingReviewsForAdmin } from '@/lib/reviews';
import type { Review } from '@/types/firestore';
import {
  ReviewModerationActionsDialog,
  type ReviewModerationAction,
} from './ReviewModerationActionsDialog';

export interface TandSReviewsPanelProps {
  /** Admin UID résolu (fetch au mount du dashboard depuis users where email==ADMIN_EMAIL). */
  adminUid: string | null;
}

function shortUid(uid: string): string {
  if (uid.length <= 10) return uid;
  return `${uid.slice(0, 6)}…${uid.slice(-4)}`;
}

function formatDate(d: { toDate?: () => Date } | undefined): string {
  if (!d?.toDate) return '—';
  return d.toDate().toLocaleString('fr-CH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function commentPreview(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function TandSReviewsPanel({ adminUid }: TandSReviewsPanelProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    reviewId: string;
    action: ReviewModerationAction;
  }>({ open: false, reviewId: '', action: 'publish' });

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getPendingReviewsForAdmin({ limit: 100 });
      setReviews(list);
    } catch (err) {
      console.error('[TandSReviewsPanel] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const handleAction = (reviewId: string, action: ReviewModerationAction) => {
    setActionDialog({ open: true, reviewId, action });
  };

  const handleResolved = () => {
    loadReviews();
  };

  if (!adminUid) {
    return (
      <Card className="bg-gray-900 border border-gray-800">
        <CardContent className="p-6 text-center text-orange-400 text-sm">
          ⚠️ Setup admin requis : ouvre Firebase Console → users → ton document → set <code className="bg-gray-800 px-1 rounded">role: &quot;admin&quot;</code>.
          Sans cela les services admin rejettent (defense-in-depth).
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-gray-900 border border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-white flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#D91CD2]" />
            Reviews en modération ({reviews.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 text-gray-500 motion-safe:animate-spin" />
            </div>
          ) : reviews.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm font-light">
              Aucune review en attente — Inbox zero 🎉
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">Date</TableHead>
                  <TableHead className="text-gray-400">Reviewer</TableHead>
                  <TableHead className="text-gray-400">Activity</TableHead>
                  <TableHead className="text-gray-400 text-center">Rating</TableHead>
                  <TableHead className="text-gray-400">Commentaire</TableHead>
                  <TableHead className="text-gray-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((r) => (
                  <TableRow key={r.reviewId} className="border-gray-800 hover:bg-gray-800/50">
                    <TableCell className="text-xs text-gray-300 whitespace-nowrap">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-gray-300 font-mono">
                      {shortUid(r.reviewerId)}
                    </TableCell>
                    <TableCell className="text-xs text-gray-300 font-mono">
                      {shortUid(r.activityId)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        ★{r.rating}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-400 max-w-xs">
                      <span title={r.comment}>{commentPreview(r.comment)}</span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(r.reviewId, 'publish')}
                        className="h-7 px-2 text-xs border-green-600/40 text-green-400 hover:bg-green-600/10 mr-2"
                      >
                        Publier
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(r.reviewId, 'reject')}
                        className="h-7 px-2 text-xs border-red-600/40 text-red-400 hover:bg-red-600/10"
                      >
                        Rejeter
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ReviewModerationActionsDialog
        open={actionDialog.open}
        onOpenChange={(open) => setActionDialog((s) => ({ ...s, open }))}
        reviewId={actionDialog.reviewId}
        action={actionDialog.action}
        adminId={adminUid}
        onResolved={handleResolved}
      />
    </>
  );
}
