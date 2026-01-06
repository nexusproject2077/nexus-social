// src/pages/SettingsPage.jsx - RESPONSIVE + CYAN THEME
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft,
  ChevronRight,
  User,
  Lock,
  Shield,
  Eye,
  Download,
  HeartCrack,
  Smartphone,
  Globe,
  Moon,
  Languages,
  Palette,
  HelpCircle,
  LogOut,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Link as LinkIcon,
  Check,
  X,
  Loader,
  Save
} from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../App';
import ChangePasswordModal from '../components/ChangePasswordModal';
import CustomAccountIcon from '../components/CustomAccountIcon';
import CustomNotificationIcon from '../components/CustomNotificationIcon';
import CustomShieldIcon from '../components/CustomShieldIcon';
import CustomEyeIcon from '../components/CustomEyeIcon';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState('main');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [profileData, setProfileData] = useState({
    first_name: '',
    last_name: '',
    bio: '',
    location: '',
    website: '',
    phone: '',
    birthdate: '',
    gender: ''
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API}/users/me/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setProfileData(data.profile || {});
      }
    } catch (err) {
      toast.error("Erreur chargement");
    } finally {
      setLoading(false);
    }
  };

  const updatePrivacy = async (key, value) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API}/users/me/privacy`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ [key]: value })
      });

      if (response.ok) {
        setSettings(prev => ({
          ...prev,
          privacy: { ...prev.privacy, [key]: value }
        }));
        toast.success("✓ Mis à jour");
      }
    } catch (err) {
      toast.error("Erreur");
    }
  };

  const updateProfile = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API}/users/me/profile-details`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(profileData)
      });

      if (response.ok) {
        toast.success("✓ Profil mis à jour !");
        setEditMode(false);
        fetchSettings();
      }
    } catch (err) {
      toast.error("Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/auth');
    toast.success("Déconnexion réussie");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950 flex items-center justify-center">
        <Loader className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  // MAIN VIEW
  if (currentView === 'main') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950">
        {/* Header - Responsive */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-xl border-b border-cyan-500/20">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between px-4 md:px-6 lg:px-8 py-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 hover:bg-cyan-500/10 rounded-full transition-all"
              >
                <ArrowLeft className="w-5 h-5 text-cyan-400" />
              </button>
              <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Paramètres
              </h1>
              <div className="w-9" />
            </div>
          </div>
        </div>

        {/* Content - Responsive Grid */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Votre compte */}
            <SettingCard
              icon={<CustomAccountIcon className="w-6 h-6" color="currentColor" />}
              title="Votre compte"
              subtitle={`@${settings?.account?.username}`}
              onClick={() => setCurrentView('account')}
              gradient="from-cyan-500/20 to-blue-500/20"
            />

            {/* Sécurité */}
            <SettingCard
              icon={<CustomShieldIcon className="w-6 h-6" color="currentColor" />}
              title="Sécurité"
              subtitle="Mot de passe et sessions"
              onClick={() => setCurrentView('security')}
              gradient="from-purple-500/20 to-pink-500/20"
            />

            {/* Notifications */}
            <SettingCard
              icon={<CustomNotificationIcon className="w-6 h-6" color="currentColor" />}
              title="Notifications"
              subtitle="Gérer les alertes"
              onClick={() => setCurrentView('notifications')}
              gradient="from-orange-500/20 to-red-500/20"
            />

            {/* Confidentialité */}
            <SettingCard
              icon={<CustomEyeIcon className="w-6 h-6" color="currentColor" />}
              title="Confidentialité"
              subtitle="Compte privé et stories"
              onClick={() => setCurrentView('privacy')}
              gradient="from-green-500/20 to-emerald-500/20"
            />

            {/* Affichage */}
            <SettingCard
              icon={<Palette className="w-6 h-6" />}
              title="Affichage"
              subtitle="Thème et apparence"
              onClick={() => setCurrentView('display')}
              gradient="from-yellow-500/20 to-orange-500/20"
            />

            {/* Aide */}
            <SettingCard
              icon={<HelpCircle className="w-6 h-6" />}
              title="Aide"
              subtitle="Support et assistance"
              onClick={() => toast.info("📧 support@nexus-social.com")}
              gradient="from-indigo-500/20 to-purple-500/20"
            />
          </div>

          {/* Déconnexion */}
          <div className="mt-8">
            <button
              onClick={handleLogout}
              className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-500/20"
            >
              <LogOut className="w-5 h-5" />
              Se déconnecter
            </button>
          </div>

          {/* Footer */}
          <div className="text-center text-cyan-400/40 text-sm py-8">
            <p>Nexus Social © 2025</p>
          </div>
        </div>
      </div>
    );
  }

  // ACCOUNT VIEW
  if (currentView === 'account') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950">
        <ViewHeader 
          title="Votre compte" 
          subtitle={`@${settings?.account?.username}`}
          onBack={() => setCurrentView('main')} 
        />

        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl border border-cyan-500/20 overflow-hidden">
            <div className="p-4 text-cyan-400/60 text-sm border-b border-cyan-500/10">
              Consultez et modifiez les informations de votre compte
            </div>

            <div className="divide-y divide-cyan-500/10">
              <SettingItem
                icon={<User className="w-5 h-5" />}
                title="Informations du compte"
                subtitle="Nom, email, téléphone, bio"
                onClick={() => setCurrentView('account-info')}
              />
              <SettingItem
                icon={<Lock className="w-5 h-5" />}
                title="Changer le mot de passe"
                subtitle="Modifier votre mot de passe"
                onClick={() => setShowPasswordModal(true)}
              />
              <SettingItem
                icon={<Download className="w-5 h-5" />}
                title="Télécharger vos données"
                subtitle="Export GDPR complet"
                onClick={() => toast.info("Téléchargement à venir")}
              />
              <SettingItem
                icon={<HeartCrack className="w-5 h-5" />}
                title="Désactiver votre compte"
                subtitle="Temporairement ou définitivement"
                onClick={() => toast.warning("Contactez le support")}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ACCOUNT INFO - Responsive Form
  if (currentView === 'account-info') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950">
        <ViewHeader 
          title="Informations"
          onBack={() => setCurrentView('account')}
          action={
            editMode ? (
              <button
                onClick={updateProfile}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full text-white font-semibold hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Enregistrer
              </button>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="text-cyan-400 font-semibold hover:text-cyan-300 transition-colors"
              >
                Modifier
              </button>
            )
          }
        />

        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl border border-cyan-500/20 p-4 md:p-6">
            {/* Grid responsive pour les champs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {/* Username */}
              <InputField
                label="Nom d'utilisateur"
                value={settings?.account?.username}
                icon={<User className="w-5 h-5" />}
                disabled
              />

              {/* Email */}
              <InputField
                label="Email"
                value={settings?.account?.email}
                icon={<Mail className="w-5 h-5" />}
                disabled
              />

              {/* Prénom */}
              <InputField
                label="Prénom"
                value={profileData.first_name}
                onChange={(e) => setProfileData({...profileData, first_name: e.target.value})}
                icon={<User className="w-5 h-5" />}
                disabled={!editMode}
              />

              {/* Nom */}
              <InputField
                label="Nom"
                value={profileData.last_name}
                onChange={(e) => setProfileData({...profileData, last_name: e.target.value})}
                icon={<User className="w-5 h-5" />}
                disabled={!editMode}
              />

              {/* Téléphone */}
              <InputField
                label="Téléphone"
                value={profileData.phone}
                onChange={(e) => setProfileData({...profileData, phone: e.target.value})}
                icon={<Phone className="w-5 h-5" />}
                disabled={!editMode}
                type="tel"
              />

              {/* Date de naissance */}
              <InputField
                label="Date de naissance"
                value={profileData.birthdate}
                onChange={(e) => setProfileData({...profileData, birthdate: e.target.value})}
                icon={<Calendar className="w-5 h-5" />}
                disabled={!editMode}
                type="date"
              />

              {/* Localisation */}
              <InputField
                label="Localisation"
                value={profileData.location}
                onChange={(e) => setProfileData({...profileData, location: e.target.value})}
                icon={<MapPin className="w-5 h-5" />}
                disabled={!editMode}
              />

              {/* Site web */}
              <InputField
                label="Site web"
                value={profileData.website}
                onChange={(e) => setProfileData({...profileData, website: e.target.value})}
                icon={<LinkIcon className="w-5 h-5" />}
                disabled={!editMode}
                type="url"
              />
            </div>

            {/* Bio - Full width */}
            <div className="mt-6">
              <label className="text-sm text-cyan-400/80 mb-2 block font-medium">Bio</label>
              <textarea
                value={profileData.bio}
                onChange={(e) => setProfileData({...profileData, bio: e.target.value})}
                disabled={!editMode}
                className="w-full bg-slate-800/50 border border-cyan-500/20 rounded-xl px-4 py-3 text-white disabled:opacity-60 resize-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                rows={4}
                maxLength={160}
                placeholder="Parlez de vous..."
              />
              <div className="text-right text-xs text-cyan-400/60 mt-1">
                {profileData.bio?.length || 0}/160
              </div>
            </div>

            {/* Genre - Full width */}
            <div className="mt-6">
              <label className="text-sm text-cyan-400/80 mb-2 block font-medium">Genre</label>
              <select
                value={profileData.gender}
                onChange={(e) => setProfileData({...profileData, gender: e.target.value})}
                disabled={!editMode}
                className="w-full bg-slate-800/50 border border-cyan-500/20 rounded-xl px-4 py-3 text-white disabled:opacity-60 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
              >
                <option value="">Préférer ne pas dire</option>
                <option value="male">Homme</option>
                <option value="female">Femme</option>
                <option value="other">Autre</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SECURITY VIEW
  if (currentView === 'security') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950">
        <ViewHeader 
          title="Sécurité"
          subtitle="Protection de votre compte"
          onBack={() => setCurrentView('main')} 
        />

        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl border border-cyan-500/20 overflow-hidden">
            <div className="divide-y divide-cyan-500/10">
              <SettingItem
                icon={<Shield className="w-5 h-5" />}
                title="Authentification à deux facteurs"
                subtitle="Sécurité renforcée (à venir)"
                onClick={() => toast.info("Bientôt disponible")}
              />
              <SettingItem
                icon={<Smartphone className="w-5 h-5" />}
                title="Appareils et sessions"
                subtitle="Gérer les appareils connectés"
                onClick={() => toast.info("Liste des sessions à venir")}
              />
              <SettingItem
                icon={<Globe className="w-5 h-5" />}
                title="Comptes connectés"
                subtitle="Google, Apple (à venir)"
                onClick={() => toast.info("Aucun compte connecté")}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // NOTIFICATIONS VIEW - Responsive
  if (currentView === 'notifications') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950">
        <ViewHeader 
          title="Notifications"
          subtitle="Gérer vos alertes"
          onBack={() => setCurrentView('main')} 
        />

        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-4">
          {/* Publications */}
          <NotificationSection title="Publications des personnes que vous suivez">
            <ToggleItem
              title="Posts"
              subtitle="15 personnes"
              checked={true}
              onChange={() => {}}
            />
          </NotificationSection>

          {/* Interactions */}
          <NotificationSection title="En rapport avec vous et vos posts">
            <ToggleItem title="Mentions et réponses" subtitle="Adapté pour vous" checked={true} onChange={() => {}} />
            <ToggleItem title="Reposts" subtitle="Adapté pour vous" checked={false} onChange={() => {}} />
            <ToggleItem title="J'aime" subtitle="Adapté pour vous" checked={true} onChange={() => {}} />
            <ToggleItem title="Photo tags" checked={true} onChange={() => {}} />
            <ToggleItem title="Moments" checked={true} onChange={() => {}} />
          </NotificationSection>

          {/* Abonnés */}
          <NotificationSection title="Abonnés et contacts">
            <ToggleItem title="Nouveaux abonnés" checked={true} onChange={() => {}} />
            <ToggleItem title="Contact rejoint Nexus" checked={true} onChange={() => {}} />
          </NotificationSection>

          {/* Messages */}
          <NotificationSection title="Messages directs">
            <ToggleItem title="Messages directs" checked={true} onChange={() => {}} />
            <ToggleItem title="Réactions aux messages" subtitle="Vos propres messages" checked={false} onChange={() => {}} />
          </NotificationSection>
        </div>
      </div>
    );
  }

  // PRIVACY VIEW
  if (currentView === 'privacy') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950">
        <ViewHeader 
          title="Confidentialité"
          subtitle="Contrôlez votre visibilité"
          onBack={() => setCurrentView('main')} 
        />

        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl border border-cyan-500/20 overflow-hidden">
            <div className="divide-y divide-cyan-500/10">
              <ToggleItem
                title="Compte privé"
                subtitle="Seuls vos abonnés voient vos publications"
                checked={settings?.privacy?.is_private || false}
                onChange={(val) => updatePrivacy('is_private', val)}
              />
              <ToggleItem
                title="Autoriser les réponses aux stories"
                subtitle="Les autres peuvent répondre à vos stories"
                checked={settings?.privacy?.allow_story_replies !== false}
                onChange={(val) => updatePrivacy('allow_story_replies', val)}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // DISPLAY VIEW
  if (currentView === 'display') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950">
        <ViewHeader 
          title="Affichage"
          subtitle="Personnaliser l'apparence"
          onBack={() => setCurrentView('main')} 
        />

        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl border border-cyan-500/20 overflow-hidden">
            <div className="divide-y divide-cyan-500/10">
              <ToggleItem
                title="Mode sombre"
                subtitle="Toujours activé"
                checked={true}
                onChange={() => {}}
                disabled
              />
              <SettingItem
                icon={<Palette className="w-5 h-5" />}
                title="Couleur d'accentuation"
                subtitle="Cyan (par défaut)"
                onClick={() => toast.info("Personnalisation à venir")}
              />
              <SettingItem
                icon={<Languages className="w-5 h-5" />}
                title="Langue"
                subtitle="Français"
                onClick={() => toast.info("Multilingue à venir")}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render modal if needed
  return (
    <>
      {showPasswordModal && (
        <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />
      )}
    </>
  );
}

// COMPOSANTS UTILITAIRES

function ViewHeader({ title, subtitle, onBack, action }) {
  return (
    <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-xl border-b border-cyan-500/20">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between px-4 md:px-6 py-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              onClick={onBack}
              className="p-2 hover:bg-cyan-500/10 rounded-full transition-all flex-shrink-0"
            >
              <ArrowLeft className="w-5 h-5 text-cyan-400" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-white truncate">{title}</h1>
              {subtitle && <p className="text-sm text-cyan-400/60 truncate">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="ml-4 flex-shrink-0">{action}</div>}
        </div>
      </div>
    </div>
  );
}

function SettingCard({ icon, title, subtitle, onClick, gradient }) {
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden bg-slate-900/50 backdrop-blur-sm border border-cyan-500/20 rounded-2xl p-6 hover:border-cyan-500/40 transition-all duration-300 text-left`}
    >
      {/* Gradient Background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
      
      {/* Content */}
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-3">
          <div className="p-3 bg-cyan-500/10 rounded-xl text-cyan-400 group-hover:bg-cyan-500/20 transition-all">
            {icon}
          </div>
          <ChevronRight className="w-5 h-5 text-cyan-400/40 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
        </div>
        <h3 className="font-bold text-white mb-1">{title}</h3>
        <p className="text-sm text-cyan-400/60">{subtitle}</p>
      </div>
    </button>
  );
}

function SettingItem({ icon, title, subtitle, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 md:px-6 py-4 flex items-center gap-4 hover:bg-cyan-500/5 transition-all group"
    >
      <div className="text-cyan-400/60 group-hover:text-cyan-400 transition-colors">{icon}</div>
      <div className="flex-1 text-left min-w-0">
        <p className="font-medium text-white truncate">{title}</p>
        {subtitle && <p className="text-sm text-cyan-400/60 truncate">{subtitle}</p>}
      </div>
      <ChevronRight className="w-5 h-5 text-cyan-400/40 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all flex-shrink-0" />
    </button>
  );
}

function ToggleItem({ title, subtitle, checked, onChange, disabled }) {
  return (
    <div className="px-4 md:px-6 py-4 flex items-center justify-between gap-4 hover:bg-cyan-500/5 transition-all">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate">{title}</p>
        {subtitle && <p className="text-sm text-cyan-400/60 truncate">{subtitle}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative w-12 h-6 rounded-full transition-all flex-shrink-0 ${
          checked ? 'bg-gradient-to-r from-cyan-500 to-blue-500' : 'bg-slate-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-lg ${
            checked ? 'translate-x-6' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function NotificationSection({ title, children }) {
  return (
    <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl border border-cyan-500/20 overflow-hidden">
      <div className="px-4 md:px-6 py-3 bg-cyan-500/5 border-b border-cyan-500/10">
        <h2 className="text-sm font-semibold text-cyan-400">{title}</h2>
      </div>
      <div className="divide-y divide-cyan-500/10">
        {children}
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, icon, disabled, type = "text" }) {
  return (
    <div className="w-full">
      <label className="text-sm text-cyan-400/80 mb-2 block font-medium">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400/40">
          {icon}
        </div>
        <input
          type={type}
          value={value || ''}
          onChange={onChange}
          disabled={disabled}
          className="w-full bg-slate-800/50 border border-cyan-500/20 rounded-xl pl-11 pr-4 py-3 text-white disabled:opacity-60 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-cyan-400/30"
        />
      </div>
    </div>
  );
}
