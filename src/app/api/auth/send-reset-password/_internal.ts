/**
 * Phase 9.5 c3 — Internal DI seam pour /api/auth/send-reset-password.
 *
 * Next.js 15 enforce que les fichiers route.ts n'exportent QUE les HTTP handlers
 * (GET/POST/etc.) + config (runtime/dynamic/revalidate). Les DI seams pour tests
 * doivent vivre dans un fichier séparé _internal.ts.
 *
 * Pattern cohérent verifyAuth Phase 8 SC4 + sharedStripe Phase 9 SC2 c3.
 */

export interface AdminAuthLike {
  generatePasswordResetLink(email: string, opts?: unknown): Promise<string>;
  // Fix #156/#157 i18n — `uid` ajouté pour lookup user.language via Firestore
  getUserByEmail(email: string): Promise<{ displayName?: string | null; uid: string }>;
}

let _adminAuthOverride: AdminAuthLike | null = null;

/** @internal — utilisé UNIQUEMENT par tests pour injecter un mock firebase-admin/auth. */
export function __setAdminAuthForTesting(mock: AdminAuthLike | null): void {
  _adminAuthOverride = mock;
}

/** @internal — getter consommé par route.ts. */
export function getAdminAuthOverride(): AdminAuthLike | null {
  return _adminAuthOverride;
}
