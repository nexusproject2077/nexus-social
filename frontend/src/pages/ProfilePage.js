import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import EditProfileModal from "@/components/EditProfileModal";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, UserMinus, Edit } from "lucide-react";
import { toast } from "sonner";

export default function ProfilePage({ user, setUser }) {
  const { userId } = useParams();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const isOwnProfile = user.id === userId;

  useEffect(() => {
    fetchProfile();
    fetchUserPosts();
  }, [userId]);

  const fetchProfile = async () => {
    try {
      const response = await axios.get(`${API}/users/${userId}`);
      setProfile(response.data);
    } catch (error) {
      toast.error("Erreur lors du chargement du profil");
    }
  };

  const fetchUserPosts = async () => {
    try {
      const response = await axios.get(`${API}/users/${userId}/posts`);
      setPosts(response.data);
    } catch (error) {
      toast.error("Erreur lors du chargement des publications");
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async () => {
    try {
      const response = await axios.post(`${API}/users/${userId}/follow`);
      setProfile({
        ...profile,
        is_following: response.data.following,
        followers_count: profile.followers_count + (response.data.following ? 1 : -1),
      });
      toast.success(
        response.data.following ? "Abonné avec succès" : "Désabonné avec succès"
      );
    } catch (error) {
      toast.error("Erreur lors de l'action");
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
  };

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
                {profile.username[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="mt-4 sm:mt-0">
              {isOwnProfile ? (
                <Button
                  data-testid="edit-profile-button"
                  onClick={() => setShowEditProfile(true)}
                  variant="outline"
                  className="border-slate-700 text-white hover:bg-slate-800"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Modifier le profil
                </Button>
              ) : (
                <Button
                  data-testid="follow-button"
                  onClick={handleFollow}
                  className={`${
                    profile.is_following
                      ? "bg-slate-700 hover:bg-slate-600"
                      : "bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
                  } text-white font-semibold`}
                >
                  {profile.is_following ? (
                    <><UserMinus className="w-4 h-4 mr-2" />Se désabonner</>
                  ) : (
                    <><UserPlus className="w-4 h-4 mr-2" />Suivre</>
                  )}
                </Button>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              {profile.username}
            </h1>
            {profile.bio && <p className="text-slate-400 mt-2">{profile.bio}</p>}
            <div className="flex gap-6 mt-4 text-sm">
              <div>
                <span className="font-semibold text-white">{profile.following_count}</span>
                <span className="text-slate-400 ml-1">Abonnements</span>
              </div>
              <div>
                <span className="font-semibold text-white">{profile.followers_count}</span>
                <span className="text-slate-400 ml-1">Abonnés</span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-6">
            <h2 className="text-xl font-bold mb-4">Publications</h2>
            {loading ? (
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
