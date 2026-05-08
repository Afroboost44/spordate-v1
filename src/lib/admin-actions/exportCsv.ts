/**
 * Phase 9 sub-chantier 4 commit 1/6 — CSV export helpers admin actions audit trail.
 *
 * 2 helpers pure :
 *   - formatAdminActionsCsv(actions, opts?) : RFC 4180 compliant string (CRLF terminators,
 *     quote-wrap si contient ',' '"' '\n', double quote escape `"` → `""`).
 *   - fetchAllAdminActionsForExport(opts, capRows=5000) : pagination loop avec cursor
 *     jusqu'au cap (Q2=C — export current filter ALL pages, cap 5000 pour Vercel timeout).
 *
 * Headers CSV (ordre stable) : actionId, createdAt, adminId, actionType, targetType,
 * targetId, reason, metadataJson.
 *
 * `metadata` sérialisé en JSON inline (RFC 4180 escape inclus) — caller peut parser
 * downstream si besoin. Date format ISO 8601 UTC pour interop tableurs.
 *
 * @module
 */

import type { AdminAction } from '@/types/firestore';
import { getAdminActions, type GetAdminActionsOptions } from './getAdminActions';

// =====================================================================
// CSV format helpers (RFC 4180)
// =====================================================================

/** Champ doit être quoté si contient `,`, `"`, `\n` ou `\r`. */
function csvEscape(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

/** Headers stables (ordre canonique audit). */
export const CSV_HEADERS = [
  'actionId',
  'createdAt',
  'adminId',
  'actionType',
  'targetType',
  'targetId',
  'reason',
  'metadataJson',
] as const;

function actionToRow(a: AdminAction): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ts = (a.createdAt as any)?.toMillis?.()
    ? new Date((a.createdAt as { toMillis: () => number }).toMillis()).toISOString()
    : '';
  let metadataJson = '';
  if (a.metadata && Object.keys(a.metadata).length > 0) {
    try {
      metadataJson = JSON.stringify(a.metadata);
    } catch {
      metadataJson = '<unserializable>';
    }
  }
  return [
    a.actionId ?? '',
    ts,
    a.adminId ?? '',
    a.actionType ?? '',
    a.targetType ?? '',
    a.targetId ?? '',
    a.reason ?? '',
    metadataJson,
  ];
}

/**
 * Format actions en CSV RFC 4180. Toujours retourne au minimum la ligne headers.
 * @param actions liste pré-filtrée (caller paginates upstream)
 */
export function formatAdminActionsCsv(actions: AdminAction[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.map((h) => csvEscape(h)).join(','));
  for (const a of actions) {
    lines.push(actionToRow(a).map((cell) => csvEscape(cell)).join(','));
  }
  // CRLF (RFC 4180)
  return lines.join('\r\n') + '\r\n';
}

// =====================================================================
// Pagination loop pour export (Q2=C all pages cap 5000)
// =====================================================================

/** Cap par défaut pour Vercel timeout 60s + UI réactivité. */
export const EXPORT_CAP_DEFAULT = 5000;

/** Page size par fetch interne. Trade-off : plus = moins de round-trips, mais plus de mem. */
export const EXPORT_PAGE_SIZE = 500;

export interface FetchAllExportResult {
  actions: AdminAction[];
  /** True si la limite cap a été atteinte (caller affiche warning UI). */
  truncated: boolean;
  pages: number;
}

/**
 * Boucle pagination cursor jusqu'au cap. Q2=C : export current filter ALL pages
 * mais cap pour éviter Vercel timeout sur volumes énormes.
 *
 * Caller passe `opts` (filtres date/type/admin), récupère toutes les pages.
 */
export async function fetchAllAdminActionsForExport(
  opts: Omit<GetAdminActionsOptions, 'limit' | 'cursorAfter'> = {},
  capRows: number = EXPORT_CAP_DEFAULT,
): Promise<FetchAllExportResult> {
  const all: AdminAction[] = [];
  let pages = 0;
  let cursor: AdminAction | undefined = undefined;
  let truncated = false;

  while (all.length < capRows) {
    const remaining = capRows - all.length;
    const pageSize = Math.min(EXPORT_PAGE_SIZE, remaining);
    const page = await getAdminActions({
      ...opts,
      limit: pageSize,
      cursorAfter: cursor,
    });
    pages++;
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break; // dernière page partielle = fin
    cursor = page[page.length - 1];
    if (all.length >= capRows) {
      truncated = true;
      break;
    }
  }

  return { actions: all, truncated, pages };
}
