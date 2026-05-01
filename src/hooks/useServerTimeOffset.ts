/**
 * Spordateur — Phase 4
 * Hook qui retourne l'offset (ms) entre l'horloge client et l'horloge serveur de référence.
 *
 * Implémentation Phase 4 : SIMPLE, retourne 0 (assume horloges synchronisées via NTP OS).
 * Sur browsers modernes, la dérive est typiquement < 1s, ce qui est acceptable pour un countdown.
 *
 * TODO Phase 7 : si on observe de la dérive en prod (cas réel : user avec OS sans NTP, ou
 * cluster avec drift), raffiner avec une route /api/now + estimation round-trip :
 *   - Au mount : capture clientT1, fetch /api/now, capture clientT2, lit serverT
 *   - offset = serverT - (clientT1 + clientT2) / 2
 *   - Cache en state, retourne l'offset stable jusqu'à la fin du composant
 *
 * Usage :
 *   const offset = useServerTimeOffset();
 *   const now = Date.now() + offset;
 */
export function useServerTimeOffset(): number {
  // Phase 4 : pas de fetch serveur. Hook stateless, retourne 0.
  // Le hook reste un hook (et pas une simple constante) pour permettre la transition Phase 7
  // sans casser les call sites (signature stable : useServerTimeOffset(): number).
  return 0;
}
