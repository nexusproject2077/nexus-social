import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { User, Mail, Lock, UserCircle } from "lucide-react";

export default function AuthPage({ setUser }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    bio: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = isLogin ? "/auth/login" : "/auth/register";
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : formData;

      const response = await axios.post(`${API}${endpoint}`, payload);
      localStorage.setItem("token", response.data.token);
      setUser(response.data.user);
      toast.success(isLogin ? "Connexion réussie!" : "Inscription réussie!");
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Une erreur s'est produite"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold mb-3" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Social
            </span>
          </h1>
          <p className="text-slate-400 text-sm">Connectez-vous avec le monde</p>
        </div>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl p-8 shadow-2xl">
          <div className="flex gap-2 mb-6">
            <Button
              data-testid="login-tab-button"
              onClick={() => setIsLogin(true)}
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
              data-testid="register-tab-button"
              onClick={() => setIsLogin(false)}
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

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div>
                <Label htmlFor="username" className="text-slate-300 mb-2 block">
                  <User className="inline w-4 h-4 mr-2" />
                  Nom d'utilisateur
                </Label>
                <Input
                  id="username"
                  data-testid="register-username-input"
                  type="text"
                  required
                  value={formData.username}
                  onChange={(e) =>
                    setFormData({ ...formData, username: e.target.value })
                  }
                  className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
                  placeholder="@votrenom"
                />
              </div>
            )}

            <div>
              <Label htmlFor="email" className="text-slate-300 mb-2 block">
                <Mail className="inline w-4 h-4 mr-2" />
                Email
              </Label>
              <Input
                id="email"
                data-testid={isLogin ? "login-email-input" : "register-email-input"}
                type="email"
                required
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
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
                data-testid={isLogin ? "login-password-input" : "register-password-input"}
                type="password"
                required
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
                placeholder="••••••••"
              />
            </div>

            {!isLogin && (
              <div>
                <Label htmlFor="bio" className="text-slate-300 mb-2 block">
                  <UserCircle className="inline w-4 h-4 mr-2" />
                  Bio (optionnel)
                </Label>
                <Input
                  id="bio"
                  data-testid="register-bio-input"
                  type="text"
                  value={formData.bio}
                  onChange={(e) =>
                    setFormData({ ...formData, bio: e.target.value })
                  }
                  className="bg-slate-800/50 border-slate-700 text-white focus:border-cyan-500"
                  placeholder="Parlez-nous de vous..."
                />
              </div>
            )}

            <Button
              data-testid={isLogin ? "login-submit-button" : "register-submit-button"}
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold py-6 text-base"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                </div>
              ) : isLogin ? (
                "Se connecter"
              ) : (
                "S'inscrire"
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
