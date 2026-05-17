/**
 * BUG #30 Étape 1 — YouTube embed URL pour page DÉTAIL avec params qui
 * minimisent le branding YouTube et empêchent les redirections externes.
 *
 * Avant : MediaCarousel.tsx (page DÉTAIL) utilisait `item.embedUrl` (bare
 * `https://www.youtube.com/embed/{id}`) → controls par défaut + related
 * videos à la fin + annotations + raccourcis clavier qui ouvrent YT UI.
 * L'utilisateur pouvait facilement quitter Spordateur via les suggestions.
 *
 * Cette version DÉTAIL diffère de getVideoEmbedUrl (LISTE preview autoplay
 * muted loop sans controls) — ici on veut full user controls mais branding
 * minimal.
 *
 * Note ToS YouTube : le mini-logo bottom-right est obligatoire, impossible
 * à retirer. modestbranding=1 minimise le reste.
 *
 * @module
 */

/**
 * @param videoId YouTube videoId (11 chars typiquement, extrait via parseVideoUrl)
 * @returns URL iframe src ready-to-use, ou null si videoId vide/whitespace
 */
export function buildYoutubeDetailEmbedUrl(videoId: string | null | undefined): string | null {
  if (!videoId || typeof videoId !== 'string') return null;
  const id = videoId.trim();
  if (!id) return null;

  const params = new URLSearchParams({
    controls: '1',         // user controls (play/pause/timeline/volume)
    modestbranding: '1',   // pas de gros logo YouTube
    rel: '0',              // pas de vidéos suggérées
    iv_load_policy: '3',   // pas d'annotations (cartes / écrans de fin)
    disablekb: '1',        // pas de raccourcis clavier qui ouvrent YT UI
    fs: '1',               // autorise fullscreen
    playsinline: '1',      // iOS Safari : pas de hard fullscreen
  });

  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}
