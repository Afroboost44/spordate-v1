import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";
import PWARegister from "@/components/PWARegister";
import { SanctionBanner } from "@/components/SanctionBanner";
import AdminBroadcastModal from "@/components/AdminBroadcastModal";
import { ThemeProvider } from "@/components/ThemeProvider";
import { BrandProvider } from "@/components/BrandProvider";
import { getServerTheme, buildThemeStyleString } from "@/lib/theme/server";
import { getServerBrand } from "@/lib/brand/server";

// Phase 9.5 c18 BUG K — police globale Plus Jakarta Sans (alternative libre proche
// de Canva Sans, souhait Bassi). Chargée via next/font/google : self-hosted, pas de
// FOUT, performance optimale (preloaded CSS).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Spordateur",
    template: "%s — Spordateur",
  },
  description: "La plateforme suisse de rencontres par le sport et la danse.",
  // Fix #128 — manifest dynamique via src/app/manifest.ts (Next.js sert à
  // /manifest.webmanifest). Lit settings/site.brand pour servir les logos
  // uploadés par l'admin. public/manifest.json reste comme legacy fallback.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Spordateur",
  },
  // Phase 9.5 c14/c18/c22/c46 — métadonnées icons + cache-bust query param.
  // Chrome cache aggressivement les favicons : versionner les URLs force re-fetch.
  // Bump v27 = c46 : nouveau logo neon Spordateur (généré depuis logo-source.png
  // via src/scripts/generate-pwa-assets.ts → public/icons/). À incrémenter à
  // chaque regénération d'asset pour éviter d'avoir à demander Cmd+Shift+Delete.
  // Accent feature Phase 2 : icons 16/32 servis dynamiquement par
  // src/app/icon.tsx (suit settings/site.primaryColor admin, revalidate 60s).
  // Les tailles 192/512 (PWA) + apple-touch-icon restent statiques (charte
  // officielle), régénération dynamique reportée (Cloud Function Phase 3).
  icons: {
    icon: [
      { url: "/icons/icon-192.png?v=29", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png?v=29", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png?v=29", sizes: "180x180" }],
    shortcut: ["/favicon.ico?v=29"],
  },
  openGraph: {
    title: "Spordateur",
    description: "Sport pour de vraies rencontres en Suisse romande.",
    type: "website",
    locale: "fr_CH",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Spordateur",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spordateur",
    description: "Sport pour de vraies rencontres en Suisse romande.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  // BUG #86 — themeColor était "var(--accent-color)" (rose Spordateur), ce qui
  // teintait la barre système iOS/Android (horaire/batterie/réseau) en rose.
  // Bassi veut la barre noire cohérente avec le fond du site. Fix : "#000000".
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Fix FOUC — sans force-dynamic, Next.js peut figer le layout au build avec
// les anciennes valeurs admin (theme couleur, brand logos) dans le HTML
// statique. Avec force-dynamic, `getServerTheme()` + `getServerBrand()` sont
// évalués à chaque request — leur cache 60s interne (unstable_cache, purgé
// par /api/admin/site/revalidate après save admin) limite les reads
// Firestore. Sans ça, le <style id="server-theme"> contiendrait la couleur
// figée au build → FOUC garanti après save admin.
export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fix FOUC — fetch settings/site.primaryColor en SSR via Admin SDK et
  // injecte les CSS variables (--accent-color, --primary, etc.) dans un
  // <style> inline en <head>. Le premier paint utilise la bonne couleur,
  // plus de flash 1s entre la couleur du :root et la couleur sauvegardée.
  // Le ThemeProvider client reste actif pour les updates realtime admin.
  const theme = await getServerTheme();
  const themeStyle = buildThemeStyleString(theme);
  // Fix #128 — Lecture brand logos uploadés par admin. Si présents, on injecte
  // des <link> explicites qui écrasent les défauts statiques /icons/*.png.
  const brand = await getServerBrand();
  const v = brand?.version ? `?v=${brand.version}` : '';

  return (
    <html lang="fr" className={`dark ${jakarta.variable}`}>
      <head>
        <style id="server-theme" dangerouslySetInnerHTML={{ __html: themeStyle }} />
        {/* Fix #128 — Si admin a configuré des logos, on les injecte avant les
            défauts statiques pour qu'ils gagnent la priorité (le navigateur
            utilise le dernier link déclaré qui matche le rel+sizes). */}
        {brand?.icon32Url && (
          <link rel="icon" type="image/png" sizes="32x32" href={`${brand.icon32Url}${v}`} />
        )}
        {brand?.icon16Url && (
          <link rel="icon" type="image/png" sizes="16x16" href={`${brand.icon16Url}${v}`} />
        )}
        {brand?.icon192Url && (
          <link rel="icon" type="image/png" sizes="192x192" href={`${brand.icon192Url}${v}`} />
        )}
        {brand?.icon512Url && (
          <link rel="icon" type="image/png" sizes="512x512" href={`${brand.icon512Url}${v}`} />
        )}
        {brand?.appleTouch180Url ? (
          <link rel="apple-touch-icon" sizes="180x180" href={`${brand.appleTouch180Url}${v}`} />
        ) : (
          <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png?v=29" />
        )}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* BUG #87 — "black-translucent" laisse passer le contenu du site sous
            la status bar iOS, ce qui crée le trait violet/rose vu par Bassi.
            "black" rend la barre OPAQUE noire complète, comme demandé. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        {/* BUG #87 — meta theme-color explicite multi-variants pour forcer
            la status bar noire sur tous les navigateurs (Chrome Android,
            Safari iOS, Edge mobile, etc.). Sans cette redondance, certains
            navigateurs ignorent le viewport.themeColor de Next.js. */}
        <meta name="theme-color" content="#000000" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#000000" />
        <meta name="msapplication-navbutton-color" content="#000000" />
        {/* Phase 9.5 c46 — iOS PWA splash screens (9 tailles standard).
            Media queries match device-width × device-height × pixel-ratio.
            Fix #128 — Si brand.splash1024Url existe, on l'utilise sur toutes
            les tailles (iOS scale automatiquement avec letterbox noir). Sinon
            on garde les 9 PNG statiques générés via generate-pwa-assets.ts. */}
        {brand?.splash1024Url ? (
          <>
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)" />
            <link rel="apple-touch-startup-image" href={`${brand.splash1024Url}${v}`} media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
          </>
        ) : (
          <>
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-1125-2436.png?v=29" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-750-1334.png?v=29" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-828-1792.png?v=29" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-1170-2532.png?v=29" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-1242-2208.png?v=29" media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-1242-2688.png?v=29" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-1284-2778.png?v=29" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-1536-2048.png?v=29" media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)" />
            <link rel="apple-touch-startup-image" href="/splash/apple-splash-2048-2732.png?v=29" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
          </>
        )}
      </head>
      <body className="font-body">
        <AuthProvider>
          <LanguageProvider>
            <ThemeProvider>
              <BrandProvider initialBrand={brand}>
                <SanctionBanner />
                {children}
                <Toaster />
                <PWARegister />
                <AdminBroadcastModal />
              </BrandProvider>
            </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
