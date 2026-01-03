import { useState } from "react";
import axios from "axios";
import { API } from "../App";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { toast } from "sonner";
import { User, Mail, Lock, UserCircle, MapPin, Calendar, Phone, ChevronRight, ChevronLeft } from "lucide-react";

export default function AuthPage({ setUser }) {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState(1); // 1, 2, 3 pour l'inscription
  const [formData, setFormData] = useState({
    // Étape 1 - Compte
    email: "",
    password: "",
    username: "",
    
    // Étape 2 - Identité
    first_name: "",
    last_name: "",
    birthdate: "",
    gender: "",
    
    // Étape 3 - Profil
    bio: "",
    location: "",
    phone: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Si inscription et pas dernière étape, passer à la suite
    if (!isLogin && step < 3) {
      setStep(step + 1);
      return;
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? "/auth/login" : "/auth/register";
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : formData;

      const response = await axios.post(`${API}${endpoint}`, payload);
      const token = response.data.token;
      localStorage.setItem("token", token);

      // Récupère les infos utilisateur
      try {
        const userResponse = await axios.get(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        localStorage.setItem("user", JSON.stringify(userResponse.data));
        setUser(userResponse.data);
        toast.success(isLogin ? "Connexion réussie!" : "Inscription réussie!");
      } catch (userError) {
        console.error("Erreur profil:", userError);
        localStorage.setItem("user", JSON.stringify(response.data.user));
        setUser(response.data.user);
        toast.success(isLogin ? "Connexion réussie!" : "Inscription réussie!");
      }
    } catch (error) {
      console.error("Erreur auth:", error);
      toast.error(
        error.response?.data?.detail || "Une erreur s'est produite"
      );
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setStep(1);
  };

  const renderStepIndicator = () => {
    if (isLogin) return null;
    
    return (
      <div className="flex justify-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 flex-1 rounded-full transition ${
              s === step ? 'bg-cyan-500' : s < step ? 'bg-cyan-700' : 'bg-slate-700'
            }`}
          />
        ))}
      </div>
    );
  };

  const renderStep1 = () => (
    <>
      <div>
        <Label htmlFor="email" className="text-slate-300 mb-2 block">
          <Mail className="inline w-4 h-4 mr-2" />
          Email
        </Label>
        <Input
          id="email"
          type="email"
          required
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
          placeholder="email@exemple.com"
        />
      </div>

      <div>
        <Label htmlFor="password" className="text-slate-300 mb-2 block">
          <Lock className="inline w-4 h-4 mr-2" />
          Mot de passe
        </Label>
        <Input
          id="password"
          type="password"
          required
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
          placeholder="••••••••"
        />
      </div>

      {!isLogin && (
        <div>
          <Label htmlFor="username" className="text-slate-300 mb-2 block">
            <User className="inline w-4 h-4 mr-2" />
            Nom d'utilisateur
          </Label>
          <Input
            id="username"
            type="text"
            required
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
            placeholder="@votrenom"
          />
        </div>
      )}
    </>
  );

  const renderStep2 = () => (
    <>
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-white">Informations personnelles</h3>
        <p className="text-sm text-slate-400">Aidez-nous à mieux vous connaître</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="first_name" className="text-slate-300 mb-2 block">
            Prénom
          </Label>
          <Input
            id="first_name"
            type="text"
            required
            value={formData.first_name}
            onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
            className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
            placeholder="John"
          />
        </div>

        <div>
          <Label htmlFor="last_name" className="text-slate-300 mb-2 block">
            Nom
          </Label>
          <Input
            id="last_name"
            type="text"
            required
            value={formData.last_name}
            onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
            className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
            placeholder="Doe"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="birthdate" className="text-slate-300 mb-2 block">
          <Calendar className="inline w-4 h-4 mr-2" />
          Date de naissance
        </Label>
        <Input
          id="birthdate"
          type="date"
          required
          value={formData.birthdate}
          onChange={(e) => setFormData({ ...formData, birthdate: e.target.value })}
          className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
        />
      </div>

      <div>
        <Label htmlFor="gender" className="text-slate-300 mb-2 block">
          Genre (optionnel)
        </Label>
        <select
          id="gender"
          value={formData.gender}
          onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
          className="w-full bg-slate-800/50 border border-slate-700 text-white rounded-md px-3 py-2 focus:border-cyan-500 focus:outline-none"
        >
          <option value="">Sélectionnez</option>
          <option value="male">Homme</option>
          <option value="female">Femme</option>
          <option value="other">Autre</option>
          <option value="prefer_not_to_say">Préfère ne pas dire</option>
        </select>
      </div>
    </>
  );

  const renderStep3 = () => (
    <>
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-white">Personnalisez votre profil</h3>
        <p className="text-sm text-slate-400">Dernière étape !</p>
      </div>

      <div>
        <Label htmlFor="bio" className="text-slate-300 mb-2 block">
          <UserCircle className="inline w-4 h-4 mr-2" />
          Bio (optionnel)
        </Label>
        <Input
          id="bio"
          type="text"
          value={formData.bio}
          onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
          className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
          placeholder="Parlez-nous de vous..."
        />
      </div>

      <div>
        <Label htmlFor="location" className="text-slate-300 mb-2 block">
          <MapPin className="inline w-4 h-4 mr-2" />
          Localisation (optionnel)
        </Label>
        <Input
          id="location"
          type="text"
          value={formData.location}
          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
          placeholder="Paris, France"
        />
      </div>

      <div>
        <Label htmlFor="phone" className="text-slate-300 mb-2 block">
          <Phone className="inline w-4 h-4 mr-2" />
          Téléphone (optionnel)
        </Label>
        <Input
          id="phone"
          type="tel"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
          placeholder="+33 6 12 34 56 78"
        />
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold mb-3" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Nexus Social
            </span>
          </h1>
          <p className="text-slate-400 text-sm">Connectez-vous avec le monde</p>
        </div>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl p-8 shadow-2xl">
          <div className="flex gap-2 mb-6">
            <Button
              onClick={switchMode}
              variant={isLogin ? "default" : "ghost"}
              className={`flex-1 ${
                isLogin
                  ? "bg-cyan-500 hover:bg-cyan-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Connexion
            </Button>
            <Button
              onClick={switchMode}
              variant={!isLogin ? "default" : "ghost"}
              className={`flex-1 ${
                !isLogin
                  ? "bg-cyan-500 hover:bg-cyan-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Inscription
            </Button>
          </div>

          {renderStepIndicator()}

          <form onSubmit={handleSubmit} className="space-y-5">
            {isLogin && renderStep1()}
            {!isLogin && step === 1 && renderStep1()}
            {!isLogin && step === 2 && renderStep2()}
            {!isLogin && step === 3 && renderStep3()}

            <div className="flex gap-2">
              {!isLogin && step > 1 && (
                <Button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  variant="outline"
                  className="border-slate-700 text-white hover:bg-slate-800"
                >
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Retour
                </Button>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold py-6 text-base"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  </div>
                ) : isLogin ? (
                  "Se connecter"
                ) : step < 3 ? (
                  <>
                    Suivant
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </>
                ) : (
                  "S'inscrire"
                )}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
