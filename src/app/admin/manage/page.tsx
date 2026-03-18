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
  Plus, Minus, Send, BarChart3, Zap, Crown
} from 'lucide-react';
import { useAuth } from "@/context/AuthContext";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, getDocs, doc, updateDoc, deleteDoc, setDoc, addDoc,
  serverTimestamp, orderBy, limit, where, increment
} from 'firebase/firestore';
import { useToast } from "@/hooks/use-toast";
import Link from 'next/link';

type Tab = 'cockpit' | 'users' | 'partners' | 'credits' | 'promos' | 'settings' | 'tarifs' | 'errors';

interface UserItem { uid: string; displayName: string; email: string; role: string; city: string; isPremium: boolean; credits: number; isVisible?: boolean; createdAt: any; }
interface PartnerItem { partnerId: string; name: string; city: string; isActive: boolean; isApproved: boolean; totalBookings: number; totalRevenue: number; }
interface TxItem { transactionId: string; userId: string; amount: number; status: string; package: string; paymentMethod: string; createdAt: any; }
interface ErrorItem { logId: string; message: string; source: string; level: string; resolved: boolean; createdAt: any; }
interface PricingItem { id: string; label: string; price: number; credits: number; type: string; interval?: string; isActive: boolean; }

export default function AdminManagePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('cockpit');
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [partners, setPartners] = useState<PartnerItem[]>([]);
  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [pricingSaving, setPricingSaving] = useState(false);
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

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }
    loadAll();
  }, [user]);

  const loadAll = async () => {
    if (!db) return;
    try {
      // Always set default pricing first
      const defaults: PricingItem[] = [
        { id: '1_date', label: 'Starter', price: 10, credits: 1, type: 'one_time', isActive: true },
        { id: '3_dates', label: 'Populaire', price: 25, credits: 3, type: 'one_time', isActive: true },
        { id: '10_dates', label: 'Premium', price: 60, credits: 10, type: 'one_time', isActive: true },
        { id: 'premium_monthly', label: 'Premium Mensuel', price: 19.90, credits: 5, type: 'subscription', interval: 'month', isActive: true },
        { id: 'premium_yearly', label: 'Premium Annuel', price: 149, credits: 60, type: 'subscription', interval: 'year', isActive: true },
        { id: 'partner_monthly', label: 'Partenaire', price: 49, credits: 0, type: 'subscription', interval: 'month', isActive: true },
      ];
      setPricing(defaults);

      const [uSnap, pSnap, tSnap, eSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(200))),
        getDocs(query(collection(db, 'partners'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(100))),
        getDocs(query(collection(db, 'errorLogs'), where('resolved', '==', false), orderBy('createdAt', 'desc'), limit(50))),
      ]);
      setUsers(uSnap.docs.map(d => ({ ...d.data(), uid: d.id } as UserItem)));
      setPartners(pSnap.docs.map(d => d.data() as PartnerItem));
      setTransactions(tSnap.docs.map(d => d.data() as TxItem));
      setErrors(eSnap.docs.map(d => d.data() as ErrorItem));
      // Load saved pricing from settings/pricing (single source of truth)
      try {
        const { getDoc } = await import('firebase/firestore');
        const settingsSnap = await getDoc(doc(db, 'settings', 'pricing'));
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          if (data?.packages) {
            const loaded = defaults.map(d => {
              const saved = (data.packages as Record<string, any>)[d.id];
              if (!saved) return d;
              return {
                ...d,
                price: saved.price ? saved.price / 100 : d.price, // centimes → CHF
                credits: saved.credits ?? d.credits,
                label: saved.label || d.label,
                isActive: saved.isActive !== false,
              };
            });
            setPricing(loaded);
          }
        }
      } catch { /* Firestore rules may block — use defaults */ }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // Stats
  const totalRevenue = transactions.filter(t => t.status === 'succeeded').reduce((s, t) => s + (t.amount || 0), 0) / 100;
  const totalUsers = users.length;
  const premiumUsers = users.filter(u => u.isPremium).length;
  const activePartners = partners.filter(p => p.isActive).length;
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
    if (!db || !confirm(`Supprimer ${name} ?`)) return;
    await deleteDoc(doc(db, 'users', uid));
    setUsers(users.filter(u => u.uid !== uid));
    toast({ title: 'Supprimé' });
  };
  const togglePartner = async (pid: string, field: 'isActive' | 'isApproved', cur: boolean) => {
    if (!db) return;
    await updateDoc(doc(db, 'partners', pid), { [field]: !cur, updatedAt: serverTimestamp() });
    setPartners(partners.map(p => p.partnerId === pid ? { ...p, [field]: !cur } : p));
    toast({ title: 'Mis à jour' });
  };
  const adjustCredits = async (add: boolean) => {
    if (!db || !creditUserId) return;
    const amt = parseInt(creditAmount) || 1;
    const val = add ? amt : -amt;
    await updateDoc(doc(db, 'users', creditUserId), { credits: increment(val), updatedAt: serverTimestamp() });
    toast({ title: `${add ? '+' : '-'}${amt} crédits → ${creditUserId.substring(0, 8)}...` });
    setCreditUserId(''); setCreditAmount('1');
    await loadAll();
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
    const batch: Promise<void>[] = [];
    for (const u of users.slice(0, 500)) {
      const ref = doc(collection(db, 'notifications'));
      batch.push(setDoc(ref, {
        notificationId: ref.id, userId: u.uid, type: 'system',
        title: notifTitle, body: notifBody, data: {}, isRead: false,
        createdAt: serverTimestamp(),
      }));
    }
    await Promise.all(batch);
    toast({ title: `Notification envoyée à ${Math.min(users.length, 500)} utilisateurs` });
    setNotifTitle(''); setNotifBody('');
  };
  const updatePricing = async (id: string, field: string, value: number | boolean) => {
    if (!db) return;
    const updated = pricing.map(p => p.id === id ? { ...p, [field]: value } : p);
    setPricing(updated);
  };
  const savePricing = async () => {
    if (!db) return;
    setPricingSaving(true);
    try {
      for (const p of pricing) {
        // Remove undefined fields — Firestore rejects them
        const clean: Record<string, any> = { id: p.id, label: p.label, price: p.price, credits: p.credits, type: p.type, isActive: p.isActive };
        if (p.interval) clean.interval = p.interval;
        await setDoc(doc(db, 'pricing', p.id), clean);
      }
      // Also update the checkout API config via a settings doc
      await setDoc(doc(db, 'settings', 'pricing'), {
        packages: pricing.reduce((acc, p) => {
          const pkg: Record<string, any> = { price: Math.round(p.price * 100), credits: p.credits, label: p.label, type: p.type, isActive: p.isActive };
          if (p.interval) pkg.interval = p.interval;
          return { ...acc, [p.id]: pkg };
        }, {}),
        updatedAt: serverTimestamp(),
      });
      toast({ title: 'Tarifs sauvegardés !' });
    } catch (err) { toast({ variant: 'destructive', title: 'Erreur', description: String(err) }); }
    finally { setPricingSaving(false); }
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
    { id: 'partners', label: 'Partenaires', icon: <Building2 className="h-4 w-4" />, count: partners.length },
    { id: 'credits', label: 'Crédits', icon: <CreditCard className="h-4 w-4" /> },
    { id: 'promos', label: 'Promos', icon: <Gift className="h-4 w-4" /> },
    { id: 'tarifs', label: 'Tarifs', icon: <Wallet className="h-4 w-4" /> },
    { id: 'settings', label: 'Notifs', icon: <Bell className="h-4 w-4" /> },
    { id: 'errors', label: 'Erreurs', icon: <Bug className="h-4 w-4" />, count: errors.length },
  ];

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-32 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-light tracking-tight flex items-center gap-2">
              <Shield className="h-6 w-6 text-[#D91CD2]" /> Admin Spordate
            </h1>
          </div>
          <Link href="/admin/revenue"><Button variant="outline" size="sm" className="border-[#D91CD2]/30 text-[#D91CD2] text-xs">Revenus</Button></Link>
        </div>

        {/* Tabs — horizontal scroll on mobile */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap transition-all ${
                tab === t.id ? 'bg-[#D91CD2]/10 border border-[#D91CD2]/30 text-[#D91CD2]' : 'bg-white/5 text-white/40'
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Revenus total', value: `${totalRevenue.toFixed(0)} CHF`, icon: <Wallet className="h-4 w-4 text-[#D91CD2]" /> },
                { label: "Aujourd'hui", value: `${todayRevenue.toFixed(0)} CHF`, icon: <TrendingUp className="h-4 w-4 text-green-400" /> },
                { label: 'Utilisateurs', value: String(totalUsers), icon: <Users className="h-4 w-4 text-blue-400" /> },
                { label: 'Premium', value: String(premiumUsers), icon: <Crown className="h-4 w-4 text-amber-400" /> },
                { label: 'Partenaires', value: String(activePartners), icon: <Building2 className="h-4 w-4 text-cyan-400" /> },
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
          <div className="space-y-2">
            {filteredUsers.map(u => (
              <Card key={u.uid} className="bg-[#1A1A1A] border-white/5">
                <CardContent className="p-3 flex flex-col md:flex-row items-start md:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm text-white truncate">{u.displayName || 'Sans nom'}</span>
                      <Badge className={`text-[9px] ${u.role === 'admin' ? 'bg-red-500/10 text-red-400' : u.role === 'creator' ? 'bg-amber-500/10 text-amber-400' : 'bg-white/5 text-white/30'}`}>{u.role || 'user'}</Badge>
                      {u.isPremium && <Badge className="text-[9px] bg-[#D91CD2]/10 text-[#D91CD2]">Premium</Badge>}
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
                    {u.role !== 'admin' && <button onClick={() => deleteUser(u.uid, u.displayName)} className="w-7 h-7 rounded text-red-400/30 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* ===== PARTNERS ===== */}
        {tab === 'partners' && (
          <div className="space-y-2">
            {filteredPartners.length === 0 && <p className="text-white/30 text-center py-8">Aucun partenaire</p>}
            {filteredPartners.map(p => (
              <Card key={p.partnerId} className="bg-[#1A1A1A] border-white/5">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white">{p.name}</span>
                    <p className="text-[11px] text-white/25">{p.city} · {p.totalBookings || 0} réservations · {(p.totalRevenue || 0).toFixed(0)} CHF</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1"><span className="text-[10px] text-white/20">Visible</span><Switch checked={p.isActive} onCheckedChange={() => togglePartner(p.partnerId, 'isActive', p.isActive)} /></div>
                    <div className="flex items-center gap-1"><span className="text-[10px] text-white/20">Approuvé</span><Switch checked={p.isApproved} onCheckedChange={() => togglePartner(p.partnerId, 'isApproved', p.isApproved)} /></div>
                  </div>
                </CardContent>
              </Card>
            ))}
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
              <Button onClick={createPromo} disabled={!promoCode} className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white h-11"><Gift className="h-4 w-4 mr-2" /> Créer le code promo</Button>
            </CardContent>
          </Card>
        )}

        {/* ===== TARIFS ===== */}
        {tab === 'tarifs' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* LEFT — Éditeur */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base text-white font-medium">Modifier les tarifs</h3>
                <Button onClick={savePricing} disabled={pricingSaving} className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white h-10 text-xs">
                  {pricingSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Settings className="h-4 w-4 mr-1" />}
                  Sauvegarder
                </Button>
              </div>

              <p className="text-xs text-[#D91CD2] uppercase tracking-wider">Crédits</p>
              {pricing.filter(p => p.type === 'one_time').map(p => (
                <Card key={p.id} className={`bg-[#111] border-white/10 ${!p.isActive ? 'border-red-500/20' : ''}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${p.isActive ? 'text-white' : 'text-red-400/60'}`}>{p.label}</span>
                        {!p.isActive && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">OFF</Badge>}
                      </div>
                      <Switch checked={p.isActive} onCheckedChange={(v) => updatePricing(p.id, 'isActive', v)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div><label className="text-[11px] text-white/40 block mb-1">Prix CHF</label><Input type="number" value={p.price} onChange={e => updatePricing(p.id, 'price', parseFloat(e.target.value) || 0)} className="bg-black border-white/15 h-11 text-white text-base" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1">Crédits</label><Input type="number" value={p.credits} onChange={e => updatePricing(p.id, 'credits', parseInt(e.target.value) || 0)} className="bg-black border-white/15 h-11 text-white text-base" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1">Nom</label><Input value={p.label} onChange={e => { const v = e.target.value; setPricing(pricing.map(x => x.id === p.id ? { ...x, label: v } : x)); }} className="bg-black border-white/15 h-11 text-white text-base" /></div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <p className="text-xs text-[#D91CD2] uppercase tracking-wider mt-2">Abonnements</p>
              {pricing.filter(p => p.type === 'subscription').map(p => (
                <Card key={p.id} className={`bg-[#111] border-white/10 ${!p.isActive ? 'border-red-500/20' : ''}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${p.isActive ? 'text-white' : 'text-red-400/60'}`}>{p.label}</span>
                        <Badge className="text-[10px] bg-white/5 text-white/40 border-white/10">{p.interval === 'month' ? '/mois' : '/an'}</Badge>
                        {!p.isActive && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">OFF</Badge>}
                      </div>
                      <Switch checked={p.isActive} onCheckedChange={(v) => updatePricing(p.id, 'isActive', v)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div><label className="text-[11px] text-white/40 block mb-1">Prix CHF</label><Input type="number" step="0.01" value={p.price} onChange={e => updatePricing(p.id, 'price', parseFloat(e.target.value) || 0)} className="bg-black border-white/15 h-11 text-white text-base" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1">Crédits</label><Input type="number" value={p.credits} onChange={e => updatePricing(p.id, 'credits', parseInt(e.target.value) || 0)} className="bg-black border-white/15 h-11 text-white text-base" /></div>
                      <div><label className="text-[11px] text-white/40 block mb-1">Nom</label><Input value={p.label} onChange={e => { const v = e.target.value; setPricing(pricing.map(x => x.id === p.id ? { ...x, label: v } : x)); }} className="bg-black border-white/15 h-11 text-white text-base" /></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* RIGHT — Aperçu en direct */}
            <div className="space-y-4">
              <h3 className="text-base text-white font-medium flex items-center gap-2"><Eye className="h-4 w-4 text-[#D91CD2]" /> Aperçu en direct</h3>

              <p className="text-xs text-white/30 uppercase tracking-wider">Page Crédits</p>
              <div className="space-y-3">
                {pricing.filter(p => p.type === 'one_time' && p.isActive).map(p => (
                  <Card key={p.id} className="bg-[#111] border-white/10 overflow-hidden">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="text-white font-medium text-sm">{p.label}</p>
                        <p className="text-white/30 text-xs">{p.credits} crédit{p.credits > 1 ? 's' : ''}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-light text-white">{p.price} <span className="text-sm text-white/40">CHF</span></p>
                        {p.credits > 1 && <p className="text-[10px] text-[#D91CD2]">{(p.price / p.credits).toFixed(2)} CHF/crédit</p>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <p className="text-xs text-white/30 uppercase tracking-wider mt-2">Page Premium</p>
              <div className="space-y-3">
                {pricing.filter(p => p.type === 'subscription' && p.isActive).map(p => (
                  <Card key={p.id} className="bg-[#111] border-[#D91CD2]/20 overflow-hidden">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="text-white font-medium text-sm">{p.label}</p>
                        <p className="text-white/30 text-xs">{p.credits} crédits · {p.interval === 'month' ? 'par mois' : 'par an'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-light text-[#D91CD2]">{p.price} <span className="text-sm text-white/40">CHF</span></p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <p className="text-[11px] text-white/20 text-center mt-4 border-t border-white/5 pt-4">
                Cet aperçu se met à jour en temps réel. Cliquez "Sauvegarder" pour appliquer les changements sur le site.
              </p>
            </div>
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
                <Button onClick={sendNotification} disabled={!notifTitle} className="bg-[#D91CD2] hover:bg-[#D91CD2]/80 text-white h-11"><Send className="h-4 w-4 mr-2" /> Envoyer à {users.length} utilisateurs</Button>
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
