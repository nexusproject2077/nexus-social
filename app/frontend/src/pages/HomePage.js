import { useState, useEffect, Fragment } from "react";
import axios from "axios";
import { API } from "../App";
import Layout from "../components/Layout";
import PostCard from "../components/PostCard";
import CreatePostModal from "../components/CreatePostModal";
import StoriesFeed from "../components/StoriesFeed";
import AdSense from "../components/AdSense";
import { Skeleton } from "../components/ui/skeleton";
import { toast } from "sonner";

export default function HomePage({ user, setUser }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreatePost, setShowCreatePost] = useState(false);
  // "following" | "foryou" — synchronisé avec les onglets du header (mobile) via
  // localStorage + événement. À l'arrivée sur l'accueil, on démarre sur « Pour vous ».
  const [feedType, setFeedType] = useState("foryou");

  const selectFeed = (key) => {
    setFeedType(key);
    localStorage.setItem("nexus_feedtab", key);
    window.dispatchEvent(new CustomEvent("nexus:feedtab", { detail: key }));
  };

  // Force « Pour vous » à chaque arrivée sur la page d'accueil.
  useEffect(() => { selectFeed("foryou"); }, []);

  useEffect(() => {
    fetchFeed();
  }, [feedType]);

  // Onglets déplacés dans le header (mobile) : on écoute leurs changements.
  useEffect(() => {
    const onTab = (e) => setFeedType(e.detail || localStorage.getItem("nexus_feedtab") || "foryou");
    window.addEventListener("nexus:feedtab", onTab);
    return () => window.removeEventListener("nexus:feedtab", onTab);
  }, []);

  const fetchFeed = async () => {
    setLoading(true);
    try {
      // "For You" utilise l'algorithme d'engagement du backend,
      // "Following" garde le fil classique des comptes suivis.
      const endpoint =
        feedType === "foryou" ? `${API}/feed/foryou` : `${API}/posts/feed`;
      const response = await axios.get(endpoint);
      setPosts(response.data);
    } catch (error) {
      console.error("Erreur lors du chargement du fil:", error);
      toast.error("Erreur lors du chargement des publications");
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <Layout
      user={user}
      setUser={setUser}
      onCreatePost={() => setShowCreatePost(true)}
    >
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

        {/* Switch Feed (PC uniquement) — sur mobile ces onglets sont dans le header.
            La box de création « Quoi de neuf ? » a été retirée : on publie via le
            bouton « + ». */}
        <div className="hidden lg:flex items-center gap-2 mx-4 mt-4">
          {[
            { key: "foryou", label: "Pour vous" },
            { key: "following", label: "Abonnements" },
          ].map(({ key, label }) => {
            const active = feedType === key;
            return (
              <button
                key={key}
                data-testid={`feed-toggle-${key}`}
                onClick={() => selectFeed(key)}
                className="flex-1 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={{
                  backgroundColor: active ? "var(--nexus-accent)" : "#171f33",
                  color: active ? "#00363e" : "#859397",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Feed */}
        <div className="px-4 py-4 lg:py-6 space-y-4 lg:space-y-6">
          {loading ? (
            <div className="space-y-4 lg:space-y-6" data-testid="feed-skeleton">
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
          ) : posts.length === 0 ? (
            <div className="text-center py-12" style={{ color: "#859397" }}>
              <p className="text-lg">Aucune publication pour le moment</p>
              <p className="text-sm mt-2">
                {feedType === "foryou"
                  ? "Revenez bientôt : le fil « Pour toi » se remplit avec les publications populaires"
                  : "Suivez des utilisateurs pour voir leurs publications ici"}
              </p>
            </div>
          ) : (
            posts.map((post, index) => (
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
