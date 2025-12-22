// SettingsPage.js - Version complète professionnelle et mobile-optimisée

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import {
  User,
  Mail,
  Lock,
  Trash2,
  Heart,
  MessageCircle,
  Clock,
  Eye,
  EyeOff,
  Shield,
  ChevronRight,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  X,
  Check,
  Loader,
} from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage({ user, setUser }) {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("account");
  const [isPrivate, setIsPrivate] = useState(user?.is_private || false);
  const [timeStats, setTimeStats] = useState(null);
  const [likedPosts, setLikedPosts] = useState([]);
  const [userComments, setUserComments] = useState([]);
  const [deletedItems, setDeletedItems] = useState([]);
  
  // Modals
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  
  // Form states
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  useEffect(() => {
    if (activeSection === "liked") {
      fetchLikedPosts();
    } else if (activeSection === "comments") {
      fetchUserComments();
    } else if (activeSection === "deleted") {
      fetchDeletedItems();
    } else if (activeSection === "time") {
      fetchTimeStats();
    }
  }, [activeSection]);

  const fetchLikedPosts = async () => {
    try {
      const response = await axios.get(`${API}/users/me/liked-posts`);
      setLikedPosts(response.data);
    } catch (error) {
      console.error("Erreur chargement posts aimés:", error);
    }
  };

  const fetchUserComments = async () => {
    try {
      const response = await axios.get(`${API}/users/me/comments`);
      setUserComments(response.data);
    } catch (error) {
      console.error("Erreur chargement commentaires:", error);
    }
  };

  const fetchDeletedItems = async () => {
    try {
      const response = await axios.get(`${API}/users/me/deleted-items`);
      setDeletedItems(response.data);
    } catch (error) {
      console.error("Erreur chargement supprimés:", error);
    }
  };

  const fetchTimeStats = async () => {
    try {
      const response = await axios.get(`${API}/users/me/time-stats`);
      setTimeStats(response.data);
    } catch (error) {
      console.error("Erreur chargement stats:", error);
    }
  };

  const handleUpdateEmail = async () => {
    if (!newEmail || !newEmail.includes("@")) {
      toast.error("Email invalide");
      return;
    }

    setLoading(true);
    try {
      await axios.put(`${API}/users/me/email`, {
        new_email: newEmail,
        current_password: currentPassword,
      });
      toast.success("Email mis à jour");
      setShowEmailModal(false);
      setNewEmail("");
      setCurrentPassword("");
      const response = await axios.get(`${API}/auth/me`);
      setUser(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Veuillez remplir tous les champs");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Minimum 6 caractères");
      return;
    }

    setLoading(true);
    try {
      await axios.put(`${API}/users/me/password`, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success("Mot de passe mis à jour");
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUsername = async () => {
    if (!newUsername || newUsername.length < 3) {
      toast.error("Minimum 3 caractères");
      return;
    }

    setLoading(true);
    try {
      await axios.put(`${API}/users/me/username`, {
        new_username: newUsername,
        current_password: currentPassword,
      });
      toast.success("Nom d'utilisateur mis à jour");
      setShowUsernameModal(false);
      setNewUsername("");
      setCurrentPassword("");
      const response = await axios.get(`${API}/auth/me`);
      setUser(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "SUPPRIMER") {
      toast.error('Tapez "SUPPRIMER"');
      return;
    }

    setLoading(true);
    try {
      await axios.delete(`${API}/users/me`);
      toast.success("Compte supprimé");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      navigate("/auth");
    } catch (error) {
      toast.error("Erreur");
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePrivacy = async (checked) => {
    try {
      await axios.put(`${API}/users/me/privacy`, { is_private: checked });
      setIsPrivate(checked);
      setUser({ ...user, is_private: checked });
      toast.success(checked ? "Compte privé" : "Compte public");
    } catch (error) {
      toast.error("Erreur");
    }
  };

  // Render different sections
  const renderContent = () => {
    switch (activeSection) {
      case "account":
        return renderAccountSection();
      case "activity":
        return renderActivitySection();
      case "time":
        return renderTimeManagementSection();
      case "privacy":
        return renderPrivacySection();
      case "liked":
        return renderLikedPosts();
      case "comments":
        return renderCommentsSection();
      case "deleted":
        return renderDeletedSection();
      default:
        return renderAccountSection();
    }
  };

  const renderAccountSection = () => (
    <div className="space-y-3">
      {/* Email */}
      <button
        onClick={() => setShowEmailModal(true)}
        className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800/50 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 bg-cyan-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Mail className="h-5 w-5 text-cyan-500" />
          </div>
          <div className="text-left min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Adresse email</p>
            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
      </button>

      {/* Username */}
      <button
        onClick={() => setShowUsernameModal(true)}
        className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800/50 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 bg-purple-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <User className="h-5 w-5 text-purple-500" />
          </div>
          <div className="text-left min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Nom d'utilisateur</p>
            <p className="text-xs text-slate-400 truncate">@{user?.username}</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
      </button>

      {/* Password */}
      <button
        onClick={() => setShowPasswordModal(true)}
        className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800/50 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Lock className="h-5 w-5 text-green-500" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-white">Mot de passe</p>
            <p className="text-xs text-slate-400">••••••••</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
      </button>

      <div className="h-4"></div>

      {/* Analytics */}
      <button
        onClick={() => navigate("/analytics")}
        className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-purple-950/20 to-blue-950/20 border border-purple-900/50 rounded-xl hover:from-purple-950/30 hover:to-blue-950/30 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 bg-purple-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <BarChart3 className="h-5 w-5 text-purple-500" />
          </div>
          <div className="text-left min-w-0 flex-1">
            <p className="text-sm font-medium text-purple-400">Analytics & Automatisation</p>
            <p className="text-xs text-slate-400">Statistiques et gestion</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-purple-500 flex-shrink-0" />
      </button>

      <div className="h-4"></div>

      {/* Privacy Center */}
      <button
        onClick={() => navigate("/privacy-center")}
        className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-blue-950/20 to-cyan-950/20 border border-blue-900/50 rounded-xl hover:from-blue-950/30 hover:to-cyan-950/30 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 bg-blue-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Shield className="h-5 w-5 text-blue-500" />
          </div>
          <div className="text-left min-w-0 flex-1">
            <p className="text-sm font-medium text-blue-400">Confidentialité et RGPD</p>
            <p className="text-xs text-slate-400">Gérez vos données personnelles</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-blue-500 flex-shrink-0" />
      </button>

      <div className="h-4"></div>

      {/* Delete Account */}
      <button
        onClick={() => setShowDeleteModal(true)}
        className="w-full flex items-center justify-between p-4 bg-red-950/20 border border-red-900/50 rounded-xl hover:bg-red-950/30 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Trash2 className="h-5 w-5 text-red-500" />
          </div>
          <div className="text-left min-w-0 flex-1">
            <p className="text-sm font-medium text-red-500">Supprimer le compte</p>
            <p className="text-xs text-slate-400">Action irréversible</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-red-500 flex-shrink-0" />
      </button>
    </div>
  );

  const renderActivitySection = () => (
    <div className="space-y-3">
      <button
        onClick={() => setActiveSection("liked")}
        className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800/50 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Heart className="h-5 w-5 text-red-500" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-white">Publications aimées</p>
            <p className="text-xs text-slate-400">Tous vos likes</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-500" />
      </button>

      <button
        onClick={() => setActiveSection("comments")}
        className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800/50 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <MessageCircle className="h-5 w-5 text-blue-500" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-white">Mes commentaires</p>
            <p className="text-xs text-slate-400">Tous vos commentaires</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-500" />
      </button>

      <button
        onClick={() => setActiveSection("deleted")}
        className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800/50 transition-colors active:scale-[0.98]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-600/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Trash2 className="h-5 w-5 text-slate-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-white">Récemment supprimés</p>
            <p className="text-xs text-slate-400">30 derniers jours</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-500" />
      </button>
    </div>
  );

  const renderTimeManagementSection = () => (
    <div className="space-y-4">
      {timeStats ? (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-white">Aujourd'hui</p>
              <p className="text-2xl font-bold text-cyan-500">
                {Math.floor(timeStats.today / 60)}h {timeStats.today % 60}min
              </p>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min((timeStats.today / 180) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">Limite: 3h/jour</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-white">Cette semaine</p>
              <p className="text-2xl font-bold text-purple-500">
                {Math.floor(timeStats.week / 60)}h {timeStats.week % 60}min
              </p>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min((timeStats.week / 1260) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">Limite: 21h/semaine</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-400">Moyenne/jour</p>
              <p className="text-lg font-bold text-white mt-1">
                {Math.floor(timeStats.average / 60)}h {timeStats.average % 60}m
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-400">Total mois</p>
              <p className="text-lg font-bold text-white mt-1">
                {Math.floor(timeStats.month / 60)}h
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
            <p className="text-xs text-slate-400">Jour le plus actif</p>
            <p className="text-lg font-bold text-white mt-1">{timeStats.most_active_day}</p>
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          <Clock className="h-12 w-12 text-slate-600 mx-auto mb-3 animate-pulse" />
          <p className="text-slate-400 text-sm">Chargement des statistiques...</p>
        </div>
      )}
    </div>
  );

  const renderPrivacySection = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isPrivate ? 'bg-orange-500/10' : 'bg-green-500/10'}`}>
            {isPrivate ? (
              <EyeOff className="h-5 w-5 text-orange-500" />
            ) : (
              <Eye className="h-5 w-5 text-green-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">
              Compte {isPrivate ? "privé" : "public"}
            </p>
            <p className="text-xs text-slate-400">
              {isPrivate ? "Abonnés uniquement" : "Visible par tous"}
            </p>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => handleTogglePrivacy(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
        </label>
      </div>

      {isPrivate && (
        <div className="bg-orange-950/20 border border-orange-900/50 rounded-xl p-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-orange-500">Compte privé</p>
              <p className="text-xs text-slate-400 mt-1">
                Les nouveaux abonnés doivent demander à vous suivre
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderLikedPosts = () => (
    <div className="space-y-4">
      <button
        onClick={() => setActiveSection("activity")}
        className="flex items-center gap-2 text-cyan-500 hover:text-cyan-400 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm font-medium">Retour</span>
      </button>
      {likedPosts.length === 0 ? (
        <div className="text-center py-12">
          <Heart className="h-16 w-16 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Aucune publication aimée</p>
        </div>
      ) : (
        <div className="space-y-3">
          {likedPosts.map((post) => (
            <PostCard key={post.id} post={post} user={user} setUser={setUser} />
          ))}
        </div>
      )}
    </div>
  );

  const renderCommentsSection = () => (
    <div className="space-y-4">
      <button
        onClick={() => setActiveSection("activity")}
        className="flex items-center gap-2 text-cyan-500 hover:text-cyan-400 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm font-medium">Retour</span>
      </button>
      {userComments.length === 0 ? (
        <div className="text-center py-12">
          <MessageCircle className="h-16 w-16 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Aucun commentaire</p>
        </div>
      ) : (
        <div className="space-y-3">
          {userComments.map((comment) => (
            <div key={comment.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm text-white mb-2">{comment.content}</p>
              <p className="text-xs text-slate-400">
                {new Date(comment.created_at).toLocaleDateString('fr-FR')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderDeletedSection = () => (
    <div className="space-y-4">
      <button
        onClick={() => setActiveSection("activity")}
        className="flex items-center gap-2 text-cyan-500 hover:text-cyan-400 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm font-medium">Retour</span>
      </button>
      {deletedItems.length === 0 ? (
        <div className="text-center py-12">
          <Trash2 className="h-16 w-16 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Aucun élément supprimé</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deletedItems.map((item) => (
            <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm text-white mb-2">{item.content}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Supprimé le {new Date(item.deleted_at).toLocaleDateString('fr-FR')}
                </p>
                <button className="text-xs text-cyan-500 hover:text-cyan-400">
                  Restaurer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Layout user={user} setUser={setUser}>
      <div className="max-w-2xl mx-auto px-3 py-4 pb-24">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-1" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
            Paramètres
          </h1>
          <p className="text-sm text-slate-400">
            Gérez votre compte et vos préférences
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          {[
            { key: "account", label: "Compte", icon: User },
            { key: "activity", label: "Activité", icon: Heart },
            { key: "time", label: "Temps", icon: Clock },
            { key: "privacy", label: "Confidentialité", icon: Shield },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                activeSection === key
                  ? "bg-cyan-500 text-white"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        {renderContent()}

        {/* Modals... (same as before) */}
        {/* Modal Email */}
        {showEmailModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowEmailModal(false)}>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Changer l'email</h3>
                <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-white">
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-400 mb-2 block">Email actuel</label>
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm">
                  {user?.email}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-sm text-slate-400 mb-2 block">Nouvel email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                  placeholder="nouveau@email.com"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowEmailModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg font-medium transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleUpdateEmail}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white py-3 rounded-lg font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                  {loading ? "..." : "Confirmer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Username */}
        {showUsernameModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowUsernameModal(false)}>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Changer le nom d'utilisateur</h3>
                <button onClick={() => setShowUsernameModal(false)} className="text-slate-400 hover:text-white">
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              <div className="mb-4">
                <label className="text-sm text-slate-400 mb-2 block">Nom actuel</label>
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm">
                  @{user?.username}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-sm text-slate-400 mb-2 block">Nouveau nom</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
                  placeholder="nouveau_nom"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowUsernameModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg font-medium transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleUpdateUsername}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white py-3 rounded-lg font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                  {loading ? "..." : "Confirmer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Password */}
        {showPasswordModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPasswordModal(false)}>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Changer le mot de passe</h3>
                <button onClick={() => setShowPasswordModal(false)} className="text-slate-400 hover:text-white">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Mot de passe actuel</label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 pr-12 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Nouveau mot de passe</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 pr-12 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Confirmer le mot de passe</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowPasswordModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg font-medium transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleUpdatePassword}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white py-3 rounded-lg font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                  {loading ? "..." : "Confirmer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Delete */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteModal(false)}>
            <div className="bg-slate-900 border border-red-900/50 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-red-500">Supprimer le compte</h3>
                  <p className="text-sm text-slate-400">Cette action est irréversible</p>
                </div>
              </div>

              <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4 mb-4">
                <p className="text-sm text-slate-300 mb-2">
                  ⚠️ Toutes vos données seront définitivement supprimées :
                </p>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• Votre profil et informations</li>
                  <li>• Toutes vos publications</li>
                  <li>• Vos commentaires et likes</li>
                  <li>• Vos messages privés</li>
                </ul>
              </div>

              <div className="mb-6">
                <label className="text-sm text-slate-400 mb-2 block">
                  Tapez <strong className="text-red-500">SUPPRIMER</strong> pour confirmer
                </label>
                <input
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-red-500 transition-colors"
                  placeholder="SUPPRIMER"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg font-medium transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={loading || deleteConfirmation !== "SUPPRIMER"}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? <Loader className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                  {loading ? "..." : "Supprimer"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
