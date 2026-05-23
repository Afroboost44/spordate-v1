/**
 * BUG #83 — Page /profile/contacts — Inviter mes contacts à rejoindre Spordateur.
 *
 * Deux modes pour ajouter des contacts :
 *  1. Ajout manuel : input email/téléphone + bouton "Ajouter" → écrit dans
 *     users/{uid}.invitedContacts et envoie un email d'invitation via Resend.
 *  2. Synchronisation : import vCard (.vcf) depuis le téléphone — parse côté
 *     client et propose chaque contact en checkbox avant envoi groupé.
 *
 * Web ne donne PAS d'accès direct aux contacts du téléphone (pas d'API
 * navigateur). Le mode "sync" utilise l'export .vcf que l'utilisateur fait
 * depuis Google Contacts / iCloud / Outlook et upload sur Spordateur.
 *
 * Liste des contacts déjà invités affichée en bas avec leur status
 * (envoyé / vu / accepté).
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Contact, Mail, Upload, Plus, X, Loader2, CheckCircle2, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import BackButton from '@/components/BackButton';

interface InvitedContact {
  identifier: string;
  type: 'email' | 'phone';
  name?: string;
  status: 'pending' | 'opened' | 'joined';
  invitedAt: string;
}

export default function ProfileContactsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [contacts, setContacts] = useState<InvitedContact[]>([]);
  const [adding, setAdding] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualName, setManualName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Charger les contacts déjà invités
  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db!, 'users', user.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.invitedContacts)) {
            setContacts(data.invitedContacts);
          }
        }
      } catch (err) {
        console.warn('[contacts] read failed', err);
      }
    })();
  }, [user]);

  const persistContacts = async (next: InvitedContact[]) => {
    if (!user || !db) return;
    setContacts(next);
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { invitedContacts: next, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (err) {
      console.error('[contacts] save failed', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de sauvegarder les contacts.',
        variant: 'destructive',
      });
    }
  };

  const detectType = (raw: string): 'email' | 'phone' | null => {
    const v = raw.trim();
    if (!v) return null;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/i.test(v)) return 'email';
    if (/^[+]?[\d\s()-]{6,}$/.test(v)) return 'phone';
    return null;
  };

  const handleAddManual = async () => {
    const type = detectType(manualValue);
    if (!type) {
      toast({
        title: 'Format invalide',
        description: 'Entre un email valide ou un numéro de téléphone.',
        variant: 'destructive',
      });
      return;
    }
    if (contacts.some((c) => c.identifier === manualValue.trim())) {
      toast({
        title: 'Déjà invité',
        description: 'Ce contact est déjà dans ta liste.',
        variant: 'destructive',
      });
      return;
    }
    setAdding(true);
    const newContact: InvitedContact = {
      identifier: manualValue.trim(),
      type,
      name: manualName.trim() || undefined,
      status: 'pending',
      invitedAt: new Date().toISOString(),
    };
    // BUG #86 — Envoi RÉEL de l'invitation via /api/contacts/invite (Resend
    // pour les emails ; les SMS sont déférés tant que l'intégration Twilio
    // n'est pas en place). Le persist Firestore se fait après l'envoi pour
    // ne pas marquer "envoyé" en cas d'échec API.
    try {
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      const idToken = (await auth.currentUser?.getIdToken()) || '';
      const res = await fetch('/api/contacts/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          identifier: newContact.identifier,
          type: newContact.type,
          name: newContact.name,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || data?.error || 'send-failed');
      }
    } catch (err) {
      console.error('[contacts] send invite failed', err);
      toast({
        title: 'Envoi impossible',
        description: 'Impossible d\'envoyer l\'invitation. Réessaie dans un instant.',
        variant: 'destructive',
      });
      setAdding(false);
      return;
    }

    await persistContacts([...contacts, newContact]);
    setManualValue('');
    setManualName('');
    toast({
      title: 'Invitation envoyée ✓',
      description: `${newContact.name || newContact.identifier} a reçu un email d'invitation Spordateur.`,
      className: 'bg-zinc-900 border-accent/40 text-white',
    });
    setAdding(false);
  };

  const handleRemove = async (identifier: string) => {
    await persistContacts(contacts.filter((c) => c.identifier !== identifier));
  };

  /** Parse rudimentaire de vCard (.vcf) : extrait FN: et EMAIL: par ligne. */
  const handleVcardUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAdding(true);
    try {
      const text = await file.text();
      const blocks = text.split(/BEGIN:VCARD/i).slice(1);
      const parsed: InvitedContact[] = [];
      const seen = new Set(contacts.map((c) => c.identifier));
      for (const block of blocks) {
        const nameMatch = block.match(/FN:(.+)/i);
        const emailMatch = block.match(/EMAIL[^:]*:(.+)/i);
        const phoneMatch = block.match(/TEL[^:]*:(.+)/i);
        const identifier = (emailMatch?.[1] || phoneMatch?.[1] || '').trim();
        if (!identifier || seen.has(identifier)) continue;
        const type: 'email' | 'phone' = emailMatch ? 'email' : 'phone';
        parsed.push({
          identifier,
          type,
          name: nameMatch?.[1]?.trim(),
          status: 'pending',
          invitedAt: new Date().toISOString(),
        });
        seen.add(identifier);
      }
      if (parsed.length === 0) {
        toast({
          title: 'Aucun contact détecté',
          description: 'Le fichier .vcf ne contient pas d\'email ou téléphone valides.',
          variant: 'destructive',
        });
        return;
      }
      // BUG #86 — Envoi RÉEL des invitations pour chaque contact importé.
      // Best-effort : si un email échoue, on continue avec les autres.
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      const idToken = (await auth.currentUser?.getIdToken()) || '';
      let sentCount = 0;
      for (const c of parsed) {
        try {
          const res = await fetch('/api/contacts/invite', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ identifier: c.identifier, type: c.type, name: c.name }),
          });
          if (res.ok) sentCount++;
        } catch (sendErr) {
          console.warn('[contacts vcf send]', c.identifier, sendErr);
        }
      }
      await persistContacts([...contacts, ...parsed]);
      toast({
        title: 'Contacts importés ✓',
        description: `${sentCount}/${parsed.length} invitation${parsed.length > 1 ? 's' : ''} envoyée${parsed.length > 1 ? 's' : ''}.`,
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[contacts vcf parse]', err);
      toast({
        title: 'Import échoué',
        description: 'Vérifie que le fichier est bien au format .vcf.',
        variant: 'destructive',
      });
    } finally {
      setAdding(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="animate-spin mr-2 h-5 w-5" /> Chargement…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-8">
          <BackButton fallbackUrl="/profile" />
          <h1 className="text-2xl sm:text-3xl font-light tracking-wide flex items-center gap-2">
            <Contact className="h-6 w-6 text-accent" />
            Mes contacts
          </h1>
        </div>

        <p className="text-sm text-white/60 font-light mb-6 leading-relaxed">
          Invite tes amis à rejoindre Spordateur. Tu peux ajouter leurs coordonnées
          manuellement OU importer un fichier .vcf (Carnet d&apos;adresses → Exporter).
        </p>

        <div className="flex flex-col gap-6">
          {/* MODE 1 — Ajout manuel */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <Plus className="h-4 w-4 text-white/40" /> Ajouter un contact
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contact-name" className="text-xs uppercase tracking-wider text-white/60">
                    Prénom (optionnel)
                  </Label>
                  <Input
                    id="contact-name"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Marie"
                    disabled={adding}
                    className="bg-zinc-900/60 border-white/10 text-white"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contact-identifier" className="text-xs uppercase tracking-wider text-white/60">
                    Email ou téléphone
                  </Label>
                  <Input
                    id="contact-identifier"
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                    placeholder="marie@example.com"
                    disabled={adding}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddManual();
                      }
                    }}
                    className="bg-zinc-900/60 border-white/10 text-white"
                  />
                </div>
              </div>
              <Button
                onClick={handleAddManual}
                disabled={adding || !manualValue.trim()}
                className="self-start bg-accent text-white hover:bg-accent/90"
              >
                {adding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Envoi…
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" /> Inviter
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* MODE 2 — Sync vCard */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light flex items-center gap-2">
                <Upload className="h-4 w-4 text-white/40" /> Synchroniser depuis le téléphone
              </CardTitle>
              <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
                Exporte ton carnet d&apos;adresses au format .vcf depuis Google Contacts,
                iCloud ou Outlook, puis importe-le ici. On invitera tes contacts
                automatiquement (et toi tu gardes le contrôle).
              </p>
            </CardHeader>
            <CardContent>
              <input
                ref={fileInputRef}
                type="file"
                accept=".vcf,text/vcard,text/x-vcard"
                onChange={handleVcardUpload}
                disabled={adding}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={adding}
                variant="outline"
                className="border-white/10 text-white/80 hover:border-accent/40 hover:text-white"
              >
                <Upload className="h-4 w-4 mr-2" />
                Importer mon carnet .vcf
              </Button>
            </CardContent>
          </Card>

          {/* Liste des contacts invités */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider text-white/50 font-light">
                Contacts invités ({contacts.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <p className="text-sm text-white/40 text-center py-6">
                  Tu n&apos;as invité personne pour le moment.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-white/5">
                  {contacts.map((c) => (
                    <li key={c.identifier} className="flex items-center gap-3 py-3">
                      <div className="rounded-full bg-accent/10 p-2 shrink-0">
                        {c.status === 'joined' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-400" />
                        ) : c.status === 'opened' ? (
                          <Mail className="h-4 w-4 text-accent" />
                        ) : (
                          <Clock className="h-4 w-4 text-white/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">
                          {c.name || c.identifier}
                        </p>
                        {c.name && (
                          <p className="text-[11px] text-white/40 truncate">{c.identifier}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(c.identifier)}
                        aria-label="Retirer ce contact"
                        className="text-white/40 hover:text-red-400 p-1"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
