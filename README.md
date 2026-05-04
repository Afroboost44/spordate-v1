# Spordateur

Plateforme suisse de rencontres par le sport et la danse — Next.js 15 (App Router) + Firebase + Tailwind.

## Stack

- **Next.js 15** App Router + React 19 + Turbopack
- **Firebase** : Firestore + Auth + Storage + Rules
- **Tailwind 3** — charte stricte black / `#D91CD2` / white
- **Stripe** + **TWINT** Suisse
- **Resend** (transactional email)
- **Genkit** (Google AI / IA-assistée)

## Quickstart

```bash
npm install
cp .env.example .env.local   # remplir Firebase keys + RESEND_API_KEY
npm run dev                  # http://localhost:3000
```

Cf. [`CLAUDE.md`](./CLAUDE.md) pour la liste complète des commandes (build, déploiement, émulateurs, tests).

## Trust & Safety (Phase 7)

Couche T&S complète shipped mai 2026 — 6 sub-chantiers, ~372 tests passing.

**Modules** :
- **Reviews** publiques 1-5★ avec anonymisation graduée 1-2★ (modération admin pré-pub)
- **Block list** user-side mutuelle invisibilité (silencieux, anti-confrontation)
- **Reports** formels anonymes (6 catégories) + thresholds rolling 12mo
- **No-show workflow** partner check-in (grâce 30min, undo 24h, thresholds 90j)
- **Sanctions** auto-trigger 4 niveaux (warning/7j/30j/permanent) + appeals 1×/niveau
- **Admin moderation dashboard** MVP (queues + decisions + audit trail 24mo)
- **Email notifications** Resend transactional (12 templates wirés)
- **Audit trail** `adminActions/` collection

**Doctrine** : `architecture.md` §9.sexies (sections A-J).
**Guide consolidé** : [`docs/phase-7-trust-safety.md`](./docs/phase-7-trust-safety.md).

## Tests

```bash
npm run typecheck                       # TypeScript
npm run test:email                      # Resend wrapper + templates
npm run test:reviews                    # Reviews service
npm run test:reviews:rules              # Reviews Firestore rules
npm run test:blocks                     # Block list service
npm run test:blocks:rules               # Block list Firestore rules
npm run test:reports                    # Reports service + admin actions
npm run test:reports:no-show            # No-show + sanctions + appeals
npm run test:reports:rules              # Reports/Sanctions Firestore rules
npm run test:reports:admin              # Admin actions service
npm run test:reports:co-inscribed       # getCoInscribedConflicts
npm run test:admin-actions              # Audit trail service
npm run test:admin-actions:rules        # Audit trail Firestore rules
```

Tests emulator-based via `@firebase/rules-unit-testing` v4 + mini test runner (npx tsx).

## Documentation

- [`architecture.md`](./architecture.md) — doctrine produit + Phase ledger (source de vérité)
- [`CLAUDE.md`](./CLAUDE.md) — commandes opérationnelles
- [`.clauderules`](./.clauderules) — règles design + code
- [`docs/phase-7-trust-safety.md`](./docs/phase-7-trust-safety.md) — guide T&S consolidé

## Contributing

Avant tout commit :
```bash
npm run typecheck
# Lancer les tests pertinents pour la zone modifiée
```

Workflow : feature branch → PR → review → merge `main`. Pas de force push sur `main`.

## License

Propriétaire — Spordate Sàrl, Suisse.
