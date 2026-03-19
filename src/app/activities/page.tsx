import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const activities = [
  {
    title: 'Afroboost — Cours collectif',
    description: 'Danse afro & cardio intense. Énergie pure, bonne humeur garantie.',
    schedule: 'Mar 19h · Jeu 19h · Sam 10h',
    price: '25 CHF',
    duration: '60 min',
    image: 'https://picsum.photos/seed/afroboost-class/800/600',
    sport: 'afroboost',
    emoji: '🔥',
  },
  {
    title: 'Afro Dance — Session libre',
    description: 'Mouvements africains authentiques. Chorégraphies modernes sur des rythmes afrobeats.',
    schedule: 'Mer 18h30 · Sam 11h30',
    price: '25 CHF',
    duration: '60 min',
    image: 'https://picsum.photos/seed/afro-dance-session/800/600',
    sport: 'afro_dance',
    emoji: '🥁',
  },
  {
    title: 'Dance Fitness — Cardio dansé',
    description: 'Sculpte ton corps en t\'éclatant ! Mix fitness sur rythmes afro, latino et pop.',
    schedule: 'Lun 12h15 · Ven 18h',
    price: '20 CHF',
    duration: '45 min',
    image: 'https://picsum.photos/seed/dance-fitness-cardio/800/600',
    sport: 'dance_fitness',
    emoji: '⚡',
  },
  {
    title: 'Zumba Afro — Party fitness',
    description: 'Rythmes africains et latins, ambiance party, résultats fitness. Aucune expérience requise !',
    schedule: 'Mar 12h15 · Sam 14h',
    price: '20 CHF',
    duration: '50 min',
    image: 'https://picsum.photos/seed/zumba-afro-party/800/600',
    sport: 'zumba',
    emoji: '💃',
  },
];

export default function ActivitiesPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl font-headline">
          Afroboost Genève
        </h1>
        <p className="mt-4 text-gray-400 md:text-xl">
          Notre partenaire exclusif — Réserve ta session et vis l&apos;expérience.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {activities.map((activity, index) => (
          <Card key={index} className="overflow-hidden bg-card border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20 transition-all duration-300 transform hover:-translate-y-2">
            <div className="relative h-56 w-full">
              <img
                src={activity.image}
                alt={activity.title}
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40" />
              <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full">
                {activity.emoji} {activity.duration}
              </div>
            </div>
            <CardContent className="p-5">
              <h3 className="text-lg font-bold mb-1">{activity.title}</h3>
              <p className="text-foreground/50 text-sm mb-3 line-clamp-2">{activity.description}</p>
              <p className="text-xs text-foreground/30 mb-4">{activity.schedule}</p>
              <div className="flex justify-between items-center">
                <p className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-rose-400">{activity.price}</p>
                <Button asChild className="font-semibold bg-primary hover:bg-primary/90 text-sm px-4">
                  <Link href="/payment">Réserver</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Info partenaire */}
      <div className="mt-16 text-center border-t border-white/5 pt-12">
        <p className="text-white/30 text-sm max-w-lg mx-auto">
          Tous les cours sont dispensés par Afroboost Genève, studio de danse afro #1 en Suisse romande.
          Les réservations incluent l&apos;accès au studio et l&apos;encadrement par un coach professionnel.
        </p>
      </div>
    </div>
  );
}
