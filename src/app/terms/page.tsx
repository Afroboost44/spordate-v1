"use client";

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function TermsPage() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-8 text-sm font-light">
          <ArrowLeft className="h-4 w-4" />
          {t('terms_back')}
        </Link>

        <h1 className="text-3xl md:text-4xl font-light text-white mb-2">
          {t('terms_title')}
        </h1>
        <p className="text-sm text-gray-500 font-light mb-10">
          {t('terms_last_update')}
        </p>

        <div className="space-y-8 text-gray-400 font-light leading-relaxed text-[15px]">

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h1_object')}</h2>
            <p>{t('terms_object_p1')}</p>
            <p className="mt-3">{t('terms_object_p2')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h2_signup')}</h2>
            <p>{t('terms_signup_p1')}</p>
            <p className="mt-3">{t('terms_signup_p2')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h3_services')}</h2>
            <p>{t('terms_services_intro')}</p>
            <p className="mt-2">
              <span className="text-white">{t('terms_services_matching_title')}</span> {t('terms_services_matching_desc')}
            </p>
            <p className="mt-2">
              <span className="text-white">{t('terms_services_credits_title')}</span> {t('terms_services_credits_desc')}
            </p>
            <p className="mt-2">
              <span className="text-white">{t('terms_services_premium_title')}</span> {t('terms_services_premium_desc')}
            </p>
            <p className="mt-2">
              <span className="text-white">{t('terms_services_bookings_title')}</span> {t('terms_services_bookings_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h4_payments')}</h2>
            <p>{t('terms_payments_p1')}</p>
            <p className="mt-3">
              <span className="text-white">{t('terms_payments_credits_label')}</span> {t('terms_payments_credits_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_payments_premium_label')}</span> {t('terms_payments_premium_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h5_revocation')}</h2>
            <p>{t('terms_revocation_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h6_cancellation')}</h2>
            <p>{t('terms_cancellation_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h7_obligations')}</h2>
            <p>{t('terms_obligations_intro')}</p>
            <p className="mt-2">{t('terms_obligations_list')}</p>
            <p className="mt-3">{t('terms_obligations_sanctions')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h7bis_reports')}</h2>
            <p>
              <span className="text-white">{t('terms_reports_formal_title')}</span> {t('terms_reports_formal_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reports_workflow_title')}</span> {t('terms_reports_workflow_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reports_ban_title')}</span> {t('terms_reports_ban_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reports_appeal_title')}</span> {t('terms_reports_appeal_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reports_fair_title')}</span> {t('terms_reports_fair_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reports_blocklist_title')}</span> {t('terms_reports_blocklist_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h7ter_reviews')}</h2>
            <p>
              {t('terms_reviews_p1_part1')}
              <span className="text-white"> {t('terms_reviews_window')}</span>{t('terms_reviews_p1_part2')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reviews_anonymization_title')}</span> {t('terms_reviews_anonymization_desc1')}{' '}
              <span className="text-white">{t('terms_reviews_anonymized_word')}</span> {t('terms_reviews_anonymization_desc2')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reviews_edit_title')}</span> {t('terms_reviews_edit_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_reviews_optional_title')}</span> {t('terms_reviews_optional_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h7quater_moderation')}</h2>
            <p>
              <span className="text-white">{t('terms_moderation_purpose_title')}</span> {t('terms_moderation_purpose_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_moderation_method_title')}</span> {t('terms_moderation_method_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_moderation_logs_title')}</span> {t('terms_moderation_logs_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_moderation_rate_title')}</span> {t('terms_moderation_rate_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_moderation_optout_title')}</span> {t('terms_moderation_optout_desc1')}{' '}
              <span className="text-white">{t('terms_moderation_optout_suggestions')}</span>{' '}
              {t('terms_moderation_optout_desc2')}{' '}
              <Link href="/profile" className="text-accent hover:underline">{t('terms_moderation_optout_profile_link')}</Link>{' '}
              {t('terms_moderation_optout_desc3')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h7quinquies_ai')}</h2>
            <p>
              {t('terms_ai_p1_part1')}{' '}
              <span className="text-white">{t('terms_ai_auto_suggestions')}</span> {t('terms_ai_p1_part2')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_ai_default_title')}</span> {t('terms_ai_default_desc1')}{' '}
              <span className="text-white">{t('terms_ai_activated_default')}</span> {t('terms_ai_default_desc2')}{' '}
              <Link href="/profile" className="text-accent hover:underline">{t('terms_ai_profile_link')}</Link>{' '}
              {t('terms_ai_default_desc3')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h8_liability')}</h2>
            <p>{t('terms_liability_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h9_ip')}</h2>
            <p>{t('terms_ip_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h10_data')}</h2>
            <p>
              {t('terms_data_p1_part1')}{' '}
              <Link href="/privacy" className="text-accent hover:underline">
                {t('terms_data_privacy_link')}
              </Link>
              {t('terms_data_p1_part2')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('terms_data_subprocessors_title')}</span> {t('terms_data_subprocessors_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h11_modification')}</h2>
            <p>{t('terms_modification_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h12_law')}</h2>
            <p>{t('terms_law_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('terms_h13_contact')}</h2>
            <p>{t('terms_contact_intro')}</p>
            <p className="mt-2 text-white">
              <a href="mailto:contact@spordateur.com" className="text-accent hover:underline">contact@spordateur.com</a>
              <br />
              {t('terms_contact_address')}
              <br />
              {t('terms_contact_ide')}
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-wrap gap-6 text-sm text-gray-600 font-light">
          <Link href="/privacy" className="hover:text-white transition-colors">{t('terms_footer_privacy')}</Link>
          <Link href="/legal" className="hover:text-white transition-colors">{t('terms_footer_legal')}</Link>
        </div>
      </div>
    </div>
  );
}
