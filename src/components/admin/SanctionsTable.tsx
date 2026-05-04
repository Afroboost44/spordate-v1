/**
 * Phase 7 sub-chantier 4 commit 3/4 — <SanctionsTable>.
 *
 * Tab admin "T&S Sanctions" : liste UserSanctions actives avec filtres + overturn.
 * Doctrine §F : admin peut overturn manuellement (cas erreur ou abus auto-trigger).
 *
 * Filtres dropdown : level / reason / refundDue.
 * Action "Overturn" → AlertDialog confirmation + Textarea note → overturnSanction service.
 *
 * Style admin (bg-gray-900 — exception charte stricte Q9).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldOff } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ReportError, overturnSanction } from '@/lib/reports';
import type { SanctionLevel, SanctionReason, UserSanction } from '@/types/firestore';

const NOTE_MIN_LENGTH = 10;
const NOTE_MAX_LENGTH = 500;

type LevelFilter = 'all' | SanctionLevel;
type ReasonFilter = 'all' | SanctionReason;
type RefundFilter = 'all' | 'yes' | 'no';

const LEVEL_BADGE: Record<SanctionLevel, string> = {
  warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  suspension_7d: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  suspension_30d: 'bg-red-500/20 text-red-400 border-red-500/30',
  ban_permanent: 'bg-red-700/40 text-red-300 border-red-700/60',
};

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

export interface SanctionsTableProps {
  adminUid: string | null;
}

export function SanctionsTable({ adminUid }: SanctionsTableProps) {
  const { toast } = useToast();
  const [sanctions, setSanctions] = useState<UserSanction[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>('all');
  const [refundFilter, setRefundFilter] = useState<RefundFilter>('all');
  const [overturnDialog, setOverturnDialog] = useState<{ open: boolean; sanctionId: string }>({
    open: false,
    sanctionId: '',
  });
  const [overturnNote, setOverturnNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadSanctions = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'userSanctions'),
          where('isActive', '==', true),
          orderBy('createdAt', 'desc'),
        ),
      );
      setSanctions(snap.docs.map((d) => d.data() as UserSanction));
    } catch (err) {
      console.error('[SanctionsTable] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSanctions();
  }, [loadSanctions]);

  const filtered = sanctions.filter((s) => {
    if (levelFilter !== 'all' && s.level !== levelFilter) return false;
    if (reasonFilter !== 'all' && s.reason !== reasonFilter) return false;
    if (refundFilter === 'yes' && s.refundDue !== true) return false;
    if (refundFilter === 'no' && s.refundDue === true) return false;
    return true;
  });

  const noteValid = overturnNote.length >= NOTE_MIN_LENGTH && overturnNote.length <= NOTE_MAX_LENGTH;

  const handleOverturnConfirm = async () => {
    if (!adminUid || !overturnDialog.sanctionId || !noteValid || submitting) return;
    setSubmitting(true);
    try {
      await overturnSanction({
        adminId: adminUid,
        sanctionId: overturnDialog.sanctionId,
        reason: overturnNote,
      });
      toast({ title: 'Sanction overturned', description: 'isActive=false propagé.' });
      setOverturnDialog({ open: false, sanctionId: '' });
      setOverturnNote('');
      // Optimistic local refresh
      setSanctions((prev) => prev.filter((s) => s.sanctionId !== overturnDialog.sanctionId));
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Overturn échoué';
      if (err instanceof ReportError) {
        switch (err.code) {
          case 'not-admin':
            description = 'Setup admin role requis.';
            break;
          case 'not-sanction-active':
            description = 'Sanction déjà overturned.';
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
          ⚠️ Setup admin requis : users.{`{adminUid}`}.role=&apos;admin&apos; (Firebase Console).
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-gray-900 border border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-white flex items-center gap-2">
            <ShieldOff className="h-4 w-4 text-[#D91CD2]" />
            Sanctions actives ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filtres */}
          <div className="flex flex-wrap gap-3 mb-4">
            <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LevelFilter)}>
              <SelectTrigger className="w-[180px] bg-gray-800 border-gray-700 text-white">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                <SelectItem value="all">Tous niveaux</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="suspension_7d">Suspension 7d</SelectItem>
                <SelectItem value="suspension_30d">Suspension 30d</SelectItem>
                <SelectItem value="ban_permanent">Ban permanent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={reasonFilter} onValueChange={(v) => setReasonFilter(v as ReasonFilter)}>
              <SelectTrigger className="w-[200px] bg-gray-800 border-gray-700 text-white">
                <SelectValue placeholder="Reason" />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                <SelectItem value="all">Toutes raisons</SelectItem>
                <SelectItem value="reports_threshold">Reports threshold</SelectItem>
                <SelectItem value="no_show_threshold">No-show threshold</SelectItem>
                <SelectItem value="manual_admin">Manual admin</SelectItem>
              </SelectContent>
            </Select>
            <Select value={refundFilter} onValueChange={(v) => setRefundFilter(v as RefundFilter)}>
              <SelectTrigger className="w-[160px] bg-gray-800 border-gray-700 text-white">
                <SelectValue placeholder="Refund due" />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="yes">Refund due</SelectItem>
                <SelectItem value="no">Pas refund</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 text-gray-500 motion-safe:animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm font-light">
              {sanctions.length === 0
                ? 'Aucune sanction active'
                : 'Aucune sanction correspondant aux filtres'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">Date</TableHead>
                  <TableHead className="text-gray-400">User</TableHead>
                  <TableHead className="text-gray-400">Level</TableHead>
                  <TableHead className="text-gray-400">Reason</TableHead>
                  <TableHead className="text-gray-400">Ends At</TableHead>
                  <TableHead className="text-gray-400 text-center">Refund</TableHead>
                  <TableHead className="text-gray-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.sanctionId} className="border-gray-800 hover:bg-gray-800/50">
                    <TableCell className="text-xs text-gray-300 whitespace-nowrap">
                      {formatDate(s.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-gray-300 font-mono">
                      {shortUid(s.userId)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${LEVEL_BADGE[s.level]}`}>{s.level}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-300">{s.reason}</TableCell>
                    <TableCell className="text-xs text-gray-300 whitespace-nowrap">
                      {s.endsAt ? formatDate(s.endsAt) : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.refundDue === true ? (
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                          due
                        </Badge>
                      ) : (
                        <span className="text-gray-500 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setOverturnDialog({ open: true, sanctionId: s.sanctionId })
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
        open={overturnDialog.open}
        onOpenChange={(open) => {
          setOverturnDialog((s) => ({ ...s, open }));
          if (!open) setOverturnNote('');
        }}
      >
        <AlertDialogContent className="bg-gray-900 border-gray-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Overturn sanction ?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              La sanction sera désactivée (isActive=false) et marquée appealDecision=overturned.
              Note motivée obligatoire (≥{NOTE_MIN_LENGTH} chars).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={overturnNote}
            onChange={(e) => setOverturnNote(e.target.value)}
            placeholder="Motivation overturn (audit + transparency)…"
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            disabled={submitting}
            className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
          />
          <div className="flex justify-between text-xs text-gray-500 tabular-nums">
            <span
              className={
                overturnNote.length > 0 && overturnNote.length < NOTE_MIN_LENGTH
                  ? 'text-orange-400'
                  : ''
              }
            >
              Minimum {NOTE_MIN_LENGTH} caractères
            </span>
            <span>{overturnNote.length} / {NOTE_MAX_LENGTH}</span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={submitting}
              className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700"
            >
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOverturnConfirm}
              disabled={!noteValid || submitting}
              className="bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" /> Overturn…
                </>
              ) : (
                'Overturn'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
