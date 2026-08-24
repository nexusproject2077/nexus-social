import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { API } from '../App';
import axios from 'axios';
import Layout from '../components/Layout';
import ChangePasswordModal from '../components/ChangePasswordModal';
import LanguageSwitcher from '../components/LanguageSwitcher';
import AlgorithmTransparencyModal from '../components/AlgorithmTransparencyModal';
import { ACCENTS, PREMIUM_ACCENTS, applyAccent, getAccent } from '../lib/accent';
import PremiumModal from '@/components/PremiumModal';
import { enablePush, disablePush, isPushEnabled, pushReasonLabel } from '@/lib/push';
import { isPrivacyStrict, setPrivacyStrict } from '@/lib/privacyStrict';

// Libellés FR des types de notification (pour les réglages).
const NOTIF_TYPE_LABELS = {
  like: "J'aime", comment: "Commentaires", comment_reply: "Réponses à vos commentaires",
  mention: "Mentions", tag: "Identifications", follow: "Nouveaux abonnés",
  follow_request: "Demandes d'abonnement", follow_accepted: "Demandes acceptées",
  live: "Directs des abonnements", message: "Messages privés", group_message: "Messages de groupe",
  story_reply: "Réponses à vos stories", story_reaction: "Réactions à vos stories",
  trending: "Tendances", security: "Sécurité",
};

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  surface:   "#0b1326",
  low:       "#131b2e",
  container: "#171f33",
  high:      "#222a3d",
  bright:    "#31394d",
  cyan:      (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
  onPrimary: "#00363e",
  outline:   "#859397",
  outlineVar:"#3c494c",
  onSurface: "#dae2fd",
  onVariant: "#bbc9cd",
  error:     "#ffb4ab",
};

// ── Reusable Toggle ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-all flex-shrink-0 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      style={{ background: checked ? "linear-gradient(90deg,#22d3ee,#3b82f6)" : C.high }}
    >
      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

// ── Row components ─────────────────────────────────────────────────────────────
function NavRow({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all"
      style={{
        color: active ? C.cyan : C.outline,
        background: active ? `linear-gradient(to right, ${C.cyan}12, transparent)` : "transparent",
        borderLeft: active ? `3px solid ${C.cyan}` : "3px solid transparent",
      }}
    >
      <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function RowItem({ icon, label, sublabel, right, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-4 transition-all text-left hover:opacity-80"
      style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}
    >
      <span className="material-symbols-outlined text-lg" style={{ color: danger ? C.error : C.outline }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: danger ? C.error : C.onSurface }}>{label}</p>
        {sublabel && <p className="text-xs mt-0.5" style={{ color: C.outline }}>{sublabel}</p>}
      </div>
      {right && <div className="flex-shrink-0 text-xs font-bold" style={{ color: C.cyan }}>{right}</div>}
      {!right && <span className="material-symbols-outlined text-lg flex-shrink-0" style={{ color: C.outlineVar }}>chevron_right</span>}
    </button>
  );
}

function ToggleRow({ icon, label, sublabel, checked, onChange, disabled }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
      {icon && <span className="material-symbols-outlined text-lg" style={{ color: C.outline }}>{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: C.onSurface }}>{label}</p>
        {sublabel && <p className="text-xs mt-0.5" style={{ color: C.outline }}>{sublabel}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`rounded-2xl overflow-hidden ${className}`} style={{ background: C.container, border: "1px solid rgba(255,255,255,0.05)" }}>
      {children}
    </div>
  );
}

function CardHeader({ title, icon }) {
  return (
    <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="flex items-center gap-3">
        {icon && <span className="material-symbols-outlined text-lg" style={{ color: C.cyan }}>{icon}</span>}
        <h3 className="font-black text-sm uppercase tracking-widest" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{title}</h3>
      </div>
    </div>
  );
}

// ── InputField ─────────────────────────────────────────────────────────────────
function InputField({ label, value, onChange, disabled, type = "text", placeholder }) {
  return (
    <div className="min-w-0">
      <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: C.outline }}>{label}</label>
      <input
        type={type}
        value={value || ""}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full min-w-0 box-border px-4 py-2.5 rounded-xl text-sm border-none outline-none transition-all focus:ring-1 focus:ring-cyan-400/40 placeholder:text-slate-600 disabled:opacity-50"
        style={{ background: C.high, color: C.onSurface, appearance: "none", WebkitAppearance: "none" }}
      />
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
export default function SettingsPage({ user, setUser }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [activeSection, setActiveSection]   = useState("account");
  const [settings, setSettings]             = useState(null);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [editMode, setEditMode]             = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAlgoModal, setShowAlgoModal] = useState(false);
  const [accent, setAccent] = useState(getAccent());
  const [mutedInput, setMutedInput] = useState("");
  const [premiumPitch, setPremiumPitch] = useState(null);   // texte de la modale Premium (null = fermée)
  const [watchHistory, setWatchHistory] = useState(null);   // historique de visionnage (null = pas encore chargé)

  // Notifications : préférences par type + état de l'abonnement push.
  const [notifTypes, setNotifTypes]       = useState([]);
  const [disabledTypes, setDisabledTypes] = useState([]);
  const [pushOn, setPushOn]               = useState(false);
  const [pushBusy, setPushBusy]           = useState(false);

  useEffect(() => {
    axios.get(`${API}/notifications/settings`)
      .then((r) => { setNotifTypes(r.data?.types || []); setDisabledTypes(r.data?.disabled_types || []); })
      .catch(() => {});
    isPushEnabled().then(setPushOn).catch(() => {});
  }, []);

  const toggleNotifType = async (type, enabled) => {
    // enabled = true → on RETIRE le type des désactivés.
    const next = enabled ? disabledTypes.filter((t) => t !== type) : [...new Set([...disabledTypes, type])];
    setDisabledTypes(next); // optimiste
    try {
      await axios.put(`${API}/notifications/settings`, { disabled_types: next });
    } catch {
      toast.error("Impossible d'enregistrer la préférence");
    }
  };

  const togglePush = async (on) => {
    setPushBusy(true);
    try {
      if (on) {
        const res = await enablePush({ interactive: true });
        setPushOn(res.ok);
        if (res.ok) toast.success(pushReasonLabel("ok"));
        else toast.error(pushReasonLabel(res.reason));
      } else {
        await disablePush();
        setPushOn(false);
        toast.success("Notifications push désactivées");
      }
    } finally {
      setPushBusy(false);
    }
  };

  const [profileData, setProfileData] = useState({
    first_name: "", last_name: "", bio: "",
    location: "", website: "", phone: "", birthdate: "", gender: "", crypto_wallet: "", paypal_link: ""
  });

  const saveCryptoWallet = async () => {
    try {
      await axios.put(`${API}/users/me/profile-details`, { crypto_wallet: profileData.crypto_wallet });
      toast.success("Wallet enregistré");
    } catch { toast.error("Erreur"); }
  };

  const savePaypal = async () => {
    try {
      const res = await axios.put(`${API}/users/me/profile-details`, { paypal_link: profileData.paypal_link });
      const saved = res.data?.user?.paypal_link ?? "";
      setProfileData((p) => ({ ...p, paypal_link: saved }));
      toast.success(saved ? "Lien PayPal enregistré" : "Lien PayPal retiré");
    } catch { toast.error("Lien PayPal invalide"); }
  };

  // Widgets sportifs : préférences utilisateur (foot + MMA, défaut affiché).
  const [showSports, setShowSports] = useState(user?.show_sports !== false);
  const [showMma, setShowMma] = useState(user?.show_mma !== false);
  const toggleShowSports = async (value) => {
    setShowSports(value);
    setUser?.((prev) => (prev ? { ...prev, show_sports: value } : prev));
    try {
      await axios.put(`${API}/users/me/show-sports`, { show_sports: value });
      toast.success(value ? "Scores de foot affichés" : "Scores de foot masqués");
    } catch {
      setShowSports(!value);
      setUser?.((prev) => (prev ? { ...prev, show_sports: !value } : prev));
      toast.error("Erreur");
    }
  };
  const toggleShowMma = async (value) => {
    setShowMma(value);
    setUser?.((prev) => (prev ? { ...prev, show_mma: value } : prev));
    try {
      await axios.put(`${API}/users/me/show-sports`, { show_mma: value });
      toast.success(value ? "Combats MMA affichés" : "Combats MMA masqués");
    } catch {
      setShowMma(!value);
      setUser?.((prev) => (prev ? { ...prev, show_mma: !value } : prev));
      toast.error("Erreur");
    }
  };

  // Bien-être numérique : limite de temps quotidienne configurable.
  const [timeLimit, setTimeLimit] = useState(user?.daily_time_limit || 0);
  const [timeLimitOn, setTimeLimitOn] = useState(user?.time_limit_enabled !== false);
  const saveTimeLimit = async (minutes) => {
    const v = Number(minutes) || 0;
    setTimeLimit(v);
    setUser?.((prev) => (prev ? { ...prev, daily_time_limit: v || null } : prev));
    try {
      await axios.put(`${API}/users/me/time-limit`, { daily_time_limit: v || null });
      toast.success(v ? `Limite fixée à ${v} min/jour` : "Limite de temps désactivée");
    } catch {
      toast.error("Erreur");
    }
  };
  const toggleTimeLimit = async (value) => {
    setTimeLimitOn(value);
    setUser?.((prev) => (prev ? { ...prev, time_limit_enabled: value } : prev));
    try {
      await axios.put(`${API}/users/me/time-limit`, { time_limit_enabled: value });
    } catch {
      setTimeLimitOn(!value);
      toast.error("Erreur");
    }
  };

  // Alertes sportives push (buts foot / résultats MMA).
  const [sportAlerts, setSportAlerts] = useState({ goals: true, match: false, mma: true });
  useEffect(() => {
    axios.get(`${API}/users/me/sport-alerts`).then((r) => setSportAlerts(r.data)).catch(() => {});
  }, []);
  const toggleSportAlert = async (key, value) => {
    setSportAlerts((prev) => ({ ...prev, [key]: value }));
    // Activer une alerte suppose l'autorisation des notifications push.
    if (value && !pushOn) {
      try {
        const res = await enablePush({ interactive: true });
        setPushOn(res.ok);
        if (!res.ok) toast.error("Autorise les notifications pour recevoir les alertes");
      } catch { /* noop */ }
    }
    try {
      await axios.put(`${API}/users/me/sport-alerts`, { [key]: value });
    } catch {
      setSportAlerts((prev) => ({ ...prev, [key]: !value }));
      toast.error("Erreur");
    }
  };

  // Stripe Connect (pourboires par carte) : état + activation.
  const [connect, setConnect] = useState(null); // { connected, charges_enabled, enabled }
  const [connectBusy, setConnectBusy] = useState(false);
  useEffect(() => {
    axios.get(`${API}/billing/connect/status`).then((r) => setConnect(r.data)).catch(() => setConnect(null));
  }, []);
  const activateStripe = async () => {
    setConnectBusy(true);
    try {
      const r = await axios.post(`${API}/billing/connect/onboard`);
      if (r.data?.url) window.location.href = r.data.url;
      else { toast.error("Activation indisponible"); setConnectBusy(false); }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Activation indisponible");
      setConnectBusy(false);
    }
  };

  // PayPal Commerce (pourboires PayPal avec commission automatique).
  const [paypalStatus, setPaypalStatus] = useState(null); // { enabled, connected, receivable }
  const [paypalBusy, setPaypalBusy] = useState(false);
  useEffect(() => {
    axios.get(`${API}/billing/paypal/status`).then((r) => setPaypalStatus(r.data)).catch(() => setPaypalStatus(null));
  }, []);
  const connectPaypal = async () => {
    setPaypalBusy(true);
    try {
      const r = await axios.post(`${API}/billing/paypal/onboard`);
      if (r.data?.url) window.location.href = r.data.url;
      else { toast.error("Activation PayPal indisponible"); setPaypalBusy(false); }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Activation PayPal indisponible");
      setPaypalBusy(false);
    }
  };

  const startSubscription = async () => {
    try {
      const res = await axios.post(`${API}/billing/create-checkout-session`);
      if (res.data?.url) window.location.href = res.data.url;
      else toast.error("Abonnement indisponible");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Les paiements ne sont pas encore configurés");
    }
  };

  useEffect(() => {
    const sub = new URLSearchParams(window.location.search).get("sub");
    if (sub === "success") toast.success("Abonnement activé — bienvenue chez Premium 🎉");
    else if (sub === "cancel") toast.info("Abonnement annulé");
  }, []);
  const [creatorStats, setCreatorStats] = useState(null);

  useEffect(() => { fetchSettings(); fetchCreatorStats(); }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API}/users/me/settings`);
      setSettings(res.data);
      if (res.data?.profile) setProfileData(res.data.profile);
    } catch { toast.error("Erreur chargement"); }
    finally { setLoading(false); }
  };

  const fetchCreatorStats = async () => {
    try {
      const res = await axios.get(`${API}/users/me/stats`);
      setCreatorStats(res.data);
    } catch { /* stats optionnelles */ }
  };

  const updatePrivacy = async (key, value) => {
    try {
      await axios.put(`${API}/users/me/privacy`, { [key]: value });
      setSettings(prev => ({ ...prev, privacy: { ...prev?.privacy, [key]: value } }));
      toast.success("Mis à jour");
    } catch { toast.error("Erreur"); }
  };

  const updateProfile = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/users/me/profile-details`, profileData);
      toast.success("Profil mis à jour !");
      setEditMode(false);
      fetchSettings();
    } catch { toast.error("Erreur"); }
    finally { setSaving(false); }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    if (setUser) setUser(null);
    navigate("/auth");
  };

  const handleDataExport = async () => {
    try {
      toast.info("Export en cours...");
      const res = await axios.get(`${API}/users/me/data-export`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "nexus-data-export.json"; a.click();
      URL.revokeObjectURL(url);
      toast.success("Export téléchargé !");
    } catch { toast.error("Export échoué"); }
  };

  const navSections = [
    { id: "account",  icon: "manage_accounts",  label: t("settings.account") },
    { id: "activity", icon: "history",           label: "Votre activité" },
    { id: "creator",  icon: "paid",              label: t("settings.creator") },
    { id: "privacy",  icon: "gavel",             label: t("settings.privacy") },
    { id: "notifications", icon: "notifications", label: "Notifications" },
    { id: "security", icon: "shield",            label: t("settings.security") },
    { id: "content",  icon: "tune",              label: t("settings.content") },
    { id: "display",  icon: "palette",           label: t("settings.display") },
  ];

  if (loading) {
    return (
      <Layout user={user} setUser={setUser} compact hideMobileHeader>
        <div className="flex items-center justify-center h-screen">
          <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
        </div>
      </Layout>
    );
  }

  // ── Section renderers ────────────────────────────────────────────────────────

  const renderAccount = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("settings.your_account")}</h2>
        <p className="text-sm" style={{ color: C.outline }}>Gérez vos informations personnelles et vos préférences</p>
      </div>

      {/* Profile info card */}
      <Card>
        <CardHeader title="Informations du profil" icon="person" />
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField label="Nom d'utilisateur" value={settings?.account?.username} disabled />
            <InputField label="Email" value={settings?.account?.email} disabled />
            <InputField label="Prénom" value={profileData.first_name} onChange={e => setProfileData(p => ({ ...p, first_name: e.target.value }))} disabled={!editMode} />
            <InputField label="Nom" value={profileData.last_name} onChange={e => setProfileData(p => ({ ...p, last_name: e.target.value }))} disabled={!editMode} />
            <InputField label="Téléphone" type="tel" value={profileData.phone} onChange={e => setProfileData(p => ({ ...p, phone: e.target.value }))} disabled={!editMode} />
            <InputField label="Date de naissance" type="date" value={profileData.birthdate} onChange={e => setProfileData(p => ({ ...p, birthdate: e.target.value }))} disabled={!editMode} />
            <InputField label="Localisation" value={profileData.location} onChange={e => setProfileData(p => ({ ...p, location: e.target.value }))} disabled={!editMode} />
            <InputField label="Site web" type="url" value={profileData.website} onChange={e => setProfileData(p => ({ ...p, website: e.target.value }))} disabled={!editMode} />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: C.outline }}>Bio</label>
            <textarea
              value={profileData.bio || ""}
              onChange={e => setProfileData(p => ({ ...p, bio: e.target.value }))}
              disabled={!editMode}
              rows={3}
              maxLength={160}
              placeholder="Parlez de vous..."
              className="w-full px-4 py-2.5 rounded-xl text-sm resize-none border-none outline-none transition-all focus:ring-1 focus:ring-cyan-400/40 placeholder:text-slate-600 disabled:opacity-50"
              style={{ background: C.high, color: C.onSurface }}
            />
            <div className="text-right text-[10px] mt-1" style={{ color: C.outline }}>{profileData.bio?.length || 0}/160</div>
          </div>
          <div className="flex gap-3 pt-2">
            {editMode ? (
              <>
                <button onClick={updateProfile} disabled={saving}
                  className="px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 hover:opacity-90"
                  style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
                <button onClick={() => setEditMode(false)} className="px-5 py-2 rounded-xl font-bold text-sm transition-all hover:opacity-80"
                  style={{ background: C.high, color: C.outline }}>
                  Annuler
                </button>
              </>
            ) : (
              <button onClick={() => setEditMode(true)} className="px-5 py-2 rounded-xl font-bold text-sm transition-all hover:opacity-80"
                style={{ background: C.high, color: C.cyan, border: `1px solid ${C.cyan}30` }}>
                Modifier le profil
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Account actions */}
      <Card>
        <CardHeader title="Gestion du compte" icon="settings" />
        <RowItem icon="lock" label="Changer le mot de passe" sublabel="Mettre à jour votre mot de passe" onClick={() => setShowPasswordModal(true)} />
        <RowItem icon="download" label="Exporter mes données" sublabel="Télécharger une copie de vos données (RGPD)" onClick={handleDataExport} />
        <RowItem icon="logout" label="Se déconnecter" sublabel="Terminer la session en cours" onClick={handleLogout} danger />
      </Card>
    </div>
  );

  const renderCreator = () => {
    const stats = [
      { label: "Abonnés",       value: creatorStats?.followers_count, icon: "group" },
      { label: "J'aime reçus",  value: creatorStats?.total_likes,     icon: "favorite" },
      { label: "Publications",  value: creatorStats?.posts_count,     icon: "article" },
      { label: "Commentaires",  value: creatorStats?.total_comments,  icon: "chat_bubble" },
    ];
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Espace créateur</h2>
          <p className="text-sm" style={{ color: C.outline }}>Suivez vos performances et gérez la monétisation de vos contenus</p>
        </div>

        {/* Aperçu des statistiques */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((s, i) => (
            <div key={i} className="rounded-2xl p-4" style={{ background: C.container, border: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="material-symbols-outlined text-lg" style={{ color: C.cyan }}>{s.icon}</span>
              <p className="text-2xl font-black mt-1" style={{ color: C.onSurface }}>{s.value ?? "—"}</p>
              <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: C.outline }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Abonnement Premium */}
        <Card>
          <CardHeader title="Nexus Premium" icon="workspace_premium" />
          <div className="p-5 space-y-3">
            {user?.is_premium ? (
              <p className="text-sm font-bold flex items-center gap-2" style={{ color: C.cyan }}>
                <span className="material-symbols-outlined text-lg">verified</span>
                Abonnement Premium actif
              </p>
            ) : (
              <>
                <p className="text-sm" style={{ color: C.outline }}>
                  Passe Premium pour soutenir Nexus et débloquer les avantages créateur.
                </p>
                <button
                  onClick={startSubscription}
                  data-testid="subscribe-premium"
                  className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all active:scale-95"
                  style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }}
                >
                  <span className="material-symbols-outlined text-lg">workspace_premium</span>
                  Passer Premium
                </button>
              </>
            )}
          </div>
        </Card>

        {/* Analytique */}
        <Card>
          <CardHeader title="Analytique" icon="insights" />
          <RowItem
            icon="bar_chart"
            label="Tableau de bord analytique"
            sublabel="Vues, engagement et croissance détaillés"
            onClick={() => navigate("/analytics")}
          />
        </Card>

        {/* Monétisation */}
        {/* ── Recevoir des pourboires ─────────────────────────────────────
            Une seule section claire, 3 moyens au choix (le créateur peut en
            activer un ou plusieurs). Le bouton « Pourboire » apparaît sur ton
            profil dès qu'au moins un moyen est actif. */}
        <Card>
          <CardHeader title="Recevoir des pourboires" icon="volunteer_activism" />
          <div className="px-5 pt-3 pb-1 text-sm" style={{ color: C.outline }}>
            Active un ou plusieurs moyens ci-dessous. Un bouton <b style={{ color: C.onSurface }}>Pourboire</b> apparaîtra
            alors sur ton profil pour que tes abonnés puissent te soutenir.
          </div>

          {/* 1) Carte bancaire via Stripe */}
          <div className="p-5 space-y-3 border-t" style={{ borderColor: C.outlineVariant + "22" }}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined" style={{ color: C.cyan }}>credit_card</span>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: C.onSurface }}>Carte bancaire (Stripe)</p>
                <p className="text-xs" style={{ color: C.outline }}>Le plus simple pour tes abonnés — paiement sécurisé, versé sur ton compte.</p>
              </div>
              {connect?.charges_enabled && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1" style={{ background: "#22c55e22", color: "#22c55e" }}>
                  <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>Activé
                </span>
              )}
            </div>
            {connect && connect.enabled === false ? (
              <p className="text-xs" style={{ color: C.outline }}>Les paiements par carte ne sont pas encore configurés sur la plateforme.</p>
            ) : connect?.charges_enabled ? (
              <button onClick={activateStripe} disabled={connectBusy}
                className="text-xs font-bold px-4 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                style={{ background: C.surfaceHigh, color: C.onSurface, border: `1px solid ${C.outlineVariant}` }}>
                Gérer mon compte Stripe
              </button>
            ) : (
              <button onClick={activateStripe} disabled={connectBusy}
                data-testid="activate-stripe-tips"
                className="text-sm font-bold px-5 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                {connectBusy ? "Redirection…" : (connect?.connected ? "Terminer l'activation" : "Activer les pourboires par carte")}
              </button>
            )}
          </div>

          {/* 2) PayPal — Commerce (commission auto) si configuré, sinon lien PayPal.me */}
          <div className="p-5 space-y-3 border-t" style={{ borderColor: C.outlineVariant + "22" }}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined" style={{ color: C.cyan }}>account_balance_wallet</span>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: C.onSurface }}>PayPal</p>
                <p className="text-xs" style={{ color: C.outline }}>
                  {paypalStatus?.enabled
                    ? "Connecte ton compte PayPal : tu es payé directement, la commission est prélevée automatiquement."
                    : "Renseigne ton pseudo PayPal.me — tes abonnés te paient directement, sans commission Nexus."}
                </p>
              </div>
              {paypalStatus?.receivable && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1" style={{ background: "#22c55e22", color: "#22c55e" }}>
                  <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>Activé
                </span>
              )}
            </div>

            {paypalStatus?.enabled ? (
              paypalStatus.receivable ? (
                <button onClick={connectPaypal} disabled={paypalBusy}
                  className="text-xs font-bold px-4 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: C.surfaceHigh, color: C.onSurface, border: `1px solid ${C.outlineVariant}` }}>
                  Gérer mon compte PayPal
                </button>
              ) : (
                <button onClick={connectPaypal} disabled={paypalBusy}
                  data-testid="connect-paypal"
                  className="text-sm font-bold px-5 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                  {paypalBusy ? "Redirection…" : (paypalStatus.connected ? "Terminer la connexion PayPal" : "Connecter PayPal (paiements automatiques)")}
                </button>
              )
            ) : (
              <>
                <InputField
                  label="Pseudo ou lien PayPal.me"
                  value={profileData.paypal_link}
                  onChange={(e) => setProfileData((p) => ({ ...p, paypal_link: e.target.value }))}
                  placeholder="Ex : moncompte  (ou paypal.me/moncompte)"
                />
                <button onClick={savePaypal} data-testid="save-paypal"
                  className="px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
                  style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                  Enregistrer PayPal
                </button>
              </>
            )}
          </div>

          {/* 3) Crypto */}
          <div className="p-5 space-y-3 border-t" style={{ borderColor: C.outlineVariant + "22" }}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined" style={{ color: C.cyan }}>currency_bitcoin</span>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: C.onSurface }}>Crypto</p>
                <p className="text-xs" style={{ color: C.outline }}>Adresse Solana / USDT / BTC — sans intermédiaire ni frais de plateforme.</p>
              </div>
            </div>
            <InputField
              label="Adresse wallet"
              value={profileData.crypto_wallet}
              onChange={(e) => setProfileData((p) => ({ ...p, crypto_wallet: e.target.value }))}
              placeholder="Ex : 7xKX…（Solana / USDT / BTC）"
            />
            <button onClick={saveCryptoWallet} data-testid="save-wallet"
              className="px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              Enregistrer le wallet
            </button>
          </div>
        </Card>
      </div>
    );
  };

  const renderPrivacy = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("settings.privacy_title")}</h2>
        <p className="text-sm" style={{ color: C.outline }}>Contrôlez qui peut voir votre contenu et vos informations</p>
      </div>

      {/* RGPD Notice */}
      <div className="flex items-start gap-4 p-5 rounded-2xl" style={{ background: `${C.cyan}08`, border: `1px solid ${C.cyan}22` }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${C.cyan}15` }}>
          <span className="material-symbols-outlined text-lg" style={{ color: C.cyan, fontVariationSettings: "'FILL' 1" }}>verified_user</span>
        </div>
        <div>
          <p className="text-sm font-bold mb-1" style={{ color: C.onSurface }}>Conformité RGPD active</p>
          <p className="text-xs" style={{ color: C.outline }}>Vos données sont traitées conformément au RGPD. Vous avez le droit d'accéder, de corriger et de supprimer vos données.</p>
        </div>
      </div>

      {/* Mode Confidentialité stricte — l'interrupteur phare, 1 clic. */}
      {(() => {
        const strict = (typeof user?.privacy_strict === "boolean") ? user.privacy_strict : isPrivacyStrict();
        const setStrict = async (v) => {
          setPrivacyStrict(v); // effet immédiat côté client (pubs + tracking coupés)
          try {
            await axios.put(`${API}/users/me/privacy`, { privacy_strict: v });
            if (setUser && user) setUser({ ...user, privacy_strict: v });
            toast.success(v ? "Mode Confidentialité stricte activé" : "Mode Confidentialité stricte désactivé");
          } catch {
            setPrivacyStrict(!v); // rollback si le serveur refuse
            toast.error("Impossible d'enregistrer le réglage");
          }
        };
        return (
          <div className="p-5 rounded-2xl" style={{ background: strict ? `${C.cyan}10` : C.high, border: `1px solid ${strict ? C.cyan + "55" : "rgba(255,255,255,0.08)"}` }}>
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${C.cyan}18` }}>
                <span className="material-symbols-outlined" style={{ color: C.cyan, fontVariationSettings: "'FILL' 1" }}>shield_lock</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-black" style={{ color: C.onSurface }}>Mode Confidentialité stricte</p>
                  <Toggle checked={strict} onChange={setStrict} />
                </div>
                <p className="text-xs mt-1" style={{ color: C.outline }}>
                  En un clic, coupe tout ce qui n'est pas essentiel au service. Les fonctions restent identiques.
                </p>
                <div className="mt-3 space-y-1.5">
                  {[
                    ["query_stats", "Aucun suivi du temps d'écran (analytics comportemental désactivé)"],
                    ["ads_click", "Aucune publicité ciblée ni personnalisée"],
                  ].map(([ic, txt]) => (
                    <div key={ic} className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm" style={{ color: strict ? C.cyan : C.outline }}>{strict ? "check_circle" : ic}</span>
                      <span className="text-xs" style={{ color: strict ? C.onSurface : C.outline }}>{txt}</span>
                    </div>
                  ))}
                </div>
                {strict && (
                  <p className="text-[11px] mt-3 font-semibold" style={{ color: C.cyan }}>
                    Actif — et synchronisé sur tous vos appareils.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Privacy toggles */}
      <Card>
        <CardHeader title="Visibilité du compte" icon="visibility" />
        <ToggleRow icon="lock" label="Compte privé" sublabel="Seuls vos abonnés voient vos publications" checked={settings?.privacy?.is_private || false} onChange={v => updatePrivacy("is_private", v)} />
        <ToggleRow icon="chat" label="Autoriser les réponses aux stories" sublabel="Les autres peuvent répondre à vos stories" checked={settings?.privacy?.allow_story_replies !== false} onChange={v => updatePrivacy("allow_story_replies", v)} />
        <ToggleRow icon="alternate_email" label="Autoriser les mentions" sublabel="Permettre aux autres de vous mentionner" checked={settings?.privacy?.allow_mentions !== false} onChange={v => updatePrivacy("allow_mentions", v)} />
      </Card>

      {/* Messages et réponses — confidentialité de la messagerie (façon Instagram) */}
      {(() => {
        const savePref = async (key, value) => {
          if (setUser && user) setUser({ ...user, [key]: value });  // optimiste
          try { await axios.put(`${API}/users/me/preferences`, { [key]: value }); }
          catch { if (setUser && user) setUser({ ...user, [key]: !value }); toast.error("Échec de l'enregistrement"); }
        };
        return (
          <Card>
            <CardHeader title="Messages et réponses" icon="forum" />
            <ToggleRow icon="radio_button_checked" label="Afficher le statut en ligne"
              sublabel="Les autres voient votre point de présence et votre dernière connexion"
              checked={user?.show_active_status !== false}
              onChange={(v) => savePref("show_active_status", v)} />
            <ToggleRow icon="done_all" label="Confirmation de lecture"
              sublabel="Si désactivé, personne ne verra le « Vu » sous vos messages"
              checked={user?.read_receipts !== false}
              onChange={(v) => savePref("read_receipts", v)} />
          </Card>
        );
      })()}

      {/* Mots masqués — filtre personnel (fil + notifications) */}
      {(() => {
        const words = Array.isArray(user?.muted_words) ? user.muted_words : [];
        const saveMuted = async (list) => {
          try {
            await axios.put(`${API}/users/me/privacy`, { muted_words: list });
            if (setUser && user) setUser({ ...user, muted_words: list });
          } catch {
            toast.error("Impossible d'enregistrer les mots masqués");
          }
        };
        const addMuted = () => {
          const w = mutedInput.trim();
          if (!w) return;
          if (words.some((x) => x.toLowerCase() === w.toLowerCase())) { setMutedInput(""); return; }
          setMutedInput("");
          saveMuted([...words, w].slice(0, 200));
        };
        const removeMuted = (w) => saveMuted(words.filter((x) => x !== w));
        return (
          <Card>
            <CardHeader title="Mots masqués" icon="filter_alt" />
            <div className="px-4 pb-4">
              <p className="text-xs mb-3" style={{ color: C.outline }}>
                Les publications, clips et notifications contenant l'un de ces mots ou expressions seront masqués pour vous. Insensible à la casse et aux accents.
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={mutedInput}
                  onChange={(e) => setMutedInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMuted(); } }}
                  placeholder="Ajouter un mot ou une expression…"
                  maxLength={60}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ backgroundColor: "#171f33", color: C.onSurface, border: "1px solid rgba(255,255,255,0.08)" }}
                />
                <button
                  onClick={addMuted}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold active:scale-95 transition-transform"
                  style={{ backgroundColor: "var(--nexus-accent)", color: "#00363e" }}
                >
                  Ajouter
                </button>
              </div>
              {words.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {words.map((w) => (
                    <span key={w} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: "#171f33", color: C.onSurface, border: "1px solid rgba(255,255,255,0.08)" }}>
                      {w}
                      <button onClick={() => removeMuted(w)} aria-label={`Retirer ${w}`}
                        className="w-5 h-5 rounded-full flex items-center justify-center active:scale-90"
                        style={{ color: C.outline }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs mt-3" style={{ color: C.outline }}>Aucun mot masqué pour l'instant.</p>
              )}
            </div>
          </Card>
        );
      })()}

      {/* Data controls */}
      <Card>
        <CardHeader title="Contrôle des données" icon="database" />
        <RowItem icon="download" label="Exporter mes données" sublabel="Télécharger toutes vos données personnelles" onClick={handleDataExport} />
        <RowItem icon="delete_forever" label="Demander la suppression" sublabel="Supprimer définitivement votre compte" onClick={() => toast.info("Contactez support@nexus-social.com")} danger />
      </Card>

      {/* Ad targeting */}
      <Card>
        <CardHeader title="Ciblage publicitaire (DMA)" icon="target" />
        <ToggleRow label="Publicités personnalisées" sublabel="Basées sur votre activité Nexus" checked={true} onChange={() => toast.info("Paramètre à venir")} />
        <ToggleRow label="Données tierces" sublabel="Informations reçues de nos partenaires" checked={false} onChange={() => toast.info("Paramètre à venir")} />
        <ToggleRow label="Ciblage géographique" sublabel="Utilisation de votre localisation GPS" checked={false} onChange={() => toast.info("Paramètre à venir")} />
      </Card>
    </div>
  );

  const renderSecurity = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Sécurité</h2>
        <p className="text-sm" style={{ color: C.outline }}>Protégez votre compte et gérez vos sessions actives</p>
      </div>

      {/* 2FA — code de connexion envoyé par email */}
      <Card>
        <CardHeader title="Authentification à deux facteurs" icon="security" />
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="pr-3">
              <p className="text-sm font-bold" style={{ color: C.onSurface }}>Code de connexion par email</p>
              <p className="text-xs mt-0.5" style={{ color: C.outline }}>
                À chaque connexion, un code à 6 chiffres est envoyé à ton email pour confirmer que c'est bien toi.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {user?.twofa_enabled && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase" style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}>Actif</span>
              )}
              <Toggle checked={!!user?.twofa_enabled} onChange={async () => {
                const next = !user?.twofa_enabled;
                try {
                  await axios.put(`${API}/users/me/2fa`, { enabled: next });
                  const me = await axios.get(`${API}/auth/me`);
                  setUser && setUser(me.data);
                  toast.success(next ? "2FA activée" : "2FA désactivée");
                } catch (e) { toast.error(e.response?.data?.detail || "Action impossible."); }
              }} />
            </div>
          </div>
        </div>
      </Card>

      {/* Sessions */}
      <Card>
        <CardHeader title="Sessions actives" icon="devices" />
        <div className="p-5 space-y-3">
          {[
            { icon: "laptop", name: "Navigateur Web", detail: "Cette session • Actif maintenant", active: true },
            { icon: "smartphone", name: "Mobile", detail: "Dernière activité il y a 2h", active: false },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-xl" style={{ background: C.high }}>
              <span className="material-symbols-outlined text-lg" style={{ color: s.active ? C.cyan : C.outline }}>{s.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold" style={{ color: C.onSurface }}>{s.name}</p>
                <p className="text-[10px]" style={{ color: C.outline }}>{s.detail}</p>
                {s.active && <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5" style={{ color: C.cyan }}>Session actuelle</p>}
              </div>
            </div>
          ))}
          <button onClick={() => toast.info("Déconnexion des autres sessions...")} className="w-full mt-2 py-2 text-xs font-bold rounded-xl transition-all hover:opacity-80"
            style={{ border: `1px solid ${C.outlineVar}`, color: C.outline }}>
            Déconnecter tous les autres appareils
          </button>
        </div>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader title="Mot de passe" icon="key" />
        <RowItem icon="lock_reset" label="Changer le mot de passe" sublabel="Mettez à jour votre mot de passe régulièrement" onClick={() => setShowPasswordModal(true)} />
      </Card>
    </div>
  );

  const renderContent = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Préférences de contenu</h2>
        <p className="text-sm" style={{ color: C.outline }}>Personnalisez ce que vous voyez sur Nexus</p>
      </div>
      <Card>
        <CardHeader title="Widgets du fil" icon="widgets" />
        <ToggleRow
          icon="sports_soccer"
          label="Scores de foot en direct"
          sublabel="Le widget football en haut du fil (mobile) et dans la colonne de droite (PC)"
          checked={showSports}
          onChange={toggleShowSports}
        />
        <ToggleRow
          icon="sports_mma"
          label="Combats MMA / UFC"
          sublabel="Les cartes de combat UFC dans le même widget sportif"
          checked={showMma}
          onChange={toggleShowMma}
        />
      </Card>
      {/* Filtre éthique : masquer les contenus politiques (bien-être) */}
      {(() => {
        const savePol = async (v) => {
          if (setUser && user) setUser({ ...user, hide_political: v });
          try { await axios.put(`${API}/users/me/preferences`, { hide_political: v }); }
          catch { if (setUser && user) setUser({ ...user, hide_political: !v }); toast.error("Échec de l'enregistrement"); }
        };
        return (
          <Card>
            <CardHeader title="Sujets sensibles" icon="filter_alt" />
            <ToggleRow
              icon="gavel"
              label="Masquer les contenus politiques"
              sublabel="L'algorithme retire les publications liées à l'actualité politique de votre fil, pour préserver votre sérénité"
              checked={user?.hide_political === true}
              onChange={savePol}
            />
          </Card>
        );
      })()}
      {/* Bien-être numérique : limite de temps quotidienne + fin du scroll infini. */}
      <Card>
        <CardHeader title="Bien-être numérique" icon="self_improvement" />
        <ToggleRow
          icon="hourglass_top"
          label="Limite de temps quotidienne"
          sublabel="Un écran bienveillant t'invite à faire une pause une fois la durée atteinte"
          checked={timeLimitOn}
          onChange={toggleTimeLimit}
        />
        {timeLimitOn && (
          <div className="px-5 pb-5 pt-1">
            <p className="text-xs mb-2" style={{ color: C.outline }}>Durée par jour sur les flux (fil + clips)</p>
            <div className="flex flex-wrap gap-2">
              {[
                { v: 0, l: "Aucune" },
                { v: 30, l: "30 min" },
                { v: 45, l: "45 min" },
                { v: 60, l: "1 h" },
                { v: 90, l: "1 h 30" },
                { v: 120, l: "2 h" },
              ].map((o) => {
                const on = Number(timeLimit) === o.v;
                return (
                  <button key={o.v} onClick={() => saveTimeLimit(o.v)}
                    className="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95"
                    style={on
                      ? { background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }
                      : { background: C.surfaceHigh, color: C.onSurface, border: `1px solid ${C.outlineVariant}` }}>
                    {o.l}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Alertes sportives (notifications)" icon="notifications_active" />
        <ToggleRow
          icon="sports_soccer"
          label="Buts de foot"
          sublabel="Une notif à chaque but de tes ligues / équipes favorites"
          checked={sportAlerts.goals}
          onChange={(v) => toggleSportAlert("goals", v)}
        />
        <ToggleRow
          icon="schedule"
          label="Début et fin de match"
          sublabel="Coup d'envoi et coup de sifflet final (favoris)"
          checked={sportAlerts.match}
          onChange={(v) => toggleSportAlert("match", v)}
        />
        <ToggleRow
          icon="sports_mma"
          label="Résultats MMA / UFC"
          sublabel="Le vainqueur et la méthode dès la fin du combat"
          checked={sportAlerts.mma}
          onChange={(v) => toggleSportAlert("mma", v)}
        />
        <div className="px-5 pb-4 pt-1 text-xs" style={{ color: C.outline }}>
          {pushOn ? "Notifications activées sur cet appareil." : "Active une alerte pour autoriser les notifications."}
        </div>
      </Card>
      <Card>
        <CardHeader title="Filtre de contenu" icon="filter_alt" />
        <ToggleRow label="Contenu sensible" sublabel="Afficher le contenu marqué comme sensible" checked={false} onChange={() => toast.info("Paramètre à venir")} />
        <ToggleRow label="Lecture auto des vidéos" sublabel="Les vidéos se lancent automatiquement" checked={true} onChange={() => toast.info("Paramètre à venir")} />
        <ToggleRow label="Suggestion algorithmique" sublabel="Contenu basé sur vos interactions" checked={true} onChange={() => toast.info("Paramètre à venir")} />
      </Card>
      <Card>
        <CardHeader title="Transparence algorithmique (DSA)" icon="analytics" />
        <div className="p-5">
          <p className="text-sm mb-4" style={{ color: C.outline }}>Conformément au Digital Services Act, vous avez le droit de comprendre pourquoi vous voyez certains contenus.</p>
          <button onClick={() => setShowAlgoModal(true)} className="px-5 py-2 rounded-xl font-bold text-sm transition-all hover:opacity-80"
            style={{ background: `${C.cyan}15`, color: C.cyan, border: `1px solid ${C.cyan}30` }}>
            Inspecter l'algorithme
          </button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Comptes bloqués et muets" icon="block" />
        <RowItem icon="block" label="Comptes bloqués" sublabel="Gérer les utilisateurs bloqués" onClick={() => toast.info("Liste à venir")} />
        <RowItem icon="volume_off" label="Mots-clés muets" sublabel="Masquer certains mots du fil" onClick={() => toast.info("Configuration à venir")} />
      </Card>
    </div>
  );

  const renderNotifications = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Notifications</h2>
        <p className="text-sm" style={{ color: C.outline }}>Choisissez ce qui vous alerte, et où.</p>
      </div>

      <Card>
        <CardHeader title="Notifications push" icon="notifications_active" />
        <ToggleRow
          icon="phonelink_ring"
          label="Recevoir les push"
          sublabel="Être prévenu même quand l'app est fermée"
          checked={pushOn}
          onChange={togglePush}
          disabled={pushBusy}
        />
      </Card>

      <Card>
        <CardHeader title="Types de notification" icon="tune" />
        {notifTypes.map((type) => (
          <ToggleRow
            key={type}
            label={NOTIF_TYPE_LABELS[type] || type}
            checked={!disabledTypes.includes(type)}
            onChange={(v) => toggleNotifType(type, v)}
          />
        ))}
        {notifTypes.length === 0 && (
          <div className="p-5 text-sm" style={{ color: C.outline }}>Chargement des préférences…</div>
        )}
      </Card>
    </div>
  );

  const renderDisplay = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("settings.display_title")}</h2>
        <p className="text-sm" style={{ color: C.outline }}>Personnalisez l'apparence de Nexus</p>
      </div>
      <Card>
        <CardHeader title="Thème" icon="dark_mode" />
        <ToggleRow icon="dark_mode" label="Mode sombre" sublabel="Toujours activé sur Nexus" checked={true} onChange={() => {}} disabled />
      </Card>
      <Card>
        <CardHeader title="Couleur d'accentuation" icon="palette" />
        <div className="p-5">
          <p className="text-sm mb-4" style={{ color: C.outline }}>Choisissez la couleur principale de l'interface</p>
          {(() => {
            const isSel = (v) => accent.toLowerCase() === v.toLowerCase();
            const apply = (a) => {
              applyAccent(a.value);
              setAccent(a.value);
              toast.success(`Couleur « ${a.name} » appliquée`);
              // Persisté côté serveur → suit l'utilisateur sur ses autres appareils.
              axios.put(`${API}/users/me/appearance`, { accent_color: a.value }).catch(() => {});
            };
            return (
              <>
                {/* Couleurs gratuites (unies) */}
                <div className="flex flex-wrap gap-3">
                  {ACCENTS.map((a) => (
                    <button key={a.value} title={a.name} aria-label={a.name}
                      onClick={() => apply(a)}
                      className="w-10 h-10 rounded-full border-2 transition-all hover:scale-110"
                      style={{ background: a.value, borderColor: isSel(a.value) ? "#fff" : "transparent" }} />
                  ))}
                </div>

                {/* Thèmes Premium (dégradés) */}
                <div className="flex items-center gap-2 mt-5 mb-3">
                  <span className="material-symbols-outlined" style={{ color: "#e0a92e", fontSize: 18 }}>workspace_premium</span>
                  <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#c9b06a" }}>Thèmes de luxe · Premium</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {PREMIUM_ACCENTS.map((a) => {
                    const locked = !user?.is_premium;
                    return (
                      <button key={a.name} title={a.name} aria-label={a.name}
                        onClick={() => {
                          if (locked) { setPremiumPitch(`Le thème « ${a.name} » est réservé aux abonnés.`); return; }
                          apply(a);
                        }}
                        className="relative w-10 h-10 rounded-full border-2 transition-all hover:scale-110"
                        style={{ background: a.value, borderColor: isSel(a.value) ? "#fff" : "rgba(255,255,255,0.14)" }}>
                        {locked && (
                          <span className="absolute inset-0 flex items-center justify-center rounded-full"
                            style={{ background: "rgba(4,8,20,0.5)" }}>
                            <span className="material-symbols-outlined" style={{ color: "#fff", fontSize: 16 }}>lock</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs mt-3" style={{ color: C.outlineVar }}>
                  La navigation, le logo et les boutons se recolorent aussitôt. Votre choix est enregistré et vous suit sur tous vos appareils.
                  {!user?.is_premium && " Les dégradés de luxe nécessitent Nexus Premium."}
                </p>
              </>
            );
          })()}
        </div>
      </Card>
      <PremiumModal open={!!premiumPitch} feature={premiumPitch} onClose={() => setPremiumPitch(null)} />
      <Card>
        <CardHeader title="Langue" icon="language" />
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: C.onSurface }}>Langue de l'interface</p>
            <p className="text-xs mt-0.5" style={{ color: C.outline }}>Détectée automatiquement selon votre pays</p>
          </div>
          <LanguageSwitcher />
        </div>
      </Card>
    </div>
  );

  // Charge l'historique de visionnage à l'ouverture de l'onglet « Votre activité ».
  useEffect(() => {
    if (activeSection !== "activity" || watchHistory !== null) return;
    axios.get(`${API}/users/me/watch-history`, { params: { limit: 40 } })
      .then((r) => setWatchHistory(Array.isArray(r.data) ? r.data : []))
      .catch(() => setWatchHistory([]));
  }, [activeSection, watchHistory]);

  const renderActivity = () => {
    const items = watchHistory || [];
    const clearHistory = async () => {
      try { await axios.delete(`${API}/users/me/watch-history`); setWatchHistory([]); toast.success("Historique effacé"); }
      catch { toast.error("Échec de l'effacement"); }
    };
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Historique de visionnage</h2>
            <p className="text-sm" style={{ color: C.outline }}>Les Clips et publications vus récemment — pour les retrouver, liker ou partager.</p>
          </div>
          {items.length > 0 && (
            <button onClick={clearHistory} className="flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: C.high, color: "#f87171" }}>Effacer</button>
          )}
        </div>
        {watchHistory === null ? (
          <div className="flex justify-center py-16"><div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-4xl" style={{ color: C.outline }}>history_toggle_off</span>
            <p className="text-sm mt-2" style={{ color: C.outline }}>Aucun visionnage pour l'instant.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {items.map((p) => {
              const isVideo = p.media_type === "video";
              return (
                <button key={p.id} onClick={() => navigate(`/post/${p.id}`)}
                  className="relative aspect-square rounded-xl overflow-hidden active:scale-[0.97] transition-transform"
                  style={{ background: C.high, border: `1px solid rgba(255,255,255,0.06)` }}>
                  {p.media_url ? (
                    isVideo
                      ? <video src={p.media_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                      : <img src={p.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center p-2 text-[11px] text-center" style={{ color: C.outline }}>
                      {(p.content || "Publication").slice(0, 60)}
                    </span>
                  )}
                  {isVideo && (
                    <span className="absolute top-1.5 right-1.5 material-symbols-outlined" style={{ fontSize: 16, color: "#fff", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))", fontVariationSettings: "'FILL' 1" }}>play_circle</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const sectionMap = {
    account:  renderAccount,
    activity: renderActivity,
    creator:  renderCreator,
    privacy:  renderPrivacy,
    notifications: renderNotifications,
    security: renderSecurity,
    content:  renderContent,
    display:  renderDisplay,
  };

  return (
    <Layout user={user} setUser={setUser} compact hideMobileHeader>
      <div className="flex min-h-screen" style={{ backgroundColor: C.surface }}>

        {/* ── Settings sidebar ──────────────────────────────────────────────── */}
        <aside className="hidden md:flex flex-col flex-shrink-0 pt-6" style={{ width: 240, borderRight: `1px solid rgba(255,255,255,0.05)` }}>
          <div className="px-5 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: C.high }}>
                <span className="material-symbols-outlined text-base" style={{ color: C.cyan }}>manage_accounts</span>
              </div>
              <div>
                <h2 className="text-sm font-black" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Paramètres</h2>
                <p className="text-[9px] uppercase tracking-[0.2em] font-bold" style={{ color: C.outline }}>Nexus Governance</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5">
            {navSections.map(s => (
              <NavRow key={s.id} icon={s.icon} label={s.label} active={activeSection === s.id} onClick={() => setActiveSection(s.id)} />
            ))}
          </nav>
          {/* Export button */}
          <div className="p-5 mt-auto" style={{ borderTop: `1px solid rgba(255,255,255,0.05)` }}>
            <button onClick={handleDataExport} className="w-full py-2.5 rounded-xl font-black text-xs transition-all active:scale-95 hover:opacity-90"
              style={{ background: "linear-gradient(90deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              Exporter mes données
            </button>
          </div>
        </aside>

        {/* ── Main content ───────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          {/* Mobile section selector */}
          <div className="md:hidden px-4 pt-safe-4 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {navSections.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                style={{
                  background: activeSection === s.id ? "linear-gradient(90deg,#22d3ee,#3b82f6)" : C.high,
                  color: activeSection === s.id ? C.onPrimary : C.outline,
                }}>
                <span className="material-symbols-outlined text-sm">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>

          <div className="px-4 md:px-8 py-6 max-w-3xl">
            {(sectionMap[activeSection] || renderAccount)()}
          </div>

          {/* Footer */}
          <div className="px-8 py-6 flex flex-wrap gap-x-6 gap-y-2 text-[10px] font-bold uppercase tracking-widest" style={{ borderTop: `1px solid rgba(255,255,255,0.04)`, color: C.outlineVar }}>
            <Link to="/a-propos" className="hover:text-cyan-400 transition-colors">À propos</Link>
            <Link to="/comment-ca-marche" className="hover:text-cyan-400 transition-colors">Comment ça marche</Link>
            <Link to="/guides" className="hover:text-cyan-400 transition-colors">Guides</Link>
            <Link to="/faq" className="hover:text-cyan-400 transition-colors">FAQ</Link>
            <a href={`${API}/legal/terms-of-service`} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 transition-colors">Conditions</a>
            <a href={`${API}/legal/privacy-policy`} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 transition-colors">Politique de confidentialité</a>
            <a href={`${API}/legal/cookie-policy`} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 transition-colors">Cookies</a>
            <span>Nexus v4.0 · EEA Node</span>
          </div>
        </main>
      </div>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
      {showAlgoModal && <AlgorithmTransparencyModal onClose={() => setShowAlgoModal(false)} />}
    </Layout>
  );
}
