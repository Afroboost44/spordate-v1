"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Users, Building2, MapPin, Loader2, Search, Eye, EyeOff, Trash2, Shield,
  Wallet, TrendingUp, CalendarDays, CreditCard, Gift, Bell, Settings, Bug,
  Plus, Minus, Send, BarChart3, Zap, Crown, Percent,
} from 'lucide-react';
import { useAuth } from "@/context/AuthContext";
import { db, auth, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, getDocs, doc, updateDoc, deleteDoc, setDoc, addDoc,
  serverTimestamp, orderBy, limit, where, increment
} from 'firebase/firestore';
import { useToast } from "@/hooks/use-toast";
import { AdminPricingSection } from "@/components/admin/AdminPricingSection";
import { AdminSelfieReviewSection } from "@/components/admin/AdminSelfieReviewSection";
import { PreviewEyeButton } from "@/components/admin/PreviewEyeButton";
import { BrandLogoManager } from "@/components/admin/BrandLogoManager";
import type { BrandLogos } from "@/lib/brand/generateLogos";
import Link from 'next/link';
import { useFeatureFlags } from '@/lib/site/useFeatureFlags';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_CREATOR_COMMISSION, DEFAULT_INVITE_COMMISSION,
  type UserCommission, type CommissionMode,
} from "@/lib/referral/commission";
import { validateCreditAdjustment } from "@/lib/admin/creditAdjustment";

type Tab = 'cockpit' | 'users' | 'partners' | 'credits' | 'promos' | 'tarifs' | 'site' | 'settings' | 'errors';

interface SiteConfig {
  heroTitle1: string; heroTitle2: string; heroTitle3: string;
  heroSubtitle: string; ctaText: string; primaryColor: string;
  heroImage: string;
  step1Title: string; step1Desc: string; step1Image: string;
  step2Title: string; step2Desc: string; step2Image: string;
  step3Title: string; step3Desc: string; step3Image: string;
  sectionTitle: string; sectionSubtitle: string;
  ctaFinalTitle: string; ctaFinalSubtitle: string; ctaFinalButton: string;
  testimonialsTitle: string;
  testimonial1Name: string; testimonial1City: string; testimonial1Text: string; testimonial1Sport: string;
  testimonial2Name: string; testimonial2City: string; testimonial2Text: string; testimonial2Sport: string;
  testimonial3Name: string; testimonial3City: string; testimonial3Text: string; testimonial3Sport: string;
  testimonial4Name: string; testimonial4City: string; testimonial4Text: string; testimonial4Sport: string;
  swissTitle: string; swissSubtitle: string; swissImage: string;
  swissCities: string;
  partnerTitle: string; partnerSubtitle: string; partnerCta1: string; partnerCta2: string;
  [key: string]: string;
}
const DEFAULT_SITE: SiteConfig = {
  heroTitle1: "Rencontre quelqu'un", heroTitle2: "en partageant une", heroTitle3: "activité sportive.",
  heroSubtitle: "Danse, fitness, running... Choisis ton sport, matche, et vis une vraie rencontre.",
  ctaText: "Commencer", primaryColor: "var(--accent-color)",
  heroImage: "https://picsum.photos/seed/hero-dance/1920/1080",
  step1Title: "Choisis ton style", step1Desc: "Afroboost, Salsa, Tennis, Yoga... Selectionne tes activites et ton niveau.", step1Image: "https://picsum.photos/seed/step1/800/600",
  step2Title: "Matche & discute", step2Desc: "On te propose des partenaires pres de toi. Connecte-toi, organise ta session.", step2Image: "https://picsum.photos/seed/step2/800/600",
  step3Title: "Bouge & kiffe", step3Desc: "Retrouve ton match dans un studio partenaire. L'experience commence ici.", step3Image: "https://picsum.photos/seed/step3/800/600",
  sectionTitle: "Trouve ton move.", sectionSubtitle: "Sport ou danse, debutant ou avance. Chaque activite est une opportunite de rencontre.",
  ctaFinalTitle: "Pret a bouger ?", ctaFinalSubtitle: "Rejoins la communaute. Trouve ton partenaire.", ctaFinalButton: "Creer mon profil",
  testimonialsTitle: "Ils bougent deja ensemble.",
  testimonial1Name: "Amina K.", testimonial1City: "Geneve", testimonial1Text: "J'ai trouve ma partenaire d'Afroboost. On se motive chaque semaine.", testimonial1Sport: "Afroboost",
  testimonial2Name: "Karim D.", testimonial2City: "Zurich", testimonial2Text: "Fan de salsa depuis 3 ans, j'ai enfin trouve une partenaire a mon niveau.", testimonial2Sport: "Salsa",
  testimonial3Name: "Lea M.", testimonial3City: "Lausanne", testimonial3Text: "J'ai decouvert le Dance Fitness via l'app. Ambiance incroyable.", testimonial3Sport: "Dance Fitness",
  testimonial4Name: "David N.", testimonial4City: "Bern", testimonial4Text: "Bachata en duo, c'est 100x mieux. On danse, on rigole.", testimonial4Sport: "Bachata",
  swissTitle: "Actif dans toute la Suisse.", swissSubtitle: "Studios partenaires, salles de danse et espaces fitness.", swissImage: "https://picsum.photos/seed/swiss/800/1000",
  swissCities: "Geneve,Zurich,Lausanne,Bern,Bale,Lucerne,Neuchatel,Fribourg",
  partnerTitle: "Studio de danse ou salle de sport ?", partnerSubtitle: "Rejoins le reseau Spordateur. Remplis tes cours, gagne en visibilite.", partnerCta1: "Devenir partenaire", partnerCta2: "Nous contacter",
};

interface UserItem { uid: string; displayName: string; email: string; role: string; city: string; isPremium: boolean; credits: number; isVisible?: boolean; createdAt: any; commission?: UserCommission; }
interface PartnerItem { partnerId: string; name: string; email: string; city: string; phone: string; type: string; isActive: boolean; isApproved: boolean; subscriptionStatus: string; totalBookings: number; totalRevenue: number; createdAt: any; }
interface TxItem { transactionId: string; userId: string; amount: number; status: string; package: string; paymentMethod: string; createdAt: any; }
interface ErrorItem { logId: string; message: string; source: string; level: string; resolved: boolean; createdAt: any; }
interface PricingItem { id: string; label: string; price: number; credits: number; type: string; interval?: string; isActive: boolean; }
interface PartnerRequestItem { requestId: string; name: string; email: string; phone: string; activity: string; city: string; status: string; notes: string; createdAt: any; updatedAt: any; }

export default function AdminManagePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('cockpit');
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [partners, setPartners] = useState<PartnerItem[]>([]);
  const [partnerRequests, setPartnerRequests] = useState<PartnerRequestItem[]>([]);
  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_SITE);
  const [siteSaving, setSiteSaving] = useState(false);
  // Fix #128 — Brand logos (auto-gen Canvas). Stocké séparément du siteConfig
  // (typage différent : BrandLogos vs Record<string,string>).
  const [brand, setBrand] = useState<BrandLogos>({});
  const [openSection, setOpenSection] = useState<string | null>(null);
  const toggleSection = (id: string) => setOpenSection(openSection === id ? null : id);
  // Promo form
  const [promoCode, setPromoCode] = useState('');
  const [promoCredits, setPromoCredits] = useState('1');
  const [promoDiscount, setPromoDiscount] = useState('');
  // Credit adjustment
  const [creditUserId, setCreditUserId] = useState('');
  const [creditAmount, setCreditAmount] = useState('1');
  // Notification
  const [notifTitle, setNotifTitle] = useState('');
  const [notifBody, setNotifBody] = useState('');
  // Commission
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [commissionRate, setCommissionRate] = useState('20');
  const [commissionSaving, setCommissionSaving] = useState(false);
  // Phase B — édition commission paramétrable par user (creator | invite slot)
  const [commissionEditUid, setCommissionEditUid] = useState<string | null>(null);
  const [commissionDraft, setCommissionDraft] = useState<UserCommission>({
    creator: { ...DEFAULT_CREATOR_COMMISSION },
    invite: { ...DEFAULT_INVITE_COMMISSION },
  });
  const [commissionUserSaving, setCommissionUserSaving] = useState(false);
  // BUG #98 — État des mini-cards d'aperçu visibles (toggle par carte éditeur
  // via PreviewEyeButton). Vide par défaut → panneau aperçu épuré avec juste
  // un message "Clique sur 👁 d'une carte pour la prévisualiser ici".
  const [visiblePreviewIds, setVisiblePreviewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Listener pour les événements émis par PreviewEyeButton.
    // Toggle l'ID dans le Set + scroll vers l'aperçu droit après toggle ON.
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ targetId: string }>).detail?.targetId;
      if (!id) return;
      setVisiblePreviewIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          // Scroll vers la mini-card après render (toggle ON uniquement)
          requestAnimationFrame(() => {
            const el = document.getElementById(id);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Flash effect cohérent BUG #97
              el.classList.remove('preview-flash');
              void el.offsetWidth;
              el.classList.add('preview-flash');
              window.setTimeout(() => el.classList.remove('preview-flash'), 1600);
            }
          });
        }
        return next;
      });
    };
    window.addEventListener('admin-preview-toggle', handler);
    return () => window.removeEventListener('admin-preview-toggle', handler);
  }, []);

  // BUG #94/#99 — Tarifs intra-app affichés dans l'aperçu live droite.
  // Chargés depuis settings/pricing (champs racine, écrits par AdminPricingSection).
  // Defaults alignés sur les valeurs hardcodées (chatPricing.ts + sitePricing.ts).
  const [sitePricingPreview, setSitePricingPreview] = useState({
    chatMessage: 1, chatAudio: 2,
    likeCost: 1, freeLikes: 10,
    boostUser30min: 50, boostUser1h: 90, boostUser6h: 300,
    boostPartner24h: 15, boostPartner3d: 35, boostPartner7d: 50,
  });

  // BUG #91 — Pagination liste utilisateurs.
  // Avant : tous les profils étaient rendus d'un coup → page interminable + ralentissements
  // sur DOM volumineux. Maintenant : 25/page par défaut, navigable, max-height + scroll
  // contraint sur le conteneur de la liste. Reset auto à la page 1 quand la recherche
  // change pour éviter de tomber sur une page vide après filtrage.
  const [usersPage, setUsersPage] = useState(1);
  const [usersPerPage, setUsersPerPage] = useState<25 | 50 | 100>(25);

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }
    loadAll();
  }, [user]);

  // BUG #91 — Reset pagination quand la recherche change (sinon l'utilisateur
  // peut se retrouver sur la page 3 d'un résultat qui n'en a qu'une).
  useEffect(() => {
    setUsersPage(1);
  }, [searchTerm, usersPerPage]);

  const loadAll = async () => {
    if (!db) return;
    try {
      // BUG #94 — Defaults remplacés par les 8 nouveaux packs (PRICING-PROPOSAL.md
      // §3 packs crédits + §5 plans Premium) + partner_monthly conservé. Si
      // settings/pricing.packages contient les anciens IDs (1_date, 3_dates,
      // 10_dates, premium_monthly, premium_yearly), ils ne seront PAS écrasés —
      // le merge plus bas les laisse intacts pour rétro-compat. L'admin peut
      // les désactiver en mettant isActive=false via la nouvelle UI.
      const defaults: PricingItem[] = [
        // Packs crédits (intra-app : likes premium, boost user, messages)
        { id: 'pack_starter', label: 'Starter',  price: 4.90,  credits: 50,   type: 'one_time', isActive: true },
        { id: 'pack_confort', label: 'Confort',  price: 11.90, credits: 150,  type: 'one_time', isActive: true },
        { id: 'pack_pro',     label: 'Pro',      price: 29.90, credits: 500,  type: 'one_time', isActive: true },
        { id: 'pack_vip',     label: 'VIP',      price: 69.90, credits: 1500, type: 'one_time', isActive: true },
        // Plans Premium (24h + 1 sem = one_time avec premiumExpiresAt webhook ;
        // mois + an = subscription Stripe récurrent)
        { id: 'premium_24h',   label: 'Flash 24h',         price: 4.90,   credits: 50,  type: 'one_time', isActive: true },
        { id: 'premium_week',  label: 'Découverte 1 sem.', price: 14.90,  credits: 100, type: 'one_time', isActive: true },
        { id: 'premium_month', label: 'Standard 1 mois',   price: 29.90,  credits: 200, type: 'subscription', interval: 'month', isActive: true },
        { id: 'premium_year',  label: 'Fidélité 1 an',     price: 199.90, credits: 250, type: 'subscription', interval: 'year',  isActive: true },
        // Abonnement Partenaire Pro (inchangé)
        { id: 'partner_monthly', label: 'Partenaire Pro', price: 49, credits: 0, type: 'subscription', interval: 'month', isActive: true },
      ];
      setPricing(defaults);

      // Use allSettled so one failing query doesn't block the rest
      const [uRes, pRes, tRes, eRes, prRes] = await Promise.allSettled([
        getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(200))),
        getDocs(query(collection(db, 'partners'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(100))),
        getDocs(query(collection(db, 'errorLogs'), limit(50))),
        getDocs(collection(db, 'partnerRequests')),
      ]);
      if (uRes.status === 'fulfilled') setUsers(uRes.value.docs.map(d => ({ ...d.data(), uid: d.id } as UserItem)));
      else console.warn('[Admin] users query failed:', uRes.reason);
      if (pRes.status === 'fulfilled') setPartners(pRes.value.docs.map(d => d.data() as PartnerItem));
      else console.warn('[Admin] partners query failed:', pRes.reason);
      if (tRes.status === 'fulfilled') setTransactions(tRes.value.docs.map(d => d.data() as TxItem));
      else console.warn('[Admin] transactions query failed:', tRes.reason);
      if (eRes.status === 'fulfilled') setErrors(eRes.value.docs.map(d => d.data() as ErrorItem));
      else console.warn('[Admin] errorLogs query failed:', eRes.reason);
      if (prRes.status === 'fulfilled') setPartnerRequests(prRes.value.docs.map(d => ({ ...d.data(), requestId: d.id } as PartnerRequestItem)));
      else {
        console.warn('[Admin] partnerRequests client query failed, trying API fallback:', prRes.reason);
        try {
          const apiRes = await fetch('/api/partner-request');
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            if (apiData.requests) setPartnerRequests(apiData.requests as PartnerRequestItem[]);
          }
        } catch (apiFallbackErr) { console.warn('[Admin] API fallback also failed:', apiFallbackErr); }
      }
      // Load saved pricing from settings/pricing (single source of truth)
      try {
        const { getDoc: getDocFn } = await import('firebase/firestore');
        const settingsSnap = await getDocFn(doc(db, 'settings', 'pricing'));
        console.log('[Admin] settings/pricing exists:', settingsSnap.exists(), settingsSnap.data());
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          if (data?.packages) {
            const loaded = defaults.map(d => {
              const saved = (data.packages as Record<string, any>)[d.id];
              if (!saved) return d;
              return {
                ...d,
                price: saved.priceCHF ?? (saved.price ? saved.price / 100 : d.price),
                credits: saved.credits ?? d.credits,
                label: saved.label || d.label,
                isActive: saved.isActive !== false,
              };
            });
            setPricing(loaded);
          }
          // BUG #94/#99 — Charge tous les tarifs intra-app pour l'aperçu live.
          // Champs racine de settings/pricing, écrits par AdminPricingSection.
          setSitePricingPreview({
            chatMessage:     typeof data.chatMessageCost      === 'number' ? data.chatMessageCost      : 1,
            chatAudio:       typeof data.chatAudioCost        === 'number' ? data.chatAudioCost        : 2,
            likeCost:        typeof data.likeCost             === 'number' ? data.likeCost             : 1,
            freeLikes:       typeof data.freeLikesPerDay      === 'number' ? data.freeLikesPerDay      : 10,
            boostUser30min:  typeof data.boostUser30minCost   === 'number' ? data.boostUser30minCost   : 50,
            boostUser1h:     typeof data.boostUser1hCost      === 'number' ? data.boostUser1hCost      : 90,
            boostUser6h:     typeof data.boostUser6hCost      === 'number' ? data.boostUser6hCost      : 300,
            boostPartner24h: typeof data.boostPartner24hPriceCHF === 'number' ? data.boostPartner24hPriceCHF : 15,
            boostPartner3d:  typeof data.boostPartner3dPriceCHF  === 'number' ? data.boostPartner3dPriceCHF  : 35,
            boostPartner7d:  typeof data.boostPartner7dPriceCHF  === 'number' ? data.boostPartner7dPriceCHF  : 50,
          });
        }
      } catch { /* Firestore rules may block — use defaults */ }
      // Load site config + brand logos (Fix #128)
      try {
        const { getDoc: getDocFn2 } = await import('firebase/firestore');
        const siteSnap = await getDocFn2(doc(db, 'settings', 'site'));
        if (siteSnap.exists()) {
          const raw = siteSnap.data() as Record<string, unknown>;
          // brand est un sous-objet (ne doit pas être splaté dans siteConfig qui
          // attend des strings). On l'extrait à part.
          const { brand: brandData, ...rest } = raw;
          setSiteConfig({ ...DEFAULT_SITE, ...(rest as Partial<SiteConfig>) } as SiteConfig);
          if (brandData && typeof brandData === 'object') {
            setBrand(brandData as BrandLogos);
          }
        }
      } catch { /* use defaults */ }
      // Load commission settings
      try {
        const { getDoc: getDocFn3 } = await import('firebase/firestore');
        const commSnap = await getDocFn3(doc(db, 'settings', 'commission'));
        if (commSnap.exists()) {
          const cData = commSnap.data();
          setCommissionEnabled(cData?.enabled ?? false);
          setCommissionRate(String(Math.round((cData?.defaultRate ?? 0.20) * 100)));
        }
      } catch { /* defaults */ }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // Stats
  const totalRevenue = transactions.filter(t => t.status === 'succeeded').reduce((s, t) => s + (t.amount || 0), 0) / 100;
  const totalUsers = users.length;
  const premiumUsers = users.filter(u => u.isPremium).length;
  const activePartners = partners.filter(p => p.isActive).length;
  const pendingPartners = partners.filter(p => !p.isApproved && p.subscriptionStatus === 'active');
  const pendingRequests = partnerRequests.filter(r => r.status === 'pending');
  const todayTx = transactions.filter(t => {
    if (!t.createdAt?.toDate) return false;
    const d = t.createdAt.toDate();
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });
  const todayRevenue = todayTx.filter(t => t.status === 'succeeded').reduce((s, t) => s + (t.amount || 0), 0) / 100;

  // Filters
  const filteredUsers = users.filter(u =>
    (u.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.city || '').toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredPartners = partners.filter(p =>
    (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.city || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // BUG #91 — Pagination calculée. `useMemo` évite de recomputer à chaque
  // re-render quand seul un autre tab change. `usersTotalPages` ne peut être
  // < 1 pour éviter une division par zéro côté affichage. Clamp côté page :
  // si la liste rétrécit et que la page courante dépasse le total, on revient
  // à la dernière page valide.
  const usersTotalPages = Math.max(1, Math.ceil(filteredUsers.length / usersPerPage));
  const usersSafePage = Math.min(usersPage, usersTotalPages);
  const paginatedUsers = useMemo(
    () => filteredUsers.slice((usersSafePage - 1) * usersPerPage, usersSafePage * usersPerPage),
    [filteredUsers, usersSafePage, usersPerPage],
  );

  // Actions
  const toggleUserVisibility = async (uid: string, v: boolean) => {
    if (!db) return;
    await updateDoc(doc(db, 'users', uid), { isVisible: !v, updatedAt: serverTimestamp() });
    setUsers(users.map(u => u.uid === uid ? { ...u, isVisible: !v } : u));
    toast({ title: !v ? 'Visible' : 'Masqué' });
  };
  const changeUserRole = async (uid: string, role: string) => {
    if (!db) return;
    await updateDoc(doc(db, 'users', uid), { role, updatedAt: serverTimestamp() });
    setUsers(users.map(u => u.uid === uid ? { ...u, role } : u));
    toast({ title: `Rôle → ${role}` });
  };
  const deleteUser = async (uid: string, name: string) => {
    if (!db) return;
    // Fix #124 — Cascade delete via /api/admin/delete-user (Firebase Auth +
    // users + likes + matches + chats + notifications). Avant : deleteDoc
    // direct sur users/{uid} laissait des comptes fantômes en Auth + des
    // matches/likes/chats orphelins (vieux UID dans le chat sidebar avec
    // un email bidon "shdjd@kdjfn.ch", impossible à débloquer). Maintenant :
    // tout est wiped en une seule requête, plus de fantômes.
    if (!confirm(
      `Supprimer ${name} ?\n\n` +
      `⚠️ Cette action supprime DÉFINITIVEMENT :\n` +
      `• Le compte Firebase Auth (login impossible après)\n` +
      `• Le profil Firestore\n` +
      `• Tous les likes envoyés et reçus\n` +
      `• Tous les matches associés\n` +
      `• Tous les chats et messages\n` +
      `• Toutes les notifications\n\n` +
      `Action irréversible. Continuer ?`
    )) return;
    try {
      if (!auth?.currentUser) throw new Error('Non authentifié');
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'delete failed');
      setUsers(users.filter(u => u.uid !== uid));
      const counts = data.deletedCounts || {};
      toast({
        title: 'Supprimé (cascade)',
        description: `${counts.likes ?? 0} likes • ${counts.matches ?? 0} matches • ${counts.chats ?? 0} chats • ${counts.notifications ?? 0} notifs`,
      });
    } catch (err) {
      console.error('[admin] delete user failed', err);
      toast({
        variant: 'destructive',
        title: 'Suppression échouée',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const openCommissionModal = (u: UserItem) => {
    setCommissionDraft({
      creator: u.commission?.creator
        ? { mode: u.commission.creator.mode, value: u.commission.creator.value }
        : { ...DEFAULT_CREATOR_COMMISSION },
      invite: u.commission?.invite
        ? { mode: u.commission.invite.mode, value: u.commission.invite.value }
        : { ...DEFAULT_INVITE_COMMISSION },
    });
    setCommissionEditUid(u.uid);
  };
  const saveUserCommission = async () => {
    if (!db || !commissionEditUid) return;
    setCommissionUserSaving(true);
    try {
      const sanitize = (mode: CommissionMode, raw: number): number => {
        if (!Number.isFinite(raw) || raw < 0) return mode === 'percent' ? 10 : 1;
        return mode === 'free-class' ? Math.floor(raw) : raw;
      };
      const payload: UserCommission = {
        creator: {
          mode: commissionDraft.creator.mode,
          value: sanitize(commissionDraft.creator.mode, commissionDraft.creator.value),
        },
        invite: {
          mode: commissionDraft.invite.mode,
          value: sanitize(commissionDraft.invite.mode, commissionDraft.invite.value),
        },
      };
      await updateDoc(doc(db, 'users', commissionEditUid), {
        commission: payload,
        updatedAt: serverTimestamp(),
      });
      setUsers(users.map(u => u.uid === commissionEditUid ? { ...u, commission: payload } : u));
      toast({ title: 'Commission mise à jour' });
      setCommissionEditUid(null);
    } catch (err) {
      console.error('[Admin] saveUserCommission failed', err);
      toast({ variant: 'destructive', title: 'Erreur', description: 'Impossible de sauvegarder' });
    } finally {
      setCommissionUserSaving(false);
    }
  };
  const togglePartner = async (pid: string, field: 'isActive' | 'isApproved', cur: boolean) => {
    if (!db) return;
    await updateDoc(doc(db, 'partners', pid), { [field]: !cur, updatedAt: serverTimestamp() });
    setPartners(partners.map(p => p.partnerId === pid ? { ...p, [field]: !cur } : p));
    toast({ title: 'Mis à jour' });
  };
  const adjustCredits = async (add: boolean) => {
    if (!db) return;
    // BUG #12 — validation explicite + try/catch (avant : silent fail sur
    // uid vide / amount invalide / permission denied / network error → "ne
    // marche plus" pour Bassi). Optimistic local update remplace l'expensive
    // loadAll() qui rechargeait tous les onglets.
    const result = validateCreditAdjustment({ userId: creditUserId, amountStr: creditAmount, add });
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Action impossible',
        description: result.error === 'missing-user'
          ? 'Sélectionne un utilisateur.'
          : 'Quantité invalide (entier > 0).',
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'users', result.uid), {
        credits: increment(result.delta),
        updatedAt: serverTimestamp(),
      });
      // Optimistic local update — évite loadAll() coûteux qui recharge
      // users/partners/transactions/errors.
      setUsers(prev => prev.map(u =>
        u.uid === result.uid ? { ...u, credits: (u.credits || 0) + result.delta } : u,
      ));
      const absDelta = Math.abs(result.delta);
      toast({
        title: `${add ? '+' : '-'}${absDelta} crédits → ${result.uid.substring(0, 8)}...`,
      });
      setCreditUserId('');
      setCreditAmount('1');
    } catch (err) {
      console.error('[Admin] adjustCredits failed', err);
      toast({
        variant: 'destructive',
        title: 'Erreur Firestore',
        description: err instanceof Error ? err.message : 'Mise à jour refusée — vérifie ton rôle admin.',
      });
    }
  };
  const createPromo = async () => {
    if (!db || !promoCode) return;
    await setDoc(doc(db, 'promos', promoCode.toUpperCase()), {
      code: promoCode.toUpperCase(),
      creditsBonus: parseInt(promoCredits) || 0,
      discountPercent: parseInt(promoDiscount) || 0,
      isActive: true,
      usageCount: 0,
      createdAt: serverTimestamp(),
    });
    toast({ title: `Code ${promoCode.toUpperCase()} créé !` });
    setPromoCode(''); setPromoCredits('1'); setPromoDiscount('');
  };
  const sendNotification = async () => {
    if (!db || !notifTitle) return;
    // Phase 9.5 c52 BUG 3 — type='admin-broadcast' + priority='high' fait
    // déclencher le composant <AdminBroadcastModal> (modal fullscreen
    // obligatoire) côté users. Picked up via realtime listener Firestore
    // sur layout root → impossible à manquer.
    const batch: Promise<void>[] = [];
    for (const u of users.slice(0, 500)) {
      const ref = doc(collection(db, 'notifications'));
      batch.push(setDoc(ref, {
        notificationId: ref.id, userId: u.uid, type: 'admin-broadcast',
        title: notifTitle, body: notifBody, data: {},
        isRead: false, priority: 'high',
        createdAt: serverTimestamp(),
      }));
    }
    await Promise.all(batch);
    toast({ title: `Notification envoyée à ${Math.min(users.length, 500)} utilisateurs (modal popup)` });
    setNotifTitle(''); setNotifBody('');
  };
  const updatePricing = async (id: string, field: string, value: number | boolean) => {
    if (!db) return;
    const updated = pricing.map(p => p.id === id ? { ...p, [field]: value } : p);
    setPricing(updated);
  };
  const savePricing = async () => {
    if (!db) {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Firestore non connecté' });
      return;
    }
    setPricingSaving(true);
    try {
      const packagesData = pricing.reduce((acc, p) => {
        const pkg: Record<string, any> = { priceCHF: p.price, credits: p.credits, label: p.label, type: p.type, isActive: p.isActive };
        if (p.interval) pkg.interval = p.interval;
        return { ...acc, [p.id]: pkg };
      }, {});

      console.log('[Admin] Saving pricing:', JSON.stringify(packagesData));

      // Single source of truth: settings/pricing
      await setDoc(doc(db, 'settings', 'pricing'), {
        packages: packagesData,
        updatedAt: serverTimestamp(),
      });

      console.log('[Admin] Pricing saved successfully');
      toast({ title: 'Tarifs sauvegardés !', description: 'Les changements sont en ligne.' });

      // Reload to confirm
      await loadAll();
    } catch (err) {
      console.error('[Admin] Save pricing error:', err);
      toast({ variant: 'destructive', title: 'Erreur de sauvegarde', description: String(err) });
    }
    finally { setPricingSaving(false); }
  };
  const saveSiteConfig = async () => {
    if (!db) return;
    setSiteSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'site'), { ...siteConfig, updatedAt: serverTimestamp() });
      toast({ title: 'Configuration du site sauvegardée !' });
    } catch (err) {
      console.error('[Admin] Save site error:', err);
      toast({ variant: 'destructive', title: 'Erreur', description: String(err) });
    } finally { setSiteSaving(false); }
  };
  const updateSite = (field: keyof SiteConfig, value: string) => {
    setSiteConfig(prev => ({ ...prev, [field]: value }));
  };
  const saveCommission = async () => {
    if (!db) return;
    setCommissionSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'commission'), {
        enabled: commissionEnabled,
        defaultRate: parseFloat(commissionRate) / 100,
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'Commission sauvegardée', description: `${commissionEnabled ? commissionRate + '%' : 'Désactivée'}` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erreur', description: String(err) });
    } finally { setCommissionSaving(false); }
  };
  const updatePartnerRequest = async (requestId: string, newStatus: string, name: string) => {
    if (!db) return;
    await updateDoc(doc(db, 'partnerRequests', requestId), { status: newStatus, updatedAt: serverTimestamp() });
    setPartnerRequests(partnerRequests.map(r => r.requestId === requestId ? { ...r, status: newStatus } : r));
    const labels: Record<string, string> = { contacted: 'Contacté', approved: 'Approuvé', rejected: 'Refusé' };
    toast({ title: `${name} — ${labels[newStatus] || newStatus}` });
  };
  const resolveError = async (logId: string) => {
    if (!db) return;
    await updateDoc(doc(db, 'errorLogs', logId), { resolved: true, resolvedAt: serverTimestamp() });
    setErrors(errors.filter(e => e.logId !== logId));
    toast({ title: 'Erreur résolue' });
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'cockpit', label: 'Cockpit', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'users', label: 'Utilisateurs', icon: <Users className="h-4 w-4" />, count: totalUsers },
    { id: 'partners', label: 'Partenaires', icon: <Building2 className="h-4 w-4" />, count: (pendingRequests.length + pendingPartners.length) > 0 ? (pendingRequests.length + pendingPartners.length) : partners.length },
    { id: 'credits', label: 'Crédits', icon: <CreditCard className="h-4 w-4" /> },
    { id: 'promos', label: 'Promos', icon: <Gift className="h-4 w-4" /> },
    { id: 'tarifs', label: 'Tarifs', icon: <Wallet className="h-4 w-4" /> },
    { id: 'site', label: 'Site', icon: <Settings className="h-4 w-4" /> },
    { id: 'settings', label: 'Notifs', icon: <Bell className="h-4 w-4" /> },
    { id: 'errors', label: 'Erreurs', icon: <Bug className="h-4 w-4" />, count: errors.length },
  ];

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-accent animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-32 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-light tracking-tight flex items-center gap-2">
              <Shield className="h-6 w-6 text-accent" /> Admin Spordateur
            </h1>
          </div>
          <Link href="/admin/revenue"><Button variant="outline" size="sm" className="border-accent/30 text-accent text-xs">Revenus</Button></Link>
        </div>

        {/* Tabs — horizontal scroll on mobile */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap transition-all ${
                tab === t.id ? 'bg-accent/10 border border-accent/30 text-accent' : 'bg-white/5 text-white/40'
              }`}
            >
              {t.icon} {t.label} {t.count !== undefined && <span className="text-[10px] opacity-60">({t.count})</span>}
            </button>
          ))}
        </div>

        {/* Search (for users/partners) */}
        {(tab === 'users' || tab === 'partners') && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
            <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Rechercher..." className="bg-[#1A1A1A] border-white/10 pl-10 h-11" />
          </div>
        )}

        {/* ===== COCKPIT ===== */}
        {tab === 'cockpit' && (
          <div className="space-y-4">
            {/* Pending partner alert */}
            {pendingRequests.length > 0 && (
              <Card className="bg-accent/5 border-accent/20 cursor-pointer hover:bg-accent/10 transition" onClick={() => setTab('partners')}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-accent animate-pulse" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-accent">{pendingRequests.length} nouvelle(s) demande(s) de partenariat</p>
                    <p className="text-xs text-white/40">Formulaire de contact — cliquez pour traiter</p>
                  </div>
                  <Building2 className="h-5 w-5 text-accent" />
                </CardContent>
              </Card>
            )}
            {pendingPartners.length > 0 && (
              <Card className="bg-amber-500/5 border-amber-500/20 cursor-pointer hover:bg-amber-500/10 transition" onClick={() => setTab('partners')}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-amber-400 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-400">{pendingPartners.length} partenaire(s) payé(s) en attente d&apos;approbation</p>
                    <p className="text-xs text-white/40">Cliquez pour voir et valider</p>
                  </div>
                  <Building2 className="h-5 w-5 text-amber-400" />
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Revenus total', value: `${totalRevenue.toFixed(0)} CHF`, icon: <Wallet className="h-4 w-4 text-accent" /> },
                { label: "Aujourd'hui", value: `${todayRevenue.toFixed(0)} CHF`, icon: <TrendingUp className="h-4 w-4 text-green-400" /> },
                { label: 'Utilisateurs', value: String(totalUsers), icon: <Users className="h-4 w-4 text-blue-400" /> },
                { label: 'Premium', value: String(premiumUsers), icon: <Crown className="h-4 w-4 text-amber-400" /> },
                { label: 'Partenaires', value: String(activePartners), icon: <Building2 className="h-4 w-4 text-accent" /> },
                { label: 'Transactions', value: String(transactions.length), icon: <CreditCard className="h-4 w-4 text-purple-400" /> },
                { label: 'Erreurs', value: String(errors.length), icon: <Bug className="h-4 w-4 text-red-400" /> },
                { label: 'Conversion', value: transactions.length > 0 ? `${((transactions.filter(t=>t.status==='succeeded').length / totalUsers) * 100).toFixed(0)}%` : '0%', icon: <Zap className="h-4 w-4 text-yellow-400" /> },
              ].map((s, i) => (
                <Card key={i} className="bg-[#1A1A1A] border-white/5">
                  <CardContent className="p-3.5">
                    <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-[10px] text-white/40 uppercase tracking-wider">{s.label}</span></div>
                    <p className="text-xl font-light text-white">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            {/* Recent transactions */}
            <Card className="bg-[#1A1A1A] border-white/5">
              <CardContent className="p-4">
                <h3 className="text-sm text-white/50 mb-3">Dernières transactions</h3>
                {transactions.slice(0, 5).map(tx => (
                  <div key={tx.transactionId} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div><p className="text-xs text-white/60">{tx.userId?.substring(0, 10)}...</p><p className="text-[10px] text-white/20">{tx.package} · {tx.paymentMethod}</p></div>
                    <Badge className={tx.status === 'succeeded' ? 'bg-green-500/10 text-green-400 border-green-500/20 text-xs' : 'bg-red-500/10 text-red-400 text-xs'}>{(tx.amount/100).toFixed(2)} CHF</Badge>
                  </div>
                ))}
                {transactions.length === 0 && <p className="text-xs text-white/20 text-center py-4">Aucune transaction</p>}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===== USERS ===== */}
        {tab === 'users' && (
          <div className="space-y-4">
            {/* BUG #89 — Section "Vérifications selfie en attente" tout en haut
                de la tab Utilisateurs. L'admin voit ici tous les selfies à
                approuver/rejeter avec preview selfie + photo de profil. */}
            <AdminSelfieReviewSection />

            {/* BUG #91 — Barre de contrôle pagination : compteur + sélecteur taille de page.
                Charte stricte : fond zinc, accent #D91CD2 sur élément actif. */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-[11px] text-white/40">
                {filteredUsers.length === 0
                  ? 'Aucun utilisateur'
                  : `${filteredUsers.length} utilisateur${filteredUsers.length > 1 ? 's' : ''}${searchTerm ? ' (filtré)' : ''} · Page ${usersSafePage}/${usersTotalPages}`}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Par page</span>
                {([25, 50, 100] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => setUsersPerPage(n)}
                    className={`h-7 px-2 rounded text-[10px] border transition-colors ${
                      usersPerPage === n
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* BUG #91 — Conteneur de la liste : max-height + overflow-y-auto pour que
                la page admin reste à hauteur fixe au lieu de s'étirer indéfiniment.
                Hauteur calculée pour laisser visible le header, la barre pagination
                et les contrôles bas. Sur mobile : un peu plus court pour garder la
                barre du bas accessible. */}
            <div className="max-h-[calc(100vh-360px)] sm:max-h-[calc(100vh-320px)] overflow-y-auto pr-1 scrollbar-thin">
              <div className="space-y-2">
            {paginatedUsers.map(u => (
              <Card key={u.uid} className="bg-[#1A1A1A] border-white/5">
                <CardContent className="p-3 flex flex-col md:flex-row items-start md:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm text-white truncate">{u.displayName || 'Sans nom'}</span>
                      <Badge className={`text-[9px] ${u.role === 'admin' ? 'bg-red-500/10 text-red-400' : u.role === 'creator' ? 'bg-amber-500/10 text-amber-400' : 'bg-white/5 text-white/30'}`}>{u.role || 'user'}</Badge>
                      {u.isPremium && <Badge className="text-[9px] bg-accent/10 text-accent">Premium</Badge>}
                    </div>
                    <p className="text-[11px] text-white/25 truncate">{u.email} · {u.city || '?'} · {u.credits || 0} crédits</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => toggleUserVisibility(u.uid, u.isVisible !== false)} className={`w-7 h-7 rounded flex items-center justify-center ${u.isVisible !== false ? 'text-green-400' : 'text-red-400'}`}>
                      {u.isVisible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <select value={u.role || 'user'} onChange={e => changeUserRole(u.uid, e.target.value)} className="bg-black border border-white/10 rounded text-[10px] text-white/50 px-1.5 h-7">
                      <option value="user">User</option><option value="creator">Creator</option><option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => openCommissionModal(u)}
                      title="Configurer la commission (créateur + invitation)"
                      className={`h-7 px-2 rounded text-[10px] flex items-center gap-1 border ${u.commission ? 'border-amber-400/30 text-amber-400 bg-amber-400/5' : 'border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'}`}
                    >
                      <Percent className="h-3 w-3" /> Commission
                    </button>
                    {u.role !== 'admin' && <button onClick={() => deleteUser(u.uid, u.displayName)} className="w-7 h-7 rounded text-red-400/30 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Phase B — Modal commission paramétrable par user */}
            <Dialog open={!!commissionEditUid} onOpenChange={(o) => { if (!o) setCommissionEditUid(null); }}>
              <DialogContent className="bg-[#0F0F0F] border-white/10 text-white max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-white">Commission utilisateur</DialogTitle>
                  <DialogDescription className="text-white/40 text-xs">
                    Configure ce que reçoit ce user quand quelqu&apos;un achète via son lien créateur ou son lien d&apos;invitation. Defaults : créateur 10% · invitation 1 cours.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  {(['creator', 'invite'] as const).map(slot => {
                    const cfg = commissionDraft[slot];
                    const titleLabel = slot === 'creator' ? 'Lien créateur' : 'Lien invitation';
                    const subLabel =
                      slot === 'creator'
                        ? 'Quelqu’un achète via le lien créateur de ce user.'
                        : 'Quelqu’un s’inscrit + achète via son lien d’invitation.';
                    return (
                      <div key={slot} className="border border-white/10 rounded-md p-3 space-y-3">
                        <div>
                          <p className="text-sm text-white">{titleLabel}</p>
                          <p className="text-[10px] text-white/30">{subLabel}</p>
                        </div>
                        <RadioGroup
                          value={cfg.mode}
                          onValueChange={(v: string) =>
                            setCommissionDraft(d => ({ ...d, [slot]: { ...d[slot], mode: v as CommissionMode } }))
                          }
                          className="flex gap-4"
                        >
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="percent" id={`${slot}-percent`} />
                            <Label htmlFor={`${slot}-percent`} className="text-xs text-white/70 cursor-pointer">Pourcentage</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="free-class" id={`${slot}-free`} />
                            <Label htmlFor={`${slot}-free`} className="text-xs text-white/70 cursor-pointer">Cours gratuit</Label>
                          </div>
                        </RadioGroup>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0"
                            max={cfg.mode === 'percent' ? 100 : undefined}
                            step={cfg.mode === 'percent' ? 1 : 1}
                            value={String(cfg.value)}
                            onChange={e =>
                              setCommissionDraft(d => ({
                                ...d,
                                [slot]: { ...d[slot], value: Number(e.target.value) || 0 },
                              }))
                            }
                            className="bg-black border-white/10 h-9 w-24"
                          />
                          <span className="text-[11px] text-white/40">
                            {cfg.mode === 'percent' ? '% du montant' : `cours offert${cfg.value > 1 ? 's' : ''} par achat`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <DialogFooter className="mt-4 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setCommissionEditUid(null)}
                    className="border-white/10 text-white/60 hover:bg-white/5 h-9"
                    disabled={commissionUserSaving}
                  >
                    Annuler
                  </Button>
                  <Button
                    onClick={saveUserCommission}
                    disabled={commissionUserSaving}
                    className="bg-accent hover:bg-accent/90 text-white h-9"
                  >
                    {commissionUserSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Sauvegarder'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          </div>

          {/* BUG #91 — Pagination footer : Précédent / numéros / Suivant.
              Affiche jusqu'à 5 numéros centrés sur la page courante (fenêtre
              glissante). Désactivé visuellement quand on est aux extrémités. */}
          {usersTotalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2">
              <button
                onClick={() => setUsersPage(p => Math.max(1, p - 1))}
                disabled={usersSafePage <= 1}
                className="h-8 px-3 rounded text-[11px] border border-white/10 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ‹ Précédent
              </button>
              {Array.from({ length: usersTotalPages }, (_, i) => i + 1)
                .filter(n => Math.abs(n - usersSafePage) <= 2 || n === 1 || n === usersTotalPages)
                .map((n, i, arr) => {
                  const prev = arr[i - 1];
                  const showEllipsis = prev !== undefined && n - prev > 1;
                  return (
                    <span key={n} className="flex items-center gap-1">
                      {showEllipsis && <span className="text-white/20 text-[11px] px-1">…</span>}
                      <button
                        onClick={() => setUsersPage(n)}
                        className={`h-8 min-w-8 px-2 rounded text-[11px] border transition-colors ${
                          n === usersSafePage
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-white/10 text-white/50 hover:text-white hover:border-white/20'
                        }`}
                      >
                        {n}
                      </button>
                    </span>
                  );
                })}
              <button
                onClick={() => setUsersPage(p => Math.min(usersTotalPages, p + 1))}
                disabled={usersSafePage >= usersTotalPages}
                className="h-8 px-3 rounded text-[11px] border border-white/10 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Suivant ›
              </button>
            </div>
          )}
          </div>
        )}

        {/* ===== PARTNERS ===== */}
        {tab === 'partners' && (
          <div className="space-y-6">
            {/* New partner requests from /partners form */}
            {pendingRequests.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                  <h3 className="text-sm font-medium text-accent uppercase tracking-wider">
                    Nouvelles demandes ({pendingRequests.length})
                  </h3>
                </div>
                {pendingRequests.map(r => (
                  <Card key={r.requestId} className="bg-accent/5 border-accent/20">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-medium text-white">{r.name}</span>
                            <Badge className="text-[10px] bg-accent/10 text-accent border-accent/20">{r.activity}</Badge>
                          </div>
                          <p className="text-xs text-white/40">{r.email} {r.phone ? `· ${r.phone}` : ''}</p>
                          <p className="text-xs text-white/30 flex items-center gap-1"><MapPin className="h-3 w-3" /> {r.city}</p>
                          {r.createdAt?.toDate && (
                            <p className="text-[10px] text-white/20">Demande le {r.createdAt.toDate().toLocaleDateString('fr-CH')}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30 text-xs h-9 px-4"
                            onClick={() => updatePartnerRequest(r.requestId, 'contacted', r.name)}
                          >
                            Contacter
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs h-9 px-3"
                            onClick={() => {
                              if (confirm(`Refuser la demande de ${r.name} ?`)) {
                                updatePartnerRequest(r.requestId, 'rejected', r.name);
                              }
                            }}
                          >
                            Refuser
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Already contacted / processed requests */}
            {partnerRequests.filter(r => r.status === 'contacted').length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs text-white/30 uppercase tracking-wider">Demandes contactées ({partnerRequests.filter(r => r.status === 'contacted').length})</h3>
                {partnerRequests.filter(r => r.status === 'contacted').map(r => (
                  <Card key={r.requestId} className="bg-[#1A1A1A] border-white/5">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{r.name}</span>
                          <Badge className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/20">Contacté</Badge>
                          <Badge className="text-[9px] bg-white/5 text-white/40 border-white/10">{r.activity}</Badge>
                        </div>
                        <p className="text-[11px] text-white/25">{r.email} · {r.city}</p>
                      </div>
                      <Button
                        size="sm"
                        className="bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 text-xs h-8 px-3"
                        onClick={() => updatePartnerRequest(r.requestId, 'approved', r.name)}
                      >
                        Approuvé (inscrit)
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Pending approval requests (paid but not yet approved) */}
            {pendingPartners.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  <h3 className="text-sm font-medium text-amber-400 uppercase tracking-wider">
                    Demandes en attente ({pendingPartners.length})
                  </h3>
                </div>
                {pendingPartners.map(p => (
                  <Card key={p.partnerId} className="bg-amber-500/5 border-amber-500/20">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-medium text-white">{p.name}</span>
                            <Badge className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">Payé</Badge>
                          </div>
                          <p className="text-xs text-white/40">{p.email} · {p.phone || 'N/A'}</p>
                          <p className="text-xs text-white/30">{p.city} · {p.type || 'studio'}</p>
                          {p.createdAt?.toDate && (
                            <p className="text-[10px] text-white/20">Inscrit le {p.createdAt.toDate().toLocaleDateString('fr-CH')}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30 text-xs h-9 px-4"
                            onClick={() => {
                              togglePartner(p.partnerId, 'isApproved', false);
                              togglePartner(p.partnerId, 'isActive', false);
                              toast({ title: `${p.name} approuvé !`, description: 'Le partenaire a maintenant accès au portail.' });
                            }}
                          >
                            Approuver
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs h-9 px-3"
                            onClick={() => {
                              if (confirm(`Refuser ${p.name} ?`)) {
                                toast({ title: `${p.name} refusé`, variant: 'destructive' });
                              }
                            }}
                          >
                            Refuser
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* All partners list */}
            <div className="space-y-2">
              <h3 className="text-xs text-white/30 uppercase tracking-wider">Tous les partenaires ({filteredPartners.length})</h3>
              {filteredPartners.length === 0 && <p className="text-white/30 text-center py-8">Aucun partenaire</p>}
              {filteredPartners.map(p => (
                <Card key={p.partnerId} className="bg-[#1A1A1A] border-white/5">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white">{p.name}</span>
                        {p.subscriptionStatus === 'active' && <Badge className="text-[9px] bg-green-500/10 text-green-400 border-green-500/20">Abo actif</Badge>}
                        {p.subscriptionStatus === 'trial' && <Badge className="text-[9px] bg-yellow-500/10 text-yellow-400 border-yellow-500/20">Non payé</Badge>}
                        {p.subscriptionStatus === 'cancelled' && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">Annulé</Badge>}
                        {!p.isApproved && p.subscriptionStatus === 'active' && <Badge className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20">En attente</Badge>}
                      </div>
                      <p className="text-[11px] text-white/25">{p.email} · {p.city} · {p.totalBookings || 0} réservations · {(p.totalRevenue || 0).toFixed(0)} CHF</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1"><span className="text-[10px] text-white/20">Visible</span><Switch checked={p.isActive} onCheckedChange={() => togglePartner(p.partnerId, 'isActive', p.isActive)} /></div>
                      <div className="flex items-center gap-1"><span className="text-[10px] text-white/20">Approuvé</span><Switch checked={p.isApproved} onCheckedChange={() => togglePartner(p.partnerId, 'isApproved', p.isApproved)} /></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Commission Settings */}
            <Card className="bg-[#1A1A1A] border-white/5">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm text-white/50">Commission sur les réservations</h3>
                  <Switch checked={commissionEnabled} onCheckedChange={v => setCommissionEnabled(v)} />
                </div>
                {commissionEnabled && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-white/30 block mb-1">Taux de commission (%)</label>
                      <div className="flex items-center gap-3">
                        <Input type="number" min="0" max="100" value={commissionRate} onChange={e => setCommissionRate(e.target.value)} className="bg-black border-white/10 h-11 w-24" />
                        <span className="text-white/30 text-sm">%</span>
                        <div className="flex-1 text-right">
                          <p className="text-xs text-white/20">Ex: activité 20 CHF → admin {((20 * parseFloat(commissionRate || '0')) / 100).toFixed(2)} CHF · partenaire {(20 - (20 * parseFloat(commissionRate || '0')) / 100).toFixed(2)} CHF</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {!commissionEnabled && <p className="text-xs text-white/20">Désactivé — 100% des revenus vont au partenaire</p>}
                <Button onClick={saveCommission} disabled={commissionSaving} size="sm" className="bg-accent hover:bg-accent/80 text-white text-xs h-9">
                  {commissionSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Sauvegarder commission
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===== CREDITS ===== */}
        {tab === 'credits' && (
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-5 space-y-4">
              <h3 className="text-sm text-white/50">Ajouter / Retirer des crédits</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-white/30 block mb-1">User ID</label>
                  <select value={creditUserId} onChange={e => setCreditUserId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg text-sm text-white px-3 h-11">
                    <option value="">Sélectionner un utilisateur</option>
                    {users.map(u => <option key={u.uid} value={u.uid}>{u.displayName || u.email} ({u.credits} crédits)</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-white/30 block mb-1">Nombre de crédits</label>
                  <Input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} className="bg-black border-white/10 h-11" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => adjustCredits(true)} className="flex-1 bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 h-11"><Plus className="h-4 w-4 mr-1" /> Ajouter</Button>
                  <Button onClick={() => adjustCredits(false)} className="flex-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 h-11"><Minus className="h-4 w-4 mr-1" /> Retirer</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== PROMOS ===== */}
        {tab === 'promos' && (
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-5 space-y-4">
              <h3 className="text-sm text-white/50">Créer un code promo</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-white/30 block mb-1">Code</label>
                  <Input value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder="FREEFIRSTDATE" className="bg-black border-white/10 h-11 uppercase" />
                </div>
                <div>
                  <label className="text-xs text-white/30 block mb-1">Crédits offerts</label>
                  <Input type="number" value={promoCredits} onChange={e => setPromoCredits(e.target.value)} placeholder="1" className="bg-black border-white/10 h-11" />
                </div>
                <div>
                  <label className="text-xs text-white/30 block mb-1">Réduction %</label>
                  <Input type="number" value={promoDiscount} onChange={e => setPromoDiscount(e.target.value)} placeholder="0" className="bg-black border-white/10 h-11" />
                </div>
              </div>
              <Button onClick={createPromo} disabled={!promoCode} className="bg-accent hover:bg-accent/80 text-white h-11"><Gift className="h-4 w-4 mr-2" /> Créer le code promo</Button>
            </CardContent>
          </Card>
        )}

        {/* ===== TARIFS (BUG #96 — refonte responsive 60/40 + sticky) ===== */}
        {tab === 'tarifs' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
            {/* LEFT — Éditeur (60% sur desktop = 3/5 cols, full width sur mobile) */}
            <div className="lg:col-span-3 space-y-4">
              <div className="flex items-center justify-between gap-3 sticky top-0 z-10 bg-black/95 backdrop-blur py-2 -mx-1 px-1 rounded-md">
                <h3 className="text-base text-white font-medium">Modifier les tarifs</h3>
                <Button onClick={savePricing} disabled={pricingSaving} className="bg-accent hover:bg-accent/90 text-white h-10 px-4 text-xs rounded-full shadow-lg shadow-accent/20">
                  {pricingSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Settings className="h-4 w-4 mr-1.5" />}
                  Sauvegarder
                </Button>
              </div>

              {/* BUG #74 / #92 — Section "Prix Spordateur" : 4 cartes regroupées
                  (Chat, Likes, Boost user, Boost partenaire). Lit/écrit
                  settings/pricing (doc séparé des tarifs Stripe ci-dessous).
                  Composant autonome avec son propre bouton "Sauvegarder tous
                  les tarifs" en pied de section pour atomicité. */}
              <p className="text-xs text-accent uppercase tracking-wider">Services intra-app & boost</p>
              <AdminPricingSection />

              {/* BUG #94 — Filter par PREFIX d'ID. BUG #97/#98 — œil PAR carte
                  (à côté du switch) qui toggle la mini-card dans l'aperçu droit.
                  Grid 2 cols sur PC, 1 col mobile. */}
              <p className="text-xs text-accent uppercase tracking-wider mt-2">Packs crédits</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pricing.filter(p => p.id.startsWith('pack_')).map(p => (
                <Card key={p.id} className={`bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 ${!p.isActive ? 'border-red-500/20 opacity-70' : ''}`}>
                  <CardContent className="p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`text-sm font-medium truncate ${p.isActive ? 'text-white' : 'text-red-400/60'}`}>{p.label}</span>
                        {!p.isActive && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">OFF</Badge>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <PreviewEyeButton targetId={`preview-${p.id}`} active={visiblePreviewIds.has(`preview-${p.id}`)} label="Voir aperçu" />
                        <Switch checked={p.isActive} onCheckedChange={(v) => updatePricing(p.id, 'isActive', v)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Prix CHF</label><Input type="number" step="0.01" value={p.price} onChange={e => updatePricing(p.id, 'price', parseFloat(e.target.value) || 0)} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Crédits</label><Input type="number" value={p.credits} onChange={e => updatePricing(p.id, 'credits', parseInt(e.target.value) || 0)} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Nom</label><Input value={p.label} onChange={e => { const v = e.target.value; setPricing(pricing.map(x => x.id === p.id ? { ...x, label: v } : x)); }} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              </div>

              <p className="text-xs text-accent uppercase tracking-wider mt-4">Plans Premium</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pricing.filter(p => p.id.startsWith('premium_')).map(p => (
                <Card key={p.id} className={`bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 ${!p.isActive ? 'border-red-500/20 opacity-70' : ''}`}>
                  <CardContent className="p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`text-sm font-medium truncate ${p.isActive ? 'text-white' : 'text-red-400/60'}`}>{p.label}</span>
                        <Badge className="text-[10px] bg-white/5 text-white/40 border-white/10 flex-shrink-0">{p.type === 'subscription' ? (p.interval === 'month' ? '/mois' : '/an') : 'one-shot'}</Badge>
                        {!p.isActive && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">OFF</Badge>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <PreviewEyeButton targetId={`preview-${p.id}`} active={visiblePreviewIds.has(`preview-${p.id}`)} label="Voir aperçu" />
                        <Switch checked={p.isActive} onCheckedChange={(v) => updatePricing(p.id, 'isActive', v)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Prix CHF</label><Input type="number" step="0.01" value={p.price} onChange={e => updatePricing(p.id, 'price', parseFloat(e.target.value) || 0)} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Crédits / période</label><Input type="number" value={p.credits} onChange={e => updatePricing(p.id, 'credits', parseInt(e.target.value) || 0)} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Nom</label><Input value={p.label} onChange={e => { const v = e.target.value; setPricing(pricing.map(x => x.id === p.id ? { ...x, label: v } : x)); }} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              </div>

              <p className="text-xs text-accent uppercase tracking-wider mt-4">Abonnement Partenaire</p>
              {pricing.filter(p => p.id.startsWith('partner_')).map(p => (
                <Card key={p.id} className={`bg-[#0F0F0F] border-white/10 rounded-2xl transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/10 ${!p.isActive ? 'border-red-500/20 opacity-70' : ''}`}>
                  <CardContent className="p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`text-sm font-medium truncate ${p.isActive ? 'text-white' : 'text-red-400/60'}`}>{p.label}</span>
                        <Badge className="text-[10px] bg-white/5 text-white/40 border-white/10 flex-shrink-0">{p.interval === 'month' ? '/mois' : '/an'}</Badge>
                        {!p.isActive && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">OFF</Badge>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <PreviewEyeButton targetId={`preview-${p.id}`} active={visiblePreviewIds.has(`preview-${p.id}`)} label="Voir aperçu" />
                        <Switch checked={p.isActive} onCheckedChange={(v) => updatePricing(p.id, 'isActive', v)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Prix CHF</label><Input type="number" step="0.01" value={p.price} onChange={e => updatePricing(p.id, 'price', parseFloat(e.target.value) || 0)} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Crédits</label><Input type="number" value={p.credits} onChange={e => updatePricing(p.id, 'credits', parseInt(e.target.value) || 0)} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1 uppercase tracking-wider">Nom</label><Input value={p.label} onChange={e => { const v = e.target.value; setPricing(pricing.map(x => x.id === p.id ? { ...x, label: v } : x)); }} className="bg-black border-white/15 h-11 w-full text-white text-base rounded-xl focus:border-accent/50 transition-colors" /></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* RIGHT — Aperçu en direct (BUG #94/#96/#99 : 40% desktop, sticky, scroll interne) */}
            <div className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto scrollbar-thin space-y-4 pr-1">
              <h3 className="text-base text-white font-medium flex items-center gap-2 sticky top-0 bg-black/95 backdrop-blur py-1 -mx-1 px-1 z-10"><Eye className="h-4 w-4 text-accent" /> Aperçu en direct</h3>

              {/* BUG #101 — Sections Chat/Likes/Boost user supprimées :
                  ces tarifs intra-app n'ont pas de "carte client" à montrer.
                  L'admin les édite via AdminPricingSection en haut. */}

              {/* BUG #101 — Aperçu /payment FIDÈLE au rendu client.
                  Reproduction des cards stylisées du panneau /payment : gradient
                  color par tier, icon en cercle, badge populaire, gros prix,
                  features list, bouton "Acheter". Le but : que l'admin voie
                  exactement ce que verra le client. Conditionnel par carte. */}
              {(() => {
                const packs = pricing.filter(p => p.id.startsWith('pack_') && p.isActive);
                const visiblePacks = packs.filter(p => visiblePreviewIds.has(`preview-${p.id}`));
                // Baseline = pack le moins économique (moins de crédits par CHF).
                // Filet : si aucun pack actif, baseline 0 → savings 0%.
                const baselineRatio = packs.reduce<number>((max, p) => {
                  if (p.credits <= 0 || p.price <= 0) return max;
                  const r = p.price / p.credits;
                  return r > max ? r : max;
                }, 0);
                if (visiblePacks.length === 0) return null;
                return (
                  <>
                    <p id="preview-packs" className="text-xs text-white/30 uppercase tracking-wider mt-3 flex items-center gap-2 scroll-mt-4 rounded-md p-1">
                      <span>📱 Aperçu /payment — Packs crédits</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {visiblePacks.map(p => {
                        const ratio = p.credits > 0 ? p.price / p.credits : 0;
                        const savings = baselineRatio > 0 && ratio > 0 && ratio < baselineRatio
                          ? Math.round((1 - ratio / baselineRatio) * 100)
                          : 0;
                        const isPopular = p.id === 'pack_pro';
                        const isVip = p.id === 'pack_vip';
                        const PackIcon = p.id === 'pack_starter' ? Zap
                          : p.id === 'pack_confort' ? BarChart3
                          : isPopular ? TrendingUp
                          : Crown;
                        const gradient = p.id === 'pack_starter' ? 'from-emerald-500 to-teal-500'
                          : isPopular ? 'from-accent to-[#E91E63]'
                          : isVip ? 'from-purple-500 to-fuchsia-500'
                          : 'from-amber-500 to-orange-500';
                        return (
                          <div
                            id={`preview-${p.id}`}
                            key={p.id}
                            className="relative rounded-2xl p-4 border border-white/10 bg-[#0F0F0F] scroll-mt-4 overflow-hidden"
                          >
                            {savings > 0 && (
                              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] bg-green-500/15 text-green-400 border border-green-500/30">
                                -{savings}%
                              </div>
                            )}
                            <div className={`inline-flex p-2 rounded-xl bg-gradient-to-br ${gradient} mb-2`}>
                              <PackIcon className="h-5 w-5 text-white" />
                            </div>
                            <p className="text-sm font-medium text-white">{p.label}</p>
                            <p className="text-[10px] text-white/40">{p.credits} crédits</p>
                            <div className="mt-2 mb-2">
                              <span className="text-2xl font-light text-white">{p.price.toFixed(2)}</span>
                              <span className="text-xs text-white/40 ml-1">CHF</span>
                            </div>
                            <p className="text-[10px] text-accent">{ratio > 0 ? ratio.toFixed(3) : '0.000'} CHF/crédit</p>
                            <div className={`mt-3 h-8 rounded-full bg-gradient-to-r ${gradient} flex items-center justify-center text-[11px] text-white font-medium`}>
                              Acheter
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              {/* BUG #101 — Aperçu /premium FIDÈLE au rendu client.
                  Reproduction des cards stylisées du panneau /premium : Crown
                  icon centrée, gros prix, features list avec icônes accent,
                  bouton "S'abonner". Le plan annuel a l'accent feature, le mois
                  a le badge Populaire. Conditionnel par carte. */}
              {(() => {
                const premiums = pricing.filter(p => p.id.startsWith('premium_') && p.isActive);
                const visible = premiums.filter(p => visiblePreviewIds.has(`preview-${p.id}`));
                if (visible.length === 0) return null;
                return (
                  <>
                    <p id="preview-premium" className="text-xs text-white/30 uppercase tracking-wider mt-3 flex items-center gap-2 scroll-mt-4 rounded-md p-1">
                      <span>👑 Aperçu /premium — Plans Spordateur</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {visible.map(p => {
                        const interval =
                          p.id === 'premium_24h' ? '24h' :
                          p.id === 'premium_week' ? '7 jours' :
                          p.id === 'premium_month' ? 'mois' :
                          p.id === 'premium_year' ? 'an' :
                          p.interval || '';
                        const isFeatured = p.id === 'premium_year';
                        const isPopular = p.id === 'premium_month';
                        const monthly = pricing.find(x => x.id === 'premium_month');
                        const yearlySavings = isFeatured && monthly && monthly.price > 0
                          ? Math.round((1 - p.price / (monthly.price * 12)) * 100)
                          : 0;
                        return (
                          <div
                            id={`preview-${p.id}`}
                            key={p.id}
                            className={`relative rounded-2xl p-4 border scroll-mt-4 ${
                              isFeatured ? 'border-accent/50 bg-gradient-to-br from-zinc-900 to-black shadow-xl shadow-accent/10' :
                              isPopular ? 'border-accent/30 bg-gradient-to-br from-zinc-900/80 to-black' :
                              'border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-black'
                            }`}
                          >
                            {yearlySavings > 0 && (
                              <div className="absolute -top-2 left-3 z-10 px-2 py-0.5 rounded-full text-[10px] bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30">
                                -{yearlySavings}%
                              </div>
                            )}
                            {isPopular && (
                              <div className="absolute -top-2 right-3 z-10 px-2 py-0.5 rounded-full text-[10px] bg-accent text-white shadow-lg shadow-accent/30">
                                Populaire
                              </div>
                            )}
                            <div className="flex justify-center mb-3">
                              <div className={`p-2 rounded-2xl ${isFeatured ? 'bg-accent/10' : 'bg-zinc-800'}`}>
                                <Crown className={`h-6 w-6 ${isFeatured ? 'text-accent' : 'text-gray-400'}`} />
                              </div>
                            </div>
                            <p className="text-sm text-center text-white font-light">{p.label}</p>
                            <div className="text-center mt-2">
                              <span className="text-3xl font-light text-white">{p.price % 1 === 0 ? p.price : p.price.toFixed(2)}</span>
                              <span className="text-xs text-white/40 ml-1">CHF / {interval}</span>
                            </div>
                            {isFeatured && (
                              <p className="text-center text-[10px] text-accent mt-1">
                                ~{(p.price / 12).toFixed(2)} CHF / mois
                              </p>
                            )}
                            <div className="mt-3 space-y-1.5">
                              <div className="flex items-center gap-2 text-[11px] text-white/70"><Zap className="h-3 w-3 text-accent" /> Likes illimités</div>
                              <div className="flex items-center gap-2 text-[11px] text-white/70"><Eye className="h-3 w-3 text-accent" /> Voir qui m&apos;a liké</div>
                              <div className="flex items-center gap-2 text-[11px] text-white/70"><Crown className="h-3 w-3 text-accent" /> {p.credits} crédits inclus</div>
                            </div>
                            <div className={`mt-3 h-8 rounded-full flex items-center justify-center text-[11px] font-medium ${
                              isFeatured ? 'bg-accent text-white shadow-lg shadow-accent/30' : 'bg-zinc-800 text-white border border-zinc-700'
                            }`}>
                              S&apos;abonner
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              {/* BUG #101 — Aperçu Partenaire (carte fidèle au rendu /partner/login).
                  Seule la carte partner_monthly est affichable si l'admin clique
                  l'œil correspondant. Style identique au panneau Premium client. */}
              {(() => {
                const partner = pricing.find(p => p.id === 'partner_monthly' && p.isActive);
                if (!partner || !visiblePreviewIds.has(`preview-${partner.id}`)) return null;
                return (
                  <>
                    <p className="text-xs text-white/30 uppercase tracking-wider mt-3 flex items-center gap-2 rounded-md p-1">
                      <span>💼 Aperçu Partenaire Pro</span>
                    </p>
                    <div
                      id={`preview-${partner.id}`}
                      className="rounded-2xl p-5 border border-accent/40 bg-gradient-to-br from-zinc-900 to-black shadow-xl shadow-accent/10 scroll-mt-4"
                    >
                      <div className="flex justify-center mb-3">
                        <div className="p-3 rounded-2xl bg-accent/10">
                          <Building2 className="h-8 w-8 text-accent" />
                        </div>
                      </div>
                      <p className="text-center text-base font-light text-white">{partner.label}</p>
                      <div className="text-center mt-3">
                        <span className="text-4xl font-light text-white">{partner.price.toFixed(0)}</span>
                        <span className="text-sm text-white/40 ml-1">CHF / mois</span>
                      </div>
                      <p className="text-[11px] text-white/40 text-center mt-3">Pour coachs, clubs et lieux sportifs</p>
                    </div>
                  </>
                );
              })()}

              {/* BUG #101 — Empty state global si rien à afficher (aucun œil actif).
                  Évite que le panneau reste vide sans signal pour l'admin. */}
              {visiblePreviewIds.size === 0 && (
                <div className="border-t border-white/5 pt-6 mt-4 text-center">
                  <Eye className="h-8 w-8 text-white/10 mx-auto mb-2" />
                  <p className="text-[11px] text-white/30 italic">
                    Clique sur 👁 d&apos;une carte Pack, Premium ou Partenaire pour visualiser ici son rendu côté client.
                  </p>
                </div>
              )}
              <p className="text-[11px] text-white/20 text-center mt-4 border-t border-white/5 pt-4">
                Aperçu fidèle des pages <span className="text-white/40">/payment</span> et <span className="text-white/40">/premium</span>. Modifie le prix dans une carte éditeur à gauche, clique « Sauvegarder » pour appliquer en prod.
              </p>
            </div>
          </div>
        )}

        {/* ===== SITE CONFIG — TOUT MODIFIABLE ===== */}
        {tab === 'site' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between sticky top-0 z-10 bg-black py-2">
              <h3 className="text-base text-white font-medium">Page d'accueil — Tout modifier</h3>
              <Button onClick={saveSiteConfig} disabled={siteSaving} className="bg-accent hover:bg-accent/80 text-white h-10 text-xs">
                {siteSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Settings className="h-4 w-4 mr-1" />}
                Sauvegarder tout
              </Button>
            </div>

            {/* Phase 9.5 c8 — Feature flags : toggle Rencontres */}
            <DiscoveryToggleCard />

            {/* Phase 9.5 c29a CH2 — Migration pricingTiers vide */}
            <MigratePricingTiersCard />

            {/* Phase 9.5 c34 BUG#5 — Migration Activity.partnerId legacy → user.uid */}
            <MigrateActivityPartnerCard />

            {/* Phase 9.5 c36 — Migration boosts.partnerId "partner-{uid}" → "{uid}" */}
            <MigrateBoostPartnerCard />

            {/* Phase 9.5 c39 — Dedupe matches/ legacy (auto-id) → deterministic ID */}
            <DedupeMatchesCard />


            {/* Fix #128 — Logos unifiés (PWA, favicon, Apple, splash, monochrome) */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-4">
                <div>
                  <span className="text-sm text-white font-medium">Logos du site</span>
                  <p className="text-[11px] text-white/40 font-light mt-0.5">
                    Une seule commande pour toutes les icônes : favicon, PWA standard, maskable
                    Android, Apple Touch, monochrome, splash screen. Uploade un logo source (PNG
                    transparent 1024×1024 idéalement), le système génère et applique automatiquement
                    tous les formats sur le site.
                  </p>
                </div>
                <BrandLogoManager brand={brand} onUpdated={setBrand} />
              </CardContent>
            </Card>

            {/* Couleur */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">Couleur principale</span>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="color" value={siteConfig.primaryColor} onChange={e => updateSite('primaryColor', e.target.value)} className="w-12 h-12 rounded-lg border border-white/10 bg-transparent cursor-pointer" />
                  <Input value={siteConfig.primaryColor} onChange={e => updateSite('primaryColor', e.target.value)} className="bg-black border-white/15 h-11 text-white font-mono w-32" />
                  <div className="flex gap-2">
                    {['var(--accent-color)', '#E91E63', '#7B1FA2', '#FF6B35', '#00BCD4', '#4CAF50'].map(c => (
                      <button key={c} onClick={() => updateSite('primaryColor', c)} className="w-8 h-8 rounded-lg border border-white/10 hover:scale-110 transition" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Hero */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">Section Hero (haut de page)</span>
                <div><label className="text-[11px] text-white/40 block mb-1">Ligne 1</label><Input value={siteConfig.heroTitle1} onChange={e => updateSite('heroTitle1', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Ligne 2</label><Input value={siteConfig.heroTitle2} onChange={e => updateSite('heroTitle2', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Ligne 3 (colorée)</label><Input value={siteConfig.heroTitle3} onChange={e => updateSite('heroTitle3', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Sous-titre</label><Input value={siteConfig.heroSubtitle} onChange={e => updateSite('heroSubtitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Texte bouton</label><Input value={siteConfig.ctaText} onChange={e => updateSite('ctaText', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div>
                  <label className="text-[11px] text-white/40 block mb-1">Image de fond Hero (URL)</label>
                  <Input value={siteConfig.heroImage} onChange={e => updateSite('heroImage', e.target.value)} placeholder="https://..." className="bg-black border-white/15 h-11 text-white text-xs" />
                  {siteConfig.heroImage && <img src={siteConfig.heroImage} alt="hero" className="mt-2 h-20 w-full object-cover rounded-lg opacity-60" />}
                </div>
              </CardContent>
            </Card>

            {/* 3 Étapes */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">3 Étapes</span>
                {[
                  { title: 'step1Title', desc: 'step1Desc', img: 'step1Image', num: '01' },
                  { title: 'step2Title', desc: 'step2Desc', img: 'step2Image', num: '02' },
                  { title: 'step3Title', desc: 'step3Desc', img: 'step3Image', num: '03' },
                ].map(s => (
                  <div key={s.num} className="border-t border-white/5 pt-3 space-y-2">
                    <span className="text-[10px] text-white/20 font-mono">{s.num}</span>
                    <Input value={siteConfig[s.title]} onChange={e => updateSite(s.title as keyof SiteConfig, e.target.value)} placeholder="Titre" className="bg-black border-white/15 h-10 text-white text-sm" />
                    <Input value={siteConfig[s.desc]} onChange={e => updateSite(s.desc as keyof SiteConfig, e.target.value)} placeholder="Description" className="bg-black border-white/15 h-10 text-white text-sm" />
                    <div>
                      <label className="text-[10px] text-white/30 block mb-1">Image (URL)</label>
                      <Input value={siteConfig[s.img]} onChange={e => updateSite(s.img as keyof SiteConfig, e.target.value)} placeholder="https://..." className="bg-black border-white/15 h-10 text-white text-xs" />
                      {siteConfig[s.img] && <img src={siteConfig[s.img]} alt={s.num} className="mt-1 h-16 w-32 object-cover rounded" />}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Section Activités */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">Section Activités</span>
                <div><label className="text-[11px] text-white/40 block mb-1">Titre section</label><Input value={siteConfig.sectionTitle} onChange={e => updateSite('sectionTitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Sous-titre</label><Input value={siteConfig.sectionSubtitle} onChange={e => updateSite('sectionSubtitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
              </CardContent>
            </Card>

            {/* CTA Final */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">Section finale (bas de page)</span>
                <div><label className="text-[11px] text-white/40 block mb-1">Titre</label><Input value={siteConfig.ctaFinalTitle} onChange={e => updateSite('ctaFinalTitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Sous-titre</label><Input value={siteConfig.ctaFinalSubtitle} onChange={e => updateSite('ctaFinalSubtitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Texte bouton</label><Input value={siteConfig.ctaFinalButton} onChange={e => updateSite('ctaFinalButton', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
              </CardContent>
            </Card>

            {/* Témoignages */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">Témoignages</span>
                <div><label className="text-[11px] text-white/40 block mb-1">Titre section</label><Input value={siteConfig.testimonialsTitle} onChange={e => updateSite('testimonialsTitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="border-t border-white/5 pt-3 space-y-2">
                    <span className="text-[10px] text-white/20 font-mono">Témoignage {i}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={siteConfig[`testimonial${i}Name`]} onChange={e => updateSite(`testimonial${i}Name` as keyof SiteConfig, e.target.value)} placeholder="Nom" className="bg-black border-white/15 h-10 text-white text-sm" />
                      <Input value={siteConfig[`testimonial${i}City`]} onChange={e => updateSite(`testimonial${i}City` as keyof SiteConfig, e.target.value)} placeholder="Ville" className="bg-black border-white/15 h-10 text-white text-sm" />
                    </div>
                    <Input value={siteConfig[`testimonial${i}Text`]} onChange={e => updateSite(`testimonial${i}Text` as keyof SiteConfig, e.target.value)} placeholder="Témoignage..." className="bg-black border-white/15 h-10 text-white text-sm" />
                    <Input value={siteConfig[`testimonial${i}Sport`]} onChange={e => updateSite(`testimonial${i}Sport` as keyof SiteConfig, e.target.value)} placeholder="Sport" className="bg-black border-white/15 h-10 text-white text-sm w-40" />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Section Suisse */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">Section Suisse</span>
                <div><label className="text-[11px] text-white/40 block mb-1">Titre</label><Input value={siteConfig.swissTitle} onChange={e => updateSite('swissTitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Sous-titre</label><Input value={siteConfig.swissSubtitle} onChange={e => updateSite('swissSubtitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div>
                  <label className="text-[11px] text-white/40 block mb-1">Villes (séparées par virgule)</label>
                  <Input value={siteConfig.swissCities} onChange={e => updateSite('swissCities', e.target.value)} placeholder="Geneve,Zurich,Lausanne..." className="bg-black border-white/15 h-11 text-white text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-white/40 block mb-1">Image (URL)</label>
                  <Input value={siteConfig.swissImage} onChange={e => updateSite('swissImage', e.target.value)} placeholder="https://..." className="bg-black border-white/15 h-11 text-white text-xs" />
                  {siteConfig.swissImage && <img src={siteConfig.swissImage} alt="swiss" className="mt-1 h-16 w-32 object-cover rounded" />}
                </div>
              </CardContent>
            </Card>

            {/* Section Partenaires */}
            <Card className="bg-[#111] border-white/10">
              <CardContent className="p-4 space-y-3">
                <span className="text-sm text-white font-medium">Section Partenaires</span>
                <div><label className="text-[11px] text-white/40 block mb-1">Titre</label><Input value={siteConfig.partnerTitle} onChange={e => updateSite('partnerTitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div><label className="text-[11px] text-white/40 block mb-1">Sous-titre</label><Input value={siteConfig.partnerSubtitle} onChange={e => updateSite('partnerSubtitle', e.target.value)} className="bg-black border-white/15 h-11 text-white" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[11px] text-white/40 block mb-1">Bouton 1</label><Input value={siteConfig.partnerCta1} onChange={e => updateSite('partnerCta1', e.target.value)} className="bg-black border-white/15 h-10 text-white text-sm" /></div>
                  <div><label className="text-[11px] text-white/40 block mb-1">Bouton 2</label><Input value={siteConfig.partnerCta2} onChange={e => updateSite('partnerCta2', e.target.value)} className="bg-black border-white/15 h-10 text-white text-sm" /></div>
                </div>
              </CardContent>
            </Card>

            {/* Aperçu rapide */}
            <Card className="bg-[#0A0A0A] border-white/10">
              <CardContent className="p-5 space-y-4">
                <span className="text-xs text-white/30 uppercase tracking-wider">Aperçu hero</span>
                <div className="relative h-32 rounded-xl overflow-hidden">
                  <img src={siteConfig.heroImage} alt="hero" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                  <div className="relative z-10 p-4">
                    <p className="text-lg font-light text-white">{siteConfig.heroTitle1} {siteConfig.heroTitle2} <span style={{ color: siteConfig.primaryColor }}>{siteConfig.heroTitle3}</span></p>
                    <button className="mt-2 px-4 py-1 rounded-full text-white text-xs" style={{ backgroundColor: siteConfig.primaryColor }}>{siteConfig.ctaText}</button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <p className="text-[11px] text-white/20 text-center pb-8">Cliquez "Sauvegarder tout" pour appliquer les changements sur le site.</p>
          </div>
        )}

        {/* ===== NOTIFICATIONS ===== */}
        {tab === 'settings' && (
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-5 space-y-4">
              <h3 className="text-sm text-white/50">Envoyer une notification à tous les utilisateurs</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-white/30 block mb-1">Titre</label>
                  <Input value={notifTitle} onChange={e => setNotifTitle(e.target.value)} placeholder="Il reste 3 places ce soir !" className="bg-black border-white/10 h-11" />
                </div>
                <div>
                  <label className="text-xs text-white/30 block mb-1">Message</label>
                  <Input value={notifBody} onChange={e => setNotifBody(e.target.value)} placeholder="Réserve ta place pour la Zumba de ce soir" className="bg-black border-white/10 h-11" />
                </div>
                <Button onClick={sendNotification} disabled={!notifTitle} className="bg-accent hover:bg-accent/80 text-white h-11"><Send className="h-4 w-4 mr-2" /> Envoyer à {users.length} utilisateurs</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== ERRORS ===== */}
        {tab === 'errors' && (
          <div className="space-y-2">
            {errors.length === 0 && <p className="text-white/30 text-center py-8">Aucune erreur non résolue</p>}
            {errors.map(e => (
              <Card key={e.logId} className="bg-[#1A1A1A] border-white/5">
                <CardContent className="p-3 flex items-start gap-3">
                  <Bug className={`h-4 w-4 mt-0.5 flex-shrink-0 ${e.level === 'error' ? 'text-red-400' : 'text-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/70 break-all">{e.message}</p>
                    <p className="text-[10px] text-white/20">{e.source}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => resolveError(e.logId)} className="border-green-500/20 text-green-400 text-xs h-7">Résoudre</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

/**
 * Phase 9.5 c8 + c21 — Mode "Rencontres" 3-state (settings/features.discoveryMode).
 * Pattern POST /api/admin/site/discovery-toggle Bearer auth + audit log adminActions.
 */
type DiscoveryMode = 'disabled' | 'participants-only' | 'open-to-all';

const DISCOVERY_MODE_OPTIONS: ReadonlyArray<{
  value: DiscoveryMode;
  label: string;
  description: string;
}> = [
  {
    value: 'disabled',
    label: 'Désactivé',
    description: 'Page Rencontres cachée + nav item masqué. /discovery redirige vers /activities. Default au launch.',
  },
  {
    value: 'participants-only',
    label: 'Participants uniquement (recommandé)',
    description: 'Page visible. Users affichés UNIQUEMENT ceux qui ont au moins 1 réservation confirmée sur une activité dont le partner a opt-in (toggle côté /partner/dashboard).',
  },
  {
    value: 'open-to-all',
    label: 'Ouvert à tous',
    description: 'Page visible. TOUS les users inscrits + actifs sont dans le swipe pool (legacy comportement c8).',
  },
];

function DiscoveryToggleCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { discoveryMode, loading } = useFeatureFlags();
  const [saving, setSaving] = useState(false);

  const handleSelectMode = async (next: DiscoveryMode) => {
    if (!user) {
      toast({ title: 'Non authentifié', variant: 'destructive' });
      return;
    }
    if (next === discoveryMode) return; // no-op
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/site/discovery-toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ mode: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'Échec changement mode',
          description: data?.detail || data?.error || 'Réessaie.',
          variant: 'destructive',
        });
        return;
      }
      const opt = DISCOVERY_MODE_OPTIONS.find((o) => o.value === next);
      toast({
        title: `Mode Rencontres : ${opt?.label || next}`,
        description: opt?.description || '',
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[DiscoveryToggle]', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-[#111] border-white/10">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-white font-medium">Mode page Rencontres</span>
          <span className="text-[11px] text-white/50">
            3 niveaux d&apos;activation pour la page /discovery (swipe matching entre users).
          </span>
        </div>
        <div role="radiogroup" aria-label="Mode Rencontres" className="flex flex-col gap-2">
          {DISCOVERY_MODE_OPTIONS.map((opt) => {
            const selected = discoveryMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={loading || saving}
                onClick={() => handleSelectMode(opt.value)}
                className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${
                  selected
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-white/10 bg-zinc-900/40 hover:border-white/20'
                } disabled:opacity-50`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-accent bg-accent' : 'border-white/30'
                  }`}
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className={`text-sm font-medium ${selected ? 'text-accent' : 'text-white'}`}>
                    {opt.label}
                  </span>
                  <span className="text-[11px] text-white/50">{opt.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        {saving && (
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <Loader2 className="h-3 w-3 animate-spin" />
            Mise à jour…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =========================================================================
 * Phase 9.5 c29a CH2 — Bouton migration sessions legacy pricingTiers vide.
 * POST /api/admin/migrate-pricing (Bearer auth + admin role + audit log).
 * Confirme avant write réel : run dryRun d'abord, affiche le rapport, puis
 * propose de confirmer pour appliquer.
 * ========================================================================= */
function MigratePricingTiersCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<{
    dryRun: boolean;
    totalScanned: number;
    totalMigrated: number;
    totalSkipped: number;
    errors: Array<{ sessionId: string; reason: string }>;
  } | null>(null);

  const runMigration = async (dryRun: boolean) => {
    if (!user) {
      toast({ title: 'Non authentifié', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/migrate-pricing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'Migration échouée',
          description: data?.detail || data?.error || 'Réessaie.',
          variant: 'destructive',
        });
        return;
      }
      setReport({
        dryRun: data.dryRun,
        totalScanned: data.totalScanned,
        totalMigrated: data.totalMigrated,
        totalSkipped: data.totalSkipped,
        errors: data.errors ?? [],
      });
      toast({
        title: dryRun ? 'Simulation OK' : 'Migration appliquée',
        description: `${data.totalMigrated}/${data.totalScanned} sessions ${dryRun ? 'à migrer' : 'migrées'} (${data.totalSkipped} skip, ${data.errors?.length ?? 0} err).`,
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[MigratePricingTiers]', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="bg-[#111] border-white/10">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-white font-medium">Migrer prix progressifs</span>
          <span className="text-[11px] text-white/50">
            Re-seed pricingTiers (80/100/120% de Activity.price) pour les sessions legacy qui affichent 0/0/0 CHF. Idempotent : skip celles déjà configurées.
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => runMigration(true)}
            disabled={running}
            size="sm"
            variant="outline"
            className="border-white/20 text-white/80 text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Simuler (dry-run)
          </Button>
          <Button
            onClick={() => runMigration(false)}
            disabled={running || !report}
            size="sm"
            className="bg-accent hover:bg-accent/80 text-white text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Appliquer
          </Button>
        </div>
        {report && (
          <div className="mt-2 text-[11px] text-white/60 space-y-1">
            <p>
              <span className="text-white/40">Mode :</span>{' '}
              <span className="text-accent">{report.dryRun ? 'simulation' : 'appliqué'}</span>{' · '}
              <span className="text-white/40">Scanned :</span> {report.totalScanned}{' · '}
              <span className="text-white/40">Migrated :</span> {report.totalMigrated}{' · '}
              <span className="text-white/40">Skip :</span> {report.totalSkipped}
            </p>
            {report.errors.length > 0 && (
              <details className="text-white/40">
                <summary className="cursor-pointer">{report.errors.length} erreur(s)</summary>
                <ul className="pl-4 mt-1 space-y-0.5">
                  {report.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      <span className="text-white/30">{e.sessionId}</span>: {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =========================================================================
 * Phase 9.5 c34 BUG#5 — Bouton migration Activity.partnerId legacy → user.uid.
 * POST /api/admin/migrate-activity-partner. Pour Activities créées avant c33
 * avec partnerId = Partner doc id (≠ user.uid), provoquant un mismatch côté
 * /discovery boost matching et /partner/offers ownership filter.
 * ========================================================================= */
function MigrateActivityPartnerCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<{
    dryRun: boolean;
    totalScanned: number;
    totalMigrated: number;
    totalAlreadyOk: number;
    errors: Array<{ activityId: string; reason: string }>;
  } | null>(null);

  const run = async (dryRun: boolean) => {
    if (!user) {
      toast({ title: 'Non authentifié', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/migrate-activity-partner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'Migration échouée',
          description: data?.detail || data?.error || 'Réessaie.',
          variant: 'destructive',
        });
        return;
      }
      setReport({
        dryRun: data.dryRun,
        totalScanned: data.totalScanned,
        totalMigrated: data.totalMigrated,
        totalAlreadyOk: data.totalAlreadyOk,
        errors: data.errors ?? [],
      });
      toast({
        title: dryRun ? 'Simulation OK' : 'Migration appliquée',
        description: `${data.totalMigrated}/${data.totalScanned} activities ${dryRun ? 'à migrer' : 'migrées'} (${data.totalAlreadyOk} déjà OK, ${data.errors?.length ?? 0} err).`,
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[MigrateActivityPartner]', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="bg-[#111] border-white/10">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-white font-medium">Migrer Activity.partnerId legacy</span>
          <span className="text-[11px] text-white/50">
            Réassigne les Activities dont partnerId pointe vers un Partner doc id (legacy) vers le user.uid correspondant. Idempotent : skip celles déjà OK. Nécessaire pour que boosts c33+ matchent les activités.
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => run(true)}
            disabled={running}
            size="sm"
            variant="outline"
            className="border-white/20 text-white/80 text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Simuler (dry-run)
          </Button>
          <Button
            onClick={() => run(false)}
            disabled={running || !report}
            size="sm"
            className="bg-accent hover:bg-accent/80 text-white text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Appliquer
          </Button>
        </div>
        {report && (
          <div className="mt-2 text-[11px] text-white/60 space-y-1">
            <p>
              <span className="text-white/40">Mode :</span>{' '}
              <span className="text-accent">{report.dryRun ? 'simulation' : 'appliqué'}</span>{' · '}
              <span className="text-white/40">Scanned :</span> {report.totalScanned}{' · '}
              <span className="text-white/40">Migrated :</span> {report.totalMigrated}{' · '}
              <span className="text-white/40">OK :</span> {report.totalAlreadyOk}
            </p>
            {report.errors.length > 0 && (
              <details className="text-white/40">
                <summary className="cursor-pointer">{report.errors.length} erreur(s)</summary>
                <ul className="pl-4 mt-1 space-y-0.5">
                  {report.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      <span className="text-white/30">{e.activityId}</span>: {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =========================================================================
 * Phase 9.5 c36 — Bouton migration boosts.partnerId "partner-{uid}" → "{uid}".
 * POST /api/admin/migrate-boost-partner. Pour boosts créés pré-c33 via Stripe
 * flow où le client envoyait state.partnerId = "partner-{uid}" (convention
 * Partner doc id). Symétrique à MigrateActivityPartnerCard.
 * ========================================================================= */
function MigrateBoostPartnerCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<{
    dryRun: boolean;
    totalScanned: number;
    totalMigrated: number;
    totalAlreadyOk: number;
    errors: Array<{ boostId: string; reason: string }>;
  } | null>(null);

  const run = async (dryRun: boolean) => {
    if (!user) {
      toast({ title: 'Non authentifié', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/migrate-boost-partner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'Migration échouée',
          description: data?.detail || data?.error || 'Réessaie.',
          variant: 'destructive',
        });
        return;
      }
      setReport({
        dryRun: data.dryRun,
        totalScanned: data.totalScanned,
        totalMigrated: data.totalMigrated,
        totalAlreadyOk: data.totalAlreadyOk,
        errors: data.errors ?? [],
      });
      toast({
        title: dryRun ? 'Simulation OK' : 'Migration appliquée',
        description: `${data.totalMigrated}/${data.totalScanned} boosts ${dryRun ? 'à migrer' : 'migrés'} (${data.totalAlreadyOk} déjà OK, ${data.errors?.length ?? 0} err).`,
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[MigrateBoostPartner]', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="bg-[#111] border-white/10">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-white font-medium">Migrer boosts.partnerId legacy</span>
          <span className="text-[11px] text-white/50">
            Strip le préfixe &quot;partner-&quot; des boosts/{'{X}'}.partnerId (legacy pré-c33 via Stripe). Idempotent : skip ceux déjà OK. Nécessaire pour que /partner/boost et /discovery matchent les boosts post-c33.
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => run(true)}
            disabled={running}
            size="sm"
            variant="outline"
            className="border-white/20 text-white/80 text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Simuler (dry-run)
          </Button>
          <Button
            onClick={() => run(false)}
            disabled={running || !report}
            size="sm"
            className="bg-accent hover:bg-accent/80 text-white text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Appliquer
          </Button>
        </div>
        {report && (
          <div className="mt-2 text-[11px] text-white/60 space-y-1">
            <p>
              <span className="text-white/40">Mode :</span>{' '}
              <span className="text-accent">{report.dryRun ? 'simulation' : 'appliqué'}</span>{' · '}
              <span className="text-white/40">Scanned :</span> {report.totalScanned}{' · '}
              <span className="text-white/40">Migrated :</span> {report.totalMigrated}{' · '}
              <span className="text-white/40">OK :</span> {report.totalAlreadyOk}
            </p>
            {report.errors.length > 0 && (
              <details className="text-white/40">
                <summary className="cursor-pointer">{report.errors.length} erreur(s)</summary>
                <ul className="pl-4 mt-1 space-y-0.5">
                  {report.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      <span className="text-white/30">{e.boostId}</span>: {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =========================================================================
 * Phase 9.5 c39 — Bouton dedupe matches/ legacy (auto-id) → deterministic ID.
 * POST /api/admin/dedupe-matches. Pour matches créés pré-c39 avec auto-id qui
 * causaient des doublons sur re-click chat direct. Migration les copie vers
 * matches/{sortedUids[0]_sortedUids[1]} + supprime les doublons.
 * ========================================================================= */
function DedupeMatchesCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<{
    dryRun: boolean;
    totalScanned: number;
    totalGroups: number;
    totalKept: number;
    totalDeleted: number;
    totalMigrated: number;
    errors: Array<{ matchId: string; reason: string }>;
  } | null>(null);

  const run = async (dryRun: boolean) => {
    if (!user) {
      toast({ title: 'Non authentifié', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/dedupe-matches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'Dedupe échoué',
          description: data?.detail || data?.error || 'Réessaie.',
          variant: 'destructive',
        });
        return;
      }
      setReport({
        dryRun: data.dryRun,
        totalScanned: data.totalScanned,
        totalGroups: data.totalGroups,
        totalKept: data.totalKept,
        totalDeleted: data.totalDeleted,
        totalMigrated: data.totalMigrated,
        errors: data.errors ?? [],
      });
      toast({
        title: dryRun ? 'Simulation OK' : 'Dedupe appliqué',
        description: `${data.totalKept} gardés / ${data.totalDeleted} supprimés / ${data.totalMigrated} migrés (${data.totalGroups} paires uniques, ${data.errors?.length ?? 0} err).`,
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
    } catch (err) {
      console.error('[DedupeMatches]', err);
      toast({ title: 'Erreur réseau', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="bg-[#111] border-white/10">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-white font-medium">Dedupe matches/ legacy</span>
          <span className="text-[11px] text-white/50">
            Nettoie les doublons matches/ (créés avant c39 avec auto-id). Migre vers deterministic ID {'{'}sortedUids[0]{'}'}_{'{'}sortedUids[1]{'}'} + force chatUnlocked:true sur le gardé. Idempotent.
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => run(true)}
            disabled={running}
            size="sm"
            variant="outline"
            className="border-white/20 text-white/80 text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Simuler (dry-run)
          </Button>
          <Button
            onClick={() => run(false)}
            disabled={running || !report}
            size="sm"
            className="bg-accent hover:bg-accent/80 text-white text-xs h-9"
          >
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Appliquer
          </Button>
        </div>
        {report && (
          <div className="mt-2 text-[11px] text-white/60 space-y-1">
            <p>
              <span className="text-white/40">Mode :</span>{' '}
              <span className="text-accent">{report.dryRun ? 'simulation' : 'appliqué'}</span>{' · '}
              <span className="text-white/40">Scanned :</span> {report.totalScanned}{' · '}
              <span className="text-white/40">Paires :</span> {report.totalGroups}{' · '}
              <span className="text-white/40">Kept :</span> {report.totalKept}{' · '}
              <span className="text-white/40">Deleted :</span> {report.totalDeleted}{' · '}
              <span className="text-white/40">Migrated :</span> {report.totalMigrated}
            </p>
            {report.errors.length > 0 && (
              <details className="text-white/40">
                <summary className="cursor-pointer">{report.errors.length} erreur(s)</summary>
                <ul className="pl-4 mt-1 space-y-0.5">
                  {report.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      <span className="text-white/30">{e.matchId}</span>: {e.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
