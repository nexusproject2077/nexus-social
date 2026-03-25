import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { API } from '../App';
import axios from 'axios';
import Layout from '../components/Layout';
import ChangePasswordModal from '../components/ChangePasswordModal';

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  surface:   "#0b1326",
  low:       "#131b2e",
  container: "#171f33",
  high:      "#222a3d",
  bright:    "#31394d",
  cyan:      "#22d3ee",
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
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: C.outline }}>{label}</label>
      <input
        type={type}
        value={value || ""}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-xl text-sm border-none outline-none transition-all focus:ring-1 focus:ring-cyan-400/40 placeholder:text-slate-600 disabled:opacity-50"
        style={{ background: C.high, color: C.onSurface }}
      />
    </div>
  );
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
export default function SettingsPage({ user, setUser }) {
  const navigate = useNavigate();
  const [activeSection, setActiveSection]   = useState("account");
  const [settings, setSettings]             = useState(null);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [editMode, setEditMode]             = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [profileData, setProfileData] = useState({
    first_name: "", last_name: "", bio: "",
    location: "", website: "", phone: "", birthdate: "", gender: ""
  });

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API}/users/me/settings`);
      setSettings(res.data);
      if (res.data?.profile) setProfileData(res.data.profile);
    } catch { toast.error("Erreur chargement"); }
    finally { setLoading(false); }
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
    { id: "account",  icon: "manage_accounts",  label: "Compte" },
    { id: "privacy",  icon: "gavel",             label: "Confidentialité" },
    { id: "security", icon: "shield",            label: "Sécurité" },
    { id: "content",  icon: "tune",              label: "Contenu" },
    { id: "display",  icon: "palette",           label: "Affichage" },
  ];

  if (loading) {
    return (
      <Layout user={user} setUser={setUser}>
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
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Votre compte</h2>
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

  const renderPrivacy = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Confidentialité</h2>
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

      {/* Privacy toggles */}
      <Card>
        <CardHeader title="Visibilité du compte" icon="visibility" />
        <ToggleRow icon="lock" label="Compte privé" sublabel="Seuls vos abonnés voient vos publications" checked={settings?.privacy?.is_private || false} onChange={v => updatePrivacy("is_private", v)} />
        <ToggleRow icon="chat" label="Autoriser les réponses aux stories" sublabel="Les autres peuvent répondre à vos stories" checked={settings?.privacy?.allow_story_replies !== false} onChange={v => updatePrivacy("allow_story_replies", v)} />
        <ToggleRow icon="alternate_email" label="Autoriser les mentions" sublabel="Permettre aux autres de vous mentionner" checked={settings?.privacy?.allow_mentions !== false} onChange={v => updatePrivacy("allow_mentions", v)} />
      </Card>

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

      {/* 2FA */}
      <Card>
        <CardHeader title="Authentification à deux facteurs" icon="security" />
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold" style={{ color: C.onSurface }}>Authentification 2FA</p>
              <p className="text-xs mt-0.5" style={{ color: C.outline }}>Gratuit via application Authenticator</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase" style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80" }}>Actif</span>
              <Toggle checked={true} onChange={() => toast.info("Configurez dans l'appli")} />
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
        <CardHeader title="Filtre de contenu" icon="filter_alt" />
        <ToggleRow label="Contenu sensible" sublabel="Afficher le contenu marqué comme sensible" checked={false} onChange={() => toast.info("Paramètre à venir")} />
        <ToggleRow label="Lecture auto des vidéos" sublabel="Les vidéos se lancent automatiquement" checked={true} onChange={() => toast.info("Paramètre à venir")} />
        <ToggleRow label="Suggestion algorithmique" sublabel="Contenu basé sur vos interactions" checked={true} onChange={() => toast.info("Paramètre à venir")} />
      </Card>
      <Card>
        <CardHeader title="Transparence algorithmique (DSA)" icon="analytics" />
        <div className="p-5">
          <p className="text-sm mb-4" style={{ color: C.outline }}>Conformément au Digital Services Act, vous avez le droit de comprendre pourquoi vous voyez certains contenus.</p>
          <button onClick={() => toast.info("Inspection de l'algorithme à venir")} className="px-5 py-2 rounded-xl font-bold text-sm transition-all hover:opacity-80"
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

  const renderDisplay = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Affichage</h2>
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
          <div className="flex gap-3">
            {[C.cyan, "#3b82f6", "#8b5cf6", "#ec4899", "#f97316"].map((color, i) => (
              <button key={i} onClick={() => toast.info("Personnalisation à venir")}
                className="w-10 h-10 rounded-full border-2 transition-all hover:scale-110"
                style={{ background: color, borderColor: i === 0 ? "#fff" : "transparent" }} />
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Langue" icon="language" />
        <RowItem icon="translate" label="Langue de l'interface" right="Français" onClick={() => toast.info("Multilingue à venir")} />
      </Card>
    </div>
  );

  const sectionMap = {
    account:  renderAccount,
    privacy:  renderPrivacy,
    security: renderSecurity,
    content:  renderContent,
    display:  renderDisplay,
  };

  return (
    <Layout user={user} setUser={setUser}>
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
          <div className="md:hidden px-4 pt-4 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
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
            <a href="#" className="hover:text-cyan-400 transition-colors">Conditions</a>
            <a href="#" className="hover:text-cyan-400 transition-colors">Politique de confidentialité</a>
            <a href="#" className="hover:text-cyan-400 transition-colors">Cookies</a>
            <span>Nexus v4.0 · EEA Node</span>
          </div>
        </main>
      </div>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
    </Layout>
  );
}
