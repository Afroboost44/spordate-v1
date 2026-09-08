/**
 * F3 FINAL — LA GARDE OPAQUE VERS UN PROFIL LIÉ.
 *
 * afroboost ne connaît jamais le `uid` d'un autre membre : il reçoit, pour un
 * utilisateur lié qu'il affiche déjà, un jeton de VUE opaque (`spordate-profile-
 * view`) qui EMBALLE le uid. Le navigateur ouvre `/u/<jeton>` ; ici, côté
 * serveur, on vérifie ce jeton avec le secret partagé, on en extrait le uid, et
 * on redirige vers le VRAI profil `/profile/<uid>` — celui, déjà protégé par
 * l'AuthGuard, que Spordateur affiche à ses membres connectés.
 *
 * Jeton invalide / expiré / forgé -> retour à l'accueil, jamais d'erreur
 * bavarde, jamais de profil ouvert. Le uid n'apparaît QUE dans l'URL finale du
 * profil (comme pour n'importe quel lien de profil de l'app), jamais dans une
 * donnée servie à une liste.
 */
import { redirect } from 'next/navigation';
import { uidDepuisJetonVue } from '@/lib/bridge/jetonResolution';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function OuvrirProfilOpaque(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const secret = process.env.AFRO_SPORDATE_SHARED_SECRET || '';
  const uid = secret ? uidDepuisJetonVue(decodeURIComponent(token || ''), secret, Date.now()) : null;

  // `redirect` préfixe le basePath (/rencontre) automatiquement — chemins
  // internes de l'app uniquement, jamais une URL fournie.
  if (!uid) redirect('/');
  redirect(`/profile/${encodeURIComponent(uid)}`);
}
