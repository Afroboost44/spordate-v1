/**
 * BUG #70 — Affichage public des prompts profil style Hinge.
 *
 * Rendu sur /profile/[uid] : 3 cards éditoriales empilées avec :
 *  - Question en grand (font-light, leading généreux)
 *  - Réponse en gras (font-medium accent, type "answer block")
 *
 * Si l'utilisateur n'a pas encore répondu (cas users existants pré-fix #70),
 * le composant renvoie null pour ne pas afficher de section vide.
 *
 * Charte stricte noir / #D91CD2 / white.
 */

'use client';

import { Quote } from 'lucide-react';

interface PromptAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export interface ProfilePromptsDisplayProps {
  prompts: PromptAnswer[] | undefined | null;
  className?: string;
}

export function ProfilePromptsDisplay({ prompts, className = '' }: ProfilePromptsDisplayProps) {
  if (!prompts || prompts.length === 0) return null;

  const valid = prompts.filter(
    (p) => p && typeof p.question === 'string' && typeof p.answer === 'string' && p.answer.trim().length > 0,
  );
  if (valid.length === 0) return null;

  return (
    <section
      aria-label="Réponses du profil"
      className={`flex flex-col gap-4 ${className}`}
    >
      {valid.map((p, i) => (
        <article
          key={`${p.questionId}-${i}`}
          className="rounded-2xl border border-accent/15 bg-gradient-to-br from-accent/[0.05] via-zinc-950 to-zinc-950 p-5 sm:p-6 flex flex-col gap-3"
        >
          <div className="flex items-start gap-2">
            <Quote className="h-4 w-4 text-accent/70 mt-1 shrink-0" aria-hidden="true" />
            <h3 className="text-base sm:text-lg text-white/80 font-light leading-snug">
              {p.question}
            </h3>
          </div>
          <p className="text-lg sm:text-xl text-white font-medium leading-snug whitespace-pre-line">
            {p.answer}
          </p>
        </article>
      ))}
    </section>
  );
}
