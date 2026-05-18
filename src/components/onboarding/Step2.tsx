"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { 
  ArrowRight, 
  ArrowLeft, 
  Loader2,
  Dumbbell,
  Footprints,
  Music,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Step2Props } from "./types";
import { LEVELS } from "./types";
import type { Sport } from "@/lib/sports";

// Mapping des icônes Lucide
const IconMap: Record<string, LucideIcon> = {
  Dumbbell,
  Footprints,
  Music,
  Zap,
};

// Icônes SVG personnalisées pour Tennis et Padel
const CustomIcons: Record<string, React.ReactNode> = {
  Tennis: (
    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3c-1.5 3-1.5 6 0 9s1.5 6 0 9" />
      <path d="M3 12c3-1.5 6-1.5 9 0s6 1.5 9 0" />
    </svg>
  ),
  Paddle: (
    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="8" rx="5" ry="6" />
      <line x1="12" y1="14" x2="12" y2="22" />
      <circle cx="7" cy="6" r="1" fill="currentColor" />
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="17" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
      <circle cx="15" cy="9" r="1" fill="currentColor" />
    </svg>
  ),
};

// Render icon for a sport
function SportIcon({ iconName, className }: { iconName: string; className?: string }) {
  // Check custom SVG icons first
  if (CustomIcons[iconName]) {
    return <>{CustomIcons[iconName]}</>;
  }
  
  // Use Lucide icon
  const LucideIconComponent = IconMap[iconName];
  if (LucideIconComponent) {
    return <LucideIconComponent className={className || "h-7 w-7"} />;
  }
  
  // Fallback to Dumbbell
  return <Dumbbell className={className || "h-7 w-7"} />;
}

export function Step2({ data, onDataChange, onBack, onSubmit, loading, sports }: Step2Props) {
  const { toast } = useToast();

  const toggleSport = (sportId: string) => {
    const newSports = data.selectedSports.includes(sportId)
      ? data.selectedSports.filter((s) => s !== sportId)
      : [...data.selectedSports, sportId];
    onDataChange({ selectedSports: newSports });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (data.selectedSports.length === 0) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Veuillez sélectionner au moins un sport.",
      });
      return;
    }

    if (!data.selectedLevel) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Veuillez sélectionner votre niveau.",
      });
      return;
    }

    await onSubmit();
  };

  // Filter only active sports
  const activeSports = sports.filter(s => s.active);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Sports selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Sélectionne tes sports</Label>
        <div className="grid grid-cols-2 gap-2">
          {activeSports.map((sport) => (
            <div
              key={sport.id}
              onClick={() => toggleSport(sport.id)}
              className={`p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 text-center group active:scale-95 ${
                data.selectedSports.includes(sport.id)
                  ? "border-primary bg-primary/10 shadow-lg shadow-primary/20"
                  : "border-border/30 hover:border-border/60 bg-background/30"
              }`}
              data-testid={`sport-${sport.id}`}
            >
              <div className={`mx-auto mb-1.5 transition-colors ${
                data.selectedSports.includes(sport.id) 
                  ? "text-primary" 
                  : "text-muted-foreground group-hover:text-foreground"
              }`}>
                <SportIcon iconName={sport.icon} />
              </div>
              <span className="text-xs font-medium">{sport.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Level selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Ton niveau</Label>
        <div className="grid grid-cols-2 gap-2">
          {LEVELS.map((level) => (
            <div
              key={level.id}
              onClick={() => onDataChange({ selectedLevel: level.id })}
              className={`p-2.5 rounded-lg border-2 cursor-pointer transition-all duration-200 text-center active:scale-95 ${
                data.selectedLevel === level.id
                  ? "border-primary bg-primary/10 shadow-lg shadow-primary/20"
                  : "border-border/30 hover:border-border/60 bg-background/30"
              }`}
              data-testid={`level-${level.id}`}
            >
              <span className="text-xs font-medium block">{level.label}</span>
              <span className="text-[10px] text-muted-foreground">{level.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="flex-1 h-11"
          data-testid="step2-back"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour
        </Button>
        <Button
          type="submit"
          className="flex-1 h-11 bg-accent text-white font-semibold"
          disabled={loading}
          data-testid="step2-submit"
        >
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Création...
            </>
          ) : (
            <>
              Créer <ArrowRight className="ml-1.5 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
