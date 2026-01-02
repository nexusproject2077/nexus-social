import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import EditProfileModal from "@/components/EditProfileModal";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, UserMinus, Edit, Lock, Clock } from "lucide-react";
import { toast } from "sonner";

export default function ProfilePage({ user, setUser }) {
  const { userId } = useParams();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [followStatus, setFollowStatus] = useState("not_following"); // 'following', 'pending', 'not_following'
  const [stats, setStats] = useState({ followers: 0, following: 0, posts: 0 });
  
  const isOwnProfile = user && userId && user.id === userId;

  useEffect(() => {
    if (userId) {
      fetchProfile();
      fetchUserPosts();
      if (!isOwnProfile) {
        fetchFollowStatus();
      }
    }
  }, [userId]);

  const fetchProfile = async () => {
    try {
      const response = await axios.get(`${API}/users/${userId}`);
      setProfile(response.data);
      
      // Récupérer les stats
      try {
        const statsRes = await axios.get(`${API}/users/${userId}/stats`);
        setStats(statsRes.data);
      } catch (err) {
        console.error("Erreur stats:", err);
        // Fallback aux anciennes stats
        setStats({
          followers: response.data.followers_count || 0,
          following: response.data.following_count || 0,
          posts: 0
        });
      }
    } catch (error) {
      console.error("Erreur profil:", error);
      toast.error("Erreur lors du chargement du profil");
    }
  };

  const fetchFollowStatus = async () => {
    try {
      const response = await axios.get(`${API}/users/${userId}/follow-status`);
      setFollowStatus(response.data.status);
    } catch (error) {
      console.error("Erreur statut:", error);
    }
  };

  const fetchUserPosts = async () => {
    try {
      const response = await axios.get(`${API}/users/${userId}/posts`);
      setPosts(response.data);
      setStats(prev => ({ ...prev, posts: response.data.length }));
    } catch (error) {
      console.error("Erreur posts:", error);
      // Si 403, c'est probablement un compte privé
      if (error.response?.status === 403) {
        setPosts([]);
      } else {
        toast.error("Erreur lors du chargement des publications");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async () => {
    if (!user) {
      toast.error("Vous devez être connecté");
      return;
    }

    try {
      setFollowLoading(true);
      const response = await axios.post(`${API}/users/${userId}/follow`);
      
      setFollowStatus(response.data.status);
      
      if (response.data.status === "pending") {
        toast.success("Demande d'abonnement envoyée");
      } else {
        toast.success("Abonné avec succès");
        setStats(prev => ({ ...prev, followers: prev.followers + 1 }));
      }
    } catch (error) {
      console.error("Erreur follow:", error);
      toast.error(error.response?.data?.detail || "Erreur lors de l'action");
    } finally {
      setFollowLoading(false);
    }
  };

  const handleUnfollow = async () => {
    if (!user) {
      toast.error("Vous devez être connecté");
      return;
    }

    try {
      setFollowLoading(true);
      await axios.delete(`${API}/users/${userId}/follow`);
      
      setFollowStatus("not_following");
      toast.success("Désabonné avec succès");
      setStats(prev => ({ ...prev, followers: Math.max(0, prev.followers - 1) }));
    } catch (error) {
      console.error("Erreur unfollow:", error);
      toast.error(error.response?.data?.detail || "Erreur lors de l'action");
    } finally {
      setFollowLoading(false);
    }
  };

  const handleProfileUpdate = (updatedUser) => {
    setUser(updatedUser);
    setProfile(updatedUser);
    setShowEditProfile(false);
  };

  const handlePostUpdate = (updatedPost) => {
    setPosts(posts.map((p) => (p.id === updatedPost.id ? updatedPost : p)));
  };

  const handlePostDelete = (postId) => {
    setPosts(posts.filter((p) => p.id !== postId));
    setStats(prev => ({ ...prev, posts: Math.max(0, prev.posts - 1) }));
  };

  const renderFollowButton = () => {
    if (isOwnProfile) {
      return (
        <Button
          data-testid="edit-profile-button"
          onClick={() => setShowEditProfile(true)}
          variant="outline"
          className="border-slate-700 text-white hover:bg-slate-800"
        >
          <Edit className="w-4 h-4 mr-2" />
          Modifier le profil
        </Button>
      );
    }

    if (followStatus === "following") {
      return (
        <Button
          data-testid="unfollow-button"
          onClick={handleUnfollow}
          disabled={followLoading}
          className="bg-slate-700 hover:bg-slate-600 text-white font-semibold"
        >
          {followLoading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
          ) : (
            <UserMinus className="w-4 h-4 mr-2" />
          )}
          Se désabonner
        </Button>
      );
    }

    if (followStatus === "pending") {
      return (
        <Button
          data-testid="cancel-request-button"
          onClick={handleUnfollow}
          disabled={followLoading}
          variant="outline"
          className="border-orange-500 text-orange-500 hover:bg-orange-500/10"
        >
          {followLoading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500 mr-2"></div>
          ) : (
            <Clock className="w-4 h-4 mr-2" />
          )}
          Demande envoyée
        </Button>
      );
    }

    return (
      <Button
        data-testid="follow-button"
        onClick={handleFollow}
        disabled={followLoading}
        className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold"
      >
        {followLoading ? (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
        ) : (
          <UserPlus className="w-4 h-4 mr-2" />
        )}
        {profile?.is_private ? "Demander à suivre" : "Suivre"}
      </Button>
    );
  };

  const canViewContent = isOwnProfile || !profile?.is_private || followStatus === "following";

  if (!profile) {
    return (
      <Layout user={user} setUser={setUser}>
        <div className="flex justify-center items-center h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 h-32 sm:h-48"></div>

        <div className="px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between -mt-16 sm:-mt-20 mb-4">
            <Avatar className="w-24 h-24 sm:w-32 sm:h-32 border-4 border-slate-950">
              <AvatarImage src={profile.profile_pic} />
              <AvatarFallback className="bg-slate-700 text-white text-3xl sm:text-4xl">
                {profile.username?.[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="mt-4 sm:mt-0">
              {renderFollowButton()}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {profile.username}
              </h1>
              {profile.is_private && (
                <Lock className="w-5 h-5 text-slate-400" />
              )}
            </div>
            {profile.bio && <p className="text-slate-400 mt-2">{profile.bio}</p>}
            <div className="flex gap-6 mt-4 text-sm">
              <div>
                <span className="font-semibold text-white">{stats.posts}</span>
                <span className="text-slate-400 ml-1">Publications</span>
              </div>
              <div>
                <span className="font-semibold text-white">{stats.followers}</span>
                <span className="text-slate-400 ml-1">Abonnés</span>
              </div>
              <div>
                <span className="font-semibold text-white">{stats.following}</span>
                <span className="text-slate-400 ml-1">Abonnements</span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-6">
            <h2 className="text-xl font-bold mb-4">Publications</h2>
            
            {!canViewContent ? (
              <div className="text-center py-12 bg-slate-900/50 rounded-xl border border-slate-800">
                <Lock className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                <h3 className="text-xl font-bold mb-2">Ce compte est privé</h3>
                <p className="text-slate-400">
                  Suivez ce compte pour voir ses publications
                </p>
              </div>
            ) : loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
              </div>
            ) : posts.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <p>Aucune publication</p>
              </div>
            ) : (
              <div className="space-y-4 pb-6">
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
      </div>

      <EditProfileModal
        open={showEditProfile}
        onClose={() => setShowEditProfile(false)}
        user={user}
        onUpdate={handleProfileUpdate}
      />
    </Layout>
  );
}
