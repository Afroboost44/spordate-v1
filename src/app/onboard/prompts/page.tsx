/**
 * BUG #70 — Page d'onboarding "3 prompts profil" style Hinge.
 *
 * Flow :
 *  1. User vient ici après signup (email ou Google first-time).
 *  2. Voit le catalogue de 20 questions (PROFILE_PROMPTS), choisit 3.
 *  3. Répond à chacune (max 200 chars).
 *  4. Submit → écriture users/{uid}.profilePrompts → redirect /activities.
 *
 * Restrictions :
 *  - Nécessite être authentifié (redirect /login si non).
 *  - Bouton submit désactivé tant que 3 réponses non remplies (>= 2 chars chacune).
 *  - Anti double-écriture : `saving` state désactive le submit pendant l'écriture.
 *  - Skippable : un lien "Passer pour l'instant" en bas pour les flows urgents
 *    (le user pourra compléter via /profile plus tard).
 *
 * Charte stricte black / #D91CD2 / white. Mobile-first.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, Check, X, Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { db, isFirebaseConfigured } from '@/lib/firebase';
import { doc, updateDoc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import {
  PROFILE_PROMPTS,
  CATEGORY_LABELS,
  PROMPT_ANSWER_MAX_LENGTH,
  REQUIRED_PROMPT_COUNT,
  type PromptCategory,
  type UserPromptAnswer,
} from '@/lib/profile/prompts';

interface SelectedPrompt {
  questionId: string;
  question: string;
  answer: string;
}

const CATEGORY_ORDER: PromptCategory[] = ['sport', 'lifestyle', 'voyage', 'rencontre'];

export default function OnboardPromptsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [selected, setSelected] = useState<SelectedPrompt[]>([]);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  // Redirect non-authentifiés
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login?redirect=/onboard/prompts');
    }
  }, [authLoading, user, router]);

  // Pré-remplir si l'utilisateur a déjà répondu (cas où il revient sur la page)
  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db!, 'users', user.uid));
        if (!cancelled && snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.profilePrompts) && data.profilePrompts.length > 0) {
            setSelected(data.profilePrompts.slice(0, REQUIRED_PROMPT_COUNT));
          }
        }
      } catch (e) {
        console.warn('[OnboardPrompts] read existing failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Liste de prompts disponibles = ceux NON déjà sélectionnés
  const usedIds = new Set(selected.map((s) => s.questionId));

  const openPicker = (slotIndex: number) => {
    setPickerSlot(slotIndex);
    setPickerOpen(true);
  };

  const pickQuestion = (questionId: string, question: string) => {
    if (pickerSlot === null) return;
    setSelected((prev) => {
      const next = [...prev];
      // Si on remplace un slot existant : on conserve la réponse vide.
      next[pickerSlot] = { questionId, question, answer: '' };
      return next;
    });
    setPickerOpen(false);
    setPickerSlot(null);
  };

  const removeSlot = (slotIndex: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== slotIndex));
  };

  const setAnswer = (slotIndex: number, answer: string) => {
    setSelected((prev) => {
      const next = [...prev];
      if (next[slotIndex]) {
        next[slotIndex] = { ...next[slotIndex], answer: answer.slice(0, PROMPT_ANSWER_MAX_LENGTH) };
      }
      return next;
    });
  };

  // Validation : 3 slots remplis ET chaque réponse a >= 2 chars
  const isComplete =
    selected.length === REQUIRED_PROMPT_COUNT &&
    selected.every((s) => s.answer.trim().length >= 2);

  const handleSubmit = async () => {
    if (!user || !db || !isFirebaseConfigured) return;
    if (!isComplete) {
      toast({
        title: t('onboard_prompts_incomplete_title'),
        description: t('onboard_prompts_incomplete_desc', { count: REQUIRED_PROMPT_COUNT }),
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const payload: UserPromptAnswer[] = selected.map((s) => ({
        questionId: s.questionId,
        question: s.question,
        answer: s.answer.trim(),
      }));
      // setDoc avec merge:true : crée le doc users/{uid} s'il n'existe pas
      // encore (cas signup tout frais où aucun write Firestore initial n'a eu
      // lieu côté AuthContext), sinon update partielle.
      await setDoc(
        doc(db, 'users', user.uid),
        {
          profilePrompts: payload,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      toast({
        title: t('onboard_prompts_success_title'),
        description: t('onboard_prompts_success_desc'),
        className: 'bg-zinc-900 border-accent/40 text-white',
      });
      router.push('/activities');
    } catch (err) {
      console.error('[OnboardPrompts] save error', err);
      toast({
        title: t('onboard_prompts_error_title'),
        description: t('onboard_prompts_error_desc'),
        variant: 'destructive',
      });
      setSaving(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-accent animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
            <span className="text-xs uppercase tracking-[0.2em] text-accent">
              {t('onboard_prompts_final_step')}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight">
            {t('onboard_prompts_title')}
          </h1>
          <p className="text-sm text-white/60 leading-relaxed">
            {t('onboard_prompts_intro_part1')} <span className="text-white font-medium">{t('onboard_prompts_questions_count', { count: REQUIRED_PROMPT_COUNT })}</span>{' '}
            {t('onboard_prompts_intro_part2')}
          </p>
        </div>

        {/* Slots */}
        <div className="flex flex-col gap-4">
          {Array.from({ length: REQUIRED_PROMPT_COUNT }).map((_, i) => {
            const slot = selected[i];
            const filled = !!slot;
            return (
              <div
                key={i}
                className={`rounded-2xl border p-4 sm:p-5 transition-colors ${
                  filled
                    ? 'border-accent/40 bg-accent/[0.04]'
                    : 'border-white/15 bg-zinc-900/30 hover:border-accent/30'
                }`}
              >
                {filled ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <span className="text-[10px] uppercase tracking-wider text-accent font-medium pt-1">
                        Q{i + 1}
                      </span>
                      <h2 className="flex-1 text-base sm:text-lg text-white font-light leading-snug">
                        {slot.question}
                      </h2>
                      <button
                        type="button"
                        onClick={() => removeSlot(i)}
                        aria-label={t('onboard_prompts_remove_question')}
                        className="text-white/40 hover:text-white/80 transition-colors p-1"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Textarea
                        value={slot.answer}
                        onChange={(e) => setAnswer(i, e.target.value)}
                        rows={3}
                        maxLength={PROMPT_ANSWER_MAX_LENGTH}
                        placeholder={t('onboard_prompts_answer_placeholder')}
                        className="bg-zinc-950 border-white/10 text-white placeholder:text-white/30 resize-none"
                      />
                      <div className="flex justify-end">
                        <span className="text-[10px] text-white/40 font-mono tabular-nums">
                          {slot.answer.length} / {PROMPT_ANSWER_MAX_LENGTH}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openPicker(i)}
                      className="self-start text-xs text-white/50 hover:text-accent underline transition-colors"
                    >
                      {t('onboard_prompts_change_question')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openPicker(i)}
                    className="w-full flex items-center justify-between gap-3 py-2"
                  >
                    <span className="text-sm sm:text-base text-white/60 font-light text-left">
                      {t('onboard_prompts_choose_question', { num: i + 1 })}
                    </span>
                    <ArrowRight className="h-4 w-4 text-accent shrink-0" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit */}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!isComplete || saving}
          className={`w-full rounded-full h-14 text-base font-medium ${
            isComplete
              ? 'bg-accent hover:bg-accent/90 text-white'
              : 'bg-white/5 text-white/30 border border-white/10 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              {t('onboard_prompts_saving')}
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" aria-hidden="true" />
              {t('onboard_prompts_publish')}
            </>
          )}
        </Button>

        {/* Skip */}
        <button
          type="button"
          onClick={() => router.push('/activities')}
          className="text-xs text-white/40 hover:text-white/70 underline self-center transition-colors"
        >
          {t('onboard_prompts_skip')}
        </button>
      </div>

      {/* Picker overlay : liste des prompts par catégorie */}
      {pickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-zinc-950 border border-white/15 rounded-2xl"
          >
            <div className="sticky top-0 bg-zinc-950/95 backdrop-blur border-b border-white/10 px-5 py-4 flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-accent font-medium">
                {t('onboard_prompts_picker_title')}
              </Label>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-white/40 hover:text-white/80 transition-colors"
                aria-label={t('common_close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-6">
              {CATEGORY_ORDER.map((cat) => {
                const promptsInCat = PROFILE_PROMPTS.filter(
                  (p) => p.category === cat && !usedIds.has(p.id),
                );
                if (promptsInCat.length === 0) return null;
                return (
                  <div key={cat} className="flex flex-col gap-2">
                    <Label className="text-[11px] uppercase tracking-wider text-white/40 font-medium">
                      {CATEGORY_LABELS[cat]}
                    </Label>
                    <div className="flex flex-col gap-1.5">
                      {promptsInCat.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => pickQuestion(p.id, p.text)}
                          className="text-left rounded-lg border border-white/10 bg-zinc-900/40 hover:border-accent/40 hover:bg-accent/[0.05] px-4 py-3 transition-colors"
                        >
                          <span className="text-sm text-white font-light">{p.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
