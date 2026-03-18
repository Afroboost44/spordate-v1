"use client";

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function BackButton({ label = 'Retour' }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors py-2"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}
