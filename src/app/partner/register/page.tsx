"use client";

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Building, ShieldCheck, ArrowLeft, Loader2, CreditCard } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { createPartner } from '@/services/firestore';
import { GeoPoint } from 'firebase/firestore';

export default function PartnerRegisterPage() {
  const [step, setStep] = useState<'form' | 'payment' | 'done'>('form');
  const router = useRouter();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', confirm: '', ide: '',
    phone: '', address: '', city: '', canton: '',
    type: 'studio' as 'gym' | 'studio' | 'outdoor' | 'pool',
    description: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [partnerId, setPartnerId] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    if (formData.password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    setIsLoading(true);

    try {
      if (!auth || !isFirebaseConfigured) {
        throw new Error("Firebase non configuré. Contactez l'administrateur.");
      }

      // 1. Create Firebase Auth account
      const cred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      await updateProfile(cred.user, { displayName: formData.name });

      // 2. Create partner document in Firestore (pending approval)
      const pid = await createPartner({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        address: formData.address,
        city: formData.city || 'Genève',
        canton: formData.canton || 'GE',
        geoPoint: new GeoPoint(46.2044, 6.1432),
        type: formData.type,
        description: formData.description,
        logo: '',
        images: [],
        subscriptionStatus: 'trial', // Will become 'active' after payment
        subscriptionEnd: null as any,
        monthlyFee: 4900,
        promoCode: '',
        referralId: '',
        isApproved: false, // Admin must approve
        isActive: false,   // Not visible until approved
      });

      setPartnerId(pid);

      // 3. Redirect to Stripe checkout for partner subscription
      setStep('payment');

    } catch (err: any) {
      console.error('[Partner Register]', err);
      if (err.code === 'auth/email-already-in-use') {
        setError("Cette adresse email est déjà utilisée. Essayez de vous connecter.");
      } else if (err.code === 'auth/weak-password') {
        setError("Le mot de passe doit contenir au moins 6 caractères.");
      } else {
        setError(err.message || "Une erreur est survenue.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayment = async () => {
    setIsLoading(true);
    setError('');

    try {
      const userId = auth?.currentUser?.uid;
      if (!userId) throw new Error("Session expirée. Veuillez vous reconnecter.");

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: 'partner_monthly',
          userId,
          partnerId, // Pass partnerId for webhook to link
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.url) {
        throw new Error(data.error || "Erreur lors de la création du paiement.");
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;

    } catch (err: any) {
      setError(err.message || "Erreur de paiement.");
      setIsLoading(false);
    }
  };

  const handleSkipPayment = () => {
    // Allow partner to skip payment for now and come back later
    setStep('done');
    toast({ title: "Compte créé", description: "Vous pourrez payer l'abonnement plus tard depuis votre espace." });
  };

  // Step 3: Confirmation
  if (step === 'done') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black p-4">
        <Card className="max-w-md w-full bg-green-900/20 border-green-800 text-center p-6">
          <CardHeader className="items-center">
            <ShieldCheck className="h-16 w-16 text-green-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-green-400 mb-2">Candidature Envoyée !</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-300">
              Votre dossier est enregistré. Après le paiement de l&apos;abonnement,
              l&apos;administrateur validera votre compte pour activer votre accès au portail partenaire.
            </p>
            <div className="bg-black/40 rounded-lg p-4 text-left space-y-2">
              <p className="text-sm text-white/60 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-yellow-400" />
                Paiement de l&apos;abonnement (49 CHF/mois)
              </p>
              <p className="text-sm text-white/60 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-yellow-400" />
                Validation par l&apos;administrateur
              </p>
              <p className="text-sm text-white/60 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-white/20" />
                Accès au portail partenaire
              </p>
            </div>
            <Button onClick={() => router.push('/')} variant="outline" className="w-full border-green-800 text-green-400 hover:bg-green-900/30">
              Retour à l&apos;accueil
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Payment
  if (step === 'payment') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black p-4">
        <Card className="max-w-md w-full bg-[#0a111a] border-cyan-900/50">
          <CardHeader className="text-center">
            <CreditCard className="h-10 w-10 text-[#D91CD2] mx-auto mb-2" />
            <CardTitle className="text-xl font-bold text-white">Abonnement Partenaire</CardTitle>
            <p className="text-sm text-white/50 mt-2">
              Pour accéder au portail partenaire, un abonnement mensuel est requis.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <div className="bg-gradient-to-br from-[#D91CD2]/10 to-purple-900/20 border border-[#D91CD2]/30 rounded-xl p-6 text-center">
              <p className="text-4xl font-light text-white">49 <span className="text-lg text-white/50">CHF/mois</span></p>
              <p className="text-xs text-white/40 mt-2">Annulable à tout moment</p>
              <div className="mt-4 space-y-2 text-left">
                <p className="text-sm text-white/60 flex items-center gap-2">
                  <span className="text-[#D91CD2]">✓</span> Portail de gestion complet
                </p>
                <p className="text-sm text-white/60 flex items-center gap-2">
                  <span className="text-[#D91CD2]">✓</span> Publication d&apos;activités illimitée
                </p>
                <p className="text-sm text-white/60 flex items-center gap-2">
                  <span className="text-[#D91CD2]">✓</span> Suivi des réservations en temps réel
                </p>
                <p className="text-sm text-white/60 flex items-center gap-2">
                  <span className="text-[#D91CD2]">✓</span> Visibilité sur la plateforme Spordateur
                </p>
              </div>
            </div>

            <Button
              onClick={handlePayment}
              disabled={isLoading}
              className="w-full bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white font-bold h-14 text-base"
            >
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : <CreditCard className="mr-2 h-5 w-5" />}
              Payer et activer mon compte
            </Button>

            <button
              onClick={handleSkipPayment}
              className="w-full text-sm text-white/30 hover:text-white/50 transition py-2"
            >
              Payer plus tard →
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 1: Registration form
  return (
    <div className="flex items-center justify-center min-h-screen bg-black p-4">
      <Card className="max-w-lg w-full bg-[#0a111a] border-cyan-900/50">
        <form onSubmit={handleSubmit}>
          <CardHeader className="text-center">
            <Building className="h-10 w-10 text-cyan-400 mx-auto mb-2" />
            <CardTitle className="text-xl font-bold text-white">Devenir Partenaire</CardTitle>
            <p className="text-sm text-white/40 mt-1">
              Créez votre compte et souscrivez à l&apos;abonnement pour rejoindre le réseau Spordateur.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-gray-400 text-xs">Nom du Club / Studio</Label>
                <Input placeholder="Ex: Afroboost Genève" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Numéro IDE</Label>
                <Input placeholder="CHE-123.456.789" required value={formData.ide} onChange={e => setFormData({...formData, ide: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Type</Label>
                <select
                  value={formData.type}
                  onChange={e => setFormData({...formData, type: e.target.value as any})}
                  className="w-full h-10 mt-1 bg-black/50 text-white border border-gray-700 rounded-md px-3 text-sm"
                >
                  <option value="studio">Studio de danse</option>
                  <option value="gym">Salle de sport</option>
                  <option value="outdoor">Plein air</option>
                  <option value="pool">Piscine</option>
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-gray-400 text-xs">Email Professionnel</Label>
                <Input type="email" placeholder="contact@votreclub.ch" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Téléphone</Label>
                <Input placeholder="+41 22 ..." value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Ville</Label>
                <Input placeholder="Genève" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-gray-400 text-xs">Adresse</Label>
                <Input placeholder="Rue du Studio 10" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Mot de passe</Label>
                <Input type="password" placeholder="Min. 6 caractères" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
              <div>
                <Label className="text-gray-400 text-xs">Confirmer</Label>
                <Input type="password" placeholder="Confirmer" required value={formData.confirm} onChange={e => setFormData({...formData, confirm: e.target.value})} className="bg-black/50 text-white border-gray-700 mt-1" />
              </div>
            </div>

            <Button type="submit" disabled={isLoading} className="w-full bg-cyan-600 hover:bg-cyan-500 text-black font-bold h-12">
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : null}
              Continuer vers le paiement
            </Button>
          </CardContent>
          <CardFooter className="justify-center border-t border-gray-800 pt-6">
            <div className="text-sm text-gray-400">
              Déjà partenaire ? <Link href="/partner/login" className="text-cyan-400 hover:underline">Se connecter</Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
