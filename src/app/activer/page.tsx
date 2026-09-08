'use client';
/**
 * F4 — LA PAGE D'ACTIVATION VOLONTAIRE, CÔTÉ SPORDATEUR.
 *
 * On arrive ici avec un jeton d'activation signé par afroboost (`?t=`), qui
 * atteste identité + consentement. Cette page exécute les branches sûres :
 *   - déjà connecté (session Spordateur) + jeton  -> PREUVE de possession :
 *     `link-existing` (l'e-mail prouvé doit être celui du jeton) ;
 *   - jeton seul -> `activate` : déjà lié / preuve requise / création minimale ;
 *   - création  -> on ouvre la session (customToken) puis l'ONBOARDING réel ;
 *   - preuve requise -> on renvoie vers le LOGIN Spordateur existant, puis ici ;
 *   - pas de jeton -> on invite à repartir d'afroboost. Jamais de création ni de
 *     liaison sans jeton consenti.
 *
 * Aucune donnée inventée, aucune fusion par e-mail : tout passe par les routes
 * `/api/bridge/activate` et `/api/bridge/link-existing`.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

type Etat =
  | 'chargement' | 'sans_jeton' | 'travail'
  | 'preuve_requise' | 'deja_lie' | 'erreur';

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

export default function ActiverProfilSocial() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const [etat, setEtat] = useState<Etat>('chargement');
  const [messageErreur, setMessageErreur] = useState('');
  const lance = useRef(false); // anti double-exécution (double montage / double-clic)

  const jeton = (params.get('t') || '').trim();

  useEffect(() => {
    if (loading) return;          // on attend de savoir si une session existe
    if (lance.current) return;
    lance.current = true;

    (async () => {
      if (!jeton) { setEtat('sans_jeton'); return; }
      setEtat('travail');
      try {
        if (user) {
          // PREUVE DE POSSESSION : session authentifiée + jeton d'activation.
          const idToken = await user.getIdToken();
          const r = await fetch('/api/bridge/link-existing', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ t: jeton, idToken }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok && d.status === 'linked') { router.replace('/profile'); return; }
          if (d.error === 'proof_mismatch') {
            setMessageErreur("Cette session ne correspond pas à l'adresse à relier.");
            setEtat('erreur'); return;
          }
          if (d.status === 'conflict') {
            setMessageErreur('Ce compte est déjà relié à un autre profil.');
            setEtat('erreur'); return;
          }
          setMessageErreur("La liaison n'a pas pu être établie.");
          setEtat('erreur'); return;
        }

        // Pas de session : on présente le jeton au serveur, qui décide.
        const r = await fetch('/api/bridge/activate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: jeton }),
        });
        const d = await r.json().catch(() => ({}));

        if (r.ok && d.status === 'created' && d.token) {
          const [{ signInWithCustomToken }, { auth }] = await Promise.all([
            import('firebase/auth'), import('@/lib/firebase'),
          ]);
          if (!auth) { setEtat('erreur'); setMessageErreur('Service indisponible.'); return; }
          await signInWithCustomToken(auth, d.token);
          router.replace('/onboard/prompts');   // l'onboarding Spordateur réel
          return;
        }
        if (r.ok && d.status === 'already_linked') { setEtat('deja_lie'); return; }
        if (r.ok && d.status === 'needs_proof') { setEtat('preuve_requise'); return; }
        if (r.status === 401) {
          setMessageErreur('Lien d’activation expiré ou invalide. Reprends depuis Afroboost.');
          setEtat('erreur'); return;
        }
        setMessageErreur("L'activation n'a pas pu aboutir.");
        setEtat('erreur');
      } catch {
        setMessageErreur('Un problème réseau est survenu. Réessaie.');
        setEtat('erreur');
      }
    })();
  }, [loading, user, jeton, router]);

  const allerLogin = () => {
    // Reprise après connexion : on revient ICI avec le même jeton -> la branche
    // « preuve » s'exécute (session + jeton). `redirect` encodé.
    const retour = encodeURIComponent(`/activer?t=${encodeURIComponent(jeton)}`);
    router.push(`/login?redirect=${retour}`);
  };
  const retourAfroboost = () => { window.location.href = 'https://afroboost.com/'; };

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: '#0b0b0f' }}>
      <div style={{ width: '100%', maxWidth: '420px', background: '#17171d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px', color: '#fff', boxSizing: 'border-box' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 12px' }}>Profil social Spordateur</h1>

        {(etat === 'chargement' || etat === 'travail') && (
          <p data-testid="activer-travail" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', margin: 0 }}>Activation en cours…</p>
        )}

        {etat === 'sans_jeton' && (
          <div data-testid="activer-sans-jeton">
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', lineHeight: 1.5 }}>
              Pour activer ton profil social, reviens sur Afroboost et clique sur « Activer mon profil social ».
            </p>
            <button onClick={retourAfroboost} style={btnSecondaire}>Retour à Afroboost</button>
          </div>
        )}

        {etat === 'preuve_requise' && (
          <div data-testid="activer-preuve">
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '14px', lineHeight: 1.5 }}>
              Un compte Spordateur existe déjà avec ton adresse. Pour le relier en toute sécurité, connecte-toi à ce compte.
            </p>
            <button onClick={allerLogin} style={btnPrimaire}>Me connecter pour relier</button>
            <button onClick={retourAfroboost} style={btnSecondaire}>Annuler</button>
          </div>
        )}

        {etat === 'deja_lie' && (
          <div data-testid="activer-deja-lie">
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '14px', lineHeight: 1.5 }}>Ton profil social est déjà activé.</p>
            <button onClick={() => router.replace('/profile')} style={btnPrimaire}>Ouvrir mon profil</button>
          </div>
        )}

        {etat === 'erreur' && (
          <div data-testid="activer-erreur">
            <p style={{ color: '#ffb4b4', fontSize: '14px', lineHeight: 1.5 }}>{messageErreur}</p>
            <button onClick={retourAfroboost} style={btnSecondaire}>Retour à Afroboost</button>
          </div>
        )}
      </div>
    </main>
  );
}

const btnPrimaire: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: '16px', padding: '12px 16px',
  background: '#D91CD2', color: '#fff', border: 'none', borderRadius: '10px',
  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
};
const btnSecondaire: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: '10px', padding: '10px 16px',
  background: 'transparent', color: 'rgba(255,255,255,0.7)',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px',
  fontSize: '13px', cursor: 'pointer',
};
