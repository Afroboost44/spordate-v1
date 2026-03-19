"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

interface ActivityCard {
  activityId: string;
  name: string;
  description: string;
  sport: string;
  price: number;
  duration: number;
  schedule: string;
  imageUrl: string;
  city: string;
  partnerName?: string;
}

// Données Afroboost en dur (fallback si Firestore pas configuré ou vide)
const AFROBOOST_FALLBACK: ActivityCard[] = [
  {
    activityId: 'afroboost-1',
    name: 'Afroboost — Cours collectif',
    description: 'Danse afro & cardio intense. Énergie pure, bonne humeur garantie.',
    sport: 'Afroboost',
    price: 25,
    duration: 60,
    schedule: 'Mar 19h · Jeu 19h · Sam 10h',
    imageUrl: 'https://picsum.photos/seed/afroboost-class/800/600',
    city: 'Genève',
    partnerName: 'Afroboost Genève',
  },
  {
    activityId: 'afroboost-2',
    name: 'Afro Dance — Session libre',
    description: 'Mouvements africains authentiques. Chorégraphies modernes sur des rythmes afrobeats.',
    sport: 'Afro Dance',
    price: 25,
    duration: 60,
    schedule: 'Mer 18h30 · Sam 11h30',
    imageUrl: 'https://picsum.photos/seed/afro-dance-session/800/600',
    city: 'Genève',
    partnerName: 'Afroboost Genève',
  },
  {
    activityId: 'afroboost-3',
    name: 'Dance Fitness — Cardio dansé',
    description: 'Sculpte ton corps en t\'éclatant ! Mix fitness sur rythmes afro, latino et pop.',
    sport: 'Dance Fitness',
    price: 20,
    duration: 45,
    schedule: 'Lun 12h15 · Ven 18h',
    imageUrl: 'https://picsum.photos/seed/dance-fitness-cardio/800/600',
    city: 'Genève',
    partnerName: 'Afroboost Genève',
  },
  {
    activityId: 'afroboost-4',
    name: 'Zumba Afro — Party fitness',
    description: 'Rythmes africains et latins, ambiance party, résultats fitness. Aucune expérience requise !',
    sport: 'Zumba',
    price: 20,
    duration: 50,
    schedule: 'Mar 12h15 · Sam 14h',
    imageUrl: 'https://picsum.photos/seed/zumba-afro-party/800/600',
    city: 'Genève',
    partnerName: 'Afroboost Genève',
  },
];

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!db || !isFirebaseConfigured) {
        setActivities(AFROBOOST_FALLBACK);
        setLoading(false);
        return;
      }
      try {
        const q = query(
          collection(db, 'activities'),
          where('isActive', '==', true),
          orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        const data = snap.docs.map(d => ({ ...d.data(), activityId: d.id } as ActivityCard));
        setActivities(data.length > 0 ? data : AFROBOOST_FALLBACK);
      } catch {
        setActivities(AFROBOOST_FALLBACK);
      }
      setLoading(false);
    };
    load();
  }, []);

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

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {activities.map((activity) => (
            <Card key={activity.activityId} className="overflow-hidden bg-card border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20 transition-all duration-300 transform hover:-translate-y-2">
              <div className="relative h-56 w-full">
                <img
                  src={activity.imageUrl || `https://picsum.photos/seed/${activity.sport}/800/600`}
                  alt={activity.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40" />
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full">
                  {activity.duration || 60} min
                </div>
              </div>
              <CardContent className="p-5">
                <h3 className="text-lg font-bold mb-1">{activity.name}</h3>
                {activity.description && (
                  <p className="text-foreground/50 text-sm mb-2 line-clamp-2">{activity.description}</p>
                )}
                <p className="text-xs text-foreground/30 mb-4">{activity.schedule}</p>
                <div className="flex justify-between items-center">
                  <p className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-rose-400">
                    {activity.price} CHF
                  </p>
                  <Button asChild className="font-semibold bg-primary hover:bg-primary/90 text-sm px-4">
                    <Link href="/payment">Réserver</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-16 text-center border-t border-white/5 pt-12">
        <p className="text-white/30 text-sm max-w-lg mx-auto">
          Tous les cours sont dispensés par Afroboost Genève, studio de danse afro #1 en Suisse romande.
          Les réservations incluent l&apos;accès au studio et l&apos;encadrement par un coach professionnel.
        </p>
      </div>
    </div>
  );
}
