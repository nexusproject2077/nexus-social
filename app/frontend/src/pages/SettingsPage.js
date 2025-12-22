// SettingsPage.js - Version professionnelle et mobile-optimisée

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import {
  User,
  Mail,
  Lock,
  Trash2,
  Shield,
  ChevronRight,
  AlertTriangle,
  BarChart3,
  Eye,
  EyeOff,
  Check,
  X,
  Loader,
} from "lucide-react";

export default function SettingsPage({ user, setUser }) {
  const navigate = useNavigate();
  
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

  const handleEmailChange = async () => {
    if (!newEmail || !newEmail.includes("@")) {
      alert("❌ Email invalide");
      return;
    }

    setLoading(true);
    try {
      await axios.put(`${API}/users/me/email`, { email: newEmail });
      setUser({ ...user, email: newEmail });
      alert("✅ Email modifié avec succès");
      setShowEmailModal(false);
      setNewEmail("");
    } catch (error) {
      alert("❌ " + (error.response?.data?.detail || "Erreur"));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      alert("❌ Tous les champs sont requis");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("❌ Les mots de passe ne correspondent pas");
      return;
    }

    if (newPassword.length < 6) {
      alert("❌ Le mot de passe doit contenir au moins 6 caractères");
      return;
    }

    setLoading(true);
    try {
      await axios.put(`${API}/users/me/password`, {
        current_password: currentPassword,
        new_password: newPassword
      });
      alert("✅ Mot de passe modifié avec succès");
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      alert("❌ " + (error.response?.data?.detail || "Mot de passe actuel incorrect"));
    } finally {
      setLoading(false);
    }
  };

  const handleUsernameChange = async () => {
    if (!newUsername || newUsername.length < 3) {
      alert("❌ Le nom d'utilisateur doit contenir au moins 3 caractères");
      return;
    }

    setLoading(true);
    try {
      await axios.put(`${API}/users/me/username`, { username: newUsername });
      setUser({ ...user, username: newUsername });
      alert("✅ Nom d'utilisateur modifié avec succès");
      setShowUsernameModal(false);
      setNewUsername("");
    } catch (error) {
      alert("❌ " + (error.response?.data?.detail || "Ce nom est déjà pris"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "SUPPRIMER") {
      alert('❌ Tapez "SUPPRIMER" pour confirmer');
      return;
    }

    setLoading(true);
    try {
      await axios.delete(`${API}/users/me`);
      localStorage.removeItem("token");
      setUser(null);
      navigate("/auth");
    } catch (error) {
      alert("❌ " + (error.response?.data?.detail || "Erreur"));
    } finally {
      setLoading(false);
    }
  };

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

        {/* Compte */}
        <div className="mb-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
            Compte
          </h2>
          
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            {/* Email */}
            <button
              onClick={() => setShowEmailModal(true)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors border-b border-slate-800 active:bg-slate-800"
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
              className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors border-b border-slate-800 active:bg-slate-800"
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
              className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors active:bg-slate-800"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <Lock className="h-5 w-5 text-green-500" />
                </div>
                <div className="text-left min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Mot de passe</p>
                  <p className="text-xs text-slate-400">••••••••</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500 flex-shrink-0" />
            </button>
          </div>
        </div>

        {/* Fonctionnalités */}
        <div className="mb-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
            Fonctionnalités
          </h2>
          
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            {/* Analytics */}
            <button
              onClick={() => navigate("/analytics")}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors border-b border-slate-800 active:bg-slate-800"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <BarChart3 className="h-5 w-5 text-purple-400" />
                </div>
                <div className="text-left min-w-0 flex-1">
                  <p className="text-sm font-medium text-purple-400">Analytics & Automatisation</p>
                  <p className="text-xs text-slate-400">Statistiques et gestion</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-purple-500 flex-shrink-0" />
            </button>

            {/* Privacy Center */}
            <button
              onClick={() => navigate("/privacy-center")}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors active:bg-slate-800"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <Shield className="h-5 w-5 text-blue-400" />
                </div>
                <div className="text-left min-w-0 flex-1">
                  <p className="text-sm font-medium text-blue-400">Confidentialité et RGPD</p>
                  <p className="text-xs text-slate-400">Gérez vos données personnelles</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-blue-500 flex-shrink-0" />
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="mb-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
            Zone de danger
          </h2>
          
          <button
            onClick={() => setShowDeleteModal(true)}
            className="w-full flex items-center justify-between p-4 bg-red-950/20 border border-red-900/50 rounded-xl hover:bg-red-950/30 transition-colors active:bg-red-950/40"
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
                  onClick={handleEmailChange}
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
                  onClick={handleUsernameChange}
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
                  onClick={handlePasswordChange}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white py-3 rounded