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
import { useTranslation, Trans } from "react-i18next";

export default function PrivacyCenter({ user, setUser }) {
  const { t } = useTranslation();
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
      alert(t("privacycenter.ok_updated"));
    } catch (error) {
      alert(t("privacycenter.err"));
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
      link.setAttribute("download", `${t("privacycenter.file_prefix")}-${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      alert(t("privacycenter.export_done"));
      setShowExportModal(false);
    } catch (error) {
      alert(t("privacycenter.export_err"));
    } finally {
      setLoading(false);
    }
  };

  const requestDeletion = async () => {
    if (deleteConfirm !== t("privacycenter.delete_word")) {
      alert(t("privacycenter.type_delete", { word: t("privacycenter.delete_word") }));
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API}/gdpr/data/deletion-request?user_id=${user.id}`, {
        reason: deleteReason
      });
      
      alert(t("privacycenter.delete_requested"));
      setShowDeleteModal(false);
    } catch (error) {
      alert("✗ " + (error.response?.data?.detail || t("privacycenter.err").replace("✗ ","")));
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
              {t("privacycenter.title")}
            </h1>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm">
            {t("privacycenter.subtitle")}
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
              {tab === "privacy" && t("privacycenter.tab_privacy")}
              {tab === "data" && t("privacycenter.tab_data")}
              {tab === "info" && t("privacycenter.tab_info")}
            </button>
          ))}
        </div>

        {/* Confidentialité */}
        {activeTab === "privacy" && (
          <div className="space-y-3 sm:space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-base sm:text-lg font-bold text-white mb-4">
                {t("privacycenter.profile_vis")}
              </h2>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs sm:text-sm mb-2 block text-slate-300">
                    {t("privacycenter.who_can_see")}
                  </label>
                  <select
                    value={privacySettings.profile_visibility}
                    onChange={(e) => updatePrivacySettings({ ...privacySettings, profile_visibility: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                  >
                    <option value="public">{t("privacycenter.vis_public")}</option>
                    <option value="friends_only">{t("privacycenter.vis_friends")}</option>
                    <option value="private">{t("privacycenter.vis_private")}</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-white">{t("privacycenter.show_email")}</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">{t("privacycenter.show_email_sub")}</p>
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
                      <p className="text-xs sm:text-sm font-medium text-white">{t("privacycenter.show_activity")}</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">{t("privacycenter.show_activity_sub")}</p>
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
                {t("privacycenter.cookies_mgmt")}
              </h2>
              
              <div className="space-y-3">
                <div className="p-3 bg-green-950/20 border border-green-900/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-white">{t("privacycenter.cookies_essential")}</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">{t("privacycenter.cookies_essential_sub")}</p>
                    </div>
                    <span className="px-2 py-1 bg-green-500/10 text-green-500 text-xs rounded font-medium">
                      {t("privacycenter.always_on")}
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs sm:text-sm font-medium text-white">{t("privacycenter.cookies_analytics")}</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">{t("privacycenter.cookies_analytics_sub")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localStorage.getItem("cookie_consent") === "accepted"}
                        onChange={(e) => {
                          localStorage.setItem("cookie_consent", e.target.checked ? "accepted" : "rejected");
                          alert(e.target.checked ? t("privacycenter.cookies_on") : t("privacycenter.cookies_off"));
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
                    <Trans i18nKey="privacycenter.cookie_note" components={{ b: <strong /> }} />{" "}
                    <a href="/api/legal/cookie-policy" target="_blank" className="text-cyan-400 hover:underline ml-1">
                      {t("privacycenter.learn_more")}
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
                {t("privacycenter.dl_data")}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-4">
                {t("privacycenter.portability")}
              </p>
              <button
                onClick={() => setShowExportModal(true)}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
              >
                <Download className="h-4 w-4" />
                {t("privacycenter.export_all")}
              </button>
            </div>

            <div className="bg-red-950/20 border border-red-900/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <h2 className="text-base sm:text-lg font-bold text-red-500">
                  {t("privacycenter.delete_account")}
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mb-4">
                {t("privacycenter.right_erasure")}
              </p>
              <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 mb-3 text-xs text-slate-300">
                <p className="font-medium text-red-400 mb-1">{t("privacycenter.irreversible")}</p>
                <p>{t("privacycenter.delete_warn")}</p>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
              >
                <Trash2 className="h-4 w-4" />
                {t("privacycenter.request_deletion")}
              </button>
            </div>
          </div>
        )}

        {/* Transparence */}
        {activeTab === "info" && (
          <div className="space-y-3 sm:space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-base sm:text-lg font-bold text-white mb-4">
                {t("privacycenter.gdpr_rights")}
              </h2>
              <div className="space-y-2">
                {[
                  t("privacycenter.r_access"),
                  t("privacycenter.r_rectify"),
                  t("privacycenter.r_erasure"),
                  t("privacycenter.r_portability"),
                  t("privacycenter.r_object")
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
                {t("privacycenter.dpo_contact")}
              </p>
              <p className="text-xs text-slate-300">
                {t("privacycenter.dpo_q")} <strong className="text-white">dpo@nexussocial.com</strong>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href="/api/legal/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg text-xs sm:text-sm font-medium text-center transition-all"
              >
                {t("privacycenter.link_privacy")}
              </a>
              <a
                href="/api/legal/cookie-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg text-xs sm:text-sm font-medium text-center transition-all"
              >
                {t("privacycenter.link_cookies")}
              </a>
            </div>
          </div>
        )}

        {/* Modal Export */}
        {showExportModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowExportModal(false)}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-2">{t("privacycenter.export_title")}</h3>
              <p className="text-sm text-slate-300 mb-4">
                {t("privacycenter.export_desc")}
              </p>
              <ul className="text-xs text-slate-400 mb-4 space-y-1">
                <li>{t("privacycenter.export_i1")}</li>
                <li>{t("privacycenter.export_i2")}</li>
                <li>{t("privacycenter.export_i3")}</li>
                <li>{t("privacycenter.export_i4")}</li>
              </ul>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg transition-all"
                >
                  {t("privacycenter.cancel")}
                </button>
                <button
                  onClick={exportData}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white py-2.5 rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  {loading ? t("privacycenter.exporting") : t("privacycenter.download")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Delete */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteModal(false)}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-red-500 mb-2">{t("privacycenter.delete_title")}</h3>
              <p className="text-sm text-slate-400 mb-4">
                {t("privacycenter.delete_sub")}
              </p>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-sm text-slate-300 mb-2 block">{t("privacycenter.reason_label")}</label>
                  <textarea
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm resize-none"
                    placeholder={t("privacycenter.reason_ph")}
                    rows={3}
                  />
                </div>
                <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3">
                  <p className="text-xs text-slate-300 mb-2">
                    <Trans i18nKey="privacycenter.type_confirm" values={{ word: t("privacycenter.delete_word") }} components={{ b: <strong className="text-red-500" /> }} />
                  </p>
                  <input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                    placeholder={t("privacycenter.delete_word")}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-lg transition-all"
                >
                  {t("privacycenter.cancel")}
                </button>
                <button
                  onClick={requestDeletion}
                  disabled={loading || deleteConfirm !== t("privacycenter.delete_word")}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? t("privacycenter.confirming") : t("privacycenter.confirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
