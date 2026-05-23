/**
 * Fix #127 — Dialog de contact partenaire (formulaire NOUS CONTACTER home).
 *
 * Affiché depuis le bouton secondaire de la section "Studio de danse ou salle
 * de sport ?" sur la page d'accueil. Envoie un email à contact@spordateur.com
 * via POST /api/partners/contact.
 *
 * Champs :
 *  - Nom complet (requis)
 *  - Email (requis, validé client + serveur)
 *  - Nom du studio (optionnel)
 *  - Téléphone (optionnel)
 *  - Ville (optionnel)
 *  - Message (requis, min 5 / max 2000 chars)
 *
 * UX :
 *  - Loader + bouton désactivé pendant soumission
 *  - Toast succès → reset form + close dialog
 *  - Toast erreur (rate-limit, validation, infra)
 *  - Honeypot field caché en CSS (anti-bot best-effort)
 */

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send } from 'lucide-react';

interface PartnerContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PartnerContactDialog({ open, onOpenChange }: PartnerContactDialogProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [studioName, setStudioName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [message, setMessage] = useState('');
  // Honeypot — ne JAMAIS afficher visuellement (CSS .hidden + tabIndex=-1 + autocomplete=off)
  const [honeypot, setHoneypot] = useState('');

  const resetForm = () => {
    setFromName('');
    setFromEmail('');
    setStudioName('');
    setPhone('');
    setCity('');
    setMessage('');
    setHoneypot('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Validation client minimaliste (le serveur revérifie tout)
    if (!fromName.trim() || !fromEmail.trim() || message.trim().length < 5) {
      toast({
        variant: 'destructive',
        title: 'Champs incomplets',
        description: 'Nom, email et un message d\'au moins 5 caractères sont requis.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/partners/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromName: fromName.trim(),
          fromEmail: fromEmail.trim(),
          studioName: studioName.trim() || undefined,
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
          message: message.trim(),
          _hp: honeypot,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        const errMap: Record<string, string> = {
          'invalid-name': 'Nom invalide.',
          'invalid-email': 'Email invalide.',
          'invalid-message': 'Message trop court ou trop long (5 à 2000 caractères).',
          'invalid-optional': 'Un des champs optionnels est trop long.',
          'rate-limited': 'Trop de demandes — réessaie dans quelques minutes.',
          'send-failed': 'Impossible d\'envoyer pour le moment. Réessaie plus tard.',
        };
        toast({
          variant: 'destructive',
          title: 'Envoi impossible',
          description: errMap[data?.error] || data?.detail || 'Une erreur est survenue.',
        });
        return;
      }

      toast({
        title: 'Message envoyé !',
        description: 'Nous reviendrons vers toi sous 48 heures.',
      });
      resetForm();
      onOpenChange(false);
    } catch (err) {
      console.error('[PartnerContactDialog] submit failed', err);
      toast({
        variant: 'destructive',
        title: 'Erreur réseau',
        description: 'Vérifie ta connexion et réessaie.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-white/10 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white font-light text-xl">
            Nous contacter
          </DialogTitle>
          <DialogDescription className="text-white/50 text-sm font-light">
            Tu es studio, salle de sport ou organisateur ? Laisse-nous tes coordonnées,
            on revient vers toi sous 48 h.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Honeypot — caché visuellement, mais présent dans le DOM pour piéger les bots */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '-10000px',
              top: 'auto',
              width: '1px',
              height: '1px',
              overflow: 'hidden',
            }}
          >
            <label htmlFor="company_website">Site web (ne pas remplir)</label>
            <input
              type="text"
              id="company_website"
              name="company_website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name" className="text-xs font-light text-white/60">
                Nom complet *
              </Label>
              <Input
                id="contact-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Jeanne Dupont"
                maxLength={120}
                required
                disabled={submitting}
                className="bg-black/40 border-white/10 text-white placeholder:text-white/30 font-light"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email" className="text-xs font-light text-white/60">
                Email *
              </Label>
              <Input
                id="contact-email"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="contact@studio.ch"
                maxLength={200}
                required
                disabled={submitting}
                className="bg-black/40 border-white/10 text-white placeholder:text-white/30 font-light"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-studio" className="text-xs font-light text-white/60">
              Studio / Salle
            </Label>
            <Input
              id="contact-studio"
              value={studioName}
              onChange={(e) => setStudioName(e.target.value)}
              placeholder="Studio Afro Lausanne"
              maxLength={200}
              disabled={submitting}
              className="bg-black/40 border-white/10 text-white placeholder:text-white/30 font-light"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone" className="text-xs font-light text-white/60">
                Téléphone
              </Label>
              <Input
                id="contact-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+41 79 123 45 67"
                maxLength={50}
                disabled={submitting}
                className="bg-black/40 border-white/10 text-white placeholder:text-white/30 font-light"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-city" className="text-xs font-light text-white/60">
                Ville
              </Label>
              <Input
                id="contact-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Lausanne"
                maxLength={100}
                disabled={submitting}
                className="bg-black/40 border-white/10 text-white placeholder:text-white/30 font-light"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-message" className="text-xs font-light text-white/60">
              Message *
            </Label>
            <Textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Dis-nous ce que tu fais, quels cours tu donnes, et comment on peut t'aider."
              rows={5}
              maxLength={2000}
              required
              disabled={submitting}
              className="bg-black/40 border-white/10 text-white placeholder:text-white/30 font-light resize-none"
            />
            <p className="text-[10px] text-white/30 text-right font-light">
              {message.length} / 2000
            </p>
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="border-white/10 text-white/70 hover:text-white hover:bg-white/5 font-light"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-accent hover:bg-accent/90 text-white font-normal"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Envoi…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" /> Envoyer
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
