/**
 * Phase 9 sub-chantier 4 commit 1/6 — <AdminActionsHistoryPanel>.
 *
 * Tab admin queue history `adminActions/` audit trail (doctrine §9.sexies H — 24mo conservation).
 *
 * Filtres Q1=C — date toujours active (default last 7d), autres optionnels combinables :
 *   - Date range : last 24h / last 7d (default) / last 30d / all
 *   - Action type : all / 12 enum values
 *   - Target type : all / 5 enum values
 *   - Admin uid : free text (substring sub-uid match server side)
 *
 * Pagination cursor `cursorAfter` (cohérent SC0 c1 pattern) + "Charger plus" button.
 *
 * Export CSV Q2=C : fetchAllAdminActionsForExport (boucle pagination jusqu'à cap 5000
 * pour respecter Vercel timeout 60s) → Blob download.
 *
 * Style admin charte stricte SC0 c2 : bg-zinc-950 + bordures zinc-800 + accents #D91CD2.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Filter, History as HistoryIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  getAdminActions,
  fetchAllAdminActionsForExport,
  formatAdminActionsCsv,
  ADMIN_ACTION_TYPES,
  ADMIN_ACTION_TARGET_TYPES,
} from '@/lib/admin-actions';
import type {
  AdminAction,
  AdminActionTargetType,
  AdminActionType,
} from '@/types/firestore';

const PAGE_SIZE = 100;

type DateRangeKey = '24h' | '7d' | '30d' | 'all';

const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string; days: number | undefined }[] = [
  { value: '24h', label: '24 dernières heures', days: 1 },
  { value: '7d', label: '7 derniers jours', days: 7 },
  { value: '30d', label: '30 derniers jours', days: 30 },
  { value: 'all', label: 'Tout l\'historique', days: undefined },
];

function shortUid(uid: string): string {
  if (uid.length <= 12) return uid;
  return `${uid.slice(0, 6)}…${uid.slice(-4)}`;
}

function formatDate(d: { toDate?: () => Date } | undefined): string {
  if (!d?.toDate) return '—';
  return d.toDate().toLocaleString('fr-CH', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function preview(text: string | undefined, max = 60): string {
  if (!text) return '—';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function metadataPreview(m: Record<string, unknown> | undefined): string {
  if (!m || Object.keys(m).length === 0) return '—';
  try {
    const json = JSON.stringify(m);
    return preview(json, 80);
  } catch {
    return '<unserializable>';
  }
}

export function AdminActionsHistoryPanel() {
  const { toast } = useToast();
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Filtres (Q1=C : date always-on, autres combinables optionnels)
  const [dateRange, setDateRange] = useState<DateRangeKey>('7d');
  const [actionType, setActionType] = useState<AdminActionType | 'all'>('all');
  const [targetType, setTargetType] = useState<AdminActionTargetType | 'all'>('all');
  const [adminIdFilter, setAdminIdFilter] = useState('');

  const buildOpts = useCallback(() => {
    const dateOpt = DATE_RANGE_OPTIONS.find((d) => d.value === dateRange);
    return {
      rollingDays: dateOpt?.days,
      actionType: actionType !== 'all' ? actionType : undefined,
      targetType: targetType !== 'all' ? targetType : undefined,
      adminId: adminIdFilter.trim() ? adminIdFilter.trim() : undefined,
    };
  }, [dateRange, actionType, targetType, adminIdFilter]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setActions([]);
    setHasMore(false);
    try {
      const items = await getAdminActions({ ...buildOpts(), limit: PAGE_SIZE });
      setActions(items);
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      console.error('[AdminActionsHistoryPanel] loadInitial failed', err);
      toast({
        title: 'Erreur chargement',
        description: 'Impossible de charger l\'historique. Réessaie.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [buildOpts, toast]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadMore = async () => {
    if (actions.length === 0) return;
    setLoading(true);
    try {
      const cursor = actions[actions.length - 1];
      const items = await getAdminActions({
        ...buildOpts(),
        limit: PAGE_SIZE,
        cursorAfter: cursor,
      });
      setActions((prev) => [...prev, ...items]);
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      console.error('[AdminActionsHistoryPanel] loadMore failed', err);
      toast({
        title: 'Erreur chargement',
        description: 'Impossible de charger la page suivante.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const result = await fetchAllAdminActionsForExport(buildOpts());
      const csv = formatAdminActionsCsv(result.actions);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `admin-actions_${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: 'Export CSV téléchargé',
        description: result.truncated
          ? `${result.actions.length} actions exportées (cap 5000 atteint — affine les filtres pour exporter le reste).`
          : `${result.actions.length} actions exportées.`,
        className: 'bg-zinc-900 border-[#D91CD2]/40 text-white',
      });
    } catch (err) {
      console.error('[AdminActionsHistoryPanel] export failed', err);
      toast({
        title: 'Export échoué',
        description: 'Impossible de générer le CSV. Réessaie.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="bg-zinc-950 border border-zinc-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <HistoryIcon className="h-5 w-5 text-[#D91CD2]" />
          Historique audit trail
          <Badge className="bg-[#D91CD2]/15 border-[#D91CD2]/40 text-[#D91CD2] ml-2">
            {actions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filtres */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-md border border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#D91CD2]" />
            <span className="text-xs text-zinc-400">Filtres</span>
          </div>
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangeKey)}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white text-sm">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700 text-white">
              {DATE_RANGE_OPTIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={actionType}
            onValueChange={(v) => setActionType(v as AdminActionType | 'all')}
          >
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white text-sm">
              <SelectValue placeholder="Action type" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700 text-white max-h-64">
              <SelectItem value="all">Tous types</SelectItem>
              {ADMIN_ACTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={targetType}
            onValueChange={(v) => setTargetType(v as AdminActionTargetType | 'all')}
          >
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white text-sm">
              <SelectValue placeholder="Target type" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700 text-white">
              <SelectItem value="all">Toutes cibles</SelectItem>
              {ADMIN_ACTION_TARGET_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <Input
            placeholder="Filtrer par admin uid (substring)"
            value={adminIdFilter}
            onChange={(e) => setAdminIdFilter(e.target.value)}
            className="bg-zinc-900 border-zinc-700 text-white text-sm md:max-w-md"
          />
          <Button
            onClick={handleExportCsv}
            disabled={exporting || actions.length === 0}
            className="bg-[#D91CD2] hover:bg-[#D91CD2]/90 text-white"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Exporter CSV
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-md border border-zinc-800 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-900 border-zinc-800 hover:bg-zinc-900">
                <TableHead className="text-zinc-300">Date</TableHead>
                <TableHead className="text-zinc-300">Admin</TableHead>
                <TableHead className="text-zinc-300">Action type</TableHead>
                <TableHead className="text-zinc-300">Target</TableHead>
                <TableHead className="text-zinc-300">Reason</TableHead>
                <TableHead className="text-zinc-300">Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && actions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-zinc-500 py-6">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                    Chargement...
                  </TableCell>
                </TableRow>
              )}
              {!loading && actions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-zinc-500 py-6">
                    Aucune action trouvée pour ces filtres.
                  </TableCell>
                </TableRow>
              )}
              {actions.map((a) => (
                <TableRow
                  key={a.actionId}
                  className="border-zinc-800 hover:bg-zinc-900/50"
                >
                  <TableCell className="text-zinc-300 text-xs whitespace-nowrap">
                    {formatDate(a.createdAt)}
                  </TableCell>
                  <TableCell className="text-zinc-300 text-xs font-mono">
                    {shortUid(a.adminId)}
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-[#D91CD2]/15 border-[#D91CD2]/40 text-[#D91CD2] text-xs">
                      {a.actionType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-zinc-300 text-xs">
                    <span className="text-zinc-400">{a.targetType}/</span>
                    <span className="font-mono">{shortUid(a.targetId)}</span>
                  </TableCell>
                  <TableCell className="text-zinc-300 text-xs max-w-[240px]">
                    {preview(a.reason)}
                  </TableCell>
                  <TableCell className="text-zinc-400 text-xs font-mono max-w-[200px]">
                    {metadataPreview(a.metadata)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {hasMore && !loading && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={loadMore}
              className="border-zinc-700 text-white hover:bg-zinc-900"
            >
              Charger plus
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
