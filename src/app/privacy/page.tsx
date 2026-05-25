"use client";

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function PrivacyPage() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-8 text-sm font-light">
          <ArrowLeft className="h-4 w-4" />
          {t('privacy_back')}
        </Link>

        <h1 className="text-3xl md:text-4xl font-light text-white mb-2">
          {t('privacy_title')}
        </h1>
        <p className="text-sm text-gray-500 font-light mb-10">
          {t('privacy_last_update')}
        </p>

        <div className="space-y-8 text-gray-400 font-light leading-relaxed text-[15px]">

          <section>
            <p>{t('privacy_intro_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h1_controller')}</h2>
            <p>{t('privacy_controller_intro')}</p>
            <p className="mt-2">
              <span className="text-white">{t('privacy_controller_name')}</span><br />
              {t('privacy_controller_address1')}<br />
              {t('privacy_controller_address2')}<br />
              {t('privacy_controller_ide')}<br />
              {t('privacy_controller_email_label')} <a href="mailto:contact@spordateur.com" className="text-accent hover:underline">contact@spordateur.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h2_data')}</h2>
            <p>{t('privacy_data_intro')}</p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_data_signup_title')}</span> {t('privacy_data_signup_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_data_profile_title')}</span> {t('privacy_data_profile_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_data_usage_title')}</span> {t('privacy_data_usage_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_data_payment_title')}</span> {t('privacy_data_payment_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_data_technical_title')}</span> {t('privacy_data_technical_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_data_chat_title')}</span> {t('privacy_data_chat_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_data_trust_title')}</span> {t('privacy_data_trust_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h3_purposes')}</h2>
            <p>{t('privacy_purposes_intro')}</p>
            <p className="mt-2">
              {t('privacy_purposes_list_part1')}{' '}
              <span className="text-white">{t('privacy_purposes_moderation_title')}</span>{' '}
              {t('privacy_purposes_list_part2')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h4_legal_basis')}</h2>
            <p>{t('privacy_legal_basis_intro')}</p>
            <p className="mt-2">
              — <span className="text-white">{t('privacy_legal_contract_title')}</span> {t('privacy_legal_contract_desc')}
              — <span className="text-white">{t('privacy_legal_consent_title')}</span> {t('privacy_legal_consent_desc')}
              — <span className="text-white">{t('privacy_legal_legitimate_title')}</span> {t('privacy_legal_legitimate_desc')}
              — <span className="text-white">{t('privacy_legal_obligation_title')}</span> {t('privacy_legal_obligation_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h5_hosting')}</h2>
            <p>{t('privacy_hosting_intro')}</p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_hosting_firebase_title')}</span> {t('privacy_hosting_firebase_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_hosting_vercel_title')}</span> {t('privacy_hosting_vercel_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_hosting_stripe_title')}</span> {t('privacy_hosting_stripe_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_hosting_hostinger_title')}</span> {t('privacy_hosting_hostinger_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_hosting_resend_title')}</span> {t('privacy_hosting_resend_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_hosting_gemini_title')}</span> {t('privacy_hosting_gemini_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h6_transfers')}</h2>
            <p>{t('privacy_transfers_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h7_retention')}</h2>
            <p>{t('privacy_retention_p1')}</p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_retention_trust_title')}</span>
            </p>
            <p className="mt-2">{t('privacy_retention_list')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h8_rights')}</h2>
            <p>{t('privacy_rights_intro')}</p>
            <p className="mt-2">
              — <span className="text-white">{t('privacy_rights_access_title')}</span> {t('privacy_rights_access_desc')}
              — <span className="text-white">{t('privacy_rights_rectif_title')}</span> {t('privacy_rights_rectif_desc')}
              — <span className="text-white">{t('privacy_rights_erasure_title')}</span> {t('privacy_rights_erasure_desc')}
              — <span className="text-white">{t('privacy_rights_portability_title')}</span> {t('privacy_rights_portability_desc')}
              — <span className="text-white">{t('privacy_rights_opposition_title')}</span> {t('privacy_rights_opposition_desc')}
              — <span className="text-white">{t('privacy_rights_withdraw_title')}</span> {t('privacy_rights_withdraw_desc')}
            </p>
            <p className="mt-3">{t('privacy_rights_exercise_p')}</p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_rights_sanction_title')}</span> {t('privacy_rights_sanction_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_rights_ai_optout_title')}</span> {t('privacy_rights_ai_optout_desc1')}{' '}
              <Link href="/profile" className="text-accent hover:underline">{t('privacy_rights_ai_profile_link')}</Link>.{' '}
              {t('privacy_rights_ai_optout_desc2')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_rights_moderation_title')}</span> {t('privacy_rights_moderation_desc')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('privacy_rights_softdelete_title')}</span> {t('privacy_rights_softdelete_desc1')}{' '}
              <span className="text-white">{t('privacy_rights_anonymized_word')}</span> {t('privacy_rights_softdelete_desc2')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h9_cookies')}</h2>
            <p>{t('privacy_cookies_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h10_security')}</h2>
            <p>{t('privacy_security_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h11_minors')}</h2>
            <p>{t('privacy_minors_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h12_modifications')}</h2>
            <p>{t('privacy_modifications_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('privacy_h13_contact')}</h2>
            <p>{t('privacy_contact_intro')}</p>
            <p className="mt-2 text-white">
              {t('privacy_contact_line')}
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-wrap gap-6 text-sm text-gray-600 font-light">
          <Link href="/terms" className="hover:text-white transition-colors">{t('privacy_footer_terms')}</Link>
          <Link href="/legal" className="hover:text-white transition-colors">{t('privacy_footer_legal')}</Link>
        </div>
      </div>
    </div>
  );
}
