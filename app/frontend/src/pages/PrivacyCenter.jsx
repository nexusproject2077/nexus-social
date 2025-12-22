// PrivacyCenter.jsx - Version finale sans bugs

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import {
  Shield,
  Download,
  Trash2,
  Lock,
  CheckCircle,
  AlertTriangle,
  Globe,
  Users,
  Eye,
} from "lucide-react";

export default function PrivacyCenter({ user, setUser }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("privacy");
  const [loading, setLoading] = useState(false);
  
  // Privacy Settings
  const [privacySettings, setPrivacySettings] = useState({
    profile_visibility: "public",
    show_email: false,
    show_activity: true,
    allow_tagging: true,
    allow_messaging: "everyone",
  });
  
  // Modals
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    loadPrivacySettings();
  }, []);

  const loadPrivacySettings = async () => {
    try {
      const response = await axios.get(`${API}/gdpr/privacy/settings/${user.id}`);
      setPrivacySettings(response.data);
    } catch (error) {
      console.error("Erreur chargement:", error);
    }
  };

  const updatePrivacySettings = async (newSettings) => {
    try {
      await axios.put(`${API}/gdpr/privacy/settings?user_id=${user.id}`, newSettings);
      setPrivacySettings(newSettings);
      alert("✓ Paramètres mis à jour");
    } catch (error) {
      alert("✗ Erreur");
    }
  };

  const exportData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/gdpr/data/export/${user.id}`);
      
      const dataStr = JSON.stringify(response.data, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = window.URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `mes-donnees-${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      alert("✓ Export téléchargé !");
      setShowExportModal(false);
    } catch (error) {
      alert("✗ Erreur export");
    } finally {
      setLoading(false);
    }
  };

  const requestDeletion = async () => {
    if (deleteConfirm !== "SUPPRIMER") {
      alert('✗ Tapez "SUPPRIMER" pour confirmer');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API}/gdpr/data/deletion-request?user_id=${user.id}`, {
        reason: deleteReason
      });
      
      alert("✓ Demande enregistrée. Vous avez 30 jours pour annuler.");
      setShowDeleteModal(false);
    } catch (error) {
      alert("✗ " + (error.response?.data?.detail || "Erreur"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout user={user} setUser={setUser}>
      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-20">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center gap-2 sm:gap-3 mb-1 sm:mb-2">
            <Shield className="h-6 w-6 sm:h-8 sm:w-8 text-cyan-500" />
            <h1 className="text-xl sm:text-2xl font-bold text-white" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
              Centre de confidentialité
            </h1>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm">
            Gérez vos données personnelles et votre confidentialité (RGPD)
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {["privacy", "data", "info"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? "bg-cyan-500 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {tab === "privacy" && "🔒 Confidentialité"}
              {tab === "data" && "📊 Mes données"}
              {tab === "info" && "ℹ️ Transparence"}
            </button>
          ))}
        </div>

        {/* Confidentialité */}
        {activeTab === "privacy" && (
          <div className="space-y-3 sm:space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-base sm:text-lg font-bold text-white mb-4">
                Visibilité du profil
              </h2>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs sm:text-sm mb-2 block text-slate-300">
                    Qui peut voir votre profil ?
                  </label>
                  <select
                    value={privacySettings.profile_visibility}
                    onChange={(e) => updatePrivacySettings({ ...privacySettings, profile_visibility: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                  >
                    <option value="public">🌍 Public - Tout le monde</option>
                    <option value="friends_only">👥 Amis uniquement</option>
                    <option value="private">🔒 Privé - Personne</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-white">Afficher mon email</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Visible sur votre profil</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={privacySettings.show_email}
                      onChange={(e) => updatePrivacySettings({ ...privacySettings, show_email: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-white">Afficher mon activité</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Dernière connexion</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={privacySettings.show_activity}
                      onChange={(e) => updatePrivacySettings({ ...privacySettings, show_activity: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* Cookies */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-base sm:text-lg font-bold text-white mb-4">
                🍪 Gestion des cookies
              </h2>
              
              <div className="space-y-3">
                <div className="p-3 bg-green-950/20 border border-green-900/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-white">Cookies essentiels</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Session, authentification</p>
                    </div>
                    <span className="px-2 py-1 bg-green-500/10 text-green-500 text-xs rounded font-medium">
                      Toujours actifs
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-white">Cookies analytics</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Statistiques anonymes</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localStorage.getItem("cookie_consent") === "accepted"}
                        onChange={(e) => {
                          localStorage.setItem("cookie_consent", e.target.checked ? "accepted" : "rejected");
                          alert(e.target.checked ? "✓ Cookies activés" : "✓ Cookies désactivés");
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                    </label>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-3 bg-blue-950/20 border border-blue-900/50 rounded-lg text-xs sm:text-sm text-slate-300">
                  <Shield className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <p>
                    Nous n'utilisons <strong>aucun cookie publicitaire</strong> ni de tracking tiers. 
                    <a href="/api/legal/cookie-policy" target="_blank" className="text-cyan-400 hover:underline ml-1">
                      En savoir plus
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mes données */}
        {activeTab === "data" && (
          <div className="space-y-3 sm:space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-base sm:text-lg font-bold text-white mb-2">
                Télécharger mes données
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-4">
                Droit à la portabilité (Article 20 RGPD)
              </p>
              <button
                onClick={() => setShowExportModal(true)}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
              >
                <Download className="h-4 w-4" />
                Exporter toutes mes données
              </button>
            </div>

            <div className="bg-red-950/20 border border-red-900/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <h2 className="text-base sm:text-lg font-bold text-red-500">
                  Supprimer mon compte
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mb-4">
                Droit à l'oubli (Article 17 RGPD)
              </p>
              <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 mb-3 text-xs text-slate-300">
                <p className="font-medium text-red-400 mb-1">⚠️ Action irréversible</p>
                <p>Toutes vos données seront supprimées définitivement après 30 jours. Vous pouvez annuler pendant ce délai.</p>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
              >
                <Trash2 className="h-4 w-4" />
                Demander la suppression
              </button>
            </div>
          </div>
        )}

        {/* Transparence */}
        {activeTab === "info" && (
          <div className="space-y-3 sm:space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-base sm:text-lg font-bold text-white mb-4">
                Vos droits RGPD
              </h2>
              <div className="space-y-2">
                {[
                  "📄 Droit d'accès à vos données (Article 15)",
                  "✏️ Droit de rectification (Article 16)",
                  "🗑️ Droit à l'oubli (Article 17)",
                  "📦 Droit à la portabilité (Article 20)",
                  "🚫 Droit d'opposition (Article 21)"
                ].map((right, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs sm:text-sm text-slate-300">
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                    <span>{right}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-950/20 border border-blue-900/50 rounded-xl p-4">
              <p className="text-xs sm:text-sm text-blue-400 font-medium mb-2">
                📧 Contact DPO (Délégué à la Protection des Données)
              </p>
              <p className="text-xs text-slate-300">
                Pour toute question sur vos données : <strong className="text-white">dpo@nexussocial.com</strong>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href="/api/legal/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg text-xs sm:text-sm font-medium text-center transition-all"
              >
                📜 Confidentialité
              </a>
              <a
                href="/api/legal/cookie-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg text-xs sm:text-sm font-medium text-center transition-all"
              >
                🍪 Cookies
              </a>
            </div>
          </div>
        )}

        {/* Modal Export */}
        {showExportModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowExportModal(false)}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-2">Exporter vos données</h3>
              <p className="text-sm text-slate-300 mb-4">
                Téléchargez une copie de toutes vos données au format JSON
              </p>
              <ul className="text-xs text-slate-400 mb-4 space-y-1">
                <li>• Informations de profil</li>
                <li>• Toutes vos publications</li>
                <li>• Vos commentaires et likes</li>
                <li>• Vos abonnements</li>
              </ul>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={exportData}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white py-2.5 rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  {loading ? "Export..." : "Télécharger"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Delete */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteModal(false)}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-red-500 mb-2">Supprimer mon compte</h3>
              <p className="text-sm text-slate-400 mb-4">
                Cette action est irréversible après 30 jours
              </p>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-sm text-slate-300 mb-2 block">Raison (optionnel)</label>
                  <textarea
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm resize-none"
                    placeholder="Pourquoi supprimez-vous votre compte ?"
                    rows={3}
                  />
                </div>
                <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-300 mb-2">
                    Tapez <strong className="text-red-500">SUPPRIMER</strong> pour confirmer
                  </p>
                  <input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                    placeholder="SUPPRIMER"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={requestDeletion}
                  disabled={loading || deleteConfirm !== "SUPPRIMER"}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "..." : "Confirmer"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
