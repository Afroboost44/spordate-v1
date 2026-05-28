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
    <html lang="fr" className={`dark ${jakarta.variable}`} style={{ backgroundColor: '#000000' }}>
      <head>
        {/* Bug fix Bassi 28/05 (flash blanc splash PWA) — On force le fond
            noir dès la PREMIÈRE balise <head> via un <style> inline. Sans
            ça, le user-agent (Chrome Android, Safari iOS PWA) affiche un
            écran blanc default tant que la CSS app n'est pas chargée, ce
            qui provoque un flash BLANC visible avant que le splash noir du
            manifest prenne le relais. Ce <style> est appliqué AVANT toute
            autre règle (avant `globals.css`, avant Tailwind base) car le
            navigateur lit le HTML dans l'ordre. Le `!important` couvre les
            règles user-agent (Chrome a parfois un `background-color: white`
            default sur html/body en mode mobile). */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              'html,body{background-color:#000000 !important;}html{color-scheme:dark;}',
          }}
        />
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
        {/* Fix #207 — Splash screen iOS PWA.
            BUG résolu : avant, on déclarait 9 <link rel="apple-touch-startup-image">
            tous pointant vers le MÊME splash1024Url (1024×1024). iOS ne peut
            pas adapter ce splash carré aux résolutions iPhone modernes
            (notamment iPhone 14 Pro = 1179×2556, iPhone 16 = 1206×2622).
            Quand iOS ne trouve PAS de splash matchant la résolution exacte
            du device, il fallback sur du BLANC PUR et centre l'image. C'est
            EXACTEMENT le bug visible chez Bassi : fond blanc + boîte noire
            opaque (le splash 1024×1024 avec son fond noir) centrée dessus.
            Solution : on n'injecte plus AUCUN apple-touch-startup-image.
            iOS, à défaut de splash, utilise alors l'icône apple-touch-icon
            sur le background-color du manifest (#000000 noir). Résultat :
            fond noir uni + icône logo centrée — premium et cohérent dark mode.
            Quand iOS 17+ implementera la spec PWA `display_override: ["browser"]`
            avec splash dynamique inline, on pourra revenir à un splash custom. */}
      </head>
      <body className="font-body" style={{ backgroundColor: '#000000' }}>
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
