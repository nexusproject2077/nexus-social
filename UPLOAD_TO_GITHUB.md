# 📦 Instructions pour uploader tous les fichiers frontend sur GitHub

## Problème
De nombreux fichiers sont manquants sur GitHub, notamment :
- Tous les composants dans `app/frontend/src/components/ui/` (46 fichiers)
- Les composants custom
- Certaines pages

## ✅ Solution Rapide

### Étape 1 : Télécharger l'archive complète

L'archive `frontend-complete.tar.gz` contient TOUS les fichiers nécessaires.

**Sur votre machine locale :**

```bash
# Si vous avez accès SSH à Emergent
scp user@emergent:/app/frontend-complete.tar.gz ./

# OU téléchargez via l'interface Emergent
```

### Étape 2 : Extraire l'archive

```bash
tar -xzf frontend-complete.tar.gz
```

### Étape 3 : Push sur GitHub

```bash
# Clonez votre repo
git clone https://github.com/nexusproject2077/nexus-social.git
cd nexus-social

# Supprimez l'ancien dossier frontend (si existant)
rm -rf app/frontend/

# Copiez le nouveau dossier complet
cp -r ../frontend app/

# Add, commit et push
git add app/frontend/
git commit -m "Add complete frontend with all components and UI"
git push origin main
```

## ⚠️ Alternative : Upload manuel sur GitHub

Si vous ne pouvez pas utiliser Git en ligne de commande :

### Option A : Via GitHub Web Interface

1. Allez sur https://github.com/nexusproject2077/nexus-social
2. Naviguez vers `app/`
3. Supprimez le dossier `frontend/` existant
4. Cliquez sur "Upload files"
5. Glissez-déposez TOUT le contenu du dossier `frontend/` extrait
6. Commit avec le message : "Add complete frontend"

### Option B : Via GitHub Desktop

1. Installez GitHub Desktop
2. Clonez votre repo
3. Copiez le dossier `frontend/` complet dans `app/`
4. GitHub Desktop détectera tous les changements
5. Commit et push

## 📋 Liste des fichiers critiques manquants

### Composants UI (components/ui/)
```
- sonner.jsx
- button.jsx
- input.jsx
- textarea.jsx
- dialog.jsx
- avatar.jsx
- card.jsx
- label.jsx
- dropdown-menu.jsx
- tabs.jsx
... et 36 autres
```

### Composants Custom
```
- Layout.js
- PostCard.js
- CommentCard.js
- CreatePostModal.js
- EditProfileModal.js
```

### Pages
```
- AuthPage.js
- HomePage.js
- ProfilePage.js
- MessagesPage.js
- NotificationsPage.js
- SearchPage.js
- PostDetailPage.js
```

### Autres
```
- App.js
- App.css
- index.js
- index.css
- hooks/use-toast.js
- lib/utils.js
```

## 🎯 Une fois uploadé

Vercel redéploiera automatiquement et votre application sera en ligne !

**URLs finales :**
- Backend: https://nexus-social-4k3v.onrender.com ✅
- Frontend: https://votre-app.vercel.app (après upload)

---

**Note:** L'archive `frontend-complete.tar.gz` se trouve dans `/app/frontend-complete.tar.gz` sur Emergent.
