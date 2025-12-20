import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Activity,
  ChevronRight,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import PostCard from "@/components/PostCard";

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
    if (!newEmail || !currentPassword) {
      toast.error("Veuillez remplir tous les champs");
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
    if (!newUsername || !currentPassword) {
      toast.error("Veuillez remplir tous les champs");
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

  const renderAccountSection = () => (
    <div className="space-y-3">
      {/* Email */}
      <div
        onClick={() => setShowEmailModal(true)}
        className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-xl cursor-pointer active:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-cyan-500/10 rounded-full flex items-center justify-center">
            <Mail className="h-4 w-4 sm:h-5 sm:w-5 text-cyan-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-medium text-white">Adresse email</p>
            <p className="text-[10px] sm:text-xs text-slate-400 truncate">{user?.email}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-slate-500 flex-shrink-0" />
      </div>

      {/* Username */}
      <div
        onClick={() => setShowUsernameModal(true)}
        className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-xl cursor-pointer active:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-cyan-500/10 rounded-full flex items-center justify-center">
            <User className="h-4 w-4 sm:h-5 sm:w-5 text-cyan-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-medium text-white">Nom d'utilisateur</p>
            <p className="text-[10px] sm:text-xs text-slate-400 truncate">@{user?.username}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-slate-500 flex-shrink-0" />
      </div>

      {/* Password */}
      <div
        onClick={() => setShowPasswordModal(true)}
        className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-xl cursor-pointer active:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-cyan-500/10 rounded-full flex items-center justify-center">
            <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-cyan-500" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-white">Mot de passe</p>
            <p className="text-[10px] sm:text-xs text-slate-400">••••••••</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-slate-500 flex-shrink-0" />
      </div>

      <div className="h-3 sm:h-4"></div>

      {/* Delete Account */}
      <div
        onClick={() => setShowDeleteModal(true)}
        className="flex items-center justify-between p-3 sm:p-4 bg-red-950/20 border border-red-900/50 rounded-xl cursor-pointer active:bg-red-950/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 bg-red-500/10 rounded-full flex items-center justify-center">
            <Trash2 className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-medium text-red-500">Supprimer le compte</p>
            <p className="text-[10px] sm:text-xs text-slate-400">Action irréversible</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-red-500 flex-shrink-0" />
      </div>
    </div>
  );

  const renderActivitySection = () => (
    <div className="space-y-3">
      <div
        onClick={() => setActiveSection("liked")}
        className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-xl cursor-pointer active:bg-slate-800"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Heart className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-white">Publications aimées</p>
            <p className="text-[10px] sm:text-xs text-slate-400">Tous vos likes</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-slate-500" />
      </div>

      <div
        onClick={() => setActiveSection("comments")}
        className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-xl cursor-pointer active:bg-slate-800"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-blue-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-white">Mes commentaires</p>
            <p className="text-[10px] sm:text-xs text-slate-400">Tous vos commentaires</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-slate-500" />
      </div>

      <div
        onClick={() => setActiveSection("deleted")}
        className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-xl cursor-pointer active:bg-slate-800"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-600/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Trash2 className="h-4 w-4 sm:h-5 sm:w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-white">Récemment supprimés</p>
            <p className="text-[10px] sm:text-xs text-slate-400">30 derniers jours</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-slate-500" />
      </div>
    </div>
  );

  const renderTimeManagementSection = () => (
    <div className="space-y-3 sm:space-y-4">
      {timeStats ? (
        <>
          <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <p className="text-xs sm:text-sm font-medium text-white">Aujourd'hui</p>
              <p className="text-xl sm:text-2xl font-bold text-cyan-500">
                {Math.floor(timeStats.today / 60)}h {timeStats.today % 60}min
              </p>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-1.5 sm:h-2">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-1.5 sm:h-2 rounded-full"
                style={{ width: `${Math.min((timeStats.today / 180) * 100, 100)}%` }}
              />
            </div>
            <p className="text-[10px] sm:text-xs text-slate-400 mt-1.5 sm:mt-2">Limite: 3h/jour</p>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <p className="text-xs sm:text-sm font-medium text-white">Cette semaine</p>
              <p className="text-xl sm:text-2xl font-bold text-purple-500">
                {Math.floor(timeStats.week / 60)}h {timeStats.week % 60}min
              </p>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-1.5 sm:h-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-1.5 sm:h-2 rounded-full"
                style={{ width: `${Math.min((timeStats.week / 1260) * 100, 100)}%` }}
              />
            </div>
            <p className="text-[10px] sm:text-xs text-slate-400 mt-1.5 sm:mt-2">Limite: 21h/semaine</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="bg-slate-800/50 rounded-xl p-2.5 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-slate-400">Moyenne/jour</p>
              <p className="text-base sm:text-lg font-bold text-white mt-1">
                {Math.floor(timeStats.average / 60)}h {timeStats.average % 60}m
              </p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-2.5 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-slate-400">Total mois</p>
              <p className="text-base sm:text-lg font-bold text-white mt-1">
                {Math.floor(timeStats.month / 60)}h
              </p>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-2.5 sm:p-3 text-center">
            <p className="text-[10px] sm:text-xs text-slate-400">Jour le plus actif</p>
            <p className="text-base sm:text-lg font-bold text-white mt-1">{timeStats.most_active_day}</p>
          </div>
        </>
      ) : (
        <div className="text-center py-8 sm:py-12">
          <Clock className="h-10 w-10 sm:h-12 sm:w-12 text-slate-600 mx-auto mb-2 sm:mb-3" />
          <p className="text-slate-400 text-xs sm:text-sm">Chargement...</p>
        </div>
      )}
    </div>
  );

  const renderPrivacySection = () => (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-xl">
        <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
          <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isPrivate ? 'bg-orange-500/10' : 'bg-green-500/10'}`}>
            {isPrivate ? (
              <EyeOff className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500" />
            ) : (
              <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm font-medium text-white">
              Compte {isPrivate ? "privé" : "public"}
            </p>
            <p className="text-[10px] sm:text-xs text-slate-400">
              {isPrivate ? "Abonnés uniquement" : "Visible par tous"}
            </p>
          </div>
        </div>
        <Switch checked={isPrivate} onCheckedChange={handleTogglePrivacy} />
      </div>

      {isPrivate && (
        <div className="bg-orange-950/20 border border-orange-900/50 rounded-xl p-3 sm:p-4">
          <div className="flex gap-2.5 sm:gap-3">
            <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs sm:text-sm font-medium text-orange-500">Compte privé</p>
              <p className="text-[10px] sm:text-xs text-slate-400 mt-1">
                Les nouveaux abonnés doivent demander à vous suivre
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderLikedPosts = () => (
    <div className="space-y-3 sm:space-y-4">
      <Button
        variant="ghost"
        onClick={() => setActiveSection("activity")}
        className="text-cyan-500 -ml-2 h-8 sm:h-9 text-xs sm:text-sm"
      >
        <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
        Retour
      </Button>
      {likedPosts.length === 0 ? (
        <div className="text-center py-8 sm:py-12">
          <Heart className="h-12 w-12 sm:h-16 sm:w-16 text-slate-600 mx-auto mb-3 sm:mb-4" />
          <p className="text-slate-400 text-xs sm:text-sm">Aucune publication aimée</p>
        </div>
      ) : (
        likedPosts.map((post) => (
          <PostCard key={post.id} post={post} currentUser={user} />
        ))
      )}
    </div>
  );

  const renderUserComments = () => (
    <div className="space-y-3 sm:space-y-4">
      <Button
        variant="ghost"
        onClick={() => setActiveSection("activity")}
        className="text-cyan-500 -ml-2 h-8 sm:h-9 text-xs sm:text-sm"
      >
        <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
        Retour
      </Button>
      {userComments.length === 0 ? (
        <div className="text-center py-8 sm:py-12">
          <MessageCircle className="h-12 w-12 sm:h-16 sm:w-16 text-slate-600 mx-auto mb-3 sm:mb-4" />
          <p className="text-slate-400 text-xs sm:text-sm">Aucun commentaire</p>
        </div>
      ) : (
        <div className="space-y-2.5 sm:space-y-3">
          {userComments.map((comment) => (
            <div key={comment.id} className="p-3 sm:p-4 bg-slate-800/50 rounded-xl">
              <p className="text-xs sm:text-sm text-white mb-1.5 sm:mb-2">{comment.content}</p>
              <p className="text-[10px] sm:text-xs text-slate-400">
                Sur la publication de {comment.post_author} •{" "}
                {new Date(comment.created_at).toLocaleDateString("fr-FR")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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
        return renderUserComments();
      default:
        return renderAccountSection();
    }
  };

  return (
    <Layout user={user} setUser={setUser}>
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-20">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-0.5 sm:mb-1" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
            Paramètres
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm">Gérez votre compte</p>
        </div>

        {/* Navigation Tabs */}
        {!["liked", "comments", "deleted"].includes(activeSection) && (
          <div className="flex gap-1.5 sm:gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2 -mx-3 sm:-mx-4 px-3 sm:px-4 scrollbar-hide">
            <Button
              variant={activeSection === "account" ? "default" : "outline"}
              onClick={() => setActiveSection("account")}
              size="sm"
              className={`flex-shrink-0 h-8 sm:h-9 text-xs sm:text-sm ${
                activeSection === "account"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400 bg-slate-900"
              }`}
            >
              <User className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Compte
            </Button>
            <Button
              variant={activeSection === "activity" ? "default" : "outline"}
              onClick={() => setActiveSection("activity")}
              size="sm"
              className={`flex-shrink-0 h-8 sm:h-9 text-xs sm:text-sm ${
                activeSection === "activity"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400 bg-slate-900"
              }`}
            >
              <Activity className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Activités
            </Button>
            <Button
              variant={activeSection === "time" ? "default" : "outline"}
              onClick={() => setActiveSection("time")}
              size="sm"
              className={`flex-shrink-0 h-8 sm:h-9 text-xs sm:text-sm ${
                activeSection === "time"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400 bg-slate-900"
              }`}
            >
              <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Temps
            </Button>
            <Button
              variant={activeSection === "privacy" ? "default" : "outline"}
              onClick={() => setActiveSection("privacy")}
              size="sm"
              className={`flex-shrink-0 h-8 sm:h-9 text-xs sm:text-sm whitespace-nowrap ${
                activeSection === "privacy"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400 bg-slate-900"
              }`}
            >
              <Shield className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Confidentialité
            </Button>
          </div>
        )}

        {/* Content */}
        {renderContent()}
      </div>

      {/* Modals */}
      {/* Email Modal */}
      <Dialog open={showEmailModal} onOpenChange={setShowEmailModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white w-[92vw] sm:w-[95vw] max-w-md rounded-2xl p-4 sm:p-6">
          <DialogHeader className="space-y-1 sm:space-y-1.5">
            <DialogTitle className="text-base sm:text-lg">Modifier l'email</DialogTitle>
            <DialogDescription className="text-slate-400 text-xs sm:text-sm">
              Actuel: {user?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4">
            <div>
              <Label className="text-xs sm:text-sm">Nouvel email</Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1 h-9 sm:h-10 text-xs sm:text-sm"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <Label className="text-xs sm:text-sm">Mot de passe actuel</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1 h-9 sm:h-10 text-xs sm:text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button 
              variant="outline" 
              onClick={() => setShowEmailModal(false)} 
              className="flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              Annuler
            </Button>
            <Button
              onClick={handleUpdateEmail}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              {loading ? "..." : "Modifier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Modal */}
      <Dialog open={showPasswordModal} onOpenChange={setShowPasswordModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white w-[92vw] sm:w-[95vw] max-w-md rounded-2xl p-4 sm:p-6">
          <DialogHeader className="space-y-1 sm:space-y-1.5">
            <DialogTitle className="text-base sm:text-lg">Modifier le mot de passe</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4">
            <div>
              <Label className="text-xs sm:text-sm">Mot de passe actuel</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1 h-9 sm:h-10 text-xs sm:text-sm"
              />
            </div>
            <div>
              <Label className="text-xs sm:text-sm">Nouveau mot de passe</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1 h-9 sm:h-10 text-xs sm:text-sm"
              />
            </div>
            <div>
              <Label className="text-xs sm:text-sm">Confirmer</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1 h-9 sm:h-10 text-xs sm:text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button 
              variant="outline" 
              onClick={() => setShowPasswordModal(false)} 
              className="flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              Annuler
            </Button>
            <Button
              onClick={handleUpdatePassword}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              {loading ? "..." : "Modifier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Username Modal */}
      <Dialog open={showUsernameModal} onOpenChange={setShowUsernameModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white w-[92vw] sm:w-[95vw] max-w-md rounded-2xl p-4 sm:p-6">
          <DialogHeader className="space-y-1 sm:space-y-1.5">
            <DialogTitle className="text-base sm:text-lg">Modifier le nom d'utilisateur</DialogTitle>
            <DialogDescription className="text-slate-400 text-xs sm:text-sm">
              Actuel: @{user?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4">
            <div>
              <Label className="text-xs sm:text-sm">Nouveau nom</Label>
              <Input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1 h-9 sm:h-10 text-xs sm:text-sm"
              />
            </div>
            <div>
              <Label className="text-xs sm:text-sm">Mot de passe</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1 h-9 sm:h-10 text-xs sm:text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button 
              variant="outline" 
              onClick={() => setShowUsernameModal(false)} 
              className="flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              Annuler
            </Button>
            <Button
              onClick={handleUpdateUsername}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              {loading ? "..." : "Modifier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white w-[92vw] sm:w-[95vw] max-w-md rounded-2xl p-4 sm:p-6">
          <DialogHeader className="space-y-1 sm:space-y-1.5">
            <DialogTitle className="text-red-500 text-base sm:text-lg">Supprimer le compte</DialogTitle>
            <DialogDescription className="text-slate-400 text-xs sm:text-sm">
              Action irréversible
            </DialogDescription>
          </DialogHeader>
          <div className="bg-red-950/20 border border-red-900/50 rounded-xl p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-slate-300 mb-2">
              Tapez <strong className="text-red-500">SUPPRIMER</strong>
            </p>
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white h-9 sm:h-10 text-xs sm:text-sm"
              placeholder="SUPPRIMER"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button 
              variant="outline" 
              onClick={() => setShowDeleteModal(false)} 
              className="flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              Annuler
            </Button>
            <Button
              onClick={handleDeleteAccount}
              disabled={loading || deleteConfirmation !== "SUPPRIMER"}
              className="bg-red-600 hover:bg-red-700 flex-1 h-9 sm:h-10 text-xs sm:text-sm w-full"
            >
              {loading ? "..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </Layout>
  );
}
