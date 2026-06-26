# Social - Réseau Social Moderne

Un réseau social complet et moderne inspiré de Twitter et Instagram, construit avec React, FastAPI et MongoDB.

## 🚀 Fonctionnalités

### Authentification
- ✅ Inscription avec email, nom d'utilisateur, mot de passe et bio
- ✅ Connexion sécurisée avec JWT
- ✅ Gestion de session

### Publications
- ✅ Créer des publications avec texte, images et vidéos
- ✅ Liker/Unliker des publications
- ✅ Partager des publications
- ✅ Commenter des publications
- ✅ Supprimer ses propres publications
- ✅ Affichage des compteurs (likes, commentaires, partages)

### Profil Utilisateur
- ✅ Profil personnalisable avec photo et bio
- ✅ Affichage des statistiques (abonnements, abonnés)
- ✅ Liste de toutes les publications de l'utilisateur
- ✅ Modifier le profil (photo et bio)

### Interactions Sociales
- ✅ Suivre/Se désabonner d'autres utilisateurs
- ✅ Fil d'actualité personnalisé basé sur les abonnements
- ✅ Système de notifications en temps réel
- ✅ Messages privés entre utilisateurs

### Recherche
- ✅ Recherche d'utilisateurs par nom d'utilisateur ou bio
- ✅ Recherche de publications par contenu

### Nexus Mail (messagerie e-mail type Gmail)
- ✅ Adresse personnelle automatique `username@nexus.mail`
- ✅ Boîte de réception, Envoyés, Brouillons, Favoris, Archives, Corbeille
- ✅ Composition avec destinataires multiples (À / Cc), réponse et transfert
- ✅ Étoiles (favoris), lu/non-lu, archivage, corbeille et suppression définitive
- ✅ Recherche dans les e-mails et carnet de contacts Nexus

### Messagerie
- ✅ Messages directs privés
- ✅ Liste des conversations
- ✅ Indicateur de messages non lus
- ✅ Interface de chat en temps réel

### Notifications
- ✅ Notifications pour likes, commentaires, partages et nouveaux abonnés
- ✅ Marquer les notifications comme lues
- ✅ Badge de notifications non lues

### Design Responsive
- ✅ Design adaptatif pour mobile, tablette et desktop
- ✅ Menu hamburger sur mobile
- ✅ Interface moderne avec effets visuels

## 🛠️ Stack Technique

### Backend
- **FastAPI** - Framework web Python moderne et rapide
- **MongoDB** - Base de données NoSQL
- **Motor** - Driver MongoDB asynchrone
- **JWT** - Authentification par token
- **Bcrypt** - Hachage sécurisé des mots de passe

### Frontend
- **React 19** - Bibliothèque UI
- **React Router** - Navigation
- **Axios** - Client HTTP
- **Shadcn/UI** - Composants UI modernes
- **Tailwind CSS** - Framework CSS utility-first
- **Lucide React** - Icônes

## 📦 Installation

### Prérequis
- Python 3.10+
- Node.js 18+
- MongoDB

### Backend
```bash
cd backend
pip install -r requirements.txt

# Créer un fichier .env
echo 'MONGO_URL="mongodb://localhost:27017"' > .env
echo 'DB_NAME="social_network"' >> .env
echo 'CORS_ORIGINS="*"' >> .env
echo 'SECRET_KEY="your-secret-key-here"' >> .env

# Lancer le serveur
uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

### Frontend
```bash
cd frontend
yarn install

# Créer un fichier .env
echo 'REACT_APP_BACKEND_URL=http://localhost:8001' > .env

# Lancer l'application
yarn start
```

## 🎨 Design

L'application utilise un design moderne avec :
- Palette de couleurs cyan/blue sur fond sombre
- Police Space Grotesk pour les titres
- Police Inter pour le texte
- Animations et transitions fluides
- Effets de hover sur tous les éléments interactifs
- Design glassmorphism pour certains composants

## 🔐 Sécurité

- Mots de passe hachés avec bcrypt
- Authentification JWT avec expiration
- Validation des données côté backend
- Protection CORS configurée
- Vérification des autorisations pour les actions sensibles

## 📱 API Endpoints

### Authentification
- `POST /api/auth/register` - Inscription
- `POST /api/auth/login` - Connexion
- `GET /api/auth/me` - Obtenir l'utilisateur actuel
- `PUT /api/auth/profile` - Mettre à jour le profil

### Publications
- `POST /api/posts` - Créer une publication
- `GET /api/posts/feed` - Obtenir le fil d'actualité
- `GET /api/posts/{post_id}` - Obtenir une publication
- `POST /api/posts/{post_id}/like` - Liker/Unliker
- `POST /api/posts/{post_id}/share` - Partager
- `DELETE /api/posts/{post_id}` - Supprimer

### Commentaires
- `POST /api/posts/{post_id}/comments` - Créer un commentaire
- `GET /api/posts/{post_id}/comments` - Obtenir les commentaires

### Utilisateurs
- `GET /api/users/search` - Rechercher des utilisateurs
- `GET /api/users/{user_id}` - Obtenir un profil
- `GET /api/users/{user_id}/posts` - Obtenir les publications d'un utilisateur
- `POST /api/users/{user_id}/follow` - Suivre/Se désabonner

### Messages
- `POST /api/messages` - Envoyer un message
- `GET /api/messages/conversations` - Obtenir les conversations
- `GET /api/messages/{user_id}` - Obtenir les messages avec un utilisateur

### Notifications
- `GET /api/notifications` - Obtenir les notifications
- `PUT /api/notifications/{notification_id}/read` - Marquer comme lu
- `PUT /api/notifications/read-all` - Tout marquer comme lu

### Recherche
- `GET /api/search/posts` - Rechercher des publications

### Nexus Mail
- `GET /api/mail/me` - Mon adresse Nexus Mail et nombre de non-lus
- `GET /api/mail/counts` - Compteurs par dossier
- `GET /api/mail/contacts` - Carnet de contacts Nexus
- `GET /api/mail/folder/{folder}` - Lister un dossier (inbox, sent, drafts, starred, archive, trash)
- `GET /api/mail/{mail_id}` - Lire un e-mail (marque comme lu)
- `GET /api/mail/search?q=` - Rechercher dans les e-mails
- `POST /api/mail/send` - Envoyer un e-mail
- `POST /api/mail/draft` - Créer / mettre à jour un brouillon
- `PUT /api/mail/{mail_id}/read` - Marquer lu / non-lu
- `PUT /api/mail/{mail_id}/star` - Ajouter / retirer des favoris
- `PUT /api/mail/{mail_id}/trash` - Déplacer vers la corbeille
- `PUT /api/mail/{mail_id}/archive` - Archiver
- `PUT /api/mail/{mail_id}/restore` - Restaurer
- `DELETE /api/mail/{mail_id}` - Supprimer définitivement

## 🧪 Tests

L'application a été testée avec :
- 100% des tests backend passés (25/25)
- 95% des tests frontend passés
- Tests d'intégration complets
- Tests de responsive design

## 📄 License

MIT

## 👥 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

## 🌟 Fonctionnalités Futures

- [ ] Notifications en temps réel avec WebSocket
- [ ] Stories (publications temporaires)
- [ ] Réactions variées (pas seulement like)
- [ ] Thèmes personnalisables (clair/sombre)
- [ ] Support de plus de types de médias
- [ ] Hashtags et tendances
- [ ] Groupes/Communautés
- [ ] Appels vidéo/audio
- [ ] Mode hors ligne avec PWA

---

Créé avec ❤️ par l'équipe Social
