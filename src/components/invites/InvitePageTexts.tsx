"use client";

/**
 * Fix #156/#157 — Wrapper client pour rendre les libellés statiques de la
 * Server Component /invite/[id]. Le SC ne peut pas utiliser useLanguage() —
 * on isole donc tous les textes traduits ici (titre selon status, message
 * status, bouton retour, "Voir la session").
 *
 * Les composants exportés sont volontairement granulaires pour pouvoir
 * être insérés exactement aux endroits voulus dans la page SC sans casser
 * la structure visuelle ni l'a11y.
 */

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export function InviteBackLink() {
  const { t } = useLanguage();
  return (
    <Link
      href="/activities"
      className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-8 text-sm font-light"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('nav_back')}
    </Link>
  );
}

interface InviteHeadingProps {
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  fromUserName: string;
}

export function InviteHeading({ status, fromUserName }: InviteHeadingProps) {
  const { t } = useLanguage();
  let text: string;
  if (status === 'pending') {
    text = t('invite_header_invites_you', { name: fromUserName });
  } else if (status === 'accepted') {
    text = t('invite_status_accepted');
  } else if (status === 'declined') {
    text = t('invite_status_declined');
  } else {
    text = t('invite_status_expired');
  }
  return (
    <h1 className="text-3xl md:text-4xl font-light text-white mb-2">
      {text}
    </h1>
  );
}

interface InviteViewSessionLinkProps {
  sessionId: string;
}

export function InviteViewSessionLink({ sessionId }: InviteViewSessionLinkProps) {
  const { t } = useLanguage();
  return (
    <Link
      href={`/sessions/${sessionId}`}
      className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-black text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
    >
      {t('invite_view_session')}
    </Link>
  );
}

interface InviteDeclinedRetryProps {
  toUserName: string;
}

export function InviteDeclinedRetry({ toUserName }: InviteDeclinedRetryProps) {
  const { t } = useLanguage();
  return (
    <p className="text-white/50 font-light text-sm leading-relaxed">
      {toUserName} n&rsquo;a pas pu rejoindre cette session. {t('invite_declined_retry_msg')}
    </p>
  );
}

export function InviteExpiredMessage() {
  const { t } = useLanguage();
  return (
    <p className="text-white/50 font-light text-sm leading-relaxed">
      {t('invite_expired_explanation')}
    </p>
  );
}
