"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Step1Props } from "./types";

export function Step1({ data, onDataChange, onNext, referredBy }: Step1Props) {
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (data.password !== data.confirmPassword) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Les mots de passe ne correspondent pas.",
      });
      return;
    }

    if (data.password.length < 6) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Le mot de passe doit contenir au moins 6 caractères.",
      });
      return;
    }

    onNext();
  };

  return (
    <div className="space-y-4">
      {/* Social Proof Banner - Invitation active */}
      {referredBy && (
        <div className="p-3 bg-accent/10 border border-accent/30 rounded-lg flex items-center gap-3">
          <div className="p-2 bg-accent/20 rounded-full">
            <Sparkles className="h-4 w-4 text-accent" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-purple-300">
              ✨ Invitation active
            </p>
            <p className="text-xs text-purple-400/80">
              Vous rejoignez la communauté via un partenaire
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="ton@email.com"
            value={data.email}
            onChange={(e) => onDataChange({ email: e.target.value })}
            required
            data-testid="email-input"
            className="bg-background/50"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Mot de passe</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={data.password}
            onChange={(e) => onDataChange({ password: e.target.value })}
            required
            data-testid="password-input"
            className="bg-background/50"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
          <Input
            id="confirm-password"
            type="password"
            placeholder="••••••••"
            value={data.confirmPassword}
            onChange={(e) => onDataChange({ confirmPassword: e.target.value })}
            required
            data-testid="confirm-password-input"
            className="bg-background/50"
          />
        </div>

        <Button
          type="submit"
          className="w-full bg-accent text-white font-semibold"
          data-testid="step1-submit"
        >
          Continuer <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
