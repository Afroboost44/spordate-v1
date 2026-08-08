/**
 * V409 — envoi des rappels de FIN d'accès Premium à durée fixe.
 *
 * ⚠️ EXTRAIT DE LA ROUTE POUR ÊTRE APPELÉ PAR DEUX APPELANTS : l'endpoint
 * `/api/cron/premium-ending` (déclenchement manuel / cron externe) ET la boucle
 * de fond démarrée avec le serveur (`instrumentation.ts`). Une seule
 * implémentation, donc pas de divergence entre ce qu'on teste et ce qui part.
 *
 * ⚠️ NE CIBLE QUE LES ACCÈS À DURÉE FIXE. Un abonné Stripe n'a pas de
 * `premiumExpiresAt` (Stripe gère le cycle) : il ne peut pas tomber dans cette
 * requête, et ne recevra donc jamais ce message.
 */
import { getDb } from '@/lib/payment/packages';
import { sendEmail } from '@/lib/email/sendEmail';

/** Jours avant la fin. 3 laisse le temps de décider sans avoir oublié. */
export const JOURS_AVANT = 3;

export interface ResultatRappels {
  concernes: number;
  envoyes: number;
  lettres: Array<Record<string, string>>;
  fenetre: { debut: string; fin: string };
}

export async function envoyerRappelsFinPremium(apercu: boolean): Promise<ResultatRappels> {
  const db = await getDb();
  const maintenant = new Date();
  const debut = new Date(maintenant.getTime() + (JOURS_AVANT - 0.5) * 86400000);
  const fin = new Date(maintenant.getTime() + (JOURS_AVANT + 0.5) * 86400000);

  // ⚠️ UN SEUL CHAMP DANS LA REQUÊTE, ET C'EST DÉLIBÉRÉ. Croiser `isPremium`
  // avec la plage sur `premiumExpiresAt` exige un INDEX COMPOSITE que Firestore
  // refuse tant qu'il n'est pas créé à la main — constaté en production, la
  // boucle échouait à chaque tour (« FAILED_PRECONDITION: The query requires an
  // index »). Le champ de plage est auto-indexé : on interroge sur lui seul et
  // on filtre `isPremium` en mémoire. La fenêtre ne fait qu'une journée, le
  // surcoût de lecture est négligeable — et la tâche ne dépend plus d'un index
  // qu'un redéploiement pourrait ne pas avoir.
  const snap = await db.collection('users')
    .where('premiumExpiresAt', '>=', debut)
    .where('premiumExpiresAt', '<=', fin)
    .limit(500)
    .get();

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
  const lettres: Array<Record<string, string>> = [];
  let envoyes = 0;

  for (const doc of snap.docs) {
    const u = doc.data() as Record<string, unknown>;
    if (u.isPremium !== true) continue;   // filtre déplacé de la requête vers ici
    const email = String(u.email || '').trim();
    if (!email) continue;

    const ts = u.premiumExpiresAt as { toDate?: () => Date } | undefined;
    const dateFin = ts?.toDate ? ts.toDate() : null;
    if (!dateFin) continue;
    const cle = dateFin.toISOString().slice(0, 10);
    // Déjà prévenu POUR CETTE date de fin ?
    if (String(u.premiumEndingNoticeSentFor || '') === cle) continue;

    const prenom = String(u.firstName || u.displayName || email.split('@')[0] || '').split(' ')[0];
    const lisible = dateFin.toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' });

    lettres.push({ destinataire: email, prenom, fin: lisible, uid: doc.id });
    if (apercu) continue;

    try {
      await sendEmail({
        to: email,
        templateName: 'premiumFixedEnding',
        templateData: { firstName: prenom || 'toi', endDate: lisible, link: `${base}/premium` },
        lang: 'fr',
      });
      await doc.ref.update({ premiumEndingNoticeSentFor: cle });
      envoyes += 1;
    } catch (e) {
      // Un rappel manqué ne doit pas interrompre les suivants ; le drapeau
      // n'étant pas posé, la prochaine exécution réessaiera.
      console.error('[premium-ending] échec', email, String(e).slice(0, 160));
    }
  }

  return {
    concernes: lettres.length,
    envoyes,
    lettres,
    fenetre: { debut: debut.toISOString(), fin: fin.toISOString() },
  };
}
