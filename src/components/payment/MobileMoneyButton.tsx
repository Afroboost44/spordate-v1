'use client';

/**
 * Bouton « Payer en Mobile Money » + sélecteur de pays.
 *
 * ⚠️ NE S'AFFICHE PAS SI L'INTÉGRATION N'EST PAS CONFIGURÉE. `GET
 * /api/pawapay/checkout` répond `configured:false` quand le jeton est absent :
 * on rend alors `null`. Un bouton qui échoue au clic est pire que pas de bouton.
 *
 * ⚠️ ACHATS PONCTUELS UNIQUEMENT. Le serveur refuse déjà les forfaits
 * reconduits ; ce composant n'est simplement jamais posé à côté d'eux.
 *
 * La liste des pays vient du BACKEND, qui la lit chez pawaPay : le jour où un
 * pays s'ouvre (ou se ferme) sur le compte, l'écran suit sans redéploiement.
 */

import { useEffect, useState } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import type { User } from 'firebase/auth';

interface Pays { code: string; currency: string; label: string }

/**
 * V409 — quatre origines d'achat, un seul bouton.
 *
 * `mode` decide de ce que le serveur facture : un pack de credits, une
 * reservation de session (palier x places), une invitation duo, ou un boost.
 * Le composant ne transporte QUE des identifiants — jamais un montant : c'est le
 * serveur qui calcule, et c'est ce qui empeche un prix trafique cote navigateur.
 */
export default function MobileMoneyButton({
  packageId, user, matchId, referralCode, partnerId, className = '',
  mode = 'package', sessionId, isDuoTicket, inviteId,
  activityId, duration, city, country, locationLabel,
  libelle,
}: {
  packageId?: string;
  user: User | null | undefined;
  matchId?: string;
  referralCode?: string;
  partnerId?: string;
  className?: string;
  /** 'package' (defaut) | 'session' | 'invite-accept' | 'boost' */
  mode?: 'package' | 'session' | 'invite-accept' | 'boost';
  sessionId?: string;
  isDuoTicket?: boolean;
  inviteId?: string;
  activityId?: string;
  duration?: string;
  city?: string;
  country?: string;
  locationLabel?: string;
  /** Libelle du bouton ferme. Defaut : « Payer en Mobile Money ». */
  libelle?: string;
}) {
  const [pays, setPays] = useState<Pays[]>([]);
  const [choisi, setChoisi] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let annule = false;
    fetch('/api/pawapay/checkout')
      .then((r) => r.json())
      .then((d) => {
        if (annule || !d?.configured) return;
        setPays(d.countries || []);
      })
      .catch(() => { /* silencieux : la carte reste disponible */ });
    return () => { annule = true; };
  }, []);

  if (pays.length === 0) return null;

  const payer = async () => {
    if (!user) { setErreur('Connecte-toi pour payer.'); return; }
    if (!choisi) { setErreur('Choisis ton pays.'); return; }
    setEnCours(true); setErreur('');
    try {
      const idToken = await user.getIdToken();
      const r = await fetch('/api/pawapay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          mode,
          country: choisi,
          // Selon le mode, le serveur ne lit que ce qui le concerne ; les
          // champs absents sont simplement ignores.
          packageId, matchId, referralCode, partnerId,
          sessionId, isDuoTicket, inviteId,
          activityId, duration, city,
          // `country` est deja pris par le pays Mobile Money : le pays du boost
          // voyage sous un autre nom pour ne pas l'ecraser.
          boostCountry: country, locationLabel,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.url) throw new Error(d?.error || 'Paiement indisponible');
      window.location.href = d.url;
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Paiement indisponible');
      setEnCours(false);
    }
  };

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOuvert(true); }}
        data-testid={`mm-open-${mode === 'package' ? packageId : mode}`}
        className={`w-full h-11 rounded-full text-sm font-light tracking-wider uppercase flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition ${className}`}
      >
        <Smartphone className="h-4 w-4" /> {libelle || 'Payer en Mobile Money'}
      </button>
    );
  }

  return (
    <div className={`space-y-2 ${className}`} onClick={(e) => e.stopPropagation()}>
      <select
        value={choisi}
        onChange={(e) => setChoisi(e.target.value)}
        data-testid={`mm-country-${mode === 'package' ? packageId : mode}`}
        className="w-full h-11 rounded-xl bg-white/5 border border-white/15 text-white text-sm px-3"
      >
        <option value="" className="bg-black">Choisis ton pays</option>
        {pays.map((p) => (
          <option key={p.code} value={p.code} className="bg-black">
            {p.label} — {p.currency}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={payer}
        disabled={enCours || !choisi}
        data-testid={`mm-pay-${mode === 'package' ? packageId : mode}`}
        className="w-full h-11 rounded-full text-sm font-light tracking-wider uppercase flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white disabled:opacity-50 transition"
      >
        {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
        {enCours ? 'Redirection…' : 'Continuer'}
      </button>
      <p className="text-[11px] text-white/35 text-center">
        Le montant est converti dans la devise du pays choisi.
      </p>
      {erreur && <p className="text-[11px] text-red-400 text-center">{erreur}</p>}
    </div>
  );
}
