/**
 * V408/V409 — rappel de FIN d'accès Premium à durée fixe (payé en Mobile Money).
 *
 * ⚠️ CE N'EST PAS LE RAPPEL DE RENOUVELLEMENT, ET LA DIFFÉRENCE EST
 * CONTRACTUELLE. Le Premium mensuel par carte se reconduit et se prélève : son
 * rappel annonce un débit. Celui-ci porte sur un accès PAYÉ D'AVANCE qui
 * s'arrête tout seul : il ne promet aucun prélèvement, et le dit.
 *
 * La logique vit dans `@/lib/premium/rappelFin`, partagée avec la boucle de fond
 * (`instrumentation.ts`) — c'est elle qui déclenche réellement les envois.
 */
import { NextRequest, NextResponse } from 'next/server';
import { envoyerRappelsFinPremium, JOURS_AVANT } from '@/lib/premium/rappelFin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apercu = new URL(req.url).searchParams.get('apercu') === 'true';
  const r = await envoyerRappelsFinPremium(apercu);
  return NextResponse.json({
    apercu, jours_avant: JOURS_AVANT, fenetre: r.fenetre,
    concernes: r.concernes, envoyes: r.envoyes,
    lettres: apercu ? r.lettres : undefined,
  });
}
