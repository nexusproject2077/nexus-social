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
      console.error("Erreur lors du chargement des posts aimés:", error);
    }
  };

  const fetchUserComments = async () => {
    try {
      const response = await axios.get(`${API}/users/me/comments`);
      setUserComments(response.data);
    } catch (error) {
      console.error("Erreur lors du chargement des commentaires:", error);
    }
  };

  const fetchDeletedItems = async () => {
    try {
      const response = await axios.get(`${API}/users/me/deleted-items`);
      setDeletedItems(response.data);
    } catch (error) {
      console.error("Erreur lors du chargement des éléments supprimés:", error);
    }
  };

  const fetchTimeStats = async () => {
    try {
      const response = await axios.get(`${API}/users/me/time-stats`);
      setTimeStats(response.data);
    } catch (error) {
      console.error("Erreur lors du chargement des statistiques:", error);
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
      toast.success("Email mis à jour avec succès");
      setShowEmailModal(false);
      setNewEmail("");
      setCurrentPassword("");
      const response = await axios.get(`${API}/auth/me`);
      setUser(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur lors de la mise à jour");
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
      toast.error("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }

    setLoading(true);
    try {
      await axios.put(`${API}/users/me/password`, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success("Mot de passe mis à jour avec succès");
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur lors de la mise à jour");
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
      toast.success("Nom d'utilisateur mis à jour avec succès");
      setShowUsernameModal(false);
      setNewUsername("");
      setCurrentPassword("");
      const response = await axios.get(`${API}/auth/me`);
      setUser(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur lors de la mise à jour");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "SUPPRIMER") {
      toast.error('Veuillez taper "SUPPRIMER" pour confirmer');
      return;
    }

    setLoading(true);
    try {
      await axios.delete(`${API}/users/me`);
      toast.success("Compte supprimé avec succès");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      navigate("/auth");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur lors de la suppression");
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePrivacy = async (checked) => {
    try {
      await axios.put(`${API}/users/me/privacy`, {
        is_private: checked,
      });
      setIsPrivate(checked);
      setUser({ ...user, is_private: checked });
      toast.success(checked ? "Compte privé activé" : "Compte public activé");
    } catch (error) {
      toast.error("Erreur lors de la modification de la confidentialité");
    }
  };

  const renderAccountSection = () => (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-lg sm:text-xl">Informations du compte</CardTitle>
          <CardDescription className="text-slate-400 text-sm">
            Gérez vos informations personnelles
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Email */}
          <div
            onClick={() => setShowEmailModal(true)}
            className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors active:bg-slate-700"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Mail className="h-5 w-5 text-cyan-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Adresse email</p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
          </div>

          {/* Username */}
          <div
            onClick={() => setShowUsernameModal(true)}
            className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors active:bg-slate-700"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <User className="h-5 w-5 text-cyan-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Nom d'utilisateur</p>
                <p className="text-xs text-slate-400 truncate">@{user?.username}</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
          </div>

          {/* Password */}
          <div
            onClick={() => setShowPasswordModal(true)}
            className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors active:bg-slate-700"
          >
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-cyan-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">Mot de passe</p>
                <p className="text-xs text-slate-400">••••••••</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
          </div>

          <Separator className="bg-slate-800" />

          {/* Delete Account */}
          <div
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center justify-between p-3 sm:p-4 bg-red-950/20 border border-red-900/50 rounded-lg cursor-pointer hover:bg-red-950/30 transition-colors active:bg-red-950/40"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Trash2 className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-red-500">Supprimer le compte</p>
                <p className="text-xs text-slate-400">Cette action est irréversible</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-red-500 flex-shrink-0" />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderActivitySection = () => (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-lg sm:text-xl">Vos activités</CardTitle>
          <CardDescription className="text-slate-400 text-sm">
            Consultez vos interactions sur Nexus
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            onClick={() => setActiveSection("liked")}
            className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors active:bg-slate-700"
          >
            <div className="flex items-center gap-3">
              <Heart className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">Publications aimées</p>
                <p className="text-xs text-slate-400">Voir tous vos likes</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
          </div>

          <div
            onClick={() => setActiveSection("comments")}
            className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors active:bg-slate-700"
          >
            <div className="flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-blue-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">Mes commentaires</p>
                <p className="text-xs text-slate-400">Tous vos commentaires</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
          </div>

          <div
            onClick={() => setActiveSection("deleted")}
            className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors active:bg-slate-700"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-slate-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">Récemment supprimés</p>
                <p className="text-xs text-slate-400">Éléments supprimés (30 jours)</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderTimeManagementSection = () => (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-lg sm:text-xl">
            <Clock className="h-5 w-5 text-cyan-500" />
            Gestion du temps
          </CardTitle>
          <CardDescription className="text-slate-400 text-sm">
            Suivez le temps passé sur Nexus
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeStats ? (
            <div className="space-y-6">
              {/* Aujourd'hui */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-white">Aujourd'hui</p>
                  <p className="text-xl sm:text-2xl font-bold text-cyan-500">
                    {Math.floor(timeStats.today / 60)}h {timeStats.today % 60}min
                  </p>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min((timeStats.today / 180) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">Limite recommandée: 3h/jour</p>
              </div>

              {/* Cette semaine */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-white">Cette semaine</p>
                  <p className="text-xl sm:text-2xl font-bold text-purple-500">
                    {Math.floor(timeStats.week / 60)}h {timeStats.week % 60}min
                  </p>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min((timeStats.week / 1260) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">Limite recommandée: 21h/semaine</p>
              </div>

              {/* Statistiques en grille */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mt-6">
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400">Moy. quotidienne</p>
                  <p className="text-base sm:text-lg font-bold text-white mt-1">
                    {Math.floor(timeStats.average / 60)}h {timeStats.average % 60}m
                  </p>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400">Jour le + actif</p>
                  <p className="text-base sm:text-lg font-bold text-white mt-1 truncate">{timeStats.most_active_day}</p>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center col-span-2 sm:col-span-1">
                  <p className="text-xs text-slate-400">Total ce mois</p>
                  <p className="text-base sm:text-lg font-bold text-white mt-1">
                    {Math.floor(timeStats.month / 60)}h
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Clock className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">Chargement des statistiques...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderPrivacySection = () => (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-lg sm:text-xl">
            <Shield className="h-5 w-5 text-cyan-500" />
            Confidentialité
          </CardTitle>
          <CardDescription className="text-slate-400 text-sm">
            Contrôlez qui peut voir votre contenu
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/50 rounded-lg">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {isPrivate ? (
                <EyeOff className="h-5 w-5 text-orange-500 flex-shrink-0" />
              ) : (
                <Eye className="h-5 w-5 text-green-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">
                  Compte {isPrivate ? "privé" : "public"}
                </p>
                <p className="text-xs text-slate-400">
                  {isPrivate
                    ? "Seuls vos abonnés peuvent voir vos publications"
                    : "Tout le monde peut voir vos publications"}
                </p>
              </div>
            </div>
            <Switch checked={isPrivate} onCheckedChange={handleTogglePrivacy} className="flex-shrink-0" />
          </div>

          {isPrivate && (
            <div className="bg-orange-950/20 border border-orange-900/50 rounded-lg p-3 sm:p-4">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-orange-500">Compte privé activé</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Les nouveaux abonnés devront demander à vous suivre. Vous pouvez accepter ou
                    refuser leurs demandes.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderLikedPosts = () => (
    <div className="space-y-4">
      <Button
        variant="ghost"
        onClick={() => setActiveSection("activity")}
        className="text-cyan-500 hover:text-cyan-400 mb-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Retour aux activités
      </Button>
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-lg sm:text-xl">
            <Heart className="h-5 w-5 text-red-500 fill-current" />
            Publications aimées
          </CardTitle>
        </CardHeader>
        <CardContent>
          {likedPosts.length === 0 ? (
            <div className="text-center py-12">
              <Heart className="h-16 w-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">Aucune publication aimée</p>
            </div>
          ) : (
            <div className="space-y-4">
              {likedPosts.map((post) => (
                <PostCard key={post.id} post={post} currentUser={user} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderUserComments = () => (
    <div className="space-y-4">
      <Button
        variant="ghost"
        onClick={() => setActiveSection("activity")}
        className="text-cyan-500 hover:text-cyan-400 mb-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Retour aux activités
      </Button>
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-lg sm:text-xl">
            <MessageCircle className="h-5 w-5 text-blue-500" />
            Mes commentaires
          </CardTitle>
        </CardHeader>
        <CardContent>
          {userComments.length === 0 ? (
            <div className="text-center py-12">
              <MessageCircle className="h-16 w-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">Aucun commentaire</p>
            </div>
          ) : (
            <div className="space-y-3">
              {userComments.map((comment) => (
                <div
                  key={comment.id}
                  className="p-3 sm:p-4 bg-slate-800/50 rounded-lg border border-slate-700"
                >
                  <p className="text-sm text-white mb-2 break-words">{comment.content}</p>
                  <p className="text-xs text-slate-400">
                    Sur la publication de {comment.post_author} •{" "}
                    {new Date(comment.created_at).toLocaleDateString("fr-FR")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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
      <div className="max-w-4xl mx-auto p-3 sm:p-4">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1
            className="text-2xl sm:text-3xl font-bold text-white mb-2"
            style={{ fontFamily: "Space Grotesk, sans-serif" }}
          >
            Paramètres
          </h1>
          <p className="text-slate-400 text-sm">Gérez votre compte et vos préférences</p>
        </div>

        {/* Navigation - Scrollable horizontal sur mobile */}
        {!["liked", "comments", "deleted"].includes(activeSection) && (
          <div className="flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0">
            <Button
              variant={activeSection === "account" ? "default" : "outline"}
              onClick={() => setActiveSection("account")}
              className={`flex-shrink-0 ${
                activeSection === "account"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400"
              }`}
              size="sm"
            >
              <User className="h-4 w-4 mr-2" />
              Compte
            </Button>
            <Button
              variant={activeSection === "activity" ? "default" : "outline"}
              onClick={() => setActiveSection("activity")}
              className={`flex-shrink-0 ${
                activeSection === "activity"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400"
              }`}
              size="sm"
            >
              <Activity className="h-4 w-4 mr-2" />
              Activités
            </Button>
            <Button
              variant={activeSection === "time" ? "default" : "outline"}
              onClick={() => setActiveSection("time")}
              className={`flex-shrink-0 ${
                activeSection === "time"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400"
              }`}
              size="sm"
            >
              <Clock className="h-4 w-4 mr-2" />
              Temps
            </Button>
            <Button
              variant={activeSection === "privacy" ? "default" : "outline"}
              onClick={() => setActiveSection("privacy")}
              className={`flex-shrink-0 ${
                activeSection === "privacy"
                  ? "bg-gradient-to-r from-cyan-500 to-blue-500"
                  : "border-slate-700 text-slate-400"
              }`}
              size="sm"
            >
              <Shield className="h-4 w-4 mr-2" />
              Confidentialité
            </Button>
          </div>
        )}

        {/* Content */}
        {renderContent()}
      </div>

      {/* Email Modal */}
      <Dialog open={showEmailModal} onOpenChange={setShowEmailModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">Modifier l'adresse email</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Email actuel: {user?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-email" className="text-sm">Nouvelle adresse email</Label>
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="nouvelle@email.com"
              />
            </div>
            <div>
              <Label htmlFor="current-password-email" className="text-sm">Mot de passe actuel</Label>
              <Input
                id="current-password-email"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowEmailModal(false)}
              className="w-full sm:w-auto"
            >
              Annuler
            </Button>
            <Button
              onClick={handleUpdateEmail}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 w-full sm:w-auto"
            >
              {loading ? "Modification..." : "Modifier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Modal */}
      <Dialog open={showPasswordModal} onOpenChange={setShowPasswordModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">Modifier le mot de passe</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Choisissez un mot de passe sécurisé
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="current-password" className="text-sm">Mot de passe actuel</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label htmlFor="new-password" className="text-sm">Nouveau mot de passe</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label htmlFor="confirm-password" className="text-sm">Confirmer le mot de passe</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowPasswordModal(false)}
              className="w-full sm:w-auto"
            >
              Annuler
            </Button>
            <Button
              onClick={handleUpdatePassword}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 w-full sm:w-auto"
            >
              {loading ? "Modification..." : "Modifier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Username Modal */}
      <Dialog open={showUsernameModal} onOpenChange={setShowUsernameModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg">Modifier le nom d'utilisateur</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Nom actuel: @{user?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-username" className="text-sm">Nouveau nom d'utilisateur</Label>
              <Input
                id="new-username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="nouveau_nom"
              />
            </div>
            <div>
              <Label htmlFor="current-password-username" className="text-sm">Mot de passe actuel</Label>
              <Input
                id="current-password-username"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowUsernameModal(false)}
              className="w-full sm:w-auto"
            >
              Annuler
            </Button>
            <Button
              onClick={handleUpdateUsername}
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 w-full sm:w-auto"
            >
              {loading ? "Modification..." : "Modifier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Account Modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-red-500 text-lg">Supprimer le compte</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Cette action est irréversible. Toutes vos données seront définitivement supprimées.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3 sm:p-4">
              <p className="text-sm text-slate-300 mb-2">
                Pour confirmer, tapez <strong className="text-red-500">SUPPRIMER</strong> ci-dessous :
              </p>
              <Input
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                placeholder="SUPPRIMER"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowDeleteModal(false)}
              className="w-full sm:w-auto"
            >
              Annuler
            </Button>
            <Button
              onClick={handleDeleteAccount}
              disabled={loading || deleteConfirmation !== "SUPPRIMER"}
              className="bg-red-600 hover:bg-red-700 w-full sm:w-auto"
            >
              {loading ? "Suppression..." : "Supprimer définitivement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
