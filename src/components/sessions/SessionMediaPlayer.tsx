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
import {
  SPORDATEUR_LOGO_FALLBACK,
  resolveMediaImageSrc,
  resolveSessionImageChain,
} from '@/lib/activities/media';

export interface SessionMediaPlayerProps {
  /**
   * Média à afficher. Si absent, affiche un placeholder Picsum.
   *
   * Pour type='video' :
   *  - Si `embedUrl` fourni (YouTube/Vimeo/Drive iframe URL) → rendu <iframe>
   *    (cohérent MediaCarousel c4 + autoplay c6)
   *  - Sinon `url` direct .mp4 → rendu <video> autoplay muted IntersectionObserver
   */
  media?: {
    type: 'image' | 'video';
    url: string;
    posterUrl?: string;
    embedUrl?: string;
    provider?: 'youtube' | 'vimeo' | 'drive' | 'direct';
  };
  /**
   * Phase 9.5 c16 BUG G — Chaîne de fallback URLs pour image.
   * Utilisée si `media.url` (ou la précédente du chain) renvoie 404.
   * Walk via state imgIdx + onError. Ex: YouTube hq → mq → default.
   */
  imageUrlFallbacks?: string[];
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

export function SessionMediaPlayer({
  media,
  imageUrlFallbacks,
  alt,
  aspectRatio = '16/9',
  priority = false,
  className = '',
}: SessionMediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Phase 9.5 c16 BUG G — index dans la fallback chain pour l'image
  const [imgFallbackIdx, setImgFallbackIdx] = useState(0);

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
  // Phase 9.5 c18 BUG J — si media.embedUrl présent (YouTube/Vimeo/Drive), rendu iframe
  const isIframeEmbed = media?.type === 'video' && !!media.embedUrl;
  const isVideo = media?.type === 'video' && !videoFailed && !isIframeEmbed;

  // Phase 9.5 c16 BUG G + BUG #2 — chaîne d'URLs image (primary → fallbacks → logo
  // Spordateur). Walk via state imgFallbackIdx ; le DERNIER élément est toujours le
  // logo Spordateur — fini la photo random Picsum ("tasse de café").
  const primaryImg = media?.type === 'image' ? media.url : (media?.posterUrl ?? null);
  const imgChain = resolveSessionImageChain(primaryImg, imageUrlFallbacks);
  const lastIdx = imgChain.length - 1;
  const imageUrl = imgChain[Math.min(imgFallbackIdx, lastIdx)];
  // "Exhausted" = on a atteint le logo Spordateur en bout de chaîne → stop walk.
  const exhaustedChain = imgFallbackIdx >= lastIdx;

  // Si vidéo demandée mais reduced-motion → on affiche juste le poster (image)
  const showImageInsteadOfVideo = isVideo && reducedMotion;
  // src final de la branche <Image> + détection du fallback logo (→ object-contain
  // pour afficher le logo entier centré sur fond noir, pas un crop object-cover).
  const imageSrc = showImageInsteadOfVideo
    ? resolveMediaImageSrc(media?.posterUrl)
    : imageUrl;
  const isLogoFallback = imageSrc === SPORDATEUR_LOGO_FALLBACK;

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${aspectClass} bg-black overflow-hidden ${className}`}
    >
      {isIframeEmbed ? (
        /* Phase 9.5 c18 BUG J — iframe embed YouTube/Vimeo/Drive (cohérent MediaCarousel c4) */
        <iframe
          src={media!.embedUrl}
          title={`Vidéo ${media!.provider ?? ''}`.trim()}
          className="absolute inset-0 w-full h-full"
          frameBorder="0"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; autoplay"
          allowFullScreen
          loading={priority ? 'eager' : 'lazy'}
        />
      ) : isVideo && !showImageInsteadOfVideo ? (
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
          src={imageSrc}
          alt={alt}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          className={isLogoFallback ? 'object-contain p-8' : 'object-cover'}
          // Phase 9.5 c16 BUG G + BUG #2 — walker la chaîne fallback si l'image
          // courante 404 ; s'arrête sur le logo Spordateur (dernier élément).
          onError={() => {
            if (!exhaustedChain) {
              setImgFallbackIdx((i) => i + 1);
            }
          }}
        />
      )}
    </div>
  );
}
