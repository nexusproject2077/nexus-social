// src/pages/SettingsPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft,
  ChevronRight,
  User,
  Lock,
  Shield,
  Bell,
  Eye,
  Download,
  HeartCrack,
  Smartphone,
  Globe,
  Moon,
  Languages,
  Palette,
  Volume2,
  HelpCircle,
  FileText,
  LogOut,
  Camera,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Link as LinkIcon,
  Check,
  X,
  Loader
} from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../App';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState('main'); // main, account, security, notifications
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form states pour l'édition du profil
  const [editMode, setEditMode] = useState(false);
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
      toast.error("Erreur lors du chargement");
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
        toast.success("Paramètre mis à jour");
      }
    } catch (err) {
      toast.error("Erreur");
    }
  };

  const updateProfile = async () => {
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
        toast.success("Profil mis à jour !");
        setEditMode(false);
        fetchSettings();
      }
    } catch (err) {
      toast.error("Erreur mise à jour");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/auth');
    toast.success("Déconnexion réussie");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  // MAIN VIEW - Liste des sections principales
  if (currentView === 'main') {
    return (
      <div className="min-h-screen bg-black text-white">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-black/95 backdrop-blur-xl border-b border-slate-800">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-slate-800 rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold">Paramètres</h1>
            <div className="w-9" />
          </div>
        </div>

        {/* Sections principales */}
        <div className="divide-y divide-slate-800">
          <SettingSection
            icon={<User className="w-5 h-5" />}
            title="Votre compte"
            subtitle={`@${settings?.account?.username}`}
            onClick={() => setCurrentView('account')}
          />
          <SettingSection
            icon={<Shield className="w-5 h-5" />}
            title="Sécurité et accès au compte"
            subtitle="Gérez la sécurité de votre compte"
            onClick={() => setCurrentView('security')}
          />
          <SettingSection
            icon={<Bell className="w-5 h-5" />}
            title="Notifications"
            subtitle="Gérez vos notifications push"
            onClick={() => setCurrentView('notifications')}
          />
          <SettingSection
            icon={<Eye className="w-5 h-5" />}
            title="Confidentialité et sécurité"
            subtitle="Contrôlez ce que vous partagez"
            onClick={() => setCurrentView('privacy')}
          />
          <SettingSection
            icon={<Palette className="w-5 h-5" />}
            title="Affichage"
            subtitle="Thème et apparence"
            onClick={() => setCurrentView('display')}
          />
          <SettingSection
            icon={<HelpCircle className="w-5 h-5" />}
            title="Aide et assistance"
            subtitle="Besoin d'aide ?"
            onClick={() => toast.info("Contactez support@nexus-social.com")}
          />
        </div>

        {/* Déconnexion */}
        <div className="p-4 mt-8">
          <button
            onClick={handleLogout}
            className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-5 h-5" />
            Se déconnecter
          </button>
        </div>

        {/* Footer */}
        <div className="text-center text-slate-600 text-sm py-8">
          <p>Nexus Social © 2025</p>
        </div>
      </div>
    );
  }

  // ACCOUNT VIEW - Informations du compte
  if (currentView === 'account') {
    return (
      <div className="min-h-screen bg-black text-white">
        <ViewHeader 
          title="Votre compte" 
          subtitle={`@${settings?.account?.username}`}
          onBack={() => setCurrentView('main')} 
        />

        <div className="px-4 py-3 text-slate-400 text-sm">
          Consultez les informations de votre compte, téléchargez vos données ou désactivez votre compte.
        </div>

        <div className="divide-y divide-slate-800">
          <SettingItem
            icon={<User className="w-5 h-5" />}
            title="Informations du compte"
            subtitle="Nom, prénom, email, téléphone"
            onClick={() => setCurrentView('account-info')}
          />
          <SettingItem
            icon={<Lock className="w-5 h-5" />}
            title="Changer le mot de passe"
            subtitle="Modifiez votre mot de passe"
            onClick={() => setCurrentView('change-password')}
          />
          <SettingItem
            icon={<Download className="w-5 h-5" />}
            title="Télécharger vos données"
            subtitle="Archive de vos publications et données"
            onClick={() => toast.info("Fonctionnalité à venir")}
          />
          <SettingItem
            icon={<HeartCrack className="w-5 h-5" />}
            title="Désactiver votre compte"
            subtitle="Découvrez comment désactiver votre compte"
            onClick={() => toast.warning("Contactez le support pour désactiver")}
          />
        </div>
      </div>
    );
  }

  // ACCOUNT INFO - Édition des informations personnelles
  if (currentView === 'account-info') {
    return (
      <div className="min-h-screen bg-black text-white">
        <ViewHeader 
          title="Informations du compte"
          onBack={() => setCurrentView('account')}
          action={
            editMode ? (
              <button
                onClick={updateProfile}
                className="text-cyan-400 font-semibold hover:text-cyan-300"
              >
                Enregistrer
              </button>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="text-cyan-400 font-semibold hover:text-cyan-300"
              >
                Modifier
              </button>
            )
          }
        />

        <div className="p-4 space-y-4">
          {/* Username (lecture seule) */}
          <InputField
            label="Nom d'utilisateur"
            value={settings?.account?.username}
            icon={<User className="w-5 h-5" />}
            disabled
          />

          {/* Email (lecture seule) */}
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

          {/* Bio */}
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Bio</label>
            <textarea
              value={profileData.bio}
              onChange={(e) => setProfileData({...profileData, bio: e.target.value})}
              disabled={!editMode}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-white disabled:opacity-60 resize-none"
              rows={4}
              maxLength={160}
            />
            <div className="text-right text-xs text-slate-500 mt-1">
              {profileData.bio?.length || 0}/160
            </div>
          </div>

          {/* Genre */}
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Genre</label>
            <select
              value={profileData.gender}
              onChange={(e) => setProfileData({...profileData, gender: e.target.value})}
              disabled={!editMode}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-white disabled:opacity-60"
            >
              <option value="">Préférer ne pas dire</option>
              <option value="male">Homme</option>
              <option value="female">Femme</option>
              <option value="other">Autre</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  // SECURITY VIEW
  if (currentView === 'security') {
    return (
      <div className="min-h-screen bg-black text-white">
        <ViewHeader 
          title="Sécurité et accès au compte"
          subtitle={`@${settings?.account?.username}`}
          onBack={() => setCurrentView('main')} 
        />

        <div className="px-4 py-3 text-slate-400 text-sm">
          Gérez la sécurité de votre compte et suivez l'utilisation de votre compte.
        </div>

        <div className="divide-y divide-slate-800">
          <SettingItem
            icon={<Shield className="w-5 h-5" />}
            title="Sécurité"
            subtitle="Gérez la sécurité de votre compte"
            onClick={() => toast.info("Authentification à deux facteurs à venir")}
          />
          <SettingItem
            icon={<Smartphone className="w-5 h-5" />}
            title="Applications et sessions"
            subtitle="Appareils connectés et sessions actives"
            onClick={() => toast.info("Voir les sessions actives - à venir")}
          />
          <SettingItem
            icon={<Globe className="w-5 h-5" />}
            title="Comptes connectés"
            subtitle="Gérer les comptes Google ou Apple"
            onClick={() => toast.info("Aucun compte connecté")}
          />
        </div>
      </div>
    );
  }

  // NOTIFICATIONS VIEW
  if (currentView === 'notifications') {
    return (
      <div className="min-h-screen bg-black text-white">
        <ViewHeader 
          title="Notifications"
          onBack={() => setCurrentView('main')} 
        />

        {/* Section: Publications des personnes que vous suivez */}
        <SectionHeader title="Publications des personnes que vous suivez" />
        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="Posts"
            subtitle="15 personnes"
            checked={true}
            onChange={() => {}}
          />
        </div>

        {/* Section: En rapport avec vous et vos posts */}
        <SectionHeader title="En rapport avec vous et vos posts" />
        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="Mentions et réponses"
            subtitle="Adapté pour vous"
            checked={true}
            onChange={() => {}}
          />
          <ToggleItem
            title="Reposts"
            subtitle="Adapté pour vous"
            checked={false}
            onChange={() => {}}
          />
          <ToggleItem
            title="J'aime"
            subtitle="Adapté pour vous"
            checked={true}
            onChange={() => {}}
          />
          <ToggleItem
            title="Photo tags"
            checked={true}
            onChange={() => {}}
          />
          <ToggleItem
            title="Moments"
            checked={true}
            onChange={() => {}}
          />
        </div>

        {/* Section: Abonnés et contacts */}
        <SectionHeader title="Abonnés et contacts" />
        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="Nouveaux abonnés"
            checked={true}
            onChange={() => {}}
          />
          <ToggleItem
            title="Contact rejoint Nexus"
            checked={true}
            onChange={() => {}}
          />
        </div>

        {/* Section: Messages directs */}
        <SectionHeader title="Messages directs" />
        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="Messages directs"
            checked={true}
            onChange={() => {}}
          />
          <ToggleItem
            title="Réactions aux messages"
            subtitle="Vos propres messages"
            checked={false}
            onChange={() => {}}
          />
        </div>

        {/* Section: Recommandations de Nexus */}
        <SectionHeader title="Recommandations de Nexus" />
        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="Topics"
            checked={true}
            onChange={() => {}}
          />
          <ToggleItem
            title="Recommandations"
            checked={true}
            onChange={() => {}}
          />
        </div>

        {/* Section: Actualités de Nexus */}
        <SectionHeader title="Actualités de Nexus" />
        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="News / Sport"
            checked={true}
            onChange={() => {}}
          />
          <ToggleItem
            title="Aperçu des nouvelles fonctionnalités"
            checked={true}
            onChange={() => {}}
          />
        </div>

        {/* Section: Alertes d'urgence */}
        <SectionHeader title="Alertes d'urgence" />
        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="Alertes de crise et d'urgence"
            checked={true}
            onChange={() => {}}
          />
        </div>
      </div>
    );
  }

  // PRIVACY VIEW
  if (currentView === 'privacy') {
    return (
      <div className="min-h-screen bg-black text-white">
        <ViewHeader 
          title="Confidentialité et sécurité"
          onBack={() => setCurrentView('main')} 
        />

        <div className="divide-y divide-slate-800">
          <ToggleItem
            title="Compte privé"
            subtitle="Seuls vos abonnés peuvent voir vos publications"
            checked={settings?.privacy?.is_private || false}
            onChange={(val) => updatePrivacy('is_private', val)}
          />
          <ToggleItem
            title="Autoriser les réponses aux stories"
            subtitle="Les autres peuvent répondre à vos stories"
            checked={settings?.privacy?.allow_story_replies !== false}
            onChange={(val) => updatePrivacy('allow_story_replies', val)}
          />
          <SettingItem
            icon={<Eye className="w-5 h-5" />}
            title="Audience et marquage"
            subtitle="Gérez qui peut vous voir et vous marquer"
            onClick={() => toast.info("Paramètres avancés à venir")}
          />
        </div>
      </div>
    );
  }

  // DISPLAY VIEW
  if (currentView === 'display') {
    return (
      <div className="min-h-screen bg-black text-white">
        <ViewHeader 
          title="Affichage"
          onBack={() => setCurrentView('main')} 
        />

        <div className="divide-y divide-slate-800">
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
            subtitle="Cyan"
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
    );
  }

  return null;
}

// Composants utilitaires
function ViewHeader({ title, subtitle, onBack, action }) {
  return (
    <div className="sticky top-0 z-10 bg-black/95 backdrop-blur-xl border-b border-slate-800">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 flex-1">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-800 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{title}</h1>
            {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action && <div>{action}</div>}
      </div>
    </div>
  );
}

function SettingSection({ icon, title, subtitle, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-4 flex items-center gap-4 hover:bg-slate-900 transition-colors"
    >
      <div className="text-slate-400">{icon}</div>
      <div className="flex-1 text-left">
        <p className="font-semibold">{title}</p>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <ChevronRight className="w-5 h-5 text-slate-600" />
    </button>
  );
}

function SettingItem({ icon, title, subtitle, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-4 flex items-center gap-4 hover:bg-slate-900 transition-colors"
    >
      <div className="text-slate-400">{icon}</div>
      <div className="flex-1 text-left">
        <p className="font-medium">{title}</p>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <ChevronRight className="w-5 h-5 text-slate-600" />
    </button>
  );
}

function ToggleItem({ title, subtitle, checked, onChange, disabled }) {
  return (
    <div className="px-4 py-4 flex items-center justify-between hover:bg-slate-900 transition-colors">
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          checked ? 'bg-cyan-500' : 'bg-slate-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div className="px-4 py-3 bg-slate-900/50">
      <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
    </div>
  );
}

function InputField({ label, value, onChange, icon, disabled, type = "text" }) {
  return (
    <div>
      <label className="text-sm text-slate-400 mb-2 block">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
          {icon}
        </div>
        <input
          type={type}
          value={value || ''}
          onChange={onChange}
          disabled={disabled}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-11 pr-4 py-3 text-white disabled:opacity-60 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
        />
      </div>
    </div>
  );
}
