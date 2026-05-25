"use client";

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function LegalPage() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-8 text-sm font-light">
          <ArrowLeft className="h-4 w-4" />
          {t('legal_back')}
        </Link>

        <h1 className="text-3xl md:text-4xl font-light text-white mb-2">
          {t('legal_title')}
        </h1>
        <p className="text-sm text-gray-500 font-light mb-10">
          {t('legal_subtitle')}
        </p>

        <div className="space-y-8 text-gray-400 font-light leading-relaxed text-[15px]">

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h1_publisher')}</h2>
            <p>
              <span className="text-white">{t('legal_publisher_name')}</span><br />
              {t('legal_publisher_address1')}<br />
              {t('legal_publisher_address2')}
            </p>
            <p className="mt-3">
              {/* BUG #82/#100 — Numéro IDE conservé (information légale obligatoire),
                  mention de l'entité juridique retirée (politique branding),
                  email unique : contact@spordateur.com. */}
              {t('legal_publisher_ide')}<br />
              {t('legal_publisher_email')}<br />
              {t('legal_publisher_website')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h2_representative')}</h2>
            <p>{t('legal_representative_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h3_hosting')}</h2>
            <p>
              <span className="text-white">{t('legal_hosting_web_label')}</span><br />
              {t('legal_hosting_vercel_line1')}<br />
              {t('legal_hosting_vercel_line2')}<br />
              {t('legal_hosting_vercel_line3')}<br />
              {t('legal_hosting_vercel_line4')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('legal_hosting_db_label')}</span><br />
              {t('legal_hosting_db_line1')}<br />
              {t('legal_hosting_db_line2')}<br />
              {t('legal_hosting_db_line3')}<br />
              {t('legal_hosting_db_line4')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h4_payment')}</h2>
            <p>
              {t('legal_payment_line1')}<br />
              {t('legal_payment_line2')}<br />
              {t('legal_payment_line3')}<br />
              {t('legal_payment_line4')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h5_ip')}</h2>
            <p>{t('legal_ip_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h6_data')}</h2>
            <p>
              {t('legal_data_p1_part1')}{' '}
              <Link href="/privacy" className="text-accent hover:underline">
                {t('legal_data_privacy_link')}
              </Link>
              {t('legal_data_p1_part2')}
            </p>
            <p className="mt-3">
              <span className="text-white">{t('legal_data_authority_label')}</span><br />
              {t('legal_data_authority_line1')}<br />
              {t('legal_data_authority_line2')}<br />
              {t('legal_data_authority_line3')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h7_prices')}</h2>
            <p>{t('legal_prices_p1')}</p>
            <p className="mt-3">
              {t('legal_prices_monthly')}<br />
              {t('legal_prices_yearly')}
            </p>
            <p className="mt-3">{t('legal_prices_credits')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h8_disputes')}</h2>
            <p>{t('legal_disputes_p1')}</p>
            <p className="mt-3">
              <span className="text-white">{t('legal_disputes_trust_title')}</span> {t('legal_disputes_trust_desc')}
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h9_disclaimer')}</h2>
            <p>{t('legal_disclaimer_p1')}</p>
          </section>

          <section>
            <h2 className="text-lg text-white font-normal mb-3">{t('legal_h10_external')}</h2>
            <p>{t('legal_external_p1')}</p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-wrap gap-6 text-sm text-gray-600 font-light">
          <Link href="/terms" className="hover:text-white transition-colors">{t('legal_footer_terms')}</Link>
          <Link href="/privacy" className="hover:text-white transition-colors">{t('legal_footer_privacy')}</Link>
        </div>
      </div>
    </div>
  );
}
