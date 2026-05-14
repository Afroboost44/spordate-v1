import type {NextConfig} from 'next';

const isExport = process.env.NEXT_OUTPUT === 'export';

const nextConfig: NextConfig = {
  // Static export for GitHub Pages preview
  ...(isExport ? { output: 'export', basePath: '/spordate-v1' } : {}),
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
