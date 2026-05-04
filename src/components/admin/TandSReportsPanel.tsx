/**
 * Phase 7 sub-chantier 4 commit 2/4 — <TandSReportsPanel>.
 *
 * Panel admin queue Reports modération (status='pending').
 * Doctrine §D : sort priorité catégorie (urgent rouge → basse vert) + FIFO via service.
 *
 * Render :
 *  - Table sorted via getPendingReports (commit 1/4)
 *  - Colonnes : Date / Catégorie (PriorityBadge) / Reported (uid abrégé) / Source / FreeText preview / Actions
 *  - 2 actions par ligne : "Dismiss" (gris) / "Sustain" (rouge) → dialog adapté
 *    - Dismiss : AlertDialog confirmation simple → dismissReport (note optionnelle laissée undefined)
 *    - Sustain : SanctionPickerDialog (radio level + note obligatoire)
 *  - Empty state : "Aucun report en attente — Inbox zero 🎉"
 *
 * Style admin (bg-gray-900 — exception charte stricte Q9).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
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
import { dismissReport, getPendingReports, ReportError } from '@/lib/reports';
import type { Report } from '@/types/firestore';
import { PriorityBadge } from './PriorityBadge';
import { SanctionPickerDialog } from './SanctionPickerDialog';

export interface TandSReportsPanelProps {
  /** Admin UID résolu. */
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

function freeTextPreview(text: string | undefined, max = 50): string {
  if (!text) return '—';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function TandSReportsPanel({ adminUid }: TandSReportsPanelProps) {
  const { toast } = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissDialog, setDismissDialog] = useState<{ open: boolean; reportId: string }>({
    open: false,
    reportId: '',
  });
  const [sustainDialog, setSustainDialog] = useState<{ open: boolean; reportId: string }>({
    open: false,
    reportId: '',
  });
  const [dismissing, setDismissing] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getPendingReports({ limit: 100 });
      setReports(list);
    } catch (err) {
      console.error('[TandSReportsPanel] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleDismissConfirm = async () => {
    if (!adminUid || !dismissDialog.reportId || dismissing) return;
    setDismissing(true);
    try {
      await dismissReport({
        reportId: dismissDialog.reportId,
        adminId: adminUid,
      });
      toast({ title: 'Report dismissed', description: 'Statut → dismissed.' });
      setDismissDialog({ open: false, reportId: '' });
      await loadReports();
    } catch (err) {
      let title = 'Erreur';
      let description = err instanceof Error ? err.message : 'Dismiss échoué';
      if (err instanceof ReportError) {
        switch (err.code) {
          case 'not-admin':
            description = 'Setup admin role requis (users.{uid}.role=admin).';
            break;
          case 'report-not-pending':
            description = 'Report déjà résolu.';
            break;
          default:
            description = `Code : ${err.code}`;
        }
      }
      toast({ title, description, variant: 'destructive' });
    } finally {
      setDismissing(false);
    }
  };

  if (!adminUid) {
    return (
      <Card className="bg-gray-900 border border-gray-800">
        <CardContent className="p-6 text-center text-orange-400 text-sm">
          ⚠️ Setup admin requis : ouvre Firebase Console → users → ton document → set <code className="bg-gray-800 px-1 rounded">role: &quot;admin&quot;</code>.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-gray-900 border border-gray-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-white flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#D91CD2]" />
            Reports en modération ({reports.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 text-gray-500 motion-safe:animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm font-light">
              Aucun report en attente — Inbox zero 🎉
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">Date</TableHead>
                  <TableHead className="text-gray-400">Catégorie</TableHead>
                  <TableHead className="text-gray-400">Reported</TableHead>
                  <TableHead className="text-gray-400">Source</TableHead>
                  <TableHead className="text-gray-400">FreeText</TableHead>
                  <TableHead className="text-gray-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.reportId} className="border-gray-800 hover:bg-gray-800/50">
                    <TableCell className="text-xs text-gray-300 whitespace-nowrap">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <PriorityBadge category={r.category} />
                    </TableCell>
                    <TableCell className="text-xs text-gray-300 font-mono">
                      {shortUid(r.reportedId)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          r.source === 'partner_no_show'
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                            : 'bg-gray-700/40 text-gray-300 border-gray-600/30'
                        }
                      >
                        {r.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-400 max-w-xs">
                      <span title={r.freeTextReason ?? ''}>
                        {freeTextPreview(r.freeTextReason)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDismissDialog({ open: true, reportId: r.reportId })
                        }
                        className="h-7 px-2 text-xs border-gray-600 text-gray-300 hover:bg-gray-700 mr-2"
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSustainDialog({ open: true, reportId: r.reportId })
                        }
                        className="h-7 px-2 text-xs border-red-600/40 text-red-400 hover:bg-red-600/10"
                      >
                        Sustain
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
        open={dismissDialog.open}
        onOpenChange={(open) => setDismissDialog((s) => ({ ...s, open }))}
      >
        <AlertDialogContent className="bg-gray-900 border-gray-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Dismiss report ?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              Le report sera marqué comme dismissed. Aucune sanction appliquée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={dismissing}
              className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700"
            >
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDismissConfirm}
              disabled={dismissing}
              className="bg-gray-700 text-white hover:bg-gray-600"
            >
              {dismissing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 motion-safe:animate-spin" /> Dismiss…
                </>
              ) : (
                'Dismiss'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SanctionPickerDialog
        open={sustainDialog.open}
        onOpenChange={(open) => setSustainDialog((s) => ({ ...s, open }))}
        reportId={sustainDialog.reportId}
        adminId={adminUid}
        onSustained={() => {
          setSustainDialog({ open: false, reportId: '' });
          loadReports();
        }}
      />
    </>
  );
}
