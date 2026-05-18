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
  manifest: "/manifest.json",
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
  themeColor: "var(--accent-color)",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`dark ${jakarta.variable}`}>
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png?v=29" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Phase 9.5 c46 — iOS PWA splash screens (9 tailles standard).
            Media queries match device-width × device-height × pixel-ratio.
            Cache-bust v27 = c46 nouveau logo neon depuis logo-source.png. */}
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1125-2436.png?v=29" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-750-1334.png?v=29" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-828-1792.png?v=29" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1170-2532.png?v=29" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1242-2208.png?v=29" media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1242-2688.png?v=29" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1284-2778.png?v=29" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1536-2048.png?v=29" media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-2048-2732.png?v=29" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
      </head>
      <body className="font-body">
        <AuthProvider>
          <LanguageProvider>
            <ThemeProvider>
              <SanctionBanner />
              {children}
              <Toaster />
              <PWARegister />
              <AdminBroadcastModal />
            </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
