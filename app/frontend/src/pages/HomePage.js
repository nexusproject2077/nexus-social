import { useState, useEffect, useRef, Fragment } from "react";
import axios from "axios";
import { API } from "../App";
import Layout from "../components/Layout";
import PostCard from "../components/PostCard";
import CreatePostModal from "../components/CreatePostModal";
import StoriesFeed from "../components/StoriesFeed";
import LiveScores from "../components/LiveScores";
import AdSense from "../components/AdSense";
import { Skeleton } from "../components/ui/skeleton";
import PullToRefresh from "../components/PullToRefresh";
import OnboardingOverlay from "../components/OnboardingOverlay";
import { buildMutedMatcher } from "@/lib/mutedWords";
import { toast } from "sonner";

export default function HomePage({ user, setUser }) {
  const PAGE = 8; // petite page → premier affichage rapide (surtout médias lourds)
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [serverWaking, setServerWaking] = useState(false); // backend en cours de réveil (cold start)
  const feedReqRef = useRef(0); // jeton pour annuler des retries devenus obsolètes
  const skipRef = useRef(0);    // pagination : nb de posts déjà chargés
  const sentinelRef = useRef(null); // cible d'observation pour le scroll infini
  const [showCreatePost, setShowCreatePost] = useState(false);
  // "following" | "foryou" — synchronisé avec les onglets du header (mobile) via
  // localStorage + événement. À l'arrivée sur l'accueil, on démarre sur « Pour vous ».
  const [feedType, setFeedType] = useState("foryou");
  // Mode d'ORDONNANCEMENT du fil « Pour vous », contrôlé par l'utilisateur :
  //   "reco"   → algorithme de recommandation (défaut)
  //   "chrono" → ordre strictement chronologique
  //   "mix"    → entrelacement des deux
  // Choix persistant (par appareil) et rechargement fluide au changement.
  const [feedMode, setFeedMode] = useState(() => {
    const m = localStorage.getItem("nexus_feedmode");
    return ["reco", "chrono", "mix"].includes(m) ? m : "reco";
  });

  const selectFeed = (key) => {
    setFeedType(key);
    localStorage.setItem("nexus_feedtab", key);
    window.dispatchEvent(new CustomEvent("nexus:feedtab", { detail: key }));
  };

  const selectMode = (key) => {
    if (key === feedMode) return;
    setFeedMode(key);
    localStorage.setItem("nexus_feedmode", key);
  };

  // Force « Pour vous » à chaque arrivée sur la page d'accueil.
  useEffect(() => { selectFeed("foryou"); }, []);

  // Recharge le fil au changement d'onglet OU de mode d'ordonnancement.
  useEffect(() => {
    fetchFeed();
  }, [feedType, feedMode]);

  // Onglets déplacés dans le header (mobile) : on écoute leurs changements.
  useEffect(() => {
    const onTab = (e) => setFeedType(e.detail || localStorage.getItem("nexus_feedtab") || "foryou");
    window.addEventListener("nexus:feedtab", onTab);
    return () => window.removeEventListener("nexus:feedtab", onTab);
  }, []);

  // Le backend (Render) peut « dormir » et mettre plusieurs secondes/minutes à
  // se réveiller : les 1res requêtes renvoient alors 502/503/504 ou une erreur
  // réseau (affichée comme « CORS » car la page d'erreur de Render n'a pas
  // d'en-têtes CORS). Plutôt que d'échouer, on RÉESSAYE avec backoff en gardant
  // le skeleton, et on informe l'utilisateur que le serveur se réveille.
  // Charge une PAGE du fil. reset=true → repart de zéro (changement d'onglet /
  // pull-to-refresh) ; sinon on ajoute la page suivante (scroll infini).
  // Résilient au cold start Render : réessaie sur 502/503/504/erreur réseau.
  const fetchFeed = async (reset = true) => {
    const myTab = feedType;
    const token = ++feedReqRef.current; // annule les requêtes devenues obsolètes
    if (reset) {
      skipRef.current = 0;
      setLoading(true);
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    setServerWaking(false);
    const myMode = feedMode;
    const base = myTab === "foryou" ? `${API}/feed/foryou` : `${API}/posts/feed`;
    const skip = reset ? 0 : skipRef.current;
    // Le mode (reco/chrono/mix) ne s'applique qu'au fil de découverte « Pour vous ».
    const params = { skip, limit: PAGE };
    if (myTab === "foryou") params.mode = myMode;

    const isTransient = (err) => {
      const s = err?.response?.status;
      return !err?.response || s === 502 || s === 503 || s === 504 || err?.code === "ERR_NETWORK";
    };
    const delays = [2000, 3000, 4000, 6000, 8000, 10000, 12000, 15000];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    for (let attempt = 0; ; attempt++) {
      if (token !== feedReqRef.current) return;
      try {
        const response = await axios.get(base, { params });
        if (token !== feedReqRef.current) return;
        const batch = response.data || [];
        setPosts((prev) => {
          if (reset) return batch;
          // Dédup par id (au cas où le classement se recompose entre 2 pages).
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...batch.filter((p) => !seen.has(p.id))];
        });
        skipRef.current = skip + batch.length;
        setHasMore(batch.length >= PAGE);
        setServerWaking(false);
        setLoading(false);
        setLoadingMore(false);
        return;
      } catch (error) {
        if (token !== feedReqRef.current) return;
        // On ne réessaie longuement que le 1er chargement (reset) ; un « load more »
        // qui échoue s'arrête discrètement (l'utilisateur peut re-scroller).
        if (isTransient(error) && reset && attempt < 12) {
          setServerWaking(true);
          await sleep(delays[Math.min(attempt, delays.length - 1)]);
          continue;
        }
        if (reset) {
          console.error("Erreur lors du chargement du fil:", error);
          toast.error("Impossible de charger le fil. Réessaie dans un instant.");
        }
        setLoading(false);
        setLoadingMore(false);
        return;
      }
    }
  };

  // Scroll infini : charge la page suivante quand le sentinel entre dans l'écran.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
        fetchFeed(false);
      }
    }, { rootMargin: "600px" }); // précharge avant d'atteindre le bas
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadingMore, feedType, feedMode]);

  const handlePostCreated = (newPost) => {
    setPosts([newPost, ...posts]);
    setShowCreatePost(false);
  };

  const handlePostUpdate = (updatedPost) => {
    setPosts(posts.map((p) => (p.id === updatedPost.id ? updatedPost : p)));
  };

  const handlePostDelete = (postId) => {
    setPosts(posts.filter((p) => p.id !== postId));
  };

  // Mots masqués : on retire du fil les publications dont le texte correspond.
  const muteMatch = buildMutedMatcher(user?.muted_words || []);
  const visiblePosts = posts.filter((p) => !muteMatch(p.content));

  return (
    <Layout
      user={user}
      setUser={setUser}
      onCreatePost={() => setShowCreatePost(true)}
    >
      {/* Première expérience : guide léger affiché une seule fois. */}
      <OnboardingOverlay />
      {/* Tirer vers le bas pour rafraîchir le fil (mobile). */}
      <PullToRefresh onRefresh={fetchFeed} />
      <div className="max-w-3xl mx-auto">
        {/* Sticky Header */}
        <header
          className="sticky top-0 z-30 h-16 hidden lg:flex items-center px-8"
          style={{
            backgroundColor: "rgba(11,19,38,0.7)",
            backdropFilter: "blur(20px)",
          }}
        >
          <h1
            className="font-headline font-bold text-xl tracking-tight"
            style={{ color: "#dae2fd" }}
          >
            Fil d'actualité
          </h1>
        </header>

        {/* Stories */}
        <StoriesFeed />

        {/* Scores de foot en direct — carrousel horizontal (mobile ; sur PC ils
            sont dans la colonne Tendances à droite). Optionnel : masqué si
            l'utilisateur a désactivé les scores (show_sports === false). */}
        {(user?.show_sports !== false || user?.show_mma !== false) && (
          <div className="lg:hidden">
            <LiveScores variant="mobile" setUser={setUser} />
          </div>
        )}

        {/* Sélecteur d'ordonnancement du fil « Pour vous » — MOBILE uniquement
            (sur PC, l'ordre est intégré à la ligne d'onglets X ci-dessous). */}
        {feedType === "foryou" && (
          <div
            className="flex lg:hidden items-center gap-5 sm:gap-6 px-4 mt-3"
            role="tablist"
            aria-label="Ordre du fil"
          >
            {[
              { key: "reco", label: "Recommandé" },
              { key: "chrono", label: "Chronologique" },
              { key: "mix", label: "Mix" },
            ].map(({ key, label }) => {
              const active = feedMode === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  data-testid={`feed-mode-${key}`}
                  onClick={() => selectMode(key)}
                  className="relative py-1 text-[13px] sm:text-sm font-bold transition-colors"
                  style={{ color: active ? "var(--nexus-accent)" : "#6b7686" }}
                >
                  {label}
                  {active && (
                    <span
                      className="absolute left-0 right-0 -bottom-0.5 h-[2px] rounded-full"
                      style={{ background: "var(--nexus-accent)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Onglets du fil — PC uniquement : une SEULE ligne d'onglets textuels
            épurés façon X (fin soulignement sous l'onglet actif). Remplace la
            grosse box « Pour vous / Abonnements » et la ligne de filtres.
            Sur mobile, ces onglets sont dans le header + la ligne d'ordre ci-dessus. */}
        <div
          className="hidden lg:flex items-center gap-8 mx-4 mt-4 border-b"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
          role="tablist"
          aria-label="Fil"
        >
          {[
            { key: "foryou",    label: "Pour vous",     active: feedType === "foryou" && feedMode !== "chrono", onClick: () => { selectFeed("foryou"); selectMode("reco"); } },
            { key: "following", label: "Abonnements",   active: feedType === "following",                        onClick: () => selectFeed("following") },
            { key: "chrono",    label: "Chronologique", active: feedType === "foryou" && feedMode === "chrono",  onClick: () => { selectFeed("foryou"); selectMode("chrono"); } },
          ].map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={tab.active}
              data-testid={`feed-tab-${tab.key}`}
              onClick={tab.onClick}
              className="relative py-3 text-[15px] font-bold transition-colors"
              style={{ color: tab.active ? "#e7ecf6" : "#6b7686" }}
            >
              {tab.label}
              {tab.active && (
                <span className="absolute left-0 right-0 -bottom-px h-[3px] rounded-full" style={{ background: "var(--nexus-accent)" }} />
              )}
            </button>
          ))}
        </div>

        {/* Feed — cartes sans fond, séparées par une fine ligne (effet premium). */}
        <div className="px-4 pt-2">
          {loading ? (
            <div className="space-y-4 lg:space-y-6" data-testid="feed-skeleton">
              {serverWaking && (
                <div className="flex items-center gap-3 rounded-2xl px-4 py-3"
                  style={{ backgroundColor: "#171f33", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: "#22d3ee" }} />
                  <p className="text-sm" style={{ color: "#a9b6d9" }}>
                    Le serveur se réveille… le fil arrive dans quelques secondes.
                  </p>
                </div>
              )}
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border p-4 lg:p-5"
                  style={{ backgroundColor: "#171f33", borderColor: "rgba(255,255,255,0.05)" }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-2.5 w-20" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-11/12" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                  <Skeleton className="h-40 w-full rounded-xl mt-4" />
                </div>
              ))}
            </div>
          ) : visiblePosts.length === 0 ? (
            <div className="text-center py-12" style={{ color: "#859397" }}>
              <p className="text-lg">Aucune publication pour le moment</p>
              <p className="text-sm mt-2">
                {feedType === "foryou"
                  ? "Revenez bientôt : le fil « Pour toi » se remplit avec les publications populaires"
                  : "Suivez des utilisateurs pour voir leurs publications ici"}
              </p>
            </div>
          ) : (
            visiblePosts.map((post, index) => (
              <Fragment key={post.id}>
                <PostCard
                  post={post}
                  currentUser={user}
                  onUpdate={handlePostUpdate}
                  onDelete={handlePostDelete}
                />
                {/* Emplacement pub tous les 5 posts — inerte tant qu'AdSense n'est pas configuré + consenti */}
                {index % 5 === 4 && (
                  <div className="my-2">
                    <AdSense slot={process.env.REACT_APP_ADSENSE_SLOT} />
                  </div>
                )}
              </Fragment>
            ))
          )}

          {/* Scroll infini : sentinel observé + indicateur de chargement de page. */}
          {!loading && posts.length > 0 && (
            <div ref={sentinelRef} className="h-10 flex items-center justify-center">
              {loadingMore && (
                <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: "#22d3ee" }} />
              )}
            </div>
          )}
        </div>
      </div>

      <CreatePostModal
        open={showCreatePost}
        onClose={() => setShowCreatePost(false)}
        onPostCreated={handlePostCreated}
      />
    </Layout>
  );
}
