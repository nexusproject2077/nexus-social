import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { Search, Users, FileText } from "lucide-react";
import { toast } from "sonner";

export default function SearchPage({ user }) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("users"); // 'users' or 'posts'
  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      if (searchType === "users") {
        const response = await axios.get(`${API}/users/search?q=${searchQuery}`);
        setUsers(response.data);
        setPosts([]);
      } else {
        const response = await axios.get(`${API}/search/posts?q=${searchQuery}`);
        setPosts(response.data);
        setUsers([]);
      }
    } catch (error) {
      toast.error("Erreur lors de la recherche");
    } finally {
      setLoading(false);
    }
  };

  const handlePostUpdate = (updatedPost) => {
    setPosts(posts.map((p) => (p.id === updatedPost.id ? updatedPost : p)));
  };

  const handlePostDelete = (postId) => {
    setPosts(posts.filter((p) => p.id !== postId));
  };

  return (
    <Layout user={user}>
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 p-4">
          <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Rechercher</h1>
          
          <div className="flex gap-2 mb-4">
            <Button
              data-testid="search-users-tab"
              onClick={() => setSearchType("users")}
              variant={searchType === "users" ? "default" : "ghost"}
              className={`flex-1 ${
                searchType === "users"
                  ? "bg-cyan-500 hover:bg-cyan-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Users className="w-4 h-4 mr-2" />
              Utilisateurs
            </Button>
            <Button
              data-testid="search-posts-tab"
              onClick={() => setSearchType("posts")}
              variant={searchType === "posts" ? "default" : "ghost"}
              className={`flex-1 ${
                searchType === "posts"
                  ? "bg-cyan-500 hover:bg-cyan-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <FileText className="w-4 h-4 mr-2" />
              Publications
            </Button>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              data-testid="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Rechercher des ${searchType === "users" ? "utilisateurs" : "publications"}...`}
              className="bg-slate-800 border-slate-700 text-white"
            />
            <Button
              data-testid="search-button"
              type="submit"
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
            >
              <Search className="w-5 h-5" />
            </Button>
          </form>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
            </div>
          ) : searchType === "users" ? (
            users.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <p>Aucun utilisateur trouvé</p>
              </div>
            ) : (
              <div className="space-y-2">
                {users.map((foundUser) => (
                  <div
                    key={foundUser.id}
                    data-testid={`user-result-${foundUser.id}`}
                    onClick={() => navigate(`/profile/${foundUser.id}`)}
                    className="flex items-center gap-3 p-4 bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                  >
                    <Avatar>
                      <AvatarImage src={foundUser.profile_pic} />
                      <AvatarFallback className="bg-slate-700">
                        {foundUser.username[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-semibold">{foundUser.username}</p>
                      {foundUser.bio && (
                        <p className="text-sm text-slate-400 truncate">{foundUser.bio}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            posts.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <p>Aucune publication trouvée</p>
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
            )
          )}
        </div>
      </div>
    </Layout>
  );
}
