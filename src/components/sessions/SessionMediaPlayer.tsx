/**
 * Spordateur — Phase 5
 * <SessionMediaPlayer> — Wrapper image OU vidéo pour les médias d'une activity.
 *
 * Comportement :
 * - media.type === 'image' → <Image> Next.js avec lazy loading
 * - media.type === 'video' → <video> avec autoplay CONDITIONNEL :
 *   * IntersectionObserver : play() à l'entrée du viewport, pause() à la sortie
 *   * prefers-reduced-motion: reduce → pas d'autoplay, juste l'image poster statique
 *   * Fallback automatique vers <Image> si la vidéo crash (onError)
 * - media absent → fallback Picsum (placeholder)
 *
 * Charte stricte : noir #000 background si l'image ne charge pas (object-fit: cover).
 *
 * Accessibilité :
 * - alt sur tous les <Image>
 * - <video> sans contrôles (autoplay+muted = pas d'audio jamais)
 * - prefers-reduced-motion respecté (économie batterie + a11y)
 *
 * Performance :
 * - lazy loading par défaut, sauf si priority=true (LCP)
 * - aspect-ratio CSS pour éviter CLS
 * - pause hors viewport = économie batterie/data mobile
 *
 * Usage :
 *   <SessionMediaPlayer media={activity.thumbnailMedia} alt={activity.title} />
 *   <SessionMediaPlayer media={...} alt="..." aspectRatio="4/5" priority />
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

export interface SessionMediaPlayerProps {
  /** Média à afficher. Si absent, affiche un placeholder Picsum. */
  media?: { type: 'image' | 'video'; url: string; posterUrl?: string };
  /** Texte alternatif (skill: alt-text). */
  alt: string;
  /** Ratio d'aspect CSS. Défaut '16/9'. */
  aspectRatio?: '4/5' | '16/9' | '1/1';
  /** Si true, charge en priorité (utile pour LCP du hero). Défaut false. */
  priority?: boolean;
  className?: string;
}

const ASPECT_CLASS: Record<NonNullable<SessionMediaPlayerProps['aspectRatio']>, string> = {
  '4/5': 'aspect-[4/5]',
  '16/9': 'aspect-video',
  '1/1': 'aspect-square',
};

/** Placeholder Picsum déterministe basé sur l'alt text. */
function picsumPlaceholder(alt: string): string {
  const seed = alt.toLowerCase().replace(/\s+/g, '-').slice(0, 30) || 'session';
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/600`;
}

export function SessionMediaPlayer({
  media,
  alt,
  aspectRatio = '16/9',
  priority = false,
  className = '',
}: SessionMediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Détecte prefers-reduced-motion (au mount + écoute changements)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // IntersectionObserver pour autoplay conditionnel des vidéos.
  // videoFailed dans les deps : si la vidéo crash → re-run pour nettoyer (la <video> est unmounted).
  useEffect(() => {
    if (!videoRef.current || !containerRef.current) return;
    if (reducedMotion) {
      // Si reduced-motion, on ne fait pas d'autoplay du tout
      videoRef.current.pause();
      return;
    }

    const video = videoRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            video.play().catch(() => { /* autoplay blocked, OK */ });
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.5 },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [reducedMotion, media?.type, videoFailed]);

  const aspectClass = ASPECT_CLASS[aspectRatio];
  const isVideo = media?.type === 'video' && !videoFailed;
  const fallbackUrl = picsumPlaceholder(alt);
  const imageUrl = media?.type === 'image' ? media.url : (media?.posterUrl ?? fallbackUrl);

  // Si vidéo demandée mais reduced-motion → on affiche juste le poster (image)
  const showImageInsteadOfVideo = isVideo && reducedMotion;

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${aspectClass} bg-black overflow-hidden ${className}`}
    >
      {isVideo && !showImageInsteadOfVideo ? (
        <video
          ref={videoRef}
          src={media!.url}
          poster={media!.posterUrl}
          muted
          loop
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
          aria-label={alt}
          onError={() => setVideoFailed(true)}
        />
      ) : (
        <Image
          src={showImageInsteadOfVideo ? (media?.posterUrl ?? fallbackUrl) : imageUrl}
          alt={alt}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          className="object-cover"
        />
      )}
    </div>
  );
}
