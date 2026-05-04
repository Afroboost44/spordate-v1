/**
 * Phase 7 sub-chantier 4 commit 3/4 — <AppealsTable>.
 *
 * Tab admin "T&S Appeals" : queue UserSanctions où appealUsed=true et appealResolvedAt absent.
 * Doctrine §F : SLA admin 7j pour résoudre appel.
 *
 * Actions par row : "Uphold" (vert) / "Overturn" (rouge) → AlertDialog + note ≥10 chars
 *   → resolveAppeal({decision: 'upheld'|'overturned'}). Si 'overturned' → isActive=false propagé.
 *
 * Style admin (bg-gray-900 — exception charte stricte Q9).
 *
 * Note Phase 7 : query directe sans index dédié appealUsed+appealResolvedAt.
 *  Filter client-side après fetch userSanctions where appealUsed=true.
 *  Phase 8 polish pourra ajouter un index si volume > 50 appels/jour.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ReportError, resolveAppeal } from '@/lib/reports';
import type { AppealDecision } from '@/lib/reports';
import type { UserSanction } from '@/types/firestore';

const NOTE_MIN_LENGTH = 10;
const NOTE_MAX_LENGTH = 500;

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

function notePreview(text: string | undefined, max = 100): string {
  if (!text) return '—';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export interface AppealsTableProps {
  adminUid: string | null;
}

export function AppealsTable({ adminUid }: AppealsTableProps) {
  const { toast } = useToast();
  const [appeals, setAppeals] = useState<UserSanction[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolveDialog, setResolveDialog] = useState<{
    open: boolean;
    sanctionId: string;
    decision: AppealDecision;
  }>({ open: false, sanctionId: '', decision: 'upheld' });
  const [decisionNote, setDecisionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAppeals = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      // Query userSanctions appealUsed=true ; filter client-side appealResolvedAt absent
      const snap = await getDocs(
        query(collection(db, 'userSanctions'), where('appealUsed', '==', true)),
      );
      const list = snap.docs
        .map((d) => d.data() as UserSanction)
        .filter((s) => !s.appealResolvedAt)
        .sort((a, b) => {
          // Sort par createdAt DESC (plus récent appel first dans la queue)
          const aMs = a.createdAt?.toMillis?.() ?? 0;
          const bMs = b.createdAt?.toMillis?.() ?? 0;
          return bMs - aMs;
        });
      setAppeals(list);
    } catch (err) {
      console.error('[AppealsTable] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAppeals();
  }, [loadAppeals]);

  const noteValid = decisionNote.length >= NOTE_MIN_LENGTH && decisionNote.length <= NOTE_MAX_LENGTH;

  const handleResolveConfirm = async () => {
    if (!adminUid || !resolveDialog.sanctionId || !noteValid || submitting) return;
    setSubmitting(true);
    try {
      await resolveAppeal({
        adminId: adminUid,
        sanctionId: resolveDialog.sanctionId,
        decision: resolveDialog.decision,
        decisionNote,
      });
      toast({
        title: resolveDialog.decision === 'upheld' ? 'Appeal upheld' : 'Appeal overturned',
        description:
          resolveDialog.decision === 'overturned'
            ? 'Sanction désactivée (isActive=false propagé).'
            : 'Décision admin enregistrée.',
      });
      setResolveDialog({ open: false, sanctionId: '', decision: 'upheld' });
      setDecisionNote('');
      // Optimistic local refresh : retirer de la queue
      setAppeals((prev) => prev.filter((s) => s.sanctionId !== resolveDialog.sanctionId));
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Resolve échoué';
      if (err instanceof ReportError) {
        switch (err.code) {
          case 'not-admin':
            description = 'Setup admin role requis.';
            break;
          case 'appeal-already-resolved':
            description = 'Appel déjà résolu.';
            break;
          case 'appeal-not-filed':
            description = 'Aucun appel filé sur cette sanction.';
            break;
          default:
            description = `Code : ${err.code}`;
        }
      }
      toast({ title, description, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!adminUid) {
    return (
      <Card className="bg-gray-900 border border-gray-800">
        <CardContent className="p-6 text-center text-orange-400 text-sm">
          ⚠️ Setup admin requis : users.{`{adminUid}`}.role=&apos;admin&apos;.
        </CardContent>
      </Card>
    );
  }

  const decisionLabel = resolveDialog.decision === 'upheld' ? 'Uphold' : 'Overturn';
  const decisionClass =
    resolveDialog.decision === 'upheld'
      ? 'bg-green-600 hover:bg-green-700'
      : 'bg-orange-600 hover:bg-orange-700';

  return (
    <>
      <Card className="bg-gray-900 border border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-white flex items-center gap-2">
            <Scale className="h-4 w-4 text-[#D91CD2]" />
            Appels à résoudre ({appeals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 text-gray-500 motion-safe:animate-spin" />
            </div>
          ) : appeals.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm font-light">
              Aucun appel à résoudre — Inbox zero 🎉
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">Date filing</TableHead>
                  <TableHead className="text-gray-400">User</TableHead>
                  <TableHead className="text-gray-400">Level</TableHead>
                  <TableHead className="text-gray-400">Reason</TableHead>
                  <TableHead className="text-gray-400">Note appel</TableHead>
                  <TableHead className="text-gray-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appeals.map((s) => (
                  <TableRow key={s.sanctionId} className="border-gray-800 hover:bg-gray-800/50">
                    <TableCell className="text-xs text-gray-300 whitespace-nowrap">
                      {formatDate(s.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-gray-300 font-mono">
                      {shortUid(s.userId)}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                        {s.level}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-300">{s.reason}</TableCell>
                    <TableCell className="text-xs text-gray-400 max-w-xs">
                      <span title={s.appealNote ?? ''}>{notePreview(s.appealNote)}</span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setResolveDialog({
                            open: true,
                            sanctionId: s.sanctionId,
                            decision: 'upheld',
                          })
                        }
                        className="h-7 px-2 text-xs border-green-600/40 text-green-400 hover:bg-green-600/10 mr-2"
                      >
                        Uphold
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setResolveDialog({
                            open: true,
                            sanctionId: s.sanctionId,
                            decision: 'overturned',
                          })
                        }
                        className="h-7 px-2 text-xs border-orange-600/40 text-orange-400 hover:bg-orange-600/10"
                      >
                        Overturn
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={resolveDialog.open}
        onOpenChange={(open) => {
          setResolveDialog((s) => ({ ...s, open }));
          if (!open) setDecisionNote('');
        }}
      >
        <AlertDialogContent className="bg-gray-900 border-gray-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{decisionLabel} appeal ?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {resolveDialog.decision === 'upheld'
                ? 'L\'appel sera rejeté, la sanction reste active. Note motivée obligatoire (transparency user).'
                : 'L\'appel sera accepté, la sanction sera désactivée (isActive=false). Note motivée obligatoire.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="Motivation décision admin…"
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            disabled={submitting}
            className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
          />
          <div className="flex justify-between text-xs text-gray-500 tabular-nums">
            <span
              className={
                decisionNote.length > 0 && decisionNote.length < NOTE_MIN_LENGTH
                  ? 'text-orange-400'
                  : ''
              }
            >
              Minimum {NOTE_MIN_LENGTH} caractères
            </span>
            <span>{decisionNote.length} / {NOTE_MAX_LENGTH}</span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={submitting}
              className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700"
            >
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResolveConfirm}
              disabled={!noteValid || submitting}
              className={`text-white disabled:opacity-40 ${decisionClass}`}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" /> {decisionLabel}…
                </>
              ) : (
                decisionLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
