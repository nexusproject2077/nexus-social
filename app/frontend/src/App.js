import { useEffect, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import axios from "axios";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import CookieConsent from "./components/CookieConsent";
import EmailVerifyGate from "@/components/EmailVerifyGate";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { initAccent, applyAccent } from "@/lib/accent";
import { syncPrivacyStrictFromUser } from "@/lib/privacyStrict";
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
import AdminMetrics from './pages/AdminMetrics';
import PrivacyCenter from './pages/PrivacyCenter';
import ClipsPage from './pages/ClipsPage';
import ClipsSearchPage from './pages/ClipsSearchPage';
import LiveStream from './pages/LiveStream';
import AboutPage from './pages/content/AboutPage';
import HowItWorksPage from './pages/content/HowItWorksPage';
import GuidesIndexPage from './pages/content/GuidesIndexPage';
import ArticlePage from './pages/content/ArticlePage';
import FaqPage from './pages/content/FaqPage';

// URL du backend. Configurable par variable d'environnement au build
// (REACT_APP_BACKEND_URL) pour pouvoir changer d'hébergeur sans toucher au code
// — ex. pointer vers Google Cloud Run. À défaut, on garde l'URL Render actuelle.
// L'URL WebSocket (temps réel + lives) est dérivée de API → suit automatiquement.
const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "https://nexus-social-4k3v.onrender.com").replace(/\/$/, "");
export const API = `${BACKEND_URL}/api`;

// Base publique du backend (sans /api) — sert à construire les liens miroir
// /clip/:id et /post/:id (pages publiques Open Graph servies côté serveur).
export const PUBLIC_BASE = API.replace(/\/api\/?$/, "");

// Lien public partagé (post/clip) ouvert par un visiteur NON connecté : on ne
// le renvoie JAMAIS vers /auth. On charge la page miroir PUBLIQUE servie par le
// backend (Open Graph + lecture seule + CTA « Ouvrir dans Nexus »).
function MirrorRedirect({ kind, param }) {
  const params = useParams();
  const id = params[param];
  useEffect(() => {
    if (!id) return;
    // Le CTA de la page miroir renvoie ici avec ?connect=1 → l'anonyme est alors
    // dirigé vers l'inscription/connexion (l'objectif : rejoindre la communauté).
    // Sinon (lien ouvert directement en anonyme) → on charge la page miroir
    // publique servie par le backend (lecture seule + Open Graph), jamais /auth.
    const connect = new URLSearchParams(window.location.search).get("connect") === "1";
    if (connect) window.location.replace(`${window.location.origin}/auth`);
    else window.location.replace(`${PUBLIC_BASE}/${kind}/${id}`);
  }, [kind, id]);
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500" />
    </div>
  );
}

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
const PUBLIC_PATHS = ["/auth", "/premium", "/devenir-premium", "/a-propos", "/comment-ca-marche", "/guides", "/faq"];
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
    // Aligne le Mode Confidentialité stricte local sur le compte (suit
    // l'utilisateur d'un appareil à l'autre).
    if (u) syncPrivacyStrictFromUser(u);
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

  // NB : l'enregistrement du Service Worker est fait dans index.js, et le
  // ré-abonnement push silencieux dans l'effet [user?.id] ci-dessus.

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
      {/* Vérification par email obligatoire (remplace la vérification d'identité) :
          l'accès reste bloqué tant que l'adresse n'est pas confirmée. Les admins
          en sont exemptés. */}
      {user && !user.is_admin && user.email_verified === false && (
        <EmailVerifyGate user={user} setUser={setUser} />
      )}
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
          {/* Lien PUBLIC (partage) : connecté → détail dans l'app ; visiteur
              anonyme → page miroir publique (jamais /auth). */}
          <Route
            path="/post/:postId"
            element={user ? <PostDetailPage user={user} /> : <MirrorRedirect kind="post" param="postId" />}
          />
          {/* Pages de CONTENU — PUBLIQUES (accessibles sans connexion, pensées
              pour l'information des visiteurs et le référencement). */}
          <Route path="/a-propos" element={<AboutPage />} />
          <Route path="/comment-ca-marche" element={<HowItWorksPage />} />
          <Route path="/guides" element={<GuidesIndexPage />} />
          <Route path="/guides/:slug" element={<ArticlePage />} />
          <Route path="/faq" element={<FaqPage />} />
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
          {/* Tableau de bord santé de l'app — réservé aux admins (le backend
              renvoie 403 si non-admin ; ici on redirige les non-connectés). */}
          <Route
            path="/admin"
            element={user ? <AdminMetrics user={user} setUser={setUser} /> : <Navigate to="/auth" />}
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
          {/* Lien PUBLIC (partage clip) : connecté → lecteur dans l'app ;
              visiteur anonyme → page miroir publique (jamais /auth). */}
          <Route
            path="/nexus-clips/:clipId"
            element={user ? <ClipsPage user={user} setUser={setUser} /> : <MirrorRedirect kind="clip" param="clipId" />}
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
