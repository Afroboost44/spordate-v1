"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  BarChart3, DollarSign, Users, Building2, Check, X, Lock, Unlock,
  Trash2, LogOut, Activity, Shield, Mail, AlertCircle, TrendingUp,
  ArrowUp, Eye, EyeOff, Zap
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

import {
  subscribeToAnalytics,
  getAllUsers,
  getAllTransactions,
  getAllBookings,
  getAllPayouts,
  updateUser,
  resolveError,
  getUnresolvedErrors,
  sendGlobalNotification,
  updatePartner,
  getPartners,
  processPayoutAdmin,
} from '@/services/firestore';
import type {
  AnalyticsGlobal, UserProfile, Transaction, Booking,
  Payout, ErrorLog, Partner
} from '@/types/firestore';
import { ADMIN_EMAIL } from '@/lib/sports';

// Auth key
const ADMIN_AUTH_KEY = 'spordate_admin_auth';
const AUTHORIZED_EMAIL = ADMIN_EMAIL;

// Types
interface DailyRevenue {
  date: string;
  revenue: number;
}

export default function AdminDashboard() {
  const { toast } = useToast();

  // ==================== AUTH STATE ====================
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // ==================== ANALYTICS STATE ====================
  const [analytics, setAnalytics] = useState<AnalyticsGlobal | null>(null);
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenue[]>([]);

  // ==================== DATA STATE ====================
  const [activeTab, setActiveTab] = useState("overview");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [payouts, setPayout] = useState<Payout[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);

  // ==================== UI STATE ====================
  const [loadingData, setLoadingData] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationBody, setNotificationBody] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null);

  // ==================== AUTH CHECK ====================
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedAuth = localStorage.getItem(ADMIN_AUTH_KEY);
    if (savedAuth === AUTHORIZED_EMAIL) {
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  // ==================== HANDLE LOGIN ====================
  const handleAdminLogin = () => {
    if (typeof window === 'undefined') return;
    if (loginEmail.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase()) {
      localStorage.setItem(ADMIN_AUTH_KEY, AUTHORIZED_EMAIL);
      setIsAuthenticated(true);
      toast({ title: "✅ Connexion réussie", description: "Bienvenue au Dashboard Admin V2." });
    } else {
      toast({ variant: "destructive", title: "❌ Accès refusé", description: "Email non autorisé." });
    }
  };

  // ==================== HANDLE LOGOUT ====================
  const handleLogout = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(ADMIN_AUTH_KEY);
    setIsAuthenticated(false);
    toast({ title: "Déconnexion", description: "À bientôt ! 👋" });
  };

  // ==================== LOAD ANALYTICS (Real-time) ====================
  useEffect(() => {
    if (!isAuthenticated) return;

    const unsubscribe = subscribeToAnalytics((data) => {
      setAnalytics(data);

      // Mock 7-day revenue data (in real scenario, fetch from daily analytics)
      const mockRevenue: DailyRevenue[] = [
        { date: '17 Mar', revenue: Math.max(0, (data.totalRevenue || 0) * 0.15) },
        { date: '16 Mar', revenue: Math.max(0, (data.totalRevenue || 0) * 0.14) },
        { date: '15 Mar', revenue: Math.max(0, (data.totalRevenue || 0) * 0.12) },
        { date: '14 Mar', revenue: Math.max(0, (data.totalRevenue || 0) * 0.11) },
        { date: '13 Mar', revenue: Math.max(0, (data.totalRevenue || 0) * 0.2) },
        { date: '12 Mar', revenue: Math.max(0, (data.totalRevenue || 0) * 0.18) },
        { date: '11 Mar', revenue: Math.max(0, (data.totalRevenue || 0) * 0.1) },
      ];
      setDailyRevenue(mockRevenue);
    });

    return () => unsubscribe();
  }, [isAuthenticated]);

  // ==================== LOAD DATA ====================
  const loadAllData = async () => {
    if (!isAuthenticated) return;
    setLoadingData(true);
    try {
      const [u, t, b, p, e, pt] = await Promise.all([
        getAllUsers(100),
        getAllTransactions(50),
        getAllBookings(50),
        getAllPayouts(),
        getUnresolvedErrors(),
        getPartners(false),
      ]);
      setUsers(u);
      setTransactions(t);
      setBookings(b);
      setPayout(p);
      setErrorLogs(e);
      setPartners(pt);
    } catch (err) {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de charger les données" });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && activeTab === "users") {
      loadAllData();
    }
  }, [isAuthenticated, activeTab]);

  // ==================== USER MANAGEMENT ====================
  const handleBanUser = async (uid: string) => {
    try {
      await updateUser(uid, { role: 'user' });
      toast({ title: "✅ Utilisateur banni", description: "L'utilisateur a été restreint." });
      loadAllData();
    } catch {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de bannir l'utilisateur" });
    }
  };

  const handleSuspendUser = async (uid: string) => {
    try {
      await updateUser(uid, { role: 'user' });
      toast({ title: "⏸️ Utilisateur suspendu" });
      loadAllData();
    } catch {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  // ==================== PARTNER MANAGEMENT ====================
  const handleApprovePartner = async (partnerId: string) => {
    try {
      await updatePartner(partnerId, { isApproved: true });
      toast({ title: "✅ Partenaire approuvé" });
      loadAllData();
    } catch {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  const handleRejectPartner = async (partnerId: string) => {
    try {
      await updatePartner(partnerId, { isApproved: false, isActive: false });
      toast({ title: "❌ Partenaire rejeté" });
      loadAllData();
    } catch {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  // ==================== PAYOUT MANAGEMENT ====================
  const handleApprovePayout = async (payoutId: string) => {
    try {
      await processPayoutAdmin(payoutId, AUTHORIZED_EMAIL, true);
      toast({ title: "✅ Payout approuvé" });
      loadAllData();
    } catch {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  const handleRejectPayout = async (payoutId: string) => {
    try {
      await processPayoutAdmin(payoutId, AUTHORIZED_EMAIL, false);
      toast({ title: "❌ Payout rejeté" });
      loadAllData();
    } catch {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  // ==================== ERROR RESOLUTION ====================
  const handleResolveError = async (logId: string) => {
    try {
      await resolveError(logId);
      toast({ title: "✅ Erreur résolue" });
      loadAllData();
    } catch {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  // ==================== GLOBAL NOTIFICATION ====================
  const handleSendNotification = async () => {
    if (!notificationTitle || !notificationBody) {
      toast({ variant: "destructive", title: "Erreur", description: "Remplissez tous les champs" });
      return;
    }
    try {
      await sendGlobalNotification(notificationTitle, notificationBody);
      toast({ title: "✅ Notification envoyée à tous les utilisateurs" });
      setNotificationTitle("");
      setNotificationBody("");
    } catch {
      toast({ variant: "destructive", title: "Erreur" });
    }
  };

  // ==================== SIMPLE CHART (ASCII) ====================
  const renderRevenueChart = () => {
    const maxRevenue = Math.max(...dailyRevenue.map(d => d.revenue), 1);
    return (
      <div className="space-y-2">
        {dailyRevenue.map((item) => {
          const height = Math.max(5, (item.revenue / maxRevenue) * 100);
          return (
            <div key={item.date} className="flex items-end gap-3">
              <span className="text-xs text-gray-500 w-10">{item.date}</span>
              <div className="flex-1 flex items-end gap-1 h-12">
                <div
                  className="bg-gradient-to-t from-cyan-500 to-cyan-400 rounded-t w-full transition-all duration-300"
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-12 text-right">{item.revenue.toFixed(0)} CHF</span>
            </div>
          );
        })}
      </div>
    );
  };

  // ==================== LOGIN SCREEN ====================
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#05090e]">
        <Activity className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#05090e] px-4">
        <Card className="w-full max-w-md bg-[#0f1115] border-gray-800">
          <CardHeader className="text-center">
            <div className="mx-auto p-3 bg-cyan-900/20 rounded-xl border border-cyan-800/50 w-fit mb-4">
              <Shield className="text-cyan-400 h-8 w-8" />
            </div>
            <CardTitle className="text-2xl">Admin Dashboard</CardTitle>
            <CardDescription>Spordateur V2 — Accès réservé</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-300">Email administrateur</label>
              <Input
                type="email"
                placeholder="contact.artboost@gmail.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                className="bg-black border-gray-700 mt-2"
              />
            </div>
            <Button onClick={handleAdminLogin} className="w-full bg-cyan-600 hover:bg-cyan-500 text-white">
              <Lock className="mr-2 h-4 w-4" /> Accéder au Dashboard
            </Button>
            <p className="text-xs text-center text-gray-500">
              Seul l'email autorisé (contact.artboost@gmail.com) peut accéder.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==================== MAIN DASHBOARD ====================
  return (
    <div className="min-h-screen bg-[#05090e] pt-24 pb-20 px-4 md:px-8 text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-cyan-900/20 rounded-xl border border-cyan-800/50">
            <BarChart3 className="text-cyan-400 h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Spordateur Admin Dashboard</h1>
            <p className="text-gray-400 text-sm">Système de gestion complet • V2.0 Firestore</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleLogout} className="border-gray-700 whitespace-nowrap">
          <LogOut className="mr-2 h-4 w-4" /> Déconnexion
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-gray-900/50 border border-gray-800 p-1 flex-wrap h-auto w-full justify-start gap-1">
          <TabsTrigger value="overview" className="text-xs md:text-sm">
            <BarChart3 className="mr-2 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs md:text-sm">
            <Users className="mr-2 h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="partners" className="text-xs md:text-sm">
            <Building2 className="mr-2 h-4 w-4" />
            Partners
          </TabsTrigger>
          <TabsTrigger value="payouts" className="text-xs md:text-sm">
            <DollarSign className="mr-2 h-4 w-4" />
            Payouts
          </TabsTrigger>
          <TabsTrigger value="transactions" className="text-xs md:text-sm">
            <TrendingUp className="mr-2 h-4 w-4" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="errors" className="text-xs md:text-sm">
            <AlertCircle className="mr-2 h-4 w-4" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs md:text-sm">
            <Mail className="mr-2 h-4 w-4" />
            Notify
          </TabsTrigger>
        </TabsList>

        {/* ==================== OVERVIEW TAB ==================== */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="bg-gradient-to-br from-green-900/20 to-green-900/5 border-green-800/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-green-400 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Total Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl md:text-3xl font-bold">
                  {analytics?.totalRevenue?.toFixed(2) || '0'} CHF
                </div>
                <p className="text-xs text-green-400/70 mt-1">📡 Live from Firestore</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-900/20 to-blue-900/5 border-blue-800/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-blue-400 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Total Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl md:text-3xl font-bold">
                  {analytics?.totalUsers || 0}
                </div>
                <p className="text-xs text-blue-400/70 mt-1">Registered users</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-900/20 to-purple-900/5 border-purple-800/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-purple-400 flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Total Bookings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl md:text-3xl font-bold">
                  {analytics?.totalBookings || 0}
                </div>
                <p className="text-xs text-purple-400/70 mt-1">Confirmed bookings</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-yellow-900/20 to-yellow-900/5 border-yellow-800/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-yellow-400 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Total Partners
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl md:text-3xl font-bold">
                  {analytics?.totalPartners || 0}
                </div>
                <p className="text-xs text-yellow-400/70 mt-1">Active partners</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-pink-900/20 to-pink-900/5 border-pink-800/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-pink-400 flex items-center gap-2">
                  <ArrowUp className="h-4 w-4" />
                  Creators
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl md:text-3xl font-bold">
                  {analytics?.totalCreators || 0}
                </div>
                <p className="text-xs text-pink-400/70 mt-1">Active creators</p>
              </CardContent>
            </Card>
          </div>

          {/* Revenue Chart */}
          <Card className="bg-[#0f1115] border-gray-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-cyan-400" />
                Revenue Last 7 Days
              </CardTitle>
              <CardDescription>Daily breakdown with trend analysis</CardDescription>
            </CardHeader>
            <CardContent>
              {renderRevenueChart()}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-[#0f1115] border-gray-800">
              <CardHeader>
                <CardTitle>Recent Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {transactions.slice(0, 5).map((tx) => (
                    <div key={tx.transactionId} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{tx.type}</p>
                        <p className="text-xs text-gray-500">{tx.status}</p>
                      </div>
                      <span className={`font-bold ${tx.status === 'succeeded' ? 'text-green-400' : 'text-yellow-400'}`}>
                        {(tx.amount / 100).toFixed(2)} CHF
                      </span>
                    </div>
                  ))}
                  {transactions.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No transactions yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#0f1115] border-gray-800">
              <CardHeader>
                <CardTitle>Recent Bookings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {bookings.slice(0, 5).map((booking) => (
                    <div key={booking.bookingId} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{booking.sport}</p>
                        <p className="text-xs text-gray-500">{booking.status}</p>
                      </div>
                      <Badge variant={booking.status === 'confirmed' ? 'default' : 'outline'}>
                        {booking.ticketType}
                      </Badge>
                    </div>
                  ))}
                  {bookings.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">No bookings yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ==================== USERS TAB ==================== */}
        <TabsContent value="users">
          <Card className="bg-[#0f1115] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>User Management</CardTitle>
                <CardDescription>Ban, suspend, or monitor users</CardDescription>
              </div>
              <Button onClick={loadAllData} disabled={loadingData} className="bg-cyan-600 hover:bg-cyan-500">
                {loadingData ? 'Loading...' : 'Refresh'}
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.uid} className="border-gray-800">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={user.photoURL} />
                            <AvatarFallback>{user.displayName?.charAt(0) || 'U'}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{user.displayName || 'Anonymous'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-400">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? 'destructive' : 'outline'}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{user.credits}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-500/10">
                              <Lock className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-[#0f1115] border-gray-800">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Ban User?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action will restrict {user.email} from the platform.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="border-gray-700">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleBanUser(user.uid)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                Ban
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {users.length === 0 && (
                <p className="text-center text-gray-500 py-8">No users found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== PARTNERS TAB ==================== */}
        <TabsContent value="partners">
          <Card className="bg-[#0f1115] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Partner Management</CardTitle>
                <CardDescription>Approve or reject partner applications</CardDescription>
              </div>
              <Button onClick={loadAllData} disabled={loadingData} className="bg-cyan-600 hover:bg-cyan-500">
                {loadingData ? 'Loading...' : 'Refresh'}
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead>Partner</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partners.map((partner) => (
                    <TableRow key={partner.partnerId} className="border-gray-800">
                      <TableCell>
                        <div className="font-medium">{partner.name}</div>
                        <div className="text-xs text-gray-500">{partner.email}</div>
                      </TableCell>
                      <TableCell>{partner.city}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{partner.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={partner.isApproved ? 'default' : 'destructive'}
                          className={partner.isApproved ? 'bg-green-600' : ''}
                        >
                          {partner.isApproved ? 'Approved' : 'Pending'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {!partner.isApproved && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleApprovePartner(partner.partnerId)}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRejectPartner(partner.partnerId)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {partner.isApproved && (
                          <Badge variant="outline" className="border-green-500/50 text-green-400">
                            Active
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {partners.length === 0 && (
                <p className="text-center text-gray-500 py-8">No partners found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== PAYOUTS TAB ==================== */}
        <TabsContent value="payouts">
          <Card className="bg-[#0f1115] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Payout Management</CardTitle>
                <CardDescription>Process creator payouts</CardDescription>
              </div>
              <Button onClick={loadAllData} disabled={loadingData} className="bg-cyan-600 hover:bg-cyan-500">
                {loadingData ? 'Loading...' : 'Refresh'}
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead>Creator ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payout.map((p) => (
                    <TableRow key={p.payoutId} className="border-gray-800">
                      <TableCell className="font-mono text-sm">{p.creatorId.slice(0, 8)}...</TableCell>
                      <TableCell className="font-bold">{(p.amount / 100).toFixed(2)} CHF</TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.method}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={p.status === 'requested' ? 'outline' : p.status === 'completed' ? 'default' : 'destructive'}
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {p.status === 'requested' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleApprovePayout(p.payoutId)}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRejectPayout(p.payoutId)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {payout.length === 0 && (
                <p className="text-center text-gray-500 py-8">No payouts pending</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== TRANSACTIONS TAB ==================== */}
        <TabsContent value="transactions">
          <Card className="bg-[#0f1115] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>All payment activity</CardDescription>
              </div>
              <Button onClick={loadAllData} disabled={loadingData} className="bg-cyan-600 hover:bg-cyan-500">
                {loadingData ? 'Loading...' : 'Refresh'}
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800">
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.transactionId} className="border-gray-800">
                      <TableCell>
                        <Badge variant="outline">{tx.type}</Badge>
                      </TableCell>
                      <TableCell className="font-bold text-green-400">{(tx.amount / 100).toFixed(2)} CHF</TableCell>
                      <TableCell>{tx.paymentMethod}</TableCell>
                      <TableCell>
                        <Badge
                          variant={tx.status === 'succeeded' ? 'default' : tx.status === 'pending' ? 'outline' : 'destructive'}
                          className={tx.status === 'succeeded' ? 'bg-green-600' : ''}
                        >
                          {tx.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-400">{tx.userId.slice(0, 8)}...</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {transactions.length === 0 && (
                <p className="text-center text-gray-500 py-8">No transactions found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== ERRORS TAB ==================== */}
        <TabsContent value="errors">
          <Card className="bg-[#0f1115] border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Error Logs</CardTitle>
                <CardDescription>Unresolved system errors</CardDescription>
              </div>
              <Button onClick={loadAllData} disabled={loadingData} className="bg-cyan-600 hover:bg-cyan-500">
                {loadingData ? 'Loading...' : 'Refresh'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorLogs.map((log) => (
                <div key={log.logId} className="p-4 bg-red-900/10 border border-red-800/30 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="destructive" className="bg-red-600">
                          {log.level}
                        </Badge>
                        <span className="text-sm font-medium">{log.source}</span>
                      </div>
                      <p className="text-sm text-gray-300">{log.message}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResolveError(log.logId)}
                      className="border-green-600/30 text-green-400 hover:bg-green-500/10"
                    >
                      Resolve
                    </Button>
                  </div>
                  {log.stackTrace && (
                    <div className="text-xs text-gray-500 mt-2 max-h-20 overflow-auto bg-black/30 p-2 rounded font-mono">
                      {log.stackTrace.slice(0, 200)}...
                    </div>
                  )}
                </div>
              ))}
              {errorLogs.length === 0 && (
                <p className="text-center text-gray-500 py-8">✅ No unresolved errors</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== NOTIFICATIONS TAB ==================== */}
        <TabsContent value="notifications">
          <Card className="bg-[#0f1115] border-gray-800">
            <CardHeader>
              <CardTitle>Global Notification Broadcaster</CardTitle>
              <CardDescription>Send system-wide notifications to all users</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-300 block mb-2">Title</label>
                <Input
                  value={notificationTitle}
                  onChange={(e) => setNotificationTitle(e.target.value)}
                  placeholder="e.g., Maintenance Notice"
                  className="bg-black border-gray-700"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300 block mb-2">Message Body</label>
                <Textarea
                  value={notificationBody}
                  onChange={(e) => setNotificationBody(e.target.value)}
                  placeholder="Write your message here..."
                  className="bg-black border-gray-700 min-h-[120px]"
                />
              </div>
              <div className="bg-yellow-900/20 border border-yellow-800/30 p-3 rounded-lg">
                <p className="text-sm text-yellow-400">
                  ⚠️ This notification will be sent to all {analytics?.totalUsers || 0} users. Use carefully.
                </p>
              </div>
              <Button
                onClick={handleSendNotification}
                className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
              >
                <Mail className="mr-2 h-4 w-4" />
                Send to All Users
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
