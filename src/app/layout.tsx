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
  // Fix #205 — On NE déclare PLUS les icons statiques dans metadata.icons.
  // Raison : Next.js Metadata API injecte ces <link> AVANT ceux qu'on injecte
  // manuellement dans <head>, ce qui fait que sur certains navigateurs (Chrome
  // mobile install dialog, iOS PWA dialog) le logo "S" statique fallback était
  // détecté même lorsque brand.icon192Url custom existait dans Firestore.
  //
  // La nouvelle logique est strictement gérée dans le RootLayout ci-dessous :
  //   - Si brand custom configuré → on injecte UNIQUEMENT les <link> custom
  //   - Sinon → on injecte UNIQUEMENT les <link> statiques fallback /icons/*
  //
  // Plus jamais les deux côte-à-côte = plus jamais de réapparition du "S".
  // Fix #206 — OG/Twitter images statiques retirées (l'ancien /og-image.png
  // contenait l'ancien logo "S" et a été supprimé physiquement du repo). Si
  // l'admin a uploadé un brand custom avec ogImageUrl, on l'utilisera ici dès
  // que le slot sera ajouté au schéma. En attendant, pas de preview social
  // statique plutôt qu'un faux preview avec l'ancien logo.
  openGraph: {
    title: "Spordateur",
    description: "Sport pour de vraies rencontres en Suisse romande.",
    type: "website",
    locale: "fr_CH",
  },
  twitter: {
    card: "summary_large_image",
    title: "Spordateur",
    description: "Sport pour de vraies rencontres en Suisse romande.",
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
  // Fix #128 + #205 — Lecture brand logos uploadés par admin. Logique STRICTE :
  // si admin a uploadé un set complet → ON N'INJECTE JAMAIS le fallback "S"
  // statique. Sinon → on retombe sur les PNG statiques /icons/* (fallback légal
  // si l'admin n'a pas encore configuré son logo).
  const brand = await getServerBrand();
  const v = brand?.version ? `?v=${brand.version}` : '';
  // Fix #205 — "hasBrand" = au moins UN slot custom dispo. Dès qu'il y en a un,
  // on rentre en mode "tout custom", on n'injecte plus de fallback statique.
  const hasBrand = !!(
    brand?.icon16Url ||
    brand?.icon32Url ||
    brand?.icon192Url ||
    brand?.icon512Url ||
    brand?.appleTouch180Url
  );

  return (
    <html lang="fr" className={`dark ${jakarta.variable}`}>
      <head>
        <style id="server-theme" dangerouslySetInnerHTML={{ __html: themeStyle }} />
        {/* Fix #128 + #205 — STRICT : si admin a uploadé un logo, on injecte
            UNIQUEMENT les <link> custom. Sinon UNIQUEMENT les <link> statiques.
            Plus jamais les deux ensemble → plus de réapparition du "S" cache. */}
        {hasBrand ? (
          <>
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
            {brand?.appleTouch180Url && (
              <link rel="apple-touch-icon" sizes="180x180" href={`${brand.appleTouch180Url}${v}`} />
            )}
          </>
        ) : (
          <>
            {/* Fix #206 — Tous les anciens logos "S" statiques ont été supprimés
                physiquement du repo. On utilise un seul placeholder neutre rose
                accent (#D91CD2, 192×192 uni, aucun motif "S") pour TOUTES les
                tailles, le temps que l'admin uploade son brand custom. */}
            <link rel="icon" type="image/png" sizes="32x32" href="/icons/placeholder.png?v=32" />
            <link rel="icon" type="image/png" sizes="16x16" href="/icons/placeholder.png?v=32" />
            <link rel="icon" type="image/png" sizes="192x192" href="/icons/placeholder.png?v=32" />
            <link rel="icon" type="image/png" sizes="512x512" href="/icons/placeholder.png?v=32" />
            <link rel="apple-touch-icon" sizes="180x180" href="/icons/placeholder.png?v=32" />
          </>
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
        ) : null}
        {/* Fix #206 — Tous les anciens splash PNG "S" statiques ont été
            supprimés physiquement du repo. Sans brand.splash1024Url custom,
            iOS affichera le fond noir par défaut au lancement (cohérent
            background_color du manifest). C'est ce que Bassi veut : plus
            jamais l'ancien logo "S", même au splash screen. */}
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
