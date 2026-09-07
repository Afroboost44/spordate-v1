/**
 * Phase 9.5 c9 — POST /api/auth/admin-self-promote.
 *
 * Auto-promote au login : si l'email du Bearer token est dans ADMIN_EMAILS
 * (lib/sports.ts), update Firestore users/{uid}.role='admin' + log audit
 * adminActions {actionType:'auto_promote_admin', source:'login'}.
 *
 * Idempotent : si role déjà 'admin', return { ok:true, alreadyAdmin:true }
 * sans re-write ni log doublon.
 *
 * Pipeline :
 *   1. Verify Bearer ID token → uid
 *   2. Charger users/{uid} → email
 *   3. isAdminEmail(email) ? sinon 403 not-eligible
 *   4. Si role déjà 'admin' → 200 alreadyAdmin (idempotent)
 *   5. Sinon : update role=admin + audit log + return 200 promoted
 *
 * Sécurité :
 *  - Le check email se fait côté serveur depuis le doc Firestore (pas depuis
 *    le claim/token du client) → anti-spoof.
 *  - Admin SDK bypass rules → permet write role même si user.role !== admin
 *    actuellement (chicken-and-egg : nouvelle promotion).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/verifyAuth';
import { isAdminEmail } from '@/lib/sports';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyAuth(request);
    if (!uid) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action: 'promote' | 'demote' = body?.action === 'demote' ? 'demote' : 'promote';

    const db = await getAdminDb();
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'user-not-found' }, { status: 404 });
    }
    const userData = userSnap.data() as { email?: string; role?: string };

    // P0 — L'ADRESSE VIENT DE L'ANNUAIRE D'IDENTITE, PLUS DU DOCUMENT.
    //
    // Elle etait lue dans `users/{uid}`. Or ce document est cree par le
    // NAVIGATEUR, et `firestore.rules` ne contraint pas `email` a la creation :
    // un compte neuf pouvait donc s'y inscrire l'adresse de l'administrateur,
    // appeler cette route, et se faire promouvoir par l'Admin SDK. Fermer la
    // creation de `role` ne suffisait pas — cette porte-ci restait ouverte.
    //
    // Firebase Authentication, lui, ne se laisse pas ecrire par le client.
    // Si le compte n'y est plus lisible, `email` reste indefini :
    // `isAdminEmail` rend alors false, ce qui REFUSE la promotion et AUTORISE
    // la retrogradation — les deux fois dans le sens le plus sur.
    let email: string | undefined;
    try {
      const { getAdminAuth } = await import('@/lib/firebase/admin');
      const auth = await getAdminAuth();
      const compte = await auth.getUser(uid);
      email = compte?.email || undefined;
    } catch (errAuth) {
      console.warn('[admin-self-promote] annuaire d\'identite illisible', errAuth);
      email = undefined;
    }

    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');

    // ─── DEMOTE PATH (Phase 9.5 c15 BUG B) ──────────────────────────────
    // Trigger : user a role='admin' MAIS email plus dans ADMIN_EMAILS allowlist
    // (ex: bassicustomshoes@gmail.com retiré c15). Pas de demote pour autres users.
    if (action === 'demote') {
      // Server-side check : ne demote QUE les emails actuellement non-admin allowed
      // (anti-spoof : un user ne peut pas demote un autre user via cet endpoint
      //  car uid vient du Bearer token verifié — il agit sur lui-même).
      if (isAdminEmail(email)) {
        return NextResponse.json(
          { error: 'still-eligible', detail: 'email is in admin allowlist, refuse demote' },
          { status: 409 },
        );
      }
      // Idempotent : déjà non-admin → no-op
      if (userData?.role !== 'admin') {
        return NextResponse.json(
          { ok: true, alreadyNonAdmin: true, role: userData?.role || 'user' },
          { status: 200 },
        );
      }

      const newRole: 'partner' | 'user' = 'user';
      await db.collection('users').doc(uid).update({
        role: newRole,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const demoAuditRef = db.collection('adminActions').doc();
      await demoAuditRef.set({
        actionId: demoAuditRef.id,
        adminId: 'system',
        actionType: 'auto_demote_admin',
        targetType: 'user',
        targetId: uid,
        metadata: {
          email,
          previousRole: 'admin',
          newRole,
          source: 'login',
          reason: 'email-removed-from-admin-allowlist',
        },
        createdAt: Timestamp.now(),
      });
      return NextResponse.json(
        { ok: true, demoted: true, role: newRole },
        { status: 200 },
      );
    }

    // ─── PROMOTE PATH (Phase 9.5 c9, comportement original) ──────────────
    if (!isAdminEmail(email)) {
      return NextResponse.json(
        { error: 'not-eligible', detail: 'email not in admin allowlist' },
        { status: 403 },
      );
    }

    // Idempotent : déjà admin → no-op
    if (userData?.role === 'admin') {
      return NextResponse.json(
        { ok: true, alreadyAdmin: true, role: 'admin' },
        { status: 200 },
      );
    }

    // Promote
    await db.collection('users').doc(uid).update({
      role: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Audit log (Admin SDK bypass rules)
    const auditRef = db.collection('adminActions').doc();
    await auditRef.set({
      actionId: auditRef.id,
      adminId: 'system',
      actionType: 'auto_promote_admin',
      targetType: 'user',
      targetId: uid,
      metadata: {
        email,
        previousRole: userData?.role || 'unknown',
        source: 'login',
      },
      createdAt: Timestamp.now(),
    });

    return NextResponse.json(
      { ok: true, alreadyAdmin: false, role: 'admin' },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/auth/admin-self-promote]', err);
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
