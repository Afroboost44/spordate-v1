import type {NextConfig} from 'next';

const isExport = process.env.NEXT_OUTPUT === 'export';

// Fix #204 — BUILD_ID injecté dans le client pour cache-busting du Service
// Worker. Sans ça, le navigateur ré-évalue /sw.js seulement quand l'utilisateur
// ferme totalement le browser, ce qui fait tourner l'app sur un SW v30 alors
// que le nouveau bundle JS attend un SW v31 → client crash après quelques min.
// PWARegister.tsx append `?v=${BUILD_ID}` au register() pour forcer le navigateur
// à comparer un body de SW différent → updatefound déclenché → SKIP_WAITING.
const BUILD_ID = process.env.BUILD_ID || String(Date.now());

const nextConfig: NextConfig = {
  // Static export for GitHub Pages preview, sinon `standalone` pour Docker/Coolify
  // (output: 'standalone' produit .next/standalone autonome ~200 Mo vs ~1 Go,
  // critique pour Hetzner 4 Go RAM partagés avec Afroboost).
  ...(isExport ? { output: 'export', basePath: '/spordate-v1' } : { output: 'standalone' }),
  // Phase 8 SC2 hotfix : isolation Genkit + dépendances Node-only côté serveur.
  // Sans ça, webpack tente de bundler @grpc/grpc-js + @opentelemetry/sdk-node
  // dans le client → "Module not found: 'fs'/'tls'/'net'" au build Vercel.
  // Ces packages restent runtime serveur uniquement (route /api/anti-leak).
  serverExternalPackages: [
    'genkit',
    '@genkit-ai/core',
    '@genkit-ai/google-genai',
    '@genkit-ai/next',
    '@opentelemetry/sdk-node',
    '@opentelemetry/exporter-trace-otlp-grpc',
    '@grpc/grpc-js',
    'firebase-admin',
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    // Fix #204 — exposé côté client (NEXT_PUBLIC_) pour cache-bust du SW.
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  // Fix #204 — generateBuildId stable au sein d'un même build (sinon les
  // .next chunks peuvent référencer 2 build IDs différents). En dev, Next.js
  // gère lui-même un ID via HMR — ce hook n'est appelé qu'au build prod.
  generateBuildId: async () => BUILD_ID,
  // Fix #209 (Hypothèse B — cache manifest Android Chrome agressif jusqu'à 7
  // jours) — on force des headers anti-cache stricts sur /manifest.webmanifest.
  // Sans ça, même quand Bassi désinstalle/réinstalle la PWA, Chrome Android
  // peut continuer de servir un VIEUX manifest depuis le HTTP cache (avec
  // d'anciennes icon URLs maskable problématiques). En posant max-age=0 +
  // must-revalidate, le browser DOIT re-fetch le manifest à chaque ouverture
  // PWA → garantit qu'il voit l'état courant du Firestore brand.
  //
  // On set aussi explicitement le Content-Type (Next.js défaut OK mais certains
  // reverse-proxies docker peuvent le réécrire, ceinture+bretelles).
  async headers() {
    return [
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' },
        ],
      },
    ];
  },
  images: {
    unoptimized: isExport, // Required for static export
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        // BUG #2 — miniatures YouTube (resolveMediaImageSrc + imageUrlFallbacks
        // hq→mq→default) servies via next/image dans <SessionMediaPlayer>.
        protocol: 'https',
        hostname: 'img.youtube.com',
        port: '',
        pathname: '/**',
      },
      {
        // BUG #5 — miniatures Google Drive (getVideoThumbnailChain provider=drive
        // → drive.google.com/thumbnail?id=...) servies via next/image.
        protocol: 'https',
        hostname: 'drive.google.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
