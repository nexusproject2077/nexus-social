import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "../App";
import Layout from "../components/Layout";
import PostCard from "../components/PostCard";
import CreatePostModal from "../components/CreatePostModal";
import StoriesFeed from "../components/StoriesFeed";
import { toast } from "sonner";

export default function HomePage({ user, setUser }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreatePost, setShowCreatePost] = useState(false);

  useEffect(() => {
    fetchFeed();
  }, []);

  const fetchFeed = async () => {
    try {
      const response = await axios.get(`${API}/posts/feed`);
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
                Suivez des utilisateurs pour voir leurs publications ici
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={user}
                onUpdate={handlePostUpdate}
                onDelete={handlePostDelete}
              />
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
