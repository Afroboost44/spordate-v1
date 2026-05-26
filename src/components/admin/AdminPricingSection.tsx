/**
 * BUG #74 / #92 — Section admin pour configurer TOUS les prix Spordateur.
 *
 * Lit/écrit Firestore `settings/pricing` (doc unique, source de vérité).
 * 4 cartes :
 *   1. Chat            — coûts texte + audio (crédits)              (BUG #74)
 *   2. Likes           — coût like + quota gratuit / jour          (BUG #92)
 *   3. Boost Utilisateur — coûts 30min / 1h / 6h (crédits)         (BUG #92)
 *   4. Boost Partenaire  — prix CHF 1j / 7j / 30j                   (BUG #92)
 *
 * Sécurité : la page parent /admin/manage vérifie déjà le rôle admin
 * (AuthGuard + check role). Les rules Firestore restreignent l'écriture sur
 * settings/pricing aux admins. Ce composant assume le contexte sécurisé.
 *
 * Anti-régression : les ACTIVITÉS se payent uniquement par Stripe (CLAUDE.md),
 * ces prix concernent strictement les services intra-app + boost partenaire.
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Coins, Heart, Zap, Building2, Wallet, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/context/LanguageContext';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { DEFAULT_CHAT_PRICING } from '@/lib/pricing/chatPricing';
import {
  DEFAULT_SITE_PRICING,
  sanitizeInt,
  sanitizeChf,
  sanitizeVatEnabled,
  sanitizeVatRate,
  sanitizeVatMode,
} from '@/lib/pricing/sitePricing';
import { MIN_PAYOUT_CHF } from '@/lib/creators/limits';

export function AdminPricingSection() {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ----- Chat (BUG #74) -----
  const [chatMessageCost, setChatMessageCost] = useState<number>(DEFAULT_CHAT_PRICING.chatMessageCost);
  const [chatAudioCost, setChatAudioCost] = useState<number>(DEFAULT_CHAT_PRICING.chatAudioCost);

  // ----- Likes (BUG #92) -----
  const [likeCost, setLikeCost] = useState<number>(DEFAULT_SITE_PRICING.likeCost);
  const [freeLikesPerDay, setFreeLikesPerDay] = useState<number>(DEFAULT_SITE_PRICING.freeLikesPerDay);

  // ----- Boost User (BUG #92) -----
  const [boostUser30minCost, setBoostUser30minCost] = useState<number>(DEFAULT_SITE_PRICING.boostUser30minCost);
  const [boostUser1hCost, setBoostUser1hCost] = useState<number>(DEFAULT_SITE_PRICING.boostUser1hCost);
  const [boostUser6hCost, setBoostUser6hCost] = useState<number>(DEFAULT_SITE_PRICING.boostUser6hCost);

  // ----- Boost Partenaire (BUG #92/#95 — durées 24h/3j/1sem alignées sur /partner/boost) -----
  const [boostPartner24h, setBoostPartner24h] = useState<number>(DEFAULT_SITE_PRICING.boostPartner24hPriceCHF);
  const [boostPartner3d,  setBoostPartner3d]  = useState<number>(DEFAULT_SITE_PRICING.boostPartner3dPriceCHF);
  const [boostPartner7d,  setBoostPartner7d]  = useState<number>(DEFAULT_SITE_PRICING.boostPartner7dPriceCHF);

  // ----- Payouts créateurs — seuil min retrait paramétrable (cf. limits.ts) -----
  // Floor absolu MIN_PAYOUT_CHF (10) appliqué côté validatePayoutRequest, on autorise
  // l'admin à entrer une valeur inférieure dans le champ pour clarté UX, mais
  // au save on clamp >= MIN_PAYOUT_CHF pour éviter d'écrire une valeur que la
  // règle Firestore + le serveur rejetteraient ensuite silencieusement.
  const [minPayoutChf, setMinPayoutChf] = useState<number>(DEFAULT_SITE_PRICING.minPayoutCHF);

  // ----- TVA Suisse (paramétrable admin, default OFF) -----
  // Back-compat : si le doc settings/pricing n'a pas encore ces 3 champs,
  // on reste sur les defaults (vatEnabled=false → aucun impact UI).
  const [vatEnabled, setVatEnabled] = useState<boolean>(DEFAULT_SITE_PRICING.vatEnabled);
  const [vatRate, setVatRate] = useState<number>(DEFAULT_SITE_PRICING.vatRate);
  const [vatMode, setVatMode] = useState<'included' | 'added'>(DEFAULT_SITE_PRICING.vatMode);

  useEffect(() => {
    if (!db || !isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db!, 'settings', 'pricing'));
        if (snap.exists()) {
          const data = snap.data();
          // Chat
          if (typeof data.chatMessageCost === 'number' && data.chatMessageCost >= 0) setChatMessageCost(data.chatMessageCost);
          if (typeof data.chatAudioCost === 'number' && data.chatAudioCost >= 0) setChatAudioCost(data.chatAudioCost);
          // Likes
          if (typeof data.likeCost === 'number' && data.likeCost >= 0) setLikeCost(data.likeCost);
          if (typeof data.freeLikesPerDay === 'number' && data.freeLikesPerDay >= 0) setFreeLikesPerDay(data.freeLikesPerDay);
          // Boost user
          if (typeof data.boostUser30minCost === 'number' && data.boostUser30minCost >= 0) setBoostUser30minCost(data.boostUser30minCost);
          if (typeof data.boostUser1hCost === 'number' && data.boostUser1hCost >= 0) setBoostUser1hCost(data.boostUser1hCost);
          if (typeof data.boostUser6hCost === 'number' && data.boostUser6hCost >= 0) setBoostUser6hCost(data.boostUser6hCost);
          // Boost partner (BUG #95 — clés 24h/3d/7d alignées sur /partner/boost)
          if (typeof data.boostPartner24hPriceCHF === 'number' && data.boostPartner24hPriceCHF >= 0) setBoostPartner24h(data.boostPartner24hPriceCHF);
          if (typeof data.boostPartner3dPriceCHF  === 'number' && data.boostPartner3dPriceCHF  >= 0) setBoostPartner3d(data.boostPartner3dPriceCHF);
          if (typeof data.boostPartner7dPriceCHF  === 'number' && data.boostPartner7dPriceCHF  >= 0) setBoostPartner7d(data.boostPartner7dPriceCHF);
          // Payouts — min retrait créateurs (champ optionnel pour back-compat).
          if (typeof data.minPayoutCHF === 'number' && data.minPayoutCHF >= 0) setMinPayoutChf(data.minPayoutCHF);
          // TVA — champs optionnels (back-compat : avant ajout TVA, ces clés
          // n'existaient pas → on reste sur les defaults vatEnabled=false).
          if (typeof data.vatEnabled === 'boolean') setVatEnabled(data.vatEnabled);
          if (typeof data.vatRate === 'number' && data.vatRate >= 0 && data.vatRate <= 30) setVatRate(data.vatRate);
          if (data.vatMode === 'included' || data.vatMode === 'added') setVatMode(data.vatMode);
        }
      } catch (err) {
        console.warn('[AdminPricing] read failed', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /**
   * Sauvegarde atomique : tous les champs sont écrits ensemble pour garantir
   * la cohérence (ex: éviter qu'un like coûte 1 crédit côté admin mais
   * 5 crédits côté serveur si seul un partial update passe).
   * Le bouton est en pied de section pour que l'admin valide tout d'un coup.
   */
  const handleSave = async () => {
    if (!db || !isFirebaseConfigured) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'settings', 'pricing'),
        {
          // Chat
          chatMessageCost: sanitizeInt(chatMessageCost, DEFAULT_CHAT_PRICING.chatMessageCost),
          chatAudioCost: sanitizeInt(chatAudioCost, DEFAULT_CHAT_PRICING.chatAudioCost),
          // Likes
          likeCost: sanitizeInt(likeCost, DEFAULT_SITE_PRICING.likeCost),
          freeLikesPerDay: sanitizeInt(freeLikesPerDay, DEFAULT_SITE_PRICING.freeLikesPerDay),
          // Boost user
          boostUser30minCost: sanitizeInt(boostUser30minCost, DEFAULT_SITE_PRICING.boostUser30minCost),
          boostUser1hCost: sanitizeInt(boostUser1hCost, DEFAULT_SITE_PRICING.boostUser1hCost),
          boostUser6hCost: sanitizeInt(boostUser6hCost, DEFAULT_SITE_PRICING.boostUser6hCost),
          // Boost partner (BUG #95)
          boostPartner24hPriceCHF: sanitizeChf(boostPartner24h, DEFAULT_SITE_PRICING.boostPartner24hPriceCHF),
          boostPartner3dPriceCHF:  sanitizeChf(boostPartner3d,  DEFAULT_SITE_PRICING.boostPartner3dPriceCHF),
          boostPartner7dPriceCHF:  sanitizeChf(boostPartner7d,  DEFAULT_SITE_PRICING.boostPartner7dPriceCHF),
          // Clamp >= MIN_PAYOUT_CHF côté write — défense en profondeur cohérente
          // avec firestore.rules + validatePayoutRequest. L'admin voit le champ
          // accepter < 10 dans l'UI mais on persiste >= 10 minimum.
          minPayoutCHF: Math.max(MIN_PAYOUT_CHF, sanitizeChf(minPayoutChf, DEFAULT_SITE_PRICING.minPayoutCHF)),
          // TVA Suisse — sanitize via les helpers dédiés (boolean strict, taux
          // 0-30%, mode whitelist). Si Bassi pousse une valeur invalide depuis
          // la console, on retombe sur les defaults plutôt que de corrompre
          // le calcul checkout.
          vatEnabled: sanitizeVatEnabled(vatEnabled, DEFAULT_SITE_PRICING.vatEnabled),
          vatRate:    sanitizeVatRate(vatRate,       DEFAULT_SITE_PRICING.vatRate),
          vatMode:    sanitizeVatMode(vatMode,       DEFAULT_SITE_PRICING.vatMode),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast({
        title: 'Prix mis à jour',
        description: 'Les nouveaux tarifs sont actifs immédiatement.',
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[AdminPricing] save failed', err);
      toast({
        title: 'Erreur',
        description: 'Impossible de sauvegarder les prix. Vérifie tes droits admin.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
        <CardContent className="flex items-center gap-2 text-white/40 py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des tarifs…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ============ Carte 1 : CHAT (BUG #74) ============ */}
      <Card className="bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Coins className="h-5 w-5 text-accent" />
            Prix chat (crédits par message)
          </CardTitle>
          <p className="text-xs text-white/40 font-light mt-1">
            Coût des messages texte et audio. Anti-leak IA inclus dans les Premium.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumberField
              id="admin-chat-text-cost"
              label="Message texte (crédits)"
              defaultHint={`Par défaut : ${DEFAULT_CHAT_PRICING.chatMessageCost} crédit`}
              value={chatMessageCost}
              onChange={setChatMessageCost}
              disabled={saving}
              integerOnly
            />
            <NumberField
              id="admin-chat-audio-cost"
              label="Message audio (crédits)"
              defaultHint={`Par défaut : ${DEFAULT_CHAT_PRICING.chatAudioCost} crédits`}
              value={chatAudioCost}
              onChange={setChatAudioCost}
              disabled={saving}
              integerOnly
            />
          </div>
        </CardContent>
      </Card>

      {/* ============ Carte 2 : LIKES (BUG #92) ============ */}
      <Card className="bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Heart className="h-5 w-5 text-accent" />
            Likes & quota gratuit
          </CardTitle>
          <p className="text-xs text-white/40 font-light mt-1">
            Quota offert par jour, puis chaque like supplémentaire coûte X crédits. Les Premium ont des likes illimités sans coût.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumberField
              id="admin-like-cost"
              label="Like premium (crédits)"
              defaultHint={`Par défaut : ${DEFAULT_SITE_PRICING.likeCost} crédit`}
              value={likeCost}
              onChange={setLikeCost}
              disabled={saving}
              integerOnly
            />
            <NumberField
              id="admin-free-likes"
              label="Likes gratuits / jour"
              defaultHint={`Par défaut : ${DEFAULT_SITE_PRICING.freeLikesPerDay} likes`}
              value={freeLikesPerDay}
              onChange={setFreeLikesPerDay}
              disabled={saving}
              integerOnly
            />
          </div>
        </CardContent>
      </Card>

      {/* ============ Carte 3 : BOOST USER (BUG #92) ============ */}
      <Card className="bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Zap className="h-5 w-5 text-accent" />
            Boost utilisateur (crédits)
          </CardTitle>
          <p className="text-xs text-white/40 font-light mt-1">
            Mise en avant temporaire du profil dans l&apos;algorithme de matching. Payé en crédits intra-app.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <NumberField
              id="admin-boost-user-30min"
              label="Boost 30 min"
              defaultHint={`Défaut : ${DEFAULT_SITE_PRICING.boostUser30minCost} crédits`}
              value={boostUser30minCost}
              onChange={setBoostUser30minCost}
              disabled={saving}
              integerOnly
            />
            <NumberField
              id="admin-boost-user-1h"
              label="Boost 1 h"
              defaultHint={`Défaut : ${DEFAULT_SITE_PRICING.boostUser1hCost} crédits`}
              value={boostUser1hCost}
              onChange={setBoostUser1hCost}
              disabled={saving}
              integerOnly
            />
            <NumberField
              id="admin-boost-user-6h"
              label="Boost 6 h"
              defaultHint={`Défaut : ${DEFAULT_SITE_PRICING.boostUser6hCost} crédits`}
              value={boostUser6hCost}
              onChange={setBoostUser6hCost}
              disabled={saving}
              integerOnly
            />
          </div>
        </CardContent>
      </Card>

      {/* ============ Carte 4 : BOOST PARTENAIRE (BUG #92) ============ */}
      <Card className="bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Building2 className="h-5 w-5 text-accent" />
            Boost partenaire (CHF)
          </CardTitle>
          <p className="text-xs text-white/40 font-light mt-1">
            Mise en avant d&apos;une activité dans les résultats de recherche. Réservé aux coachs / clubs / lieux. Paiement Stripe direct, jamais en crédits.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <NumberField
              id="admin-boost-partner-24h"
              label="24 heures (CHF)"
              defaultHint={`Défaut : ${DEFAULT_SITE_PRICING.boostPartner24hPriceCHF.toFixed(2)} CHF`}
              value={boostPartner24h}
              onChange={setBoostPartner24h}
              disabled={saving}
              integerOnly={false}
            />
            <NumberField
              id="admin-boost-partner-3d"
              label="3 jours (CHF)"
              defaultHint={`Défaut : ${DEFAULT_SITE_PRICING.boostPartner3dPriceCHF.toFixed(2)} CHF`}
              value={boostPartner3d}
              onChange={setBoostPartner3d}
              disabled={saving}
              integerOnly={false}
            />
            <NumberField
              id="admin-boost-partner-7d"
              label="1 semaine (CHF)"
              defaultHint={`Défaut : ${DEFAULT_SITE_PRICING.boostPartner7dPriceCHF.toFixed(2)} CHF`}
              value={boostPartner7d}
              onChange={setBoostPartner7d}
              disabled={saving}
              integerOnly={false}
            />
          </div>
        </CardContent>
      </Card>

      {/* ============ Carte 5 : PAYOUTS — seuil min retrait créateurs ============ */}
      <Card className="bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Wallet className="h-5 w-5 text-accent" />
            {t('admin_manage_pricing_payouts_h')}
          </CardTitle>
          <p className="text-xs text-white/40 font-light mt-1">
            {t('admin_manage_pricing_payouts_sub')}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumberField
              id="admin-min-payout-chf"
              label={t('admin_manage_pricing_min_payout_label')}
              defaultHint={t('admin_manage_pricing_min_payout_hint')}
              value={minPayoutChf}
              onChange={setMinPayoutChf}
              disabled={saving}
              integerOnly={false}
            />
          </div>
        </CardContent>
      </Card>

      {/* ============ Carte 6 : TVA Suisse (paramétrable, default OFF) ============ */}
      <Card className="bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Receipt className="h-5 w-5 text-accent" />
            {t('admin_manage_pricing_vat_h')}
          </CardTitle>
          <p className="text-xs text-white/40 font-light mt-1">
            {t('admin_manage_pricing_vat_sub')}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-5">
            {/* Toggle ON/OFF */}
            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/40 border border-white/5">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="admin-vat-enabled" className="text-sm text-white cursor-pointer">
                  {t('admin_manage_pricing_vat_toggle_label')}
                </Label>
                <p className="text-[11px] text-white/40">
                  {vatEnabled
                    ? t('admin_manage_pricing_vat_toggle_on_hint')
                    : t('admin_manage_pricing_vat_toggle_off_hint')}
                </p>
              </div>
              <Switch
                id="admin-vat-enabled"
                checked={vatEnabled}
                onCheckedChange={setVatEnabled}
                disabled={saving}
              />
            </div>

            {/* Taux TVA */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="admin-vat-rate" className="text-xs uppercase tracking-wider text-white/60">
                  {t('admin_manage_pricing_vat_rate_label')}
                </Label>
                <Input
                  id="admin-vat-rate"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={30}
                  step={0.1}
                  value={vatRate}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = parseFloat(raw);
                    if (!Number.isFinite(n) || n < 0) {
                      setVatRate(0);
                      return;
                    }
                    setVatRate(Math.min(30, Math.round(n * 10) / 10));
                  }}
                  disabled={saving || !vatEnabled}
                  className="bg-zinc-900/60 border-white/10 text-white disabled:opacity-50"
                />
                <p className="text-[10px] text-white/40">
                  {t('admin_manage_pricing_vat_rate_hint')}
                </p>
              </div>
            </div>

            {/* Mode TVA — radio group */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-wider text-white/60">
                {t('admin_manage_pricing_vat_mode_label')}
              </Label>
              <RadioGroup
                value={vatMode}
                onValueChange={(v) => {
                  if (v === 'included' || v === 'added') setVatMode(v);
                }}
                disabled={saving || !vatEnabled}
                className="gap-2"
              >
                <label
                  htmlFor="admin-vat-mode-included"
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                    vatMode === 'included' ? 'border-accent/60 bg-accent/5' : 'border-white/10 bg-zinc-900/40 hover:border-white/20'
                  } ${!vatEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <RadioGroupItem
                    id="admin-vat-mode-included"
                    value="included"
                    className="mt-0.5 border-white/40 text-accent"
                    disabled={saving || !vatEnabled}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-white">
                      {t('admin_manage_pricing_vat_mode_included_label')}
                    </span>
                    <span className="text-[11px] text-white/40">
                      {t('admin_manage_pricing_vat_mode_included_desc')}
                    </span>
                  </div>
                </label>
                <label
                  htmlFor="admin-vat-mode-added"
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                    vatMode === 'added' ? 'border-accent/60 bg-accent/5' : 'border-white/10 bg-zinc-900/40 hover:border-white/20'
                  } ${!vatEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <RadioGroupItem
                    id="admin-vat-mode-added"
                    value="added"
                    className="mt-0.5 border-white/40 text-accent"
                    disabled={saving || !vatEnabled}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-white">
                      {t('admin_manage_pricing_vat_mode_added_label')}
                    </span>
                    <span className="text-[11px] text-white/40">
                      {t('admin_manage_pricing_vat_mode_added_desc')}
                    </span>
                  </div>
                </label>
              </RadioGroup>
            </div>

            <p className="text-[11px] text-white/40 leading-relaxed">
              {t('admin_manage_pricing_vat_footer_hint')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Bouton save unique en pied de section — atomicité de l'écriture */}
      <Button
        onClick={handleSave}
        disabled={saving}
        className="self-start bg-accent text-white hover:bg-accent/90"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sauvegarde…
          </>
        ) : (
          <>
            <Save className="h-4 w-4 mr-2" /> Sauvegarder tous les tarifs
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * BUG #92 — Champ numérique réutilisable (crédits OU CHF avec décimales).
 * Extrait en sous-composant pour ne pas répéter 12 fois le même JSX.
 *  - integerOnly=true  : crédits, parseInt + min 0
 *  - integerOnly=false : CHF, parseFloat + min 0 + step 0.10
 */
interface NumberFieldProps {
  id: string;
  label: string;
  defaultHint: string;
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
  integerOnly: boolean;
}

function NumberField({ id, label, defaultHint, value, onChange, disabled, integerOnly }: NumberFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-white/60">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode={integerOnly ? 'numeric' : 'decimal'}
        min={0}
        step={integerOnly ? 1 : 0.1}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          const n = integerOnly ? parseInt(raw, 10) : parseFloat(raw);
          if (!Number.isFinite(n) || n < 0) {
            onChange(0);
            return;
          }
          onChange(integerOnly ? Math.floor(n) : Math.round(n * 100) / 100);
        }}
        disabled={disabled}
        className="bg-zinc-900/60 border-white/10 text-white"
      />
      <p className="text-[10px] text-white/40">{defaultHint}</p>
    </div>
  );
}
