# Guide de Déploiement sur GitHub

Ce guide vous explique comment héberger votre réseau social sur GitHub et le déployer.

## 📋 Prérequis

- Compte GitHub
- Git installé sur votre machine
- Application testée en local

## 🚀 Étapes de Déploiement

### 1. Initialiser le dépôt Git

```bash
cd /app
git init
git add .
git commit -m "Initial commit: Réseau social complet"
```

### 2. Créer un dépôt sur GitHub

1. Allez sur [GitHub](https://github.com)
2. Cliquez sur "New repository"
3. Nommez votre dépôt (ex: `social-network`)
4. Ne cochez PAS "Initialize with README" (car vous en avez déjà un)
5. Cliquez sur "Create repository"

### 3. Connecter votre dépôt local à GitHub

```bash
git remote add origin https://github.com/VOTRE-USERNAME/social-network.git
git branch -M main
git push -u origin main
```

### 4. Fichiers de Configuration Importants

#### `.gitignore`
Le fichier `.gitignore` est déjà configuré pour exclure :
- `node_modules/`
- `.env` (fichiers de configuration sensibles)
- Fichiers de build
- Logs et caches

#### `.env` (À NE PAS POUSSER)
Créez des fichiers `.env.example` pour documenter les variables nécessaires :

**Backend `.env.example`**
```bash
MONGO_URL="mongodb://localhost:27017"
DB_NAME="social_network"
CORS_ORIGINS="*"
SECRET_KEY="your-secret-key-here"
```

**Frontend `.env.example`**
```bash
REACT_APP_BACKEND_URL=http://localhost:8001
```

### 5. Options d'Hébergement

#### Option A: Vercel (Recommandé pour le Frontend)

1. **Frontend sur Vercel**
   ```bash
   cd frontend
   # Installer Vercel CLI
   npm i -g vercel
   
   # Déployer
   vercel
   ```

2. **Configuration Vercel**
   - Build Command: `yarn build`
   - Output Directory: `build`
   - Environment Variables: Ajouter `REACT_APP_BACKEND_URL`

#### Option B: Render (Backend + Frontend)

1. **Backend sur Render**
   - Service Type: Web Service
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - Environment Variables: Ajouter toutes les variables .env

2. **Frontend sur Render**
   - Service Type: Static Site
   - Build Command: `cd frontend && yarn && yarn build`
   - Publish Directory: `frontend/build`

#### Option C: Heroku

1. **Créer un Procfile à la racine**
   ```
   web: cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT
   ```

2. **Déployer**
   ```bash
   heroku create nom-de-votre-app
   heroku config:set MONGO_URL="your-mongodb-url"
   heroku config:set DB_NAME="social_network"
   heroku config:set SECRET_KEY="your-secret-key"
   git push heroku main
   ```

#### Option D: Docker (Pour tout déployer ensemble)

1. **Créer un `docker-compose.yml`**
   ```yaml
   version: '3.8'
   services:
     mongodb:
       image: mongo:latest
       ports:
         - "27017:27017"
       volumes:
         - mongo-data:/data/db
     
     backend:
       build: ./backend
       ports:
         - "8001:8001"
       environment:
         - MONGO_URL=mongodb://mongodb:27017
         - DB_NAME=social_network
         - SECRET_KEY=${SECRET_KEY}
       depends_on:
         - mongodb
     
     frontend:
       build: ./frontend
       ports:
         - "3000:3000"
       environment:
         - REACT_APP_BACKEND_URL=http://localhost:8001
       depends_on:
         - backend
   
   volumes:
     mongo-data:
   ```

2. **Créer des Dockerfiles**
   
   **Backend Dockerfile** (`backend/Dockerfile`)
   ```dockerfile
   FROM python:3.10-slim
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install -r requirements.txt
   COPY . .
   CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
   ```
   
   **Frontend Dockerfile** (`frontend/Dockerfile`)
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package.json yarn.lock ./
   RUN yarn install
   COPY . .
   RUN yarn build
   CMD ["npx", "serve", "-s", "build", "-l", "3000"]
   ```

3. **Lancer avec Docker**
   ```bash
   docker-compose up -d
   ```

### 6. Base de Données MongoDB

Pour la production, utilisez un service MongoDB hébergé :

#### MongoDB Atlas (Gratuit)
1. Créez un compte sur [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Créez un cluster gratuit
3. Configurez l'accès réseau (IP Whitelist)
4. Créez un utilisateur de base de données
5. Obtenez votre connection string
6. Mettez à jour `MONGO_URL` dans vos variables d'environnement

### 7. Sécurité en Production

⚠️ **Important : Avant de déployer en production**

1. **Changez le SECRET_KEY**
   ```bash
   # Générer une nouvelle clé secrète
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. **Configurez CORS correctement**
   ```python
   # Dans server.py
   CORS_ORIGINS = "https://votre-domaine.com,https://www.votre-domaine.com"
   ```

3. **Activez HTTPS**
   - La plupart des plateformes (Vercel, Render, Heroku) fournissent HTTPS automatiquement

4. **Variables d'environnement**
   - Ne committez JAMAIS vos fichiers `.env`
   - Utilisez les gestionnaires de secrets de votre plateforme

### 8. Mise à Jour Continue

Pour mettre à jour votre application :

```bash
# Faire vos modifications
git add .
git commit -m "Description de vos changements"
git push origin main
```

La plupart des plateformes redéploieront automatiquement lors d'un push sur la branche principale.

### 9. Monitoring et Maintenance

- **Logs** : Consultez les logs de votre plateforme pour déboguer
- **Performance** : Utilisez des outils comme Lighthouse pour optimiser
- **Sauvegardes** : Configurez des sauvegardes automatiques de MongoDB
- **Analytics** : Ajoutez Google Analytics ou similaire si nécessaire

## 📞 Support

Si vous rencontrez des problèmes :
1. Vérifiez les logs de votre plateforme
2. Assurez-vous que toutes les variables d'environnement sont correctement configurées
3. Testez localement avec les mêmes configurations

## 🔗 Ressources Utiles

- [Documentation Vercel](https://vercel.com/docs)
- [Documentation Render](https://render.com/docs)
- [Documentation Heroku](https://devcenter.heroku.com/)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)
- [Docker Documentation](https://docs.docker.com/)

---

Bon déploiement ! 🚀
