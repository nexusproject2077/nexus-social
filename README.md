# Nexus Social

Nexus Social est un réseau social responsive, pensé d'abord pour mobile. Il réunit publications, profils, messagerie, clips, scores sportifs et centre de match, avec une interface sombre adaptée au téléphone, à la tablette et au bureau.

## Fonctionnalités principales

- Authentification, profils, abonnements et comptes privés.
- Publications texte, images, vidéos et clips ; likes, commentaires, reposts, mentions et historique de visionnage.
- Fil « Pour vous », abonnements et chronologique, tendances et météo.
- Messagerie privée chiffrée P2P, conversations, statut en ligne et confirmations de lecture configurables.
- Paramètres de confidentialité : visibilité du compte, réponses aux stories, mentions, mots masqués, publicité et contrôle des données.
- Scores sportifs en direct et à venir : football et MMA/UFC.
- Favoris d'équipes et recherche de clubs internationaux.
- Centre de match football : événements, statistiques, classement et compositions selon les données disponibles.
- Fiche UFC par combat : portraits, palmarès, comparaison des athlètes et retour explicite vers les scores.

## Données sportives

Les scores et fiches sportives sont obtenus côté serveur à partir des données ESPN puis normalisés avant l'affichage. Chaque fiche UFC reste rattachée à son `event_id` : aucune donnée d'un autre combat ne sert de remplacement.

Les catégories de comparaison (âge, poids, taille, allonge, KO, frappes significatives, soumissions et takedowns) restent toujours visibles. Lorsqu'une donnée n'est pas fournie par la source, Nexus affiche `—` plutôt que d'inventer une valeur.

## Architecture

| Élément | Technologie |
| --- | --- |
| Application web | React 19, React Router, Tailwind CSS, CRACO |
| API | Cloudflare Workers |
| Temps réel | Cloudflare Durable Objects / Realtime Hub |
| Données applicatives | MongoDB |
| Données sportives | ESPN, via le Worker Nexus |

## Structure du dépôt

```text
app/frontend/              Application React
cloudflare-mongo-worker/   API Cloudflare Workers et accès MongoDB
cloudflare-backend/        Services Cloudflare complémentaires
```

## Développement local

### Frontend

```bash
cd app/frontend
yarn install
yarn start
```

L'application démarre habituellement sur `http://localhost:3000`.

### Worker API

```bash
cd cloudflare-mongo-worker
npm install
npx wrangler dev
```

Les secrets et variables de production ne doivent jamais être ajoutés au dépôt. Configure-les dans Cloudflare (secrets/variables du Worker), puis utilisez :

```bash
npx wrangler deploy
```

## Responsive et navigation

- Téléphone : navigation fixe basse, interfaces tactiles et défilement horizontal pour parcourir les groupes de scores.
- Tablette : conservation d'une navigation compacte inspirée du mobile, sans transformation en barre latérale de bureau.
- Bureau : navigation latérale et widgets de scores accessibles depuis le flux.
- Les fiches UFC peuvent être quittées à tout moment par la flèche retour ou la croix présentes dans l'en-tête.

## Confidentialité

Les choix de cookies et de publicité sont gérés séparément des fonctions essentielles. Les intégrations marketing optionnelles ne doivent être chargées ou utilisées qu'après un consentement explicite ; un refus doit bloquer tout suivi marketing, y compris côté serveur.

## Vérification avant déploiement

```bash
# Frontend
cd app/frontend
yarn build

# Worker
cd ../../cloudflare-mongo-worker
npx wrangler deploy --dry-run
```

## Licence

Projet privé. Tous droits réservés.
