# 🧩 Grid Instagram Spordateur — version corrigée

## Pourquoi ton grid précédent ne formait pas le puzzle

Tes 6 images uploadées étaient bien découpées du même poster, MAIS :
- 3 du haut en **667×833** (4:5 portrait)
- 3 du bas en **667×596** (~8:7 quasi carré)
- → Instagram **force le crop 1:1** dans la grille de profil et coupait le bas des portraits + le haut des images du bas → le puzzle ne s'aligne plus.

À ça s'ajoute **l'ordre de publication** : le dernier post publié = position top-left dans le profil. Il faut publier dans l'ordre INVERSE.

---

## ✅ La correction

J'ai reconstitué ton poster complet (2001×1429) → upscale propre à 3240×2160 → redécoupe en **6 carrés 1080×1080 parfaits**.

Plus de crop Instagram. Plus de désalignement. Le puzzle se forme exactement.

## 📂 Fichiers prêts à publier

- `post-0.jpg` → coin haut-gauche du poster (logo + "Sportdateur.com Match. Mo…")
- `post-1.jpg` → coin haut-centre (Bassi + femme avec casque, danse)
- `post-2.jpg` → coin haut-droit (tente Afroboost + couché de soleil)
- `post-3.jpg` → coin bas-gauche (étapes 2/3 MATCH + "REJOINS LA COMMUNAUTÉ SUR SPORTDATEUR.COM")
- `post-4.jpg` → coin bas-centre (icônes CASQUE SILENT / NOUVELLES RENCONTRES / COACHING SPORTIF)
- `post-5.jpg` → coin bas-droit (COURS HEBDOMADAIRES + QR code + horaires)

## 📅 Ordre de publication (INVERSE)

Sur Instagram, le post le plus récent = top-left de la grille. Pour que le poster se reconstitue dans le bon sens, publie **dans cet ordre exact** :

```
1️⃣  post-5.jpg   ← publie EN PREMIER
2️⃣  post-4.jpg
3️⃣  post-3.jpg
4️⃣  post-2.jpg
5️⃣  post-1.jpg
6️⃣  post-0.jpg   ← publie EN DERNIER
```

Résultat sur ton profil après les 6 publications :

```
┌─────────┬─────────┬─────────┐
│ post-0  │ post-1  │ post-2  │   ← rangée haute (dernière publiée)
├─────────┼─────────┼─────────┤
│ post-3  │ post-4  │ post-5  │   ← rangée basse (première publiée)
└─────────┴─────────┴─────────┘
```

## ⏱️ Cadence recommandée

- **5 minutes minimum** entre chaque post pour qu'Instagram ait le temps d'indexer.
- Idéalement, étale sur 6 jours (1 post par jour) pour maximiser la portée et garder un fil cohérent.
- Si tu veux la dimension "campagne flash" → publie les 6 dans la même journée espacés de 2-3h.

## 🚀 Légendes recommandées

Voir le fichier `marketing-prompts-gemini.html` pour les légendes complètes + hashtags.

---

🎯 **Le puzzle va se former cette fois — sans crop, sans désalignement.**
