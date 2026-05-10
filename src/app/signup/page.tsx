"use client";

import Link from "next/link";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dumbbell, Building, Eye, EyeOff } from 'lucide-react';
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/context/AuthContext";

export default function SignupPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { signup, loginWithGoogle, isLoggedIn, loading: authLoading, error, clearError } = useAuth();
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && isLoggedIn) {
      router.replace('/activities');
    }
  }, [isLoggedIn, authLoading, router]);

  // Show Firebase errors as toasts
  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: error,
      });
      clearError();
    }
  }, [error, toast, clearError]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!termsAccepted) {
      toast({
        variant: "destructive",
        title: "Conditions non acceptées",
        description: "Vous devez accepter les conditions générales pour vous inscrire.",
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Les mots de passe ne correspondent pas.",
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Le mot de passe doit contenir au moins 6 caractères.",
      });
      return;
    }

    setLoading(true);
    try {
      await signup(formData.email, formData.password, formData.firstName);
      toast({
        title: "Bienvenue !",
        description: "Votre compte a été créé avec succès.",
      });
    } catch {
      // Error already handled by AuthContext
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    if (!termsAccepted) {
      toast({
        variant: "destructive",
        title: "Conditions non acceptées",
        description: "Vous devez accepter les conditions générales pour vous inscrire.",
      });
      return;
    }

    setLoading(true);
    try {
      await loginWithGoogle();
      toast({
        title: "Bienvenue !",
        description: "Connexion avec Google réussie.",
      });
    } catch {
      // Error already handled by AuthContext
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-12rem)]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#D91CD2]"></div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-12rem)] p-4">
       <Card className="mx-auto max-w-sm w-full bg-card border-border/20 shadow-lg shadow-accent/10">
        <form onSubmit={handleSubmit}>
          <CardHeader className="items-center text-center">
              <Link href="/" className="flex items-center justify-center space-x-2 mb-4">
                  <Dumbbell className="h-8 w-8 bg-[#D91CD2] rounded-md p-1 text-white" />
                  <span className="font-bold text-2xl">Spordateur</span>
              </Link>
            <CardTitle className="text-2xl font-bold">Inscription</CardTitle>
            <CardDescription>
              Créez votre compte pour commencer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {/* Google Sign-Up Button */}
              <Button
                type="button"
                variant="outline"
                className="w-full flex items-center justify-center gap-3 border-border/40 hover:bg-accent/5"
                onClick={handleGoogleSignup}
                disabled={loading}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continuer avec Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator className="w-full bg-border/20" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">ou par email</span>
                </div>
              </div>

              <div className="grid gap-2">
                  <Label htmlFor="firstName">Prénom</Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    placeholder="John"
                    value={formData.firstName}
                    onChange={handleChange}
                    required
                  />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={handleChange}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                  minLength={6}
                />
              </div>

              <div className="flex items-center space-x-2 mt-2">
                <Checkbox id="terms" onCheckedChange={(checked) => setTermsAccepted(!!checked)} />
                <label
                  htmlFor="terms"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground/80"
                >
                  J'ai lu et j'accepte les{" "}
                  <Link href="/terms" className="underline text-accent/80 hover:text-accent" target="_blank" rel="noopener noreferrer">
                    Conditions Générales d'Utilisation
                  </Link>
                  .
                </label>
              </div>

              <Button
                type="submit"
                className="w-full bg-[#D91CD2] text-white font-semibold"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                    Création du compte...
                  </span>
                ) : (
                  "Je m'inscris"
                )}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Déjà inscrit ?{" "}
              <Link href="/login" className="underline text-accent/80 hover:text-accent">
                Se connecter
              </Link>
            </div>
             <Separator className="my-6 bg-border/20"/>
             <div className="text-center text-sm">
                 <Link href="/partner/login" className="text-foreground/60 hover:text-foreground transition-colors flex items-center justify-center gap-2">
                    <Building size={16} />
                    Vous êtes un Club ? Accédez à votre espace ici.
                 </Link>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
