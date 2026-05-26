/**
 * Fix FOUC home — POST /api/admin/site/revalidate.
 *
 * Purge le cache Next.js des Server fetches de settings/site (theme couleur,
 * brand logos, site config strings) dès qu'admin sauvegarde une modif.
 *
 * Sans cet endpoint, `unstable_cache({ revalidate: 60 })` côté
 * `src/lib/theme/server.ts`, `src/lib/brand/server.ts`,
 * `src/lib/site/server.ts` peut servir l'ancienne couleur / l'ancien hero
 * image pendant jusqu'à 60s sur les nouveaux SSR (typiquement le premier
 * paint après save → FOUC).
 *
 * Sécurité : Bearer ID token + check role=admin (pattern discovery-toggle).
 *
 * @returns 200 { ok, revalidated: ['theme:site', 'brand:logos'] }
 *          401 unauthenticated
 *          403 forbidden (not admin)
 *          500 server error
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag, revalidatePath } from 'next/cache';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function isAdmin(uid: string): Promise<boolean> {
  if (!uid) return false;
  const db = await getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return false;
  return snap.data()?.role === 'admin';
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    if (!(await isAdmin(uid))) {
      return NextResponse.json(
        { error: 'forbidden', detail: 'admin role required' },
        { status: 403 },
      );
    }

    // Purge tous les caches qui pointent vers settings/site.
    // Tags configurés dans :
    //  - src/lib/theme/server.ts  → ['theme:site']
    //  - src/lib/brand/server.ts  → ['theme:site', 'brand:logos']
    //  - src/lib/site/server.ts   → ['theme:site']
    revalidateTag('theme:site');
    revalidateTag('brand:logos');

    // Belt-and-suspenders : forcer la régénération du layout (qui injecte
    // <style id="server-theme"> + <link> brand) et de la home (hero image SSR).
    revalidatePath('/', 'layout');

    return NextResponse.json(
      { ok: true, revalidated: ['theme:site', 'brand:logos'] },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/admin/site/revalidate]', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
