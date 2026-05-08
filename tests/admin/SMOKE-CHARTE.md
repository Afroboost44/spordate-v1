# Phase 9 SC0 c2/X — Smoke checklist charte stricte admin

Tests automated SC0 c1/X (15 RR + 16 PG + 47 no-show régression). Ce doc complète
avec les paths visuels admin migrés vers charte stricte (.clauderules : black /
#D91CD2 / white).

## Pré-requis

- Vercel preview ou prod déployé (commit SC0 c2/X)
- Compte admin (`role='admin'` dans Firestore `users/{uid}`)

## Migration patterns appliquée (SC0 c2/X)

| Avant | Après |
|---|---|
| `bg-[#05090e]` (page bg) | `bg-black` |
| `bg-[#0f1115]` (card bg) | `bg-zinc-950` |
| `bg-gray-900` (dialog/card) | `bg-zinc-950` |
| `border-gray-800` | `border-zinc-800` |
| `border-gray-700` (selects) | `border-zinc-700` |
| `text-cyan-400` (accent) | `text-[#D91CD2]` |
| `bg-cyan-900/20 border-cyan-800/50` | `bg-[#D91CD2]/10 border-[#D91CD2]/30` |
| `bg-cyan-600 hover:bg-cyan-500` (CTA) | `bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2] hover:opacity-90` |
| `bg-blue-500/20 text-blue-400 border-blue-500/30` (info badge) | `bg-[#D91CD2]/15 text-[#D91CD2] border-[#D91CD2]/30` |
| `bg-gradient-to-t from-cyan-500 to-cyan-400` (chart bars) | `bg-gradient-to-t from-[#7B1FA2] to-[#D91CD2]` |
| `bg-gradient-to-r from-cyan-600 to-blue-600` (CTA) | `bg-gradient-to-r from-[#7B1FA2] to-[#D91CD2]` |

## Couleurs sémantiques préservées (admin)

Conservées intentionnellement pour at-a-glance triage admin (pas user-facing) :
- `text-amber-400` / `bg-amber-500/10` : alertes "en attente d'approbation" (partenaires payés)
- `text-red-400` / `bg-red-500/10` : erreurs (Bug icon, errors tab)
- `text-green-500` (sports active toggle) : Toggle ON indicator
- `text-amber-400` (Crown Premium, Crédits stat) : icônes thématiques stat cards

→ Décision Phase 9 : charte stricte structurelle (bg/borders/CTAs) + sémantique status conservée pour densité info admin.

## Pages admin smoke checklist

### `/admin/login`

- [ ] Background `bg-black` (pleine page)
- [ ] Card login `bg-[#0A0A0A] border-white/10`
- [ ] ShieldAlert icon `#D91CD2`
- [ ] CTA "Continuer avec Google" border `#D91CD2` ; hover bg-[#D91CD2]/10
- [ ] Texte secondaire `text-white/40`

### `/admin/dashboard` (Q2=B AdminGuard layout actif)

- [ ] Loader fullscreen pendant validation auth (spinner #D91CD2)
- [ ] Si non-admin → redirect `/admin/login` (vérifié console reseau)
- [ ] Header dashboard : icon BarChart3 `#D91CD2`, badge `bg-[#D91CD2]/10 border-[#D91CD2]/30`
- [ ] TabsList : `bg-zinc-950/80 border-zinc-800`
- [ ] Cards stats : `bg-zinc-950 border-zinc-800`
- [ ] Boutons "Refresh" : gradient `from-[#7B1FA2] to-[#D91CD2]`
- [ ] Tabs `Reviews / Reports / Sanctions / Appeals` : panels `bg-zinc-950`
- [ ] Bar chart revenus : barres gradient `from-[#7B1FA2] to-[#D91CD2]`
- [ ] AlertDialog send notification : gradient CTA `from-[#7B1FA2] to-[#D91CD2]`

### `/admin/sports`

- [ ] AdminGuard layout actif (no localStorage gate)
- [ ] Status badge : `bg-[#D91CD2]/10 text-[#D91CD2]` "Mode édition activé (admin)"
- [ ] Pas d'unlock UI / code secret input
- [ ] Toggle ON/OFF sport : icône green-500/muted (semantic conservé)
- [ ] Bouton ajout : gradient `from-[#7B1FA2] to-[#E91E63]` (existant, déjà charte-aligned)

### `/admin/manage`

- [ ] Cards `bg-[#1A1A1A] border-white/5` (existing — pas migré, hors scope SC0 c2/X)
- [ ] Badge partenaires icon `text-[#D91CD2]` (Building2)
- [ ] Status amber/red conservés (partenaires en attente, erreurs)

### `/admin/revenue`

- [ ] Stats Crédits vendus icon `text-amber-400` (semantic conservé)
- [ ] Pas de `cyan` / `bg-[#0f1115]` détecté

### Components admin (T&S panels)

- [ ] `<TandSReviewsPanel>` Card `bg-zinc-950 border-zinc-800`
- [ ] `<TandSReportsPanel>` Card `bg-zinc-950 border-zinc-800` + AlertDialog `bg-zinc-950`
- [ ] `<SanctionsTable>` Card + Selects `bg-zinc-950 border-zinc-700/800`
- [ ] `<AppealsTable>` Card + AlertDialog `bg-zinc-950`
- [ ] `<ReviewModerationActionsDialog>` `bg-zinc-950 border-zinc-800`
- [ ] `<SanctionPickerDialog>` `bg-zinc-950 border-zinc-800`
- [ ] Badges info/appeal : `bg-[#D91CD2]/15 text-[#D91CD2] border-[#D91CD2]/30`
- [ ] `<PriorityBadge>` couleurs catégories conservées (rouge urgent / orange haute / jaune moyenne / vert basse) — semantic admin

## Régression check

- [ ] Build SUCCESS Next.js (40 pages)
- [ ] Typecheck clean (`npm run typecheck`)
- [ ] Tests cron review-reminder + purge non régressés
- [ ] User-facing pages (`/discovery`, `/match`, `/chat`, `/sessions/[id]`, `/invite/[id]`) inchangées (no impact)
- [ ] Charte stricte SC4 `<InviteButton>` + `<InviteActionsClient>` toujours `bg-black/#D91CD2/white`

## Différé Phase 10 (admin polish avancé)

- ⏭️ Migration semantic colors (amber/red/green) → palette `#D91CD2`/icônes (charte ultra-stricte)
- ⏭️ Refactor `bg-[#1A1A1A]` (manage page existing) → unified `bg-zinc-950`
- ⏭️ Composant admin design system (Card, TabsList, Dialog) avec defaults charte
