# Phase A — Référral `?ref=CODE` end-to-end : checklist E2E

Cette checklist valide la chaîne complète :

```
landing /?ref=CODE  →  localStorage 'spordateur_ref' (TTL 30j)
       ↓
/signup?ref=CODE    →  localStorage (idempotent overwrite)
       ↓
createUser          →  user.referredBy = CODE + processReferralSignup()
                       (crée doc /referrals + incrémente creator.totalReferrals)
       ↓
/api/checkout       →  body.referralCode = resolveActiveReferralCode(user.referredBy)
       ↓
Stripe metadata     →  metadata.referralCode = CODE
       ↓
Webhook stripe      →  processCommission(amount, CODE)
                       - Si creator : +commission CHF (creator.totalEarnings/pendingPayout)
                       - Si user    : +1 crédit referral_bonus à l'invitant
```

## Pré-requis

- App déployée sur Vercel (ou local sur `npm run dev` avec Stripe CLI fwd webhook).
- Un user invitant **A** existant avec `referralCode = 'SPORT-VMXX'` (ou autre code lisible).
  - Pour récupérer ton code : `/profile` → bloc parrainage.
- Un email/compte Google **B** jamais inscrit (test fresh signup).
- Carte Stripe test : **4242 4242 4242 4242**, CVV/date au choix.

## 1. Capture `?ref=` côté landing

1. Navigation privée → `https://spordateur.com/?ref=SPORT-VMXX`
2. DevTools → Application → Local Storage → vérifier l'entrée
   `spordateur_ref` = `{"code":"SPORT-VMXX","expiresAt":<timestamp +30j>}`
3. ✅ **Attendu** : entrée présente, `expiresAt` ≈ `Date.now() + 2_592_000_000`.

## 2. Persistance traverse la navigation

1. Cliquer "Commencer" / "Rejoindre" → URL devient `/signup` (sans le `?ref=`)
2. DevTools → Local Storage → l'entrée `spordateur_ref` **persiste**.
3. ✅ **Attendu** : la donnée survit à la navigation SPA.

## 3. Capture directe `/signup?ref=`

1. Navigation privée fraîche → `https://spordateur.com/signup?ref=SPORT-VMXX`
2. DevTools → l'entrée est posée par le useEffect du signup.
3. ✅ **Attendu** : même format qu'au point 1.

## 4. Signup → `user.referredBy` persisté

1. Sur `/signup`, créer un compte B (email + mot de passe, OU "Continuer avec Google").
2. Console Firebase → Firestore → `users/{B.uid}` → vérifier le champ
   `referredBy: "SPORT-VMXX"`.
3. DevTools → Local Storage → l'entrée `spordateur_ref` est **supprimée**
   (consommée par AuthContext).
4. Console Firestore → `referrals` → un doc vient d'être créé
   `{ referrerId: A.uid, referredUserId: B.uid, referralCode: "SPORT-VMXX",
      status: "registered" }`.
5. ✅ **Attendu** : tous les points ci-dessus.

## 5. Achat → commission appliquée

1. Connecté en B → `/payment` → choisir un pack de crédits.
2. Stripe Checkout : carte test `4242 4242 4242 4242`, CVV `123`, date `12/30`.
3. Retour app, succès.
4. Console Stripe (test mode) → la session a `metadata.referralCode = "SPORT-VMXX"`.
5. Console Firestore :
   - Si A est dans `creators` collection : `creators/{A}.totalEarnings` et
     `pendingPayout` ont incrémenté du `amount * commissionRate` (par défaut 10%).
     Une notif type `affiliation` est posée pour A.
   - Si A est uniquement dans `users` (pas creator) : `users/{A.uid}.credits`
     a incrémenté de **+1** (`REFERRAL_BONUS_CREDITS`). Un doc `credits` type
     `referral_bonus` est créé. Une notif type `referral` est posée.
6. ✅ **Attendu** : la commission est créditée selon le chemin (creator vs user).

## 6. Edge — anti-self-referral

1. Connecté en A, ouvrir `https://spordateur.com/?ref=SPORT-VMXX` (le code de A).
2. Tenter un achat.
3. `processCommission` détecte `creatorId === userId` (ou `referrerId === userId`)
   et **skip** silencieusement.
4. ✅ **Attendu** : aucune notif ni credit auto-attribué à soi-même.

## 7. Edge — code invalide

1. Visiter `/?ref=CODE-INEXISTANT`.
2. Suivre les étapes 1-5 avec ce code.
3. `processCommission` ne trouve ni creator ni user → return silently.
4. ✅ **Attendu** : aucun crash, aucune commission, aucune notif. L'achat se
   passe normalement.

## 8. Edge — TTL expiré

1. Capturer un code (étape 1), puis attendre… (impraticable manuellement).
   Alternative : DevTools → modifier l'entrée localStorage et mettre
   `expiresAt` à une valeur passée (`Date.now() - 1000`).
2. Refresh la page de signup → `readReferralCode()` retourne null, entrée
   auto-supprimée.
3. ✅ **Attendu** : `user.referredBy = ''` au signup, pas de commission.

## Tests automatiques disponibles

```bash
npm run test:referral:storage   # 21 cas purs (TTL, SSR, priority, edge)
```

Ne couvre PAS l'intégration Stripe/Firestore (test manuel via cette checklist).

## Si quelque chose plante

- L'entrée localStorage n'est pas posée → vérifier qu'on est sur le bon
  domaine + `?ref=` exact (sensible casse, le code est trim mais pas
  lowercased).
- `user.referredBy` reste vide → vérifier les logs console
  `[Auth] Profil Firestore créé pour ... (ref=...)` au signup.
- Commission ne tombe pas → vérifier `metadata.referralCode` sur la
  session Stripe + les logs webhook `processCommission`.
- Doublons : la fonction est atomic batch côté webhook, idempotent.
