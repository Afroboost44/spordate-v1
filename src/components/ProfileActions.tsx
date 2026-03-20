"use client";

import { X, Heart, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProfileActionsProps {
  onSkip: () => void;
  onLike: () => void;
  onSuperMatch?: () => void;
  canSkip?: boolean;
  canLike?: boolean;
  canSuperMatch?: boolean;
  isProcessing?: boolean;
  credits?: number;
}

export default function ProfileActions({
  onSkip,
  onLike,
  onSuperMatch,
  canSkip = true,
  canLike = true,
  canSuperMatch = false,
  isProcessing = false,
  credits = 0,
}: ProfileActionsProps) {
  return (
    <div className="relative flex items-center justify-center gap-4 py-4">
      {/* Credit badge */}
      <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs text-gray-300">
        {credits} credit{credits !== 1 ? "s" : ""}
      </div>

      {/* Skip - X button */}
      <Button
        variant="outline"
        size="lg"
        onClick={onSkip}
        disabled={!canSkip || isProcessing}
        className="h-14 w-14 rounded-full border-2 border-gray-600 bg-transparent hover:bg-gray-800 hover:border-gray-400 disabled:opacity-30"
        title="Passer"
      >
        <X className="h-6 w-6 text-gray-400" />
      </Button>

      {/* Like - Heart button */}
      <Button
        size="lg"
        onClick={onLike}
        disabled={!canLike || isProcessing}
        className="h-16 w-16 rounded-full bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] hover:from-[#9C27B0] hover:to-[#E91CD2] shadow-lg shadow-purple-500/30 disabled:opacity-30"
        title="Liker"
      >
        <Heart className="h-7 w-7 text-white fill-white" />
      </Button>

      {/* Super Match - Zap button (premium only) */}
      {canSuperMatch && (
        <Button
          size="lg"
          onClick={onSuperMatch}
          disabled={isProcessing}
          className="h-14 w-14 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-lg shadow-amber-500/30"
          title="Super Match"
        >
          <Zap className="h-6 w-6 text-white fill-white" />
        </Button>
      )}
    </div>
  );
}
