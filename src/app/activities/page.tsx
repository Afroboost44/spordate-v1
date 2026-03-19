"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin } from "lucide-react";
import Link from "next/link";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

interface ActivityCard {
  activityId: string;
  title: string;
  name?: string;
  description: string;
  sport: string;
  price: number;
  duration: number;
  schedule: string;
  imageUrl?: string;
  images?: string[];
  city: string;
  partnerName: string;
  partnerId: string;
}

// Données Afroboost en dur (fallback si Firestore pas configuré ou vide)
const AFROBOOST_FALLBACK: ActivityCard[] = [
  {
    activityId: 'afroboost-1',
    title: 'Afroboost — Cours collectif',
    description: 'Danse afro & cardio intense. Énergie pure, bonne humeur garantie.',
    sport: 'Afroboost',
    price: 25,
    duration: 60,
    schedule: 'Mar 19h · Jeu 19h · Sam 10h',
    imageUrl: 'https://picsum.photos/seed/afroboost-class/800/600',
    city: 'Genève',
    partnerName: 'Afroboost Genève',
    partnerId: 'afroboost',
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
        const data = snap.docs.map(d => {
          const raw = d.data();
          return {
            activityId: d.id,
            title: raw.title || raw.name || '',
            description: raw.description || '',
            sport: raw.sport || '',
            price: raw.price || 0,
            duration: raw.duration || 60,
            schedule: raw.schedule
              ? (Array.isArray(raw.schedule)
                  ? raw.schedule.map((s: any) => `${s.day} ${s.start}`).join(' · ')
                  : raw.schedule)
              : '',
            imageUrl: raw.images?.[0] || raw.imageUrl || '',
            city: raw.city || '',
            partnerName: raw.partnerName || '',
            partnerId: raw.partnerId || '',
          } as ActivityCard;
        });
        setActivities(data.length > 0 ? data : AFROBOOST_FALLBACK);
      } catch {
        setActivities(AFROBOOST_FALLBACK);
      }
      setLoading(false);
    };
    load();
  }, []);

  // Group activities by partner
  const partnerGroups = activities.reduce((acc, act) => {
    const key = act.partnerName || 'Autre';
    if (!acc[key]) acc[key] = [];
    acc[key].push(act);
    return acc;
  }, {} as Record<string, ActivityCard[]>);

  const partnerNames = Object.keys(partnerGroups);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Generic page header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl font-headline">
          Activités
        </h1>
        <p className="mt-4 text-gray-400 md:text-xl">
          Découvre les cours proposés par nos partenaires — Réserve ta session et vis l&apos;expérience.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" />
        </div>
      ) : (
        <div className="space-y-16">
          {partnerNames.map((partnerName) => {
            const partnerActivities = partnerGroups[partnerName];
            const city = partnerActivities[0]?.city;

            return (
              <section key={partnerName}>
                {/* Partner header */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-white">{partnerName}</h2>
                    {city && (
                      <p className="text-sm text-white/40 flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" /> {city}
                      </p>
                    )}
                  </div>
                  <Badge className="bg-[#D91CD2]/10 text-[#D91CD2] border-[#D91CD2]/30 text-xs">
                    {partnerActivities.length} activité{partnerActivities.length > 1 ? 's' : ''}
                  </Badge>
                </div>

                {/* Activities grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {partnerActivities.map((activity) => (
                    <Card
                      key={activity.activityId}
                      className="overflow-hidden bg-card border-border/20 shadow-lg shadow-accent/10 hover:shadow-accent/20 transition-all duration-300 transform hover:-translate-y-2"
                    >
                      <div className="relative h-56 w-full">
                        <img
                          src={activity.imageUrl || `https://picsum.photos/seed/${activity.sport}/800/600`}
                          alt={activity.title}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40" />
                        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full">
                          {activity.duration || 60} min
                        </div>
                      </div>
                      <CardContent className="p-5">
                        <h3 className="text-lg font-bold mb-1">{activity.title}</h3>
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
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-16 text-center border-t border-white/5 pt-12">
        <p className="text-white/30 text-sm max-w-lg mx-auto">
          Les réservations incluent l&apos;accès au studio et l&apos;encadrement par un coach professionnel.
          Vous êtes partenaire ? <Link href="/partner/register" className="text-[#D91CD2] hover:underline">Rejoignez le réseau Spordateur</Link>.
        </p>
      </div>
    </div>
  );
}
