import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";
import PWARegister from "@/components/PWARegister";
import { SanctionBanner } from "@/components/SanctionBanner";

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
  // Phase 9.5 c14 BUG5 — métadonnées icons explicites + sizes pour cache-bust browser
  // Chrome n'utilise pas toujours `/favicon.ico` automatique, force le link rel via metadata.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"],
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
  themeColor: "#D91CD2",
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
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="font-body">
        <AuthProvider>
          <LanguageProvider>
            <SanctionBanner />
            {children}
            <Toaster />
            <PWARegister />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
