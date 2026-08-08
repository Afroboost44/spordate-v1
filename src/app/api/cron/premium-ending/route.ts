/**
 * V408 — rappel de FIN d'accès Premium à durée fixe (payé en Mobile Money).
 *
 * ⚠️ CE N'EST PAS LE RAPPEL DE RENOUVELLEMENT, ET LA DIFFÉRENCE EST
 * CONTRACTUELLE. Le Premium mensuel par carte se reconduit et se prélève : son
 * rappel annonce un débit. Celui-ci porte sur un accès PAYÉ D'AVANCE qui
 * s'arrête tout seul : il ne promet aucun prélèvement, et le dit. Employer l'un
 * pour l'autre annoncerait un débit qui n'aura jamais lieu.
 *
 * ⚠️ NE CIBLE QUE LES ACCÈS À DURÉE FIXE. Un abonné Stripe a `premiumExpiresAt`
 * absent (Stripe gère le cycle) : il ne peut donc pas tomber dans cette requête,
 * et ne recevra jamais ce message.
 *
 * Fenêtre de 3 jours, et un drapeau `premiumEndingNoticeSentFor` porté par la
 * date de fin : relancé deux fois le même jour, le cron n'envoie qu'une fois ;
 * et un accès repris plus tard (nouvelle date) redevient éligible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/payment/packages';
import { sendEmail } from '@/lib/email/sendEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Jours avant la fin. 3 laisse le temps de décider sans avoir oublié. */
const JOURS_AVANT = 3;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // `apercu=true` : renvoie EXACTEMENT ce qui partirait, sans rien envoyer.
  const apercu = new URL(req.url).searchParams.get('apercu') === 'true';

  const db = await getDb();
  const maintenant = new Date();
  const debut = new Date(maintenant.getTime() + (JOURS_AVANT - 0.5) * 86400000);
  const fin = new Date(maintenant.getTime() + (JOURS_AVANT + 0.5) * 86400000);

  const snap = await db.collection('users')
    .where('isPremium', '==', true)
    .where('premiumExpiresAt', '>=', debut)
    .where('premiumExpiresAt', '<=', fin)
    .limit(500)
    .get();

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://spordateur.com';
  const lettres: Array<Record<string, string>> = [];
  let envoyes = 0;

  for (const doc of snap.docs) {
    const u = doc.data() as Record<string, unknown>;
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

  return NextResponse.json({
    apercu, jours_avant: JOURS_AVANT,
    fenetre: { debut: debut.toISOString(), fin: fin.toISOString() },
    concernes: lettres.length, envoyes, lettres: apercu ? lettres : undefined,
  });
}
