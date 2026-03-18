"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Users, Building2, MapPin, Loader2, Search, Eye, EyeOff, Trash2, Shield, Crown
} from 'lucide-react';
import { useAuth } from "@/context/AuthContext";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, getDocs, doc, updateDoc, deleteDoc,
  serverTimestamp, orderBy, limit, where
} from 'firebase/firestore';
import { useToast } from "@/hooks/use-toast";
import Link from 'next/link';

interface UserItem {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  city: string;
  isPremium: boolean;
  credits: number;
  isVisible?: boolean;
  createdAt: any;
}

interface PartnerItem {
  partnerId: string;
  name: string;
  city: string;
  isActive: boolean;
  isApproved: boolean;
  totalBookings: number;
  totalRevenue: number;
}

export default function AdminManagePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<'users' | 'partners'>('users');
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [partners, setPartners] = useState<PartnerItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!db) return;
    try {
      // Load users
      const uQ = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(100));
      const uSnap = await getDocs(uQ);
      setUsers(uSnap.docs.map(d => ({ ...d.data(), uid: d.id } as UserItem)));

      // Load partners
      const pQ = query(collection(db, 'partners'), orderBy('createdAt', 'desc'));
      const pSnap = await getDocs(pQ);
      setPartners(pSnap.docs.map(d => d.data() as PartnerItem));
    } catch (err) {
      console.error('Erreur chargement admin:', err);
    } finally {
      setLoading(false);
    }
  };

  // User actions
  const toggleUserVisibility = async (uid: string, current: boolean) => {
    if (!db) return;
    await updateDoc(doc(db, 'users', uid), { isVisible: !current, updatedAt: serverTimestamp() });
    setUsers(users.map(u => u.uid === uid ? { ...u, isVisible: !current } : u));
    toast({ title: !current ? 'Utilisateur visible' : 'Utilisateur masqué' });
  };

  const changeUserRole = async (uid: string, newRole: string) => {
    if (!db) return;
    await updateDoc(doc(db, 'users', uid), { role: newRole, updatedAt: serverTimestamp() });
    setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    toast({ title: `Rôle changé en "${newRole}"` });
  };

  const deleteUser = async (uid: string, name: string) => {
    if (!db || !confirm(`Supprimer définitivement ${name} ?`)) return;
    await deleteDoc(doc(db, 'users', uid));
    setUsers(users.filter(u => u.uid !== uid));
    toast({ title: 'Utilisateur supprimé' });
  };

  // Partner actions
  const togglePartnerActive = async (pid: string, current: boolean) => {
    if (!db) return;
    await updateDoc(doc(db, 'partners', pid), { isActive: !current, updatedAt: serverTimestamp() });
    setPartners(partners.map(p => p.partnerId === pid ? { ...p, isActive: !current } : p));
    toast({ title: !current ? 'Partenaire activé' : 'Partenaire désactivé' });
  };

  const togglePartnerApproved = async (pid: string, current: boolean) => {
    if (!db) return;
    await updateDoc(doc(db, 'partners', pid), { isApproved: !current, updatedAt: serverTimestamp() });
    setPartners(partners.map(p => p.partnerId === pid ? { ...p, isApproved: !current } : p));
    toast({ title: !current ? 'Partenaire approuvé' : 'Partenaire non approuvé' });
  };

  // Filter
  const filteredUsers = users.filter(u =>
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.city?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPartners = partners.filter(p =>
    p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.city?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-6">

        {/* Header + nav */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-light tracking-tight flex items-center gap-2">
              <Shield className="h-6 w-6 text-[#D91CD2]" /> Gestion du site
            </h1>
            <p className="text-sm text-white/40">Utilisateurs, partenaires, visibilité</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/revenue">
              <Button variant="outline" size="sm" className="border-white/10 text-white/50 hover:text-white">Revenus</Button>
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('users')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-all ${
              tab === 'users' ? 'bg-[#D91CD2]/10 border border-[#D91CD2]/30 text-[#D91CD2]' : 'bg-white/5 border border-transparent text-white/40'
            }`}
          >
            <Users className="h-4 w-4" /> Utilisateurs ({users.length})
          </button>
          <button
            onClick={() => setTab('partners')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-all ${
              tab === 'partners' ? 'bg-[#D91CD2]/10 border border-[#D91CD2]/30 text-[#D91CD2]' : 'bg-white/5 border border-transparent text-white/40'
            }`}
          >
            <Building2 className="h-4 w-4" /> Partenaires ({partners.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Rechercher par nom, email ou ville..."
            className="bg-[#1A1A1A] border-white/10 pl-10 h-12"
          />
        </div>

        {/* Users Tab */}
        {tab === 'users' && (
          <div className="space-y-2">
            {filteredUsers.length === 0 ? (
              <p className="text-white/30 text-center py-8">Aucun utilisateur trouvé</p>
            ) : filteredUsers.map(u => (
              <Card key={u.uid} className="bg-[#1A1A1A] border-white/5">
                <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center gap-3">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-white font-medium truncate">{u.displayName || 'Sans nom'}</span>
                      <Badge className={`text-[10px] ${
                        u.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        u.role === 'creator' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                        'bg-white/5 text-white/30 border-white/10'
                      }`}>
                        {u.role || 'user'}
                      </Badge>
                      {u.isPremium && <Badge className="text-[10px] bg-[#D91CD2]/10 text-[#D91CD2] border-[#D91CD2]/20">Premium</Badge>}
                    </div>
                    <p className="text-xs text-white/30 truncate">{u.email}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/20">
                      {u.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{u.city}</span>}
                      <span>{u.credits || 0} crédits</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Visibility toggle */}
                    <button
                      onClick={() => toggleUserVisibility(u.uid, u.isVisible !== false)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                        u.isVisible !== false ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                      }`}
                      title={u.isVisible !== false ? 'Masquer' : 'Rendre visible'}
                    >
                      {u.isVisible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>

                    {/* Role change */}
                    <select
                      value={u.role || 'user'}
                      onChange={e => changeUserRole(u.uid, e.target.value)}
                      className="bg-black border border-white/10 rounded-lg text-xs text-white/60 px-2 h-8"
                    >
                      <option value="user">User</option>
                      <option value="creator">Creator</option>
                      <option value="admin">Admin</option>
                    </select>

                    {/* Delete */}
                    {u.role !== 'admin' && (
                      <button
                        onClick={() => deleteUser(u.uid, u.displayName)}
                        className="w-8 h-8 rounded-lg bg-red-500/5 text-red-400/40 hover:text-red-400 flex items-center justify-center transition-all"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Partners Tab */}
        {tab === 'partners' && (
          <div className="space-y-2">
            {filteredPartners.length === 0 ? (
              <p className="text-white/30 text-center py-8">Aucun partenaire trouvé</p>
            ) : filteredPartners.map(p => (
              <Card key={p.partnerId} className="bg-[#1A1A1A] border-white/5">
                <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{p.name}</span>
                      <Badge className={`text-[10px] ${p.isApproved ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                        {p.isApproved ? 'Approuvé' : 'En attente'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/20">
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.city}</span>
                      <span>{p.totalBookings || 0} réservations</span>
                      <span>{(p.totalRevenue || 0).toFixed(2)} CHF</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/30">Visible</span>
                      <Switch checked={p.isActive} onCheckedChange={() => togglePartnerActive(p.partnerId, p.isActive)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/30">Approuvé</span>
                      <Switch checked={p.isApproved} onCheckedChange={() => togglePartnerApproved(p.partnerId, p.isApproved)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
