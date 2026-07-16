import { useState, useEffect, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "../App";
import Layout from "../components/Layout";
import PostCard from "../components/PostCard";
import CreatePostModal from "../components/CreatePostModal";
import StoriesFeed from "../components/StoriesFeed";
import AdSense from "../components/AdSense";
import { toast } from "sonner";

export default function HomePage({ user, setUser }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [feedType, setFeedType] = useState("following"); // "following" | "foryou"

  useEffect(() => {
    fetchFeed();
  }, [feedType]);

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

        {/* Switch Feed / Reels : Abonnements · Pour toi · Reels (ouvre le lecteur immersif) */}
        <div className="flex items-center gap-2 mx-4 mt-4">
          {[
            { key: "following", label: "Abonnements" },
            { key: "foryou", label: "Pour toi" },
            { key: "reels", label: "Reels", nav: "/clips", icon: "play_circle" },
          ].map(({ key, label, nav, icon }) => {
            const active = !nav && feedType === key;
            return (
              <button
                key={key}
                data-testid={`feed-toggle-${key}`}
                onClick={() => (nav ? navigate(nav) : setFeedType(key))}
                className="flex-1 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5"
                style={{
                  backgroundColor: active ? "#22d3ee" : "#171f33",
                  color: active ? "#00363e" : "#859397",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {icon && <span className="material-symbols-outlined text-base">{icon}</span>}
                {label}
              </button>
            );
          })}
        </div>

        {/* Post Creation Box */}
        <section
          className="mx-4 mt-4 lg:mt-6 rounded-2xl p-4 lg:p-6 border cursor-pointer"
          style={{
            backgroundColor: "#171f33",
            borderColor: "rgba(255,255,255,0.05)",
          }}
          onClick={() => setShowCreatePost(true)}
        >
          <div className="flex gap-3 lg:gap-4">
            {user.profile_pic ? (
              <img
                src={user.profile_pic}
                alt="Profile"
                className="w-10 h-10 lg:w-12 lg:h-12 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div
                className="w-10 h-10 lg:w-12 lg:h-12 rounded-full flex items-center justify-center font-bold flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #22d3ee, #3b82f6)",
                  color: "#00363e",
                }}
              >
                {user.username[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div
                className="w-full py-3 text-base lg:text-lg font-medium"
                style={{ color: "#3c494c" }}
              >
                Quoi de neuf ?
              </div>
              <div
                className="flex items-center justify-between mt-2 pt-4"
                style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex gap-4" style={{ color: "#859397" }}>
                  <button
                    className="hover:text-cyan-400 transition-colors"
                    onClick={() => setShowCreatePost(true)}
                  >
                    <span className="material-symbols-outlined text-xl">
                      image
                    </span>
                  </button>
                  <button
                    className="hover:text-cyan-400 transition-colors"
                    onClick={() => setShowCreatePost(true)}
                  >
                    <span className="material-symbols-outlined text-xl">
                      gif_box
                    </span>
                  </button>
                  <button
                    className="hover:text-cyan-400 transition-colors"
                    onClick={() => setShowCreatePost(true)}
                  >
                    <span className="material-symbols-outlined text-xl">
                      sentiment_satisfied
                    </span>
                  </button>
                </div>
                <button
                  data-testid="create-post-button"
                  onClick={() => setShowCreatePost(true)}
                  className="px-5 lg:px-6 py-1.5 lg:py-2 font-bold rounded-lg text-sm transition-all active:scale-95"
                  style={{ backgroundColor: "#22d3ee", color: "#00363e" }}
                >
                  Post
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Feed */}
        <div className="px-4 py-4 lg:py-6 space-y-4 lg:space-y-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500" />
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
