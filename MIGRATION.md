# Migration d'hébergeur — Google Cloud Run (backend) + Cloudflare Pages (front)

Objectif : quitter Render (cold start / OOM sur l'offre gratuite) vers une
infra sans mise en veille. **On ne change pas le code métier ni la base** :
MongoDB Atlas reste tel quel, on ne migre que l'hébergement.

```
┌─────────────────────┐     API + WebSocket      ┌──────────────────────┐
│  Cloudflare Pages    │ ───────────────────────▶ │  Google Cloud Run     │
│  (front React build) │                          │  (FastAPI, 1 instance)│
└─────────────────────┘                          └───────────┬──────────┘
                                                              │
                                                    ┌─────────▼─────────┐
                                                    │  MongoDB Atlas     │
                                                    │  + Cloudinary      │
                                                    └────────────────────┘
```

> **Pourquoi Cloud Run et pas Firebase ?** Le code est du FastAPI + MongoDB +
> WebSockets. Firebase (Firestore/Functions) imposerait une réécriture complète
> et gère mal les connexions longues. Cloud Run fait tourner l'app **telle
> quelle** dans un conteneur, gère les WebSockets, et avec `min-instances=1`
> il n'y a **aucun cold start**.

---

## 1. Backend → Google Cloud Run

Pré-requis : un projet Google Cloud + `gcloud` installé et connecté
(`gcloud auth login`, `gcloud config set project <TON_PROJET>`).

Le `Dockerfile` est déjà prêt dans `app/backend/`. **Contexte de build = racine
du dépôt** (le Dockerfile fait `COPY app/backend/…`), ce qui correspond au
déploiement continu Cloud Run. Chemin du Dockerfile à indiquer :
`app/backend/Dockerfile`.

Alternative en ligne de commande (Cloud Build construit depuis la racine) :

```bash
gcloud run deploy nexus-backend \
  --source . \
  --region europe-west1 \            # choisir une région PROCHE de ton cluster Atlas
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 1Gi \
  --min-instances 1 --max-instances 1 \   # 1 instance : voir note « état en mémoire »
  --timeout 3600 \                    # autorise des WebSockets longs (max 60 min/connexion)
  --session-affinity \
  --set-env-vars "$(paste-la-liste-ci-dessous)"
```

À la fin, `gcloud` affiche l'URL du service, du type
`https://nexus-backend-xxxxx-ew.a.run.app`. **Note-la** : c'est ta nouvelle URL
backend (pour le front + le CORS).

> **Note « état en mémoire » :** l'app garde en mémoire les salles de live, des
> caches de classement et le rate-limit — ça suppose **un seul process**. D'où
> `min=max=1`. Pour scaler plus tard, il faudra déporter ces états (Redis).
> WebSockets : `--session-affinity` garde un client sur la même instance.

### Variables d'environnement (à mettre dans `--set-env-vars` ou la console Cloud Run)

**Indispensables :**
| Variable | Rôle |
|---|---|
| `MONGO_URL` | Chaîne de connexion MongoDB Atlas (`mongodb+srv://…`) |
| `DB_NAME` | Nom de la base (ex. `nexus_social`) |
| `SECRET_KEY` | Signature des JWT — **reprends la même qu'actuellement** (sinon tout le monde est déconnecté) |
| `ENCRYPTION_KEY` | Chiffrement des messages — **reprends la même** (sinon les anciens messages ne se déchiffrent plus) |

**Fortement recommandées :**
| Variable | Rôle |
|---|---|
| `CLOUDINARY_URL` | Médias (celle que tu as déjà configurée) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Notifications push |
| `ADMIN_EMAILS` | Comptes admin (migration médias, modération) |
| `CORS_EXTRA_ORIGINS` | **Ton domaine Cloudflare Pages** (voir §3), ex. `https://nexus-social.pages.dev` |
| `FRONTEND_URL` | URL du front (liens dans certains emails/retours) |

**Optionnelles (intégrations — à ne mettre que si tu les utilises) :**
`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` (paiements) ·
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` (emails) ·
`MODERATION_*`, `PERSPECTIVE_API_KEY`, `GOOGLE_VISION_API_KEY`, `NSFW_*`,
`TOXIC_*` (modération) · `MAXMIND_LICENSE_KEY`, `GEOIP_DB_PATH`,
`CLIPS_EU_GEO_BLOCK` (géo-blocage) · `ADSENSE_*`.

> Inutile sur Cloud Run : `RENDER_EXTERNAL_URL` et `KEEP_ALIVE_SECONDS` (le
> keep-alive était un contournement Render ; avec `min-instances=1` il n'y a
> plus de veille).

Astuce sécurité : pour les secrets (SECRET_KEY, ENCRYPTION_KEY, clés Stripe…),
préférer **Secret Manager** (`--set-secrets`) plutôt que `--set-env-vars`.

---

## 2. MongoDB Atlas (aucune migration)

- On garde le **même cluster** et les **mêmes données**.
- Dans Atlas → **Network Access**, autoriser les connexions depuis Cloud Run.
  Le plus simple : `0.0.0.0/0` (ouvert, protégé par identifiants). Pour
  restreindre, il faut un connecteur VPC/NAT (plus avancé).
- Idéalement, le cluster Atlas est dans la **même région** que Cloud Run
  (ex. `europe-west1`) pour minimiser la latence.

---

## 3. Front → Cloudflare Pages

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → sélectionne le dépôt.
2. Réglages de build :
   - **Root directory** : `app/frontend`
   - **Build command** : `npm install && CI=false npm run build`
   - **Build output directory** : `build`
3. **Variables d'environnement** (onglet Settings → Environment variables) :
   - `REACT_APP_BACKEND_URL` = l'URL Cloud Run du §1
     (ex. `https://nexus-backend-xxxxx-ew.a.run.app`)
   - `CI` = `false`
4. Déploie. Cloudflare te donne une URL type `https://nexus-social.pages.dev`.

Le routage SPA (liens profonds `/profil/…`, `/premium`…) est déjà géré par
`app/frontend/public/_redirects` (`/* /index.html 200`), que Cloudflare Pages
respecte. Rien à faire de plus.

---

## 4. Reconnecter les deux (dernière étape)

1. Sur **Cloud Run**, ajoute/complète `CORS_EXTRA_ORIGINS` avec l'URL Pages
   exacte (ex. `https://nexus-social.pages.dev`, plus ton domaine perso si tu
   en branches un), puis redéploie.
2. Le front lit `REACT_APP_BACKEND_URL` au build → l'API **et l'URL WebSocket**
   (temps réel + lives) pointent automatiquement vers Cloud Run (l'URL WS est
   dérivée de l'URL API dans le code).
3. Teste : connexion, fil, envoi de message (WebSocket : la pastille temps réel
   doit se mettre à jour), un live, l'upload d'une photo (→ Cloudinary).

---

## 5. Bascule finale

- Tant que tu n'as pas basculé, l'ancien Render continue de tourner : tu peux
  tester Cloud Run + Pages **en parallèle** sans rien casser.
- Quand tout est validé : branche ton **nom de domaine** sur Cloudflare Pages,
  et tu peux éteindre les services Render.
- `REACT_APP_BACKEND_URL` absent ⇒ le front retombe sur l'ancienne URL Render
  (valeur par défaut dans le code) : pratique pour un rollback rapide.

---

## Récapitulatif des changements de code déjà faits pour cette migration
- `app/frontend/src/App.js` : `BACKEND_URL` lit `REACT_APP_BACKEND_URL`
  (défaut = URL Render actuelle).
- `app/backend/server.py` : le CORS accepte les origines de `CORS_EXTRA_ORIGINS`.
- `app/backend/Dockerfile` + `.dockerignore` : image Cloud Run (uvicorn, WebSockets).
