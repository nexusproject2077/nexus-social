# Nexus Growth Pack — 5 features

## Contenu
1. **Salle de match** — `MatchRoom.jsx` + bouton dans `MatchCenter`
2. **Défis clips** — `ChallengeBanner` + `lib/challenges.js`
3. **Notifs utiles** — `SmartNotifCard`
4. **Stats créateur** — `CreatorStats` (profil)
5. **Potes proches** — `CloseFriendsPanel` + `lib/closeFriends.js`
6. **Backend** — `growth_features_patch.py` à coller dans `server.py`

## Intégration front

### ProfilePage
```jsx
import CreatorStats from "@/components/CreatorStats";
// sous le header profil :
<CreatorStats userId={userId} isOwn={isOwnProfile} />
```

### SettingsPage
```jsx
import GrowthHub from "@/components/GrowthHub";
// ou les cartes une par une
<GrowthHub user={user} />
```

### HomePage / Feed
```jsx
import ChallengeBanner from "@/components/ChallengeBanner";
<ChallengeBanner />
```

### LiveScores → MatchCenter
Passer `currentUser={user}` à MatchCenter.

### ReferralCard
Si le zip referral n’est pas installé, retire l’import de GrowthHub ou installe referral d’abord.

## Backend
Coller `growth_features_patch.py` dans `server.py` (routes API).

Index Mongo :
```
db.match_room_messages.createIndex({ match_id: 1, created_at: 1 })
```
