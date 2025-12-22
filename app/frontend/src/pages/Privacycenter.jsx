// PrivacyCenter.jsx - Centre de confidentialité RGPD

import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield,
  Download,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  History,
  Globe,
  Users,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export default function PrivacyCenter({ user, setUser }) {
  const [activeTab, setActiveTab] = useState("privacy");
  const [loading, setLoading] = useState(false);
  
  // Privacy Settings
  const [privacySettings, setPrivacySettings] = useState({
    profile_visibility: "public",
    show_email: false,
    show_activity: true,
    allow_tagging: true,
    allow_messaging: "everyone",
    data_retention_days: 365
  });
  
  // Consents
  const [consents, setConsents] = useState({
    analytics: false,
    marketing: false,
    third_party: false,
    data_sharing: false
  });
  
  const [consentHistory, setConsentHistory] = useState([]);
  const [dataUsageInfo, setDataUsageInfo] = useState(null);
  
  // Modals
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    loadPrivacySettings();
    loadConsentHistory();
    loadDataUsageInfo();
  }, []);

  const loadPrivacySettings = async () => {
    try {
      const response = await axios.get(`${API}/gdpr/privacy/settings/${user.id}`);
      setPrivacySettings(response.data);
    } catch (error) {
      console.error("Erreur chargement paramètres:", error);
    }
  };

  const loadConsentHistory = async () => {
    try {
      const response = await axios.get(`${API}/gdpr/consent/history/${user.id}`);
      setConsentHistory(response.data.history || []);
    } catch (error) {
      console.error("Erreur chargement historique:", error);
    }
  };

  const loadDataUsageInfo = async () => {
    try {
      const response = await axios.get(`${API}/gdpr/transparency/data-usage/${user.id}`);
      setDataUsageInfo(response.data);
    } catch (error) {
      console.error("Erreur chargement infos:", error);
    }
  };

  const updatePrivacySettings = async (newSettings) => {
    try {
      await axios.put(`${API}/gdpr/privacy/settings?user_id=${user.id}`, newSettings);
      setPrivacySettings(newSettings);
      toast.success("Paramètres de confidentialité mis à jour");
    } catch (error) {
      toast.error("Erreur mise à jour");
    }
  };

  const updateConsent = async (consentType, value) => {
    try {
      await axios.post(`${API}/gdpr/consent/update?user_id=${user.id}`, {
        consent_type: consentType,
        consent_given: value
      });
      
      setConsents({ ...consents, [consentType]: value });
      toast.success(`Consentement ${value ? "accordé" : "retiré"}`);
      loadConsentHistory();
    } catch (error) {
      toast.error("Erreur mise à jour consentement");
    }
  };

  const exportData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/gdpr/data/export/${user.id}`);
      
      // Télécharger le JSON
      const dataStr = JSON.stringify(response.data, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = window.URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `mes-donnees-${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      toast.success("Export téléchargé !");
      setShowExportModal(false);
    } catch (error) {
      toast.error("Erreur export");
    } finally {
      setLoading(false);
    }
  };

  const requestDeletion = async () => {
    if (deleteConfirm !== "SUPPRIMER") {
      toast.error('Tapez "SUPPRIMER" pour confirmer');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API}/gdpr/data/deletion-request?user_id=${user.id}`, {
        reason: deleteReason
      });
      
      toast.success("Demande de suppression enregistrée. Vous avez 30 jours pour annuler.");
      setShowDeleteModal(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur");
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
            <h1
              className="text-xl sm:text-2xl font-bold text-white"
              style={{ fontFamily: "Space Grotesk, sans-serif" }}
            >
              Centre de confidentialité
            </h1>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm">
            Gérez vos données personnelles et votre confidentialité (RGPD)
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-4 sm:mb-6 h-auto">
            <TabsTrigger value="privacy" className="text-[10px] sm:text-sm py-2">
              <Lock className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Confidentialité</span>
              <span className="sm:hidden">Privé</span>
            </TabsTrigger>
            <TabsTrigger value="consents" className="text-[10px] sm:text-sm py-2">
              <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Consentements</span>
              <span className="sm:hidden">Consen.</span>
            </TabsTrigger>
            <TabsTrigger value="data" className="text-[10px] sm:text-sm py-2">
              <FileText className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Mes données</span>
              <span className="sm:hidden">Données</span>
            </TabsTrigger>
            <TabsTrigger value="transparency" className="text-[10px] sm:text-sm py-2">
              <Info className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Transparence</span>
              <span className="sm:hidden">Info</span>
            </TabsTrigger>
          </TabsList>

          {/* Confidentialité */}
          <TabsContent value="privacy" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Visibilité du profil</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Contrôlez qui peut voir votre profil
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4">
                <div>
                  <Label className="text-xs sm:text-sm mb-2 block">Visibilité</Label>
                  <Select
                    value={privacySettings.profile_visibility}
                    onValueChange={(value) => updatePrivacySettings({ ...privacySettings, profile_visibility: value })}
                  >
                    <SelectTrigger className="bg-slate-800 border-slate-700 h-9 sm:h-10 text-xs sm:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="public" className="text-xs sm:text-sm">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3 w-3 sm:h-4 sm:w-4" />
                          Public - Tout le monde
                        </div>
                      </SelectItem>
                      <SelectItem value="friends_only" className="text-xs sm:text-sm">
                        <div className="flex items-center gap-2">
                          <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                          Amis uniquement
                        </div>
                      </SelectItem>
                      <SelectItem value="private" className="text-xs sm:text-sm">
                        <div className="flex items-center gap-2">
                          <Lock className="h-3 w-3 sm:h-4 sm:w-4" />
                          Privé - Personne
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Eye className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-white">Afficher mon email</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Visible sur votre profil</p>
                    </div>
                  </div>
                  <Switch
                    checked={privacySettings.show_email}
                    onCheckedChange={(checked) => updatePrivacySettings({ ...privacySettings, show_email: checked })}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Activity className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-white">Afficher mon activité</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Dernière connexion, posts récents</p>
                    </div>
                  </div>
                  <Switch
                    checked={privacySettings.show_activity}
                    onCheckedChange={(checked) => updatePrivacySettings({ ...privacySettings, show_activity: checked })}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Interactions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Users className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-white">Autoriser les mentions</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Autres users peuvent vous taguer</p>
                    </div>
                  </div>
                  <Switch
                    checked={privacySettings.allow_tagging}
                    onCheckedChange={(checked) => updatePrivacySettings({ ...privacySettings, allow_tagging: checked })}
                  />
                </div>

                <div>
                  <Label className="text-xs sm:text-sm mb-2 block">Messages privés</Label>
                  <Select
                    value={privacySettings.allow_messaging}
                    onValueChange={(value) => updatePrivacySettings({ ...privacySettings, allow_messaging: value })}
                  >
                    <SelectTrigger className="bg-slate-800 border-slate-700 h-9 sm:h-10 text-xs sm:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="everyone" className="text-xs sm:text-sm">Tout le monde</SelectItem>
                      <SelectItem value="friends" className="text-xs sm:text-sm">Amis uniquement</SelectItem>
                      <SelectItem value="nobody" className="text-xs sm:text-sm">Personne</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Consentements */}
          <TabsContent value="consents" className="space-y-3 sm:space-y-4">
            {/* Cookies essentiels */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  🍪 Gestion des cookies
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Modifiez vos préférences de cookies
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Cookies essentiels (non modifiable) */}
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-white">Cookies essentiels</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Nécessaires au fonctionnement du site</p>
                    </div>
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                      Toujours actifs
                    </Badge>
                  </div>
                  <p className="text-[10px] sm:text-xs text-slate-500">
                    Session, authentification, préférences
                  </p>
                </div>

                {/* Cookies optionnels */}
                <div className="p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-white">Cookies analytics</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">Statistiques d'utilisation anonymes</p>
                    </div>
                    <Switch
                      checked={localStorage.getItem("cookie_consent") === "accepted"}
                      onCheckedChange={(checked) => {
                        localStorage.setItem("cookie_consent", checked ? "accepted" : "rejected");
                        toast.success(checked ? "Cookies analytics activés" : "Cookies analytics désactivés");
                      }}
                    />
                  </div>
                </div>

                {/* Info */}
                <div className="flex items-start gap-2 p-3 bg-blue-950/20 border border-blue-900/50 rounded-lg text-xs sm:text-sm text-slate-300">
                  <Info className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <p>
                    Nous n'utilisons <strong>aucun cookie publicitaire</strong> ni de tracking tiers. 
                    Consultez notre <a href="/api/legal/cookie-policy" target="_blank" className="text-cyan-400 hover:underline">politique des cookies</a>.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Vos consentements</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Vous pouvez retirer votre consentement à tout moment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries({
                  analytics: { label: "Analyse d'utilisation", desc: "Amélioration du service" },
                  marketing: { label: "Communications marketing", desc: "Newsletters et promotions" },
                  third_party: { label: "Partenaires tiers", desc: "Partage avec partenaires (aucun actuellement)" },
                  data_sharing: { label: "Partage de données", desc: "Données anonymisées pour recherche" }
                }).map(([key, { label, desc }]) => (
                  <div key={key} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-white">{label}</p>
                      <p className="text-[10px] sm:text-xs text-slate-400">{desc}</p>
                    </div>
                    <Switch
                      checked={consents[key]}
                      onCheckedChange={(checked) => updateConsent(key, checked)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Historique */}
            {consentHistory.length > 0 && (
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader>
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <History className="h-4 w-4 sm:h-5 sm:w-5" />
                    Historique des consentements
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {consentHistory.slice(0, 5).map((log, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-slate-800/30 rounded text-xs sm:text-sm">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {log.consent_given ? (
                            <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                          )}
                          <span className="text-white truncate">{log.consent_type}</span>
                        </div>
                        <span className="text-slate-400 text-[10px] sm:text-xs whitespace-nowrap ml-2">
                          {new Date(log.timestamp).toLocaleDateString('fr-FR')}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Mes données */}
          <TabsContent value="data" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Télécharger mes données</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Droit à la portabilité (Article 20 RGPD)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => setShowExportModal(true)}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 h-9 sm:h-10 text-xs sm:text-sm"
                >
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                  Exporter toutes mes données
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-red-950/20 border-red-900/50">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg text-red-500 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5" />
                  Supprimer mon compte
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm text-slate-400">
                  Droit à l'oubli (Article 17 RGPD)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 mb-3 text-xs sm:text-sm text-slate-300">
                  <p className="font-medium text-red-400 mb-1">⚠️ Action irréversible</p>
                  <p className="text-[10px] sm:text-xs">
                    Toutes vos données seront supprimées définitivement après 30 jours. Vous pouvez annuler pendant ce délai.
                  </p>
                </div>
                <Button
                  onClick={() => setShowDeleteModal(true)}
                  variant="destructive"
                  className="w-full h-9 sm:h-10 text-xs sm:text-sm"
                >
                  <Trash2 className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                  Demander la suppression de mon compte
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transparence */}
          <TabsContent value="transparency" className="space-y-3 sm:space-y-4">
            {dataUsageInfo && (
              <>
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-base sm:text-lg">Comment nous utilisons vos données</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {Object.entries(dataUsageInfo.data_collection).map(([key, value]) => (
                      <div key={key} className="p-2 sm:p-3 bg-slate-800/50 rounded-lg">
                        <p className="text-xs sm:text-sm font-medium text-cyan-500 capitalize mb-1">
                          {key.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[10px] sm:text-xs text-slate-300">{value}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-base sm:text-lg">Vos droits RGPD</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {dataUsageInfo.your_rights.map((right, index) => (
                        <div key={index} className="flex items-start gap-2 text-xs sm:text-sm">
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                          <span className="text-slate-300">{right}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-blue-950/20 border-blue-900/50">
                  <CardContent className="p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-blue-400 font-medium mb-2">
                      📧 Contact DPO (Délégué à la Protection des Données)
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-300">
                      Pour toute question sur vos données : <strong>dpo@nexussocial.com</strong>
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Modal Export */}
        <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
          <DialogContent className="bg-slate-900 border-slate-800 text-white w-[92vw] sm:w-[95vw] max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg">Exporter vos données</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Téléchargez une copie de toutes vos données au format JSON
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-xs sm:text-sm text-slate-300">
              <p>L'export contiendra :</p>
              <ul className="list-disc list-inside space-y-1 text-[10px] sm:text-xs">
                <li>Informations de profil</li>
                <li>Toutes vos publications</li>
                <li>Vos commentaires</li>
                <li>Vos likes</li>
                <li>Vos abonnements</li>
                <li>Vos statistiques</li>
              </ul>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setShowExportModal(false)}
                className="w-full h-9 sm:h-10 text-xs sm:text-sm"
              >
                Annuler
              </Button>
              <Button
                onClick={exportData}
                disabled={loading}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 h-9 sm:h-10 text-xs sm:text-sm"
              >
                {loading ? "Export..." : "Télécharger"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal Delete */}
        <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
          <DialogContent className="bg-slate-900 border-slate-800 text-white w-[92vw] sm:w-[95vw] max-w-md">
            <DialogHeader>
              <DialogTitle className="text-red-500 text-base sm:text-lg">Supprimer mon compte</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Cette action est irréversible après 30 jours
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 sm:space-y-4">
              <div>
                <Label className="text-xs sm:text-sm">Raison (optionnel)</Label>
                <Textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white mt-1.5 text-xs sm:text-sm"
                  placeholder="Pourquoi supprimez-vous votre compte ?"
                  rows={3}
                />
              </div>
              <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3">
                <p className="text-xs sm:text-sm text-slate-300 mb-2">
                  Tapez <strong className="text-red-500">SUPPRIMER</strong> pour confirmer
                </p>
                <Input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white h-9 sm:h-10 text-xs sm:text-sm"
                  placeholder="SUPPRIMER"
                />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteModal(false)}
                className="w-full h-9 sm:h-10 text-xs sm:text-sm"
              >
                Annuler
              </Button>
              <Button
                onClick={requestDeletion}
                disabled={loading || deleteConfirm !== "SUPPRIMER"}
                variant="destructive"
                className="w-full h-9 sm:h-10 text-xs sm:text-sm"
              >
                {loading ? "..." : "Confirmer la suppression"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
