"use client";

import { useState, useEffect, FormEvent } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Edit, Trash2, Loader2, Clock, MapPin, Users } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, where, getDocs, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, orderBy
} from 'firebase/firestore';

interface Activity {
  activityId: string;
  partnerId: string;
  name: string;
  description: string;
  sport: string;
  price: number;
  duration: number;
  city: string;
  address: string;
  schedule: string;
  maxParticipants: number;
  currentParticipants: number;
  isActive: boolean;
  imageUrl: string;
}

const SPORTS = [
  'Danse / Zumba', 'Afroboost', 'Salsa', 'Bachata', 'Hip-Hop',
  'Fitness', 'Yoga', 'Running', 'Tennis', 'Crossfit', 'Padel',
];

const CITIES = [
  'Genève', 'Lausanne', 'Zurich', 'Berne', 'Bâle', 'Lucerne', 'Fribourg', 'Neuchâtel',
];

export default function PartnerOffersPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSport, setFormSport] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formDuration, setFormDuration] = useState('60');
  const [formCity, setFormCity] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formSchedule, setFormSchedule] = useState('');
  const [formMax, setFormMax] = useState('10');
  const [formImage, setFormImage] = useState('');

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }
    loadActivities();
  }, [user]);

  const loadActivities = async () => {
    if (!db || !user) return;
    try {
      let snap;
      try {
        const q = query(collection(db, 'activities'), where('partnerId', '==', user.uid), orderBy('createdAt', 'desc'));
        snap = await getDocs(q);
      } catch {
        // Index might not be ready, retry without orderBy
        console.warn('[Partner] Index not ready, fetching without orderBy');
        const q = query(collection(db, 'activities'), where('partnerId', '==', user.uid));
        snap = await getDocs(q);
      }
      setActivities(snap.docs.map(d => ({ ...d.data(), activityId: d.id } as Activity)));
    } catch (err) { console.error('Erreur chargement activités:', err); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setFormName(''); setFormDesc(''); setFormSport(''); setFormPrice(''); setFormDuration('60');
    setFormCity(''); setFormAddress(''); setFormSchedule(''); setFormMax('10'); setFormImage('');
  };

  const openCreate = () => { setEditing(null); resetForm(); setOpen(true); };

  const openEdit = (act: Activity) => {
    setEditing(act); setFormName(act.name); setFormDesc(act.description || ''); setFormSport(act.sport);
    setFormPrice(String(act.price)); setFormDuration(String(act.duration || 60)); setFormCity(act.city);
    setFormAddress(act.address || ''); setFormSchedule(act.schedule); setFormMax(String(act.maxParticipants));
    setFormImage(act.imageUrl || ''); setOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!db || !user) return;
    setSaving(true);
    try {
      const data = {
        name: formName, description: formDesc, sport: formSport,
        price: parseInt(formPrice) || 0, duration: parseInt(formDuration) || 60,
        city: formCity, address: formAddress, schedule: formSchedule,
        maxParticipants: parseInt(formMax) || 10, imageUrl: formImage,
        partnerId: user.uid, isActive: true, updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'activities', editing.activityId), data);
        toast({ title: 'Activité mise à jour !' });
      } else {
        const ref = doc(collection(db, 'activities'));
        await setDoc(ref, { ...data, activityId: ref.id, currentParticipants: 0, rating: 0, reviewCount: 0, createdAt: serverTimestamp() });
        toast({ title: 'Activité créée !', description: `"${formName}" est maintenant visible.` });
      }
      setOpen(false); resetForm(); setEditing(null); await loadActivities();
    } catch (err) { toast({ variant: 'destructive', title: 'Erreur', description: String(err) }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (act: Activity) => {
    if (!db || !confirm(`Supprimer "${act.name}" ?`)) return;
    try { await deleteDoc(doc(db, 'activities', act.activityId)); toast({ title: 'Activité supprimée' }); await loadActivities(); }
    catch (err) { toast({ variant: 'destructive', title: 'Erreur', description: String(err) }); }
  };

  const handleToggleActive = async (act: Activity) => {
    if (!db) return;
    await updateDoc(doc(db, 'activities', act.activityId), { isActive: !act.isActive, updatedAt: serverTimestamp() });
    await loadActivities();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-light text-white tracking-tight">Mes Activités</h1>
          <p className="text-sm text-white/40">Créez, modifiez ou supprimez vos activités sportives</p>
        </div>
        <Button onClick={openCreate} className="bg-white/5 backdrop-blur-xl border border-[#D91CD2] text-white font-light tracking-wider uppercase h-12 px-6 hover:bg-[#D91CD2]/10">
          <PlusCircle className="mr-2 h-4 w-4" /> Nouvelle activité
        </Button>
      </div>

      {activities.length === 0 ? (
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="py-12 text-center">
            <PlusCircle className="h-12 w-12 text-white/10 mx-auto mb-4" />
            <p className="text-white/30">Aucune activité pour le moment</p>
            <p className="text-xs text-white/20 mt-1">Créez votre première activité pour recevoir des réservations</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activities.map((act) => (
            <Card key={act.activityId} className={`bg-[#1A1A1A] border-white/5 transition-all overflow-hidden ${!act.isActive ? 'opacity-50' : ''}`}>
              {act.imageUrl && (
                <div className="relative h-36 w-full">
                  <img src={act.imageUrl} alt={act.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] to-transparent" />
                </div>
              )}
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-white font-medium">{act.name}</h3>
                    <Badge className={`mt-1 text-xs ${act.isActive ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-white/5 text-white/30 border-white/10'}`}>
                      {act.isActive ? 'Actif' : 'Inactif'}
                    </Badge>
                  </div>
                  <Switch checked={act.isActive} onCheckedChange={() => handleToggleActive(act)} />
                </div>
                {act.description && (
                  <p className="text-xs text-white/30 mb-3 line-clamp-2">{act.description}</p>
                )}
                <div className="space-y-2 text-sm text-white/50 mb-4">
                  <p className="flex items-center gap-2"><span className="text-[#D91CD2]">{act.sport}</span> · <span className="text-white font-medium">{act.price} CHF</span> · <span>{act.duration || 60} min</span></p>
                  <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {act.city}{act.address ? ` — ${act.address}` : ''}</p>
                  <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {act.schedule}</p>
                  <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {act.currentParticipants || 0}/{act.maxParticipants} participants</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => openEdit(act)} variant="outline" size="sm" className="flex-1 border-white/10 text-white/50 hover:text-white"><Edit className="h-3.5 w-3.5 mr-1.5" /> Modifier</Button>
                  <Button onClick={() => handleDelete(act)} variant="outline" size="sm" className="border-red-500/20 text-red-400/50 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-[500px] bg-black border-white/10">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-white text-xl font-light">{editing ? "Modifier l'activité" : "Nouvelle activité"}</DialogTitle>
              <DialogDescription>{editing ? "Mettez à jour les détails." : "Créez une activité pour recevoir des réservations."}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-6 max-h-[60vh] overflow-y-auto pr-2">
              <div className="grid gap-2">
                <Label className="text-white/50">Nom de l&apos;activité *</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Cours de Zumba" className="bg-[#1A1A1A] border-white/10 h-12" required />
              </div>
              <div className="grid gap-2">
                <Label className="text-white/50">Description</Label>
                <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Décrivez votre activité, l'ambiance, ce que les participants vont vivre..." className="bg-[#1A1A1A] border border-white/10 rounded-md px-3 py-2 text-sm text-white min-h-[80px] resize-none focus:outline-none focus:ring-1 focus:ring-[#D91CD2]" />
              </div>
              <div className="grid gap-2">
                <Label className="text-white/50">Image (URL)</Label>
                <Input value={formImage} onChange={e => setFormImage(e.target.value)} placeholder="https://... ou laisser vide pour l'image par défaut" className="bg-[#1A1A1A] border-white/10 h-12" />
                {formImage && (
                  <div className="relative h-32 w-full rounded-lg overflow-hidden border border-white/10">
                    <img src={formImage} alt="Aperçu" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-white/50">Sport *</Label>
                  <Select value={formSport} onValueChange={setFormSport}><SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12"><SelectValue placeholder="Choisir" /></SelectTrigger><SelectContent>{SPORTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-white/50">Prix (CHF) *</Label>
                  <Input value={formPrice} onChange={e => setFormPrice(e.target.value)} type="number" placeholder="25" className="bg-[#1A1A1A] border-white/10 h-12" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-white/50">Durée (min) *</Label>
                  <Input value={formDuration} onChange={e => setFormDuration(e.target.value)} type="number" placeholder="60" className="bg-[#1A1A1A] border-white/10 h-12" required />
                </div>
                <div className="grid gap-2">
                  <Label className="text-white/50">Places max</Label>
                  <Input value={formMax} onChange={e => setFormMax(e.target.value)} type="number" placeholder="10" className="bg-[#1A1A1A] border-white/10 h-12" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-white/50">Ville *</Label>
                  <Select value={formCity} onValueChange={setFormCity}><SelectTrigger className="bg-[#1A1A1A] border-white/10 h-12"><SelectValue placeholder="Choisir" /></SelectTrigger><SelectContent>{CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-white/50">Adresse</Label>
                  <Input value={formAddress} onChange={e => setFormAddress(e.target.value)} placeholder="Rue du Sport 12" className="bg-[#1A1A1A] border-white/10 h-12" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-white/50">Horaires *</Label>
                <Input value={formSchedule} onChange={e => setFormSchedule(e.target.value)} placeholder="Mar 19h, Jeu 19h, Sam 10h" className="bg-[#1A1A1A] border-white/10 h-12" required />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <DialogClose asChild><Button type="button" variant="outline" className="border-white/10">Annuler</Button></DialogClose>
              <Button type="submit" disabled={saving} className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? "Mettre à jour" : "Publier"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
