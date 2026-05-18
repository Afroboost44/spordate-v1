/**
 * FEATURE QR — Bouton QR code réutilisable.
 *
 * Usage :
 *   <QRCodeButton
 *     url="https://spordateur.com/signup?ref=ABC123"
 *     label="Lien d'invitation"
 *     filename="spordateur-invite-ABC123.png"  // optionnel, défaut auto
 *   />
 *
 * Affiche une icône QrCode (Lucide). Au click :
 *  - Ouvre un Dialog avec QR full size 1024×1024
 *  - Bouton "Télécharger PNG" → crée un <a download> avec data URL
 *  - Bouton "Copier le lien" → navigator.clipboard
 *
 * Génération QR : src/lib/share/qrCode.ts (testé via tests/components/qr-code-button.test.ts).
 */

'use client';

import { useState } from 'react';
import { QrCode, Download, Copy, Check, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { buildFilename, generateQrDataUrl } from '@/lib/share/qrCode';

export interface QRCodeButtonProps {
  /** URL encodée dans le QR (= ce qui s'ouvre au scan). */
  url: string;
  /** Label affiché dans le Dialog + utilisé pour buildFilename si filename absent. */
  label: string;
  /** Code de référence (referralCode) — utilisé pour le filename par défaut. */
  code?: string;
  /** Nom du fichier téléchargé (override). Si absent, généré via buildFilename(label, code). */
  filename?: string;
  /** ClassName supplémentaire sur le bouton trigger. */
  className?: string;
}

export function QRCodeButton({ url, label, code, filename, className }: QRCodeButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const finalFilename = filename ?? buildFilename(label, code ?? 'code');

  const handleOpen = async () => {
    setOpen(true);
    if (dataUrl) return;
    setLoading(true);
    try {
      const generated = await generateQrDataUrl(url);
      setDataUrl(generated);
    } catch (err) {
      console.warn('[QRCodeButton] generation failed', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de générer le QR code.',
        variant: 'destructive',
      });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = finalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ title: 'QR code téléchargé', description: finalFilename });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('[QRCodeButton] clipboard failed', err);
      toast({ title: 'Erreur', description: 'Copie impossible.', variant: 'destructive' });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Afficher le QR code — ${label}`}
        title={`Afficher le QR code — ${label}`}
        className={
          className ??
          'inline-flex items-center justify-center w-9 h-9 rounded-md border border-white/10 text-white/70 hover:text-white hover:border-accent/40 hover:bg-accent/10 transition active:scale-95'
        }
      >
        <QrCode className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#0A0A0A] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <QrCode className="h-5 w-5 text-accent" />
              {label}
            </DialogTitle>
            <DialogDescription className="text-white/40 text-xs break-all">
              {url}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex items-center justify-center">
            <div className="bg-white rounded-2xl p-4 w-full aspect-square max-w-xs flex items-center justify-center">
              {loading || !dataUrl ? (
                <Loader2 className="h-10 w-10 text-black/30 animate-spin" />
              ) : (
                // Render data URL via <img> (data:image/png;base64,...)
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dataUrl} alt={`QR code — ${label}`} className="w-full h-full" />
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleDownload}
              disabled={!dataUrl || loading}
              className="flex-1 bg-accent hover:bg-accent/90 text-white h-10"
            >
              <Download className="h-4 w-4 mr-2" />
              Télécharger PNG
            </Button>
            <Button
              variant="outline"
              onClick={handleCopy}
              className="flex-1 border-white/15 text-white/80 hover:bg-white/5 h-10"
            >
              {copied ? <Check className="h-4 w-4 mr-2 text-green-400" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? 'Copié !' : 'Copier le lien'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
