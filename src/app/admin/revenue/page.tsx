"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wallet, TrendingUp, Users, Download, Loader2, CalendarDays, MapPin, Dumbbell, UserCheck, BarChart3
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { useAuth } from "@/context/AuthContext";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import {
  collection, query, getDocs, orderBy, where, Timestamp
} from 'firebase/firestore';

// Types
interface Transaction {
  transactionId: string;
  userId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  status: string;
  package: string;
  creditsGranted: number;
  metadata: Record<string, string>;
  createdAt: Timestamp;
}

interface DailyRevenue {
  date: string;
  revenue: number;
  count: number;
}

const COLORS = ['#D91CD2', '#E91E63', '#9C27B0', '#7B1FA2', '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'];

function formatCHF(amount: number): string {
  return (amount / 100).toFixed(2) + ' CHF';
}

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RevenueDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterMethod, setFilterMethod] = useState('all');

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) { setLoading(false); return; }
    loadTransactions();
  }, [user]);

  const loadTransactions = async () => {
    if (!db) return;
    try {
      const q = query(
        collection(db, 'transactions'),
        where('status', '==', 'succeeded'),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      setTransactions(snap.docs.map(d => d.data() as Transaction));
    } catch (err) {
      console.error('Erreur chargement transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filtered transactions
  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (filterMethod !== 'all' && tx.paymentMethod !== filterMethod) return false;
      if (dateFrom && tx.createdAt) {
        const txDate = tx.createdAt.toDate();
        if (txDate < new Date(dateFrom)) return false;
      }
      if (dateTo && tx.createdAt) {
        const txDate = tx.createdAt.toDate();
        const end = new Date(dateTo);
        end.setHours(23, 59, 59);
        if (txDate > end) return false;
      }
      return true;
    });
  }, [transactions, dateFrom, dateTo, filterMethod]);

  // Stats
  const totalRevenue = filtered.reduce((sum, tx) => sum + tx.amount, 0);
  const totalTransactions = filtered.length;
  const avgTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // Revenue by day
  const dailyData = useMemo(() => {
    const map: Record<string, DailyRevenue> = {};
    filtered.forEach(tx => {
      if (!tx.createdAt) return;
      const day = tx.createdAt.toDate().toISOString().split('T')[0];
      if (!map[day]) map[day] = { date: day, revenue: 0, count: 0 };
      map[day].revenue += tx.amount / 100;
      map[day].count += 1;
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  }, [filtered]);

  // Revenue by payment method
  const byMethod = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(tx => {
      const m = tx.paymentMethod || 'card';
      map[m] = (map[m] || 0) + tx.amount / 100;
    });
    return Object.entries(map).map(([name, value]) => ({ name: name === 'card' ? 'Carte' : name === 'twint' ? 'TWINT' : name, value: Math.round(value * 100) / 100 }));
  }, [filtered]);

  // Revenue by package
  const byPackage = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(tx => {
      const p = tx.package || 'unknown';
      map[p] = (map[p] || 0) + tx.amount / 100;
    });
    return Object.entries(map).map(([name, value]) => ({
      name: name === '1_date' ? '1 Date' : name === '3_dates' ? '3 Dates' : name === '10_dates' ? '10 Dates' : name === 'test_1chf' ? 'Test 1CHF' : name === 'premium_monthly' ? 'Premium Mensuel' : name === 'premium_yearly' ? 'Premium Annuel' : name,
      value: Math.round(value * 100) / 100,
    }));
  }, [filtered]);

  // Revenue by city (from metadata)
  const byCity = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(tx => {
      const city = tx.metadata?.city || 'Non spécifié';
      map[city] = (map[city] || 0) + tx.amount / 100;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Export CSV
  const exportCSV = () => {
    const headers = 'Date,Montant CHF,Méthode,Package,Crédits,UserId,Status\n';
    const rows = filtered.map(tx => {
      const date = tx.createdAt ? tx.createdAt.toDate().toISOString() : '';
      return `${date},${(tx.amount / 100).toFixed(2)},${tx.paymentMethod},${tx.package},${tx.creditsGranted},${tx.userId},${tx.status}`;
    }).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spordate-revenus-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 text-[#D91CD2] animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
              <BarChart3 className="h-7 w-7 text-[#D91CD2]" />
              Dashboard Revenus
            </h1>
            <p className="text-sm text-white/40 mt-1">Analytics temps réel — {totalTransactions} transactions</p>
          </div>
          <Button onClick={exportCSV} variant="outline" className="border-[#D91CD2]/30 text-[#D91CD2] hover:bg-[#D91CD2]/10 h-10">
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>

        {/* Filters */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-end">
            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-white/40 mb-1 block">Date début</label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-black border-white/10 h-10" />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Date fin</label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-black border-white/10 h-10" />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Méthode</label>
                <Select value={filterMethod} onValueChange={setFilterMethod}>
                  <SelectTrigger className="bg-black border-white/10 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    <SelectItem value="card">Carte</SelectItem>
                    <SelectItem value="twint">TWINT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button variant="ghost" onClick={() => { setDateFrom(''); setDateTo(''); setFilterMethod('all'); }} className="text-white/30 text-xs">
              Réinitialiser
            </Button>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><Wallet className="h-4 w-4 text-[#D91CD2]" /><span className="text-xs text-white/40 uppercase tracking-wider">Revenus</span></div>
              <p className="text-2xl font-light">{(totalRevenue / 100).toFixed(2)} <span className="text-sm text-white/40">CHF</span></p>
            </CardContent>
          </Card>
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><TrendingUp className="h-4 w-4 text-green-400" /><span className="text-xs text-white/40 uppercase tracking-wider">Transactions</span></div>
              <p className="text-2xl font-light">{totalTransactions}</p>
            </CardContent>
          </Card>
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><CalendarDays className="h-4 w-4 text-blue-400" /><span className="text-xs text-white/40 uppercase tracking-wider">Panier moyen</span></div>
              <p className="text-2xl font-light">{(avgTransaction / 100).toFixed(2)} <span className="text-sm text-white/40">CHF</span></p>
            </CardContent>
          </Card>
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><Users className="h-4 w-4 text-amber-400" /><span className="text-xs text-white/40 uppercase tracking-wider">Crédits vendus</span></div>
              <p className="text-2xl font-light">{filtered.reduce((s, tx) => s + (tx.creditsGranted || 0), 0)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Revenue per day chart */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-light text-white flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#D91CD2]" /> Revenus par jour
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailyData.length === 0 ? (
              <p className="text-sm text-white/30 py-8 text-center">Aucune donnée pour cette période</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="date" tick={{ fill: '#ffffff40', fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fill: '#ffffff40', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#1A1A1A', border: '1px solid #ffffff15', borderRadius: 12 }}
                    labelStyle={{ color: '#ffffff80' }}
                    formatter={(v: number) => [`${v.toFixed(2)} CHF`, 'Revenus']}
                    labelFormatter={v => `Date: ${v}`}
                  />
                  <Bar dataKey="revenue" fill="#D91CD2" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Two charts side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* By payment method */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-light text-white flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[#D91CD2]" /> Par méthode de paiement
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byMethod.length === 0 ? (
                <p className="text-sm text-white/30 py-8 text-center">Aucune donnée</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={byMethod} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value} CHF`}>
                      {byMethod.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1A1A1A', border: '1px solid #ffffff15', borderRadius: 12 }} formatter={(v: number) => [`${v} CHF`]} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* By package */}
          <Card className="bg-[#1A1A1A] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-light text-white flex items-center gap-2">
                <Dumbbell className="h-4 w-4 text-[#D91CD2]" /> Par package
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byPackage.length === 0 ? (
                <p className="text-sm text-white/30 py-8 text-center">Aucune donnée</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={byPackage} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                    <XAxis type="number" tick={{ fill: '#ffffff40', fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#ffffff60', fontSize: 11 }} width={100} />
                    <Tooltip contentStyle={{ background: '#1A1A1A', border: '1px solid #ffffff15', borderRadius: 12 }} formatter={(v: number) => [`${v} CHF`]} />
                    <Bar dataKey="value" fill="#E91E63" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* By city */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-light text-white flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[#D91CD2]" /> Par ville
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byCity.length === 0 ? (
              <p className="text-sm text-white/30 py-8 text-center">Aucune donnée</p>
            ) : (
              <div className="space-y-3">
                {byCity.slice(0, 8).map((city, i) => (
                  <div key={city.name} className="flex items-center gap-3">
                    <span className="text-sm text-white/50 w-28 truncate">{city.name}</span>
                    <div className="flex-1 h-6 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(5, (city.value / (byCity[0]?.value || 1)) * 100)}%`,
                          background: COLORS[i % COLORS.length],
                        }}
                      />
                    </div>
                    <span className="text-sm text-white font-light w-20 text-right">{city.value} CHF</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent transactions table */}
        <Card className="bg-[#1A1A1A] border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-light text-white">Dernières transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left text-white/30 font-light py-2 px-2">Date</th>
                    <th className="text-left text-white/30 font-light py-2 px-2">Montant</th>
                    <th className="text-left text-white/30 font-light py-2 px-2">Méthode</th>
                    <th className="text-left text-white/30 font-light py-2 px-2">Package</th>
                    <th className="text-left text-white/30 font-light py-2 px-2">Crédits</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 20).map((tx) => (
                    <tr key={tx.transactionId} className="border-b border-white/5">
                      <td className="py-2 px-2 text-white/50">{formatDate(tx.createdAt)}</td>
                      <td className="py-2 px-2 text-[#D91CD2] font-medium">{formatCHF(tx.amount)}</td>
                      <td className="py-2 px-2">
                        <Badge className={`text-xs ${tx.paymentMethod === 'twint' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                          {tx.paymentMethod === 'twint' ? 'TWINT' : 'Carte'}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-white/50">{tx.package}</td>
                      <td className="py-2 px-2 text-white/50">{tx.creditsGranted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="text-sm text-white/30 py-6 text-center">Aucune transaction</p>}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
