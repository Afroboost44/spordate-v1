/**
 * Phase 9.5 c21 — <PartnerDiscoveryOptInCard>.
 *
 * Toggle visible UNIQUEMENT si admin a configuré discoveryMode === 'participants-only'.
 * Permet au partner d'opt-in / opt-out ses participants du swipe pool /discovery.
 *
 * Pipeline :
 *  - useFeatureFlags() → check discoveryMode === 'participants-only' (sinon return null)
 *  - Load partners doc by email (Web SDK Firestore) au mount → state includeInDiscovery
 *  - Toggle → POST /api/partner/discovery-opt-in {includeInDiscovery: next}
 *  - Toast info + refresh state via onSnapshot
 *
 * Charte stricte black/#D91CD2/white. Switch shadcn.
 */

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useFeatureFlags } from '@/lib/site/useFeatureFlags';
import { useToast } from '@/hooks/use-toast';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore';

export function PartnerDiscoveryOptInCard() {
  const { user } = useAuth();
  const { discoveryMode, loading: flagsLoading } = useFeatureFlags();
  const { toast } = useToast();
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [includeInDiscovery, setIncludeInDiscovery] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Real-time subscription au partner doc owned par user.email
  useEffect(() => {
    if (!user?.email || !isFirebaseConfigured || !db) return;
    const fbDb = db;
    const q = query(
      collection(fbDb, 'partners'),
      where('email', '==', user.email),
      limit(1),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setPartnerId(null);
          setLoaded(true);
          return;
        }
        const docSnap = snap.docs[0];
        setPartnerId(docSnap.id);
        // Default true si champ absent (partner opt-in par défaut)
        setIncludeInDiscovery(docSnap.data()?.includeInDiscovery !== false);
        setLoaded(true);
      },
      (err) => {
        console.warn('[PartnerDiscoveryOptInCard] snapshot err:', err);
        setLoaded(true);
      },
    );
    return () => unsub();
  }, [user?.email]);

  // Hide UNLESS admin a activé le mode 'participants-only'
  if (flagsLoading) return null;
  if (discoveryMode !== 'participants-only') return null;
  if (!user) return null;
  if (!loaded) return null;
  if (!partnerId) return null;

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/partner/discovery-opt-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ includeInDiscovery: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'Échec mise à jour',
          description: data?.detail || data?.error || 'Réessaie.',
          variant: 'destructive',
        });
        return;
      }
      // State updated via onSnapshot (no manual setIncludeInDiscovery here)
      toast({
        title: next ? 'Participants visibles dans Rencontres' : 'Participants masqués des Rencontres',
        description: next
          ? 'Tes participants pourront se rencontrer entre eux et avec d\'autres participants des partenaires opt-in.'
          : 'Tes participants ne seront pas visibles dans /discovery (opt-out).',
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[PartnerDiscoveryOptInCard] toggle failed:', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-[#111] border-accent/20">
      <CardContent className="p-5 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
          <Sparkles className="h-5 w-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-white font-medium">
                Mes participants apparaissent dans les Rencontres
              </span>
              <span className="text-[11px] text-white/50 leading-relaxed">
                Les users avec une réservation confirmée sur tes activités pourront se rencontrer
                entre eux et avec les participants d&apos;autres partenaires opt-in via le swipe matching.
              </span>
            </div>
            <Switch
              checked={includeInDiscovery}
              onCheckedChange={handleToggle}
              disabled={saving}
            />
          </div>
          {saving && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-white/40">
              <Loader2 className="h-3 w-3 animate-spin" />
              Mise à jour…
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
