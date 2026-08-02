import { useEffect, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { Toaster } from "./components/ui/sonner";
import CookieConsent from "./components/CookieConsent";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { initAccent, applyAccent } from "@/lib/accent";
import { enablePush } from "@/lib/push";
import { GeoProvider } from "@/context/GeoContext";
import AuthPage from "./pages/AuthPage";
import HomePage from "./pages/HomePage";
import ProfilePage from "./pages/ProfilePage";
import MessagesPage from "./pages/MessagesPage";
import NotificationsPage from "./pages/NotificationsPage";
import SearchPage from "./pages/SearchPage";
import PostDetailPage from "./pages/PostDetailPage";
import PremiumPage from "./pages/PremiumPage";
import SavedPage from "./pages/SavedPage";
import SettingsPage from "./pages/SettingsPage";
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import PrivacyCenter from './pages/PrivacyCenter';
import ClipsPage from './pages/ClipsPage';
import ClipsSearchPage from './pages/ClipsSearchPage';
import LiveStream from './pages/LiveStream';

// URL du backend (NE CHANGE PLUS JAMAIS)
const BACKEND_URL = "https://nexus-social-4k3v.onrender.com";
export const API = `${BACKEND_URL}/api`;

// INTERCEPTOR AXIOS – ENVOIE LE TOKEN À CHAQUE REQUÊTE (LA CLÉ DE LA VICTOIRE)
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Intercepteur de réponse : on ne déconnecte QUE sur un vrai 401 (token
// invalide/expiré). Les erreurs réseau / 5xx (ex. cold start Render) n'ont pas
// de `response` → on ne touche pas à la session, l'utilisateur reste connecté.
// Pages PUBLIQUES : accessibles sans connexion. Un 401 déclenché par un appel
// en arrière-plan (suivi, badges…) ne doit JAMAIS éjecter le visiteur de ces
// pages vers /auth — sinon /premium, /cgu… deviennent inaccessibles déconnecté.
const PUBLIC_PATHS = ["/auth", "/premium", "/devenir-premium"];
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("nexus_user");
      const path = window.location.pathname;
      // Pas de redirection si on est déjà sur une page publique.
      if (!PUBLIC_PATHS.some((p) => path.startsWith(p))) {
        window.location.href = "/auth";
      }
    }
    return Promise.reject(error);
  }
);

// Utilisateur mis en cache (hydratation optimiste) : permet de rester sur la
// page courante lors d'un refresh, même si /auth/me met du temps à répondre.
const cachedUser = (() => {
  try { return JSON.parse(localStorage.getItem("nexus_user") || "null"); } catch { return null; }
})();

function App() {
  const [user, setUserState] = useState(cachedUser);
  // On n'affiche le spinner plein écran QUE si on n'a aucun utilisateur en cache
  // mais un token à vérifier (premier chargement). Sinon on rend tout de suite.
  const [loading, setLoading] = useState(!cachedUser && !!localStorage.getItem("token"));

  // setUser persistant : chaque mise à jour est mise en cache (et purgée à la
  // déconnexion). Passé aux pages/enfants à la place de setUser brut.
  const setUser = (u) => {
    setUserState(u);
    try {
      if (u) localStorage.setItem("nexus_user", JSON.stringify(u));
      else localStorage.removeItem("nexus_user");
    } catch { /* quota */ }
  };

  // ✅ Active le time tracking
  useTimeTracking(user);

  // Ré-abonnement push silencieux : si l'utilisateur est connecté et a déjà
  // autorisé les notifications, on (re)synchronise l'abonnement côté serveur
  // (l'abonnement navigateur peut expirer/changer). Ne demande jamais la
  // permission ici — c'est fait sur action explicite (cloche/paramètres).
  useEffect(() => {
    if (user?.id) enablePush({ interactive: false });
  }, [user?.id]);

  const checkAuth = async (attempt = 0) => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await axios.get(`${API}/auth/me`);
      setUser(response.data);
      if (response.data?.accent_color) {
        applyAccent(response.data.accent_color);
      }
      setLoading(false);
    } catch (error) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        // Token réellement invalide → déconnexion.
        localStorage.removeItem("token");
        setUser(null);
        setLoading(false);
      } else if (attempt < 4) {
        // Erreur transitoire (réseau, cold start Render…) : on retente sans
        // déconnecter, pour ne PAS éjecter l'utilisateur de sa page.
        setTimeout(() => checkAuth(attempt + 1), 1000 * (attempt + 1));
      } else {
        // Échecs répétés : on arrête le spinner mais on GARDE la session
        // (utilisateur en cache s'il existe) → on reste sur la page courante.
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    initAccent(); // Applique la couleur d'accentuation choisie
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <GeoProvider>
    <div className="App">
      <Toaster position="top-center" richColors />
      <CookieConsent />
      <BrowserRouter>
        <Routes>
          <Route
            path="/auth"
            element={!user ? <AuthPage setUser={setUser} /> : <Navigate to="/feed" />}
          />
          {/* Accueil : l'URL canonique est /feed. "/" redirige vers /feed. */}
          <Route path="/" element={<Navigate to="/feed" replace />} />
          <Route
            path="/feed"
            element={user ? <HomePage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          {/* Profil : /profil/:userId est l'URL partageable ; /profile/:userId reste un alias. */}
          <Route
            path="/profil/:userId"
            element={user ? <ProfilePage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/profile/:userId"
            element={user ? <ProfilePage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/messages"
            element={user ? <MessagesPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/messages/:userId"
            element={user ? <MessagesPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/messages/group/:groupId"
            element={user ? <MessagesPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/notifications"
            element={user ? <NotificationsPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/search"
            element={user ? <SearchPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/post/:postId"
            element={user ? <PostDetailPage user={user} /> : <Navigate to="/auth" />}
          />
          {/* Page « Devenir Premium » — PUBLIQUE (visible sans connexion : les
              produits/tarifs doivent être accessibles publiquement). */}
          <Route path="/premium" element={<PremiumPage />} />
          <Route path="/devenir-premium" element={<PremiumPage />} />
          {/* Publications et clips enregistrés (bouton signet). */}
          <Route
            path="/enregistres"
            element={user ? <SavedPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/saved"
            element={user ? <SavedPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route 
            path="/analytics" 
           element={<AnalyticsDashboard user={user} setUser={setUser} />} 
          />
          <Route
            path="/privacy-center"
            element={user ? <PrivacyCenter user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          {/* Nexus Clips : /nexus-clips est l'URL canonique ; /nexus-clips/:clipId
              ouvre (et permet de partager) une vidéo précise. /clips reste un alias. */}
          {/* Recherche dédiée Nexus Clips (distincte de /search). */}
          <Route
            path="/nexus-clips/recherche"
            element={user ? <ClipsSearchPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/clips/recherche"
            element={user ? <ClipsSearchPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/nexus-clips"
            element={user ? <ClipsPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/nexus-clips/:clipId"
            element={user ? <ClipsPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/clips"
            element={user ? <ClipsPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/settings"
            element={user ? <SettingsPage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/live"
            element={user ? <LiveStream user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/live/:roomId"
            element={user ? <LiveStream user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          {/* Chemin inconnu → accueil (évite une page blanche). */}
          <Route path="*" element={<Navigate to="/feed" replace />} />
        </Routes>
      </BrowserRouter>
    </div>
    </GeoProvider>
  );
}

export default App;
