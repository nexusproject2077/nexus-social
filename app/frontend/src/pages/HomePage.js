import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import CreatePostModal from "@/components/CreatePostModal";
import { Button } from "@/components/ui/button";
import { PenSquare } from "lucide-react";
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
      toast.error("Erreur lors du chargement du fil");
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
    <Layout user={user} setUser={setUser}>
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 p-4">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Fil d'actualité</h1>
        </div>

        <div className="p-4">
          <Button
            data-testid="create-post-button"
            onClick={() => setShowCreatePost(true)}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold py-6 mb-6"
          >
            <PenSquare className="w-5 h-5 mr-2" />
            Créer une publication
          </Button>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg">Aucune publication pour le moment</p>
              <p className="text-sm mt-2">Suivez des utilisateurs pour voir leurs publications ici</p>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={user}
                  onUpdate={handlePostUpdate}
                  onDelete={handlePostDelete}
                />
              ))}
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
