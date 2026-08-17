import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API } from "../App";
import { toast } from "sonner";

export default function AuthPage({ setUser }) {
  const [isLogin, setIsLogin] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    username: "",
    first_name: "",
    last_name: "",
    birthdate: "",
    gender: "",
    bio: "",
    location: "",
    phone: "",
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  // Compte privé PAR DÉFAUT (contrôle & vie privée) — modifiable ensuite dans les réglages.
  const [privateAccount, setPrivateAccount] = useState(true);
  const [loading, setLoading] = useState(false);
  const [twofa, setTwofa] = useState(null);   // { email } quand un code de connexion est requis
  const [twofaCode, setTwofaCode] = useState("");
  const [forgot, setForgot] = useState(null); // { step, email, code, pw, pw2 } pour la réinitialisation

  const handleChange = (field) => (e) =>
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  // Stocke le token + le profil et connecte l'utilisateur.
  const finishAuth = async (data) => {
    const token = data.token;
    localStorage.setItem("token", token);
    try {
      const me = await axios.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      localStorage.setItem("user", JSON.stringify(me.data));
      setUser(me.data);
    } catch {
      localStorage.setItem("user", JSON.stringify(data.user));
      setUser(data.user);
    }
  };

  // 2e étape de connexion (2FA) : code reçu par email.
  const submit2fa = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await axios.post(`${API}/auth/login/2fa`, { email: twofa.email, code: twofaCode.trim() });
      await finishAuth(r.data);
      toast.success("Connexion réussie !");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Code invalide ou expiré.");
    } finally { setLoading(false); }
  };

  // Mot de passe oublié : étape 0 = envoi du code, étape 1 = nouveau mot de passe.
  const submitForgot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (forgot.step === 0) {
        await axios.post(`${API}/auth/password/forgot`, { email: forgot.email });
        toast.success("Si un compte existe, un code a été envoyé par email.");
        setForgot((f) => ({ ...f, step: 1 }));
      } else {
        if ((forgot.pw || "").length < 6) { toast.error("Mot de passe : 6 caractères minimum."); setLoading(false); return; }
        if (forgot.pw !== forgot.pw2) { toast.error("Les mots de passe ne correspondent pas."); setLoading(false); return; }
        await axios.post(`${API}/auth/password/reset`, { email: forgot.email, code: (forgot.code || "").trim(), new_password: forgot.pw });
        toast.success("Mot de passe réinitialisé. Connecte-toi.");
        setForgot(null); setIsLogin(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Échec de la réinitialisation.");
    } finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isLogin && formData.password !== formData.confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas.");
      return;
    }
    if (!isLogin && !termsAccepted) {
      toast.error("Veuillez accepter les conditions d'utilisation.");
      return;
    }
    // Contrôle d'âge (loi française : réseaux sociaux interdits avant 15 ans).
    if (!isLogin) {
      if (!formData.birthdate) {
        toast.error("Indique ta date de naissance.");
        return;
      }
      const b = new Date(formData.birthdate);
      const now = new Date();
      let age = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
      if (Number.isNaN(age)) {
        toast.error("Date de naissance invalide.");
        return;
      }
      if (age < 15) {
        toast.error("Inscription impossible : l'âge minimum est de 15 ans (loi française).");
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? "/auth/login" : "/auth/register";
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : {
            email: formData.email,
            password: formData.password,
            username: formData.name.toLowerCase().replace(/\s+/g, "_"),
            first_name: formData.name.split(" ")[0] || formData.name,
            last_name: formData.name.split(" ").slice(1).join(" ") || "",
            birthdate: formData.birthdate,
            gender: formData.gender,
            bio: formData.bio,
            location: formData.location,
            phone: formData.phone,
            is_private: privateAccount,
          };

      const response = await axios.post(`${API}${endpoint}`, payload);

      // Inscription → on force l'affichage du guide de bienvenue à l'arrivée sur
      // le fil (même si le drapeau « déjà vu » existe sur cet appareil).
      if (!isLogin) {
        try { localStorage.setItem("nexus_show_onboarding", "1"); } catch { /* ignore */ }
      }

      // Double authentification : le backend ne renvoie pas de token, il attend
      // un code de connexion envoyé par email.
      if (response.data?.twofa_required) {
        setTwofa({ email: response.data.email || formData.email });
        setTwofaCode("");
        toast.message("Code de connexion envoyé par email.", { description: "Vérifie ta boîte (et les spams)." });
        return;
      }

      await finishAuth(response.data);
      toast.success(isLogin ? "Connexion réussie!" : "Inscription réussie!");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Une erreur s'est produite");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full border-none rounded-xl py-2.5 pl-11 pr-4 text-ns-on-surface placeholder:text-ns-outline/50 focus:ring-1 focus:ring-ns-primary/40 transition-all font-body outline-none";

  return (
    <>
      {/* Fixed decorative background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div
          className="absolute top-0 right-0 rounded-full blur-[150px] mix-blend-screen translate-x-1/2 -translate-y-1/2"
          style={{
            width: "80vw",
            height: "819px",
            background: "rgba(138,235,255,0.02)",
          }}
        />
        <div
          className="absolute bottom-0 left-0 rounded-full blur-[120px] mix-blend-screen -translate-x-1/2 translate-y-1/2"
          style={{
            width: "60vw",
            height: "614px",
            background: "rgba(173,198,255,0.02)",
          }}
        />
      </div>

      <main
        className="min-h-[100dvh] lg:h-screen grid lg:grid-cols-2"
        style={{ backgroundColor: "#0b1326", color: "#dae2fd" }}
      >
        {/* Left Column: Branding */}
        <section
          className="hidden lg:flex flex-col justify-center p-16 relative overflow-hidden"
          style={{ backgroundColor: "#060e20" }}
        >
          <div
            className="absolute rounded-full blur-[120px]"
            style={{
              top: "-10%",
              right: "-10%",
              width: "500px",
              height: "500px",
              background: "rgba(138,235,255,0.05)",
            }}
          />
          <div
            className="absolute rounded-full blur-[80px]"
            style={{
              bottom: "-5%",
              left: "-5%",
              width: "300px",
              height: "300px",
              background: "rgba(173,198,255,0.05)",
            }}
          />

          <div className="absolute top-16 left-16 z-10">
            <h1 className="font-headline text-3xl font-bold tracking-tight text-kinetic-gradient">
              Nexus Social
            </h1>
          </div>

          <div className="relative z-10 max-w-lg">
            <h2 className="font-headline text-6xl font-bold leading-[1.1] mb-8">
              Ton réseau social,{" "}
              <span style={{ color: "rgba(218,226,253,0.5)" }}>
                à ta façon.
              </span>
            </h2>
            <p
              className="text-lg leading-relaxed font-light"
              style={{ color: "#bbc9cd" }}
            >
              Ta vie privée d'abord, tes créateurs mis en avant, et la liberté de
              t'exprimer. Poste, filme, discute et soutiens ta communauté, sans
              suivi caché ni bruit inutile.
            </p>
          </div>
        </section>

        {/* Right Column: Form */}
        <section
          className="flex items-center justify-center p-5 sm:p-8 lg:p-12 lg:h-screen lg:overflow-y-auto"
          style={{ backgroundColor: "#0b1326" }}
        >
          <div className="w-full max-w-md space-y-5 py-4">
            {/* Mobile logo */}
            <div className="lg:hidden">
              <h1 className="font-headline text-xl font-bold text-kinetic-gradient">
                Nexus Social
              </h1>
            </div>

            <header>
              <h2
                className="font-headline text-2xl sm:text-3xl font-bold tracking-tight mb-1"
                style={{ color: "#dae2fd" }}
              >
                {isLogin ? "Connexion" : "Inscription"}
              </h2>
              <p className="text-sm" style={{ color: "#bbc9cd" }}>
                {isLogin
                  ? "Bienvenue de retour sur Nexus Social."
                  : "Créez votre profil pour commencer l'aventure."}
              </p>
            </header>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-3">
                {/* Full Name (register only) */}
                {!isLogin && (
                  <div className="space-y-1">
                    <label
                      className="font-label text-xs uppercase tracking-widest ml-1"
                      style={{ color: "#bbc9cd" }}
                      htmlFor="name"
                    >
                      Nom complet
                    </label>
                    <div className="relative group">
                      <div
                        className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors"
                        style={{ color: "#859397" }}
                      >
                        <span className="material-symbols-outlined text-xl">
                          person
                        </span>
                      </div>
                      <input
                        id="name"
                        type="text"
                        required
                        value={formData.name}
                        onChange={handleChange("name")}
                        placeholder="Alexandre Martin"
                        className={inputClass}
                        style={{ backgroundColor: "#131b2e" }}
                      />
                    </div>
                  </div>
                )}

                {/* Email */}
                <div className="space-y-1">
                  <label
                    className="font-label text-xs uppercase tracking-widest ml-1"
                    style={{ color: "#bbc9cd" }}
                    htmlFor="email"
                  >
                    Email
                  </label>
                  <div className="relative group">
                    <div
                      className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors"
                      style={{ color: "#859397" }}
                    >
                      <span className="material-symbols-outlined text-xl">
                        mail
                      </span>
                    </div>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={handleChange("email")}
                      placeholder="alex@nexus.social"
                      className={inputClass}
                      style={{ backgroundColor: "#131b2e" }}
                    />
                  </div>
                </div>

                {/* Date de naissance (inscription) — contrôle d'âge >= 15 (loi FR) */}
                {!isLogin && (
                  <div className="space-y-1">
                    <label
                      className="font-label text-xs uppercase tracking-widest ml-1"
                      style={{ color: "#bbc9cd" }}
                      htmlFor="birthdate"
                    >
                      Date de naissance
                    </label>
                    <div className="relative group">
                      <div
                        className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"
                        style={{ color: "#859397" }}
                      >
                        <span className="material-symbols-outlined text-xl">calendar_month</span>
                      </div>
                      <input
                        id="birthdate"
                        type="date"
                        required
                        max={new Date().toISOString().slice(0, 10)}
                        value={formData.birthdate}
                        onChange={handleChange("birthdate")}
                        className={inputClass}
                        style={{ backgroundColor: "#131b2e", colorScheme: "dark" }}
                      />
                    </div>
                    <p className="text-[11px] ml-1" style={{ color: "#5b6b8c" }}>
                      Tu dois avoir au moins 15 ans pour t'inscrire (loi française).
                    </p>
                  </div>
                )}

                {isLogin ? (
                  /* Login: single password field */
                  <div className="space-y-1">
                    <label
                      className="font-label text-xs uppercase tracking-widest ml-1"
                      style={{ color: "#bbc9cd" }}
                      htmlFor="password"
                    >
                      Mot de passe
                    </label>
                    <div className="relative group">
                      <div
                        className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors"
                        style={{ color: "#859397" }}
                      >
                        <span className="material-symbols-outlined text-xl">
                          lock
                        </span>
                      </div>
                      <input
                        id="password"
                        type="password"
                        required
                        value={formData.password}
                        onChange={handleChange("password")}
                        placeholder="••••••••"
                        className={inputClass}
                        style={{ backgroundColor: "#131b2e" }}
                      />
                    </div>
                    <div className="text-right">
                      <button type="button"
                        onClick={() => setForgot({ step: 0, email: formData.email, code: "", pw: "", pw2: "" })}
                        className="text-xs hover:underline bg-transparent border-none cursor-pointer" style={{ color: "#8aebff" }}>
                        Mot de passe oublié ?
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Register: password + confirm side by side */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label
                        className="font-label text-xs uppercase tracking-widest ml-1"
                        style={{ color: "#bbc9cd" }}
                        htmlFor="password"
                      >
                        Mot de passe
                      </label>
                      <div className="relative group">
                        <div
                          className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors"
                          style={{ color: "#859397" }}
                        >
                          <span className="material-symbols-outlined text-xl">
                            lock
                          </span>
                        </div>
                        <input
                          id="password"
                          type="password"
                          required
                          value={formData.password}
                          onChange={handleChange("password")}
                          placeholder="••••••••"
                          className={inputClass}
                          style={{ backgroundColor: "#131b2e" }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label
                        className="font-label text-xs uppercase tracking-widest ml-1"
                        style={{ color: "#bbc9cd" }}
                        htmlFor="confirm-password"
                      >
                        Confirmer
                      </label>
                      <div className="relative group">
                        <div
                          className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors"
                          style={{ color: "#859397" }}
                        >
                          <span className="material-symbols-outlined text-xl">
                            shield
                          </span>
                        </div>
                        <input
                          id="confirm-password"
                          type="password"
                          required
                          value={formData.confirmPassword}
                          onChange={handleChange("confirmPassword")}
                          placeholder="••••••••"
                          className={inputClass}
                          style={{ backgroundColor: "#131b2e" }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Terms (register only) */}
              {!isLogin && (
                <div className="flex items-center gap-3">
                  <input
                    id="terms"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="w-5 h-5 rounded border-none focus:ring-0 cursor-pointer"
                    style={{ accentColor: "#8aebff" }}
                  />
                  <label
                    className="text-sm cursor-pointer"
                    style={{ color: "#bbc9cd" }}
                    htmlFor="terms"
                  >
                    J'accepte les{" "}
                    <a
                      className="hover:underline transition-all"
                      style={{ color: "#8aebff" }}
                      href={`${API}/legal/terms-of-service`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      conditions d'utilisation
                    </a>
                  </label>
                </div>
              )}

              {/* Compte privé par défaut (register only) — contrôle & vie privée */}
              {!isLogin && (
                <div className="flex items-start gap-3">
                  <input
                    id="private-account"
                    type="checkbox"
                    checked={privateAccount}
                    onChange={(e) => setPrivateAccount(e.target.checked)}
                    className="w-5 h-5 mt-0.5 rounded border-none focus:ring-0 cursor-pointer"
                    style={{ accentColor: "#8aebff" }}
                  />
                  <label className="text-sm cursor-pointer" style={{ color: "#bbc9cd" }} htmlFor="private-account">
                    Compte privé
                    <span className="block text-xs" style={{ color: "#859397" }}>
                      Seuls les abonnés que vous approuvez voient votre contenu. Modifiable à tout moment dans les réglages.
                    </span>
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-kinetic-gradient font-headline font-bold py-3 rounded-xl transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  color: "#00363e",
                  boxShadow: "0 10px 30px rgba(34,211,238,0.2)",
                }}
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current" />
                  </div>
                ) : isLogin ? (
                  "Se connecter"
                ) : (
                  "Créer un compte"
                )}
              </button>
            </form>

            <footer className="text-center pt-2">
              <p className="text-sm" style={{ color: "#bbc9cd" }}>
                {isLogin ? "Pas encore inscrit ?" : "Déjà inscrit ?"}{" "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-medium hover:underline ml-1 transition-all bg-transparent border-none cursor-pointer"
                  style={{ color: "#8aebff" }}
                >
                  {isLogin ? "Créez un compte" : "Connectez-vous ici"}
                </button>
              </p>
              <nav className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1.5 text-[11px]">
                <Link to="/a-propos" className="hover:underline" style={{ color: "#859397" }}>À propos</Link>
                <Link to="/comment-ca-marche" className="hover:underline" style={{ color: "#859397" }}>Comment ça marche</Link>
                <Link to="/guides" className="hover:underline" style={{ color: "#859397" }}>Guides</Link>
                <Link to="/faq" className="hover:underline" style={{ color: "#859397" }}>FAQ</Link>
                <a href={`${API}/legal/terms-of-service`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#859397" }}>Conditions</a>
                <a href={`${API}/legal/privacy-policy`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#859397" }}>Confidentialité</a>
                <a href={`${API}/legal/cookie-policy`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#859397" }}>Cookies</a>
              </nav>
            </footer>
          </div>
        </section>
      </main>

      {/* Overlay 2FA : code de connexion reçu par email */}
      {twofa && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: "rgba(3,7,18,0.94)", backdropFilter: "blur(6px)" }}>
          <form onSubmit={submit2fa} className="w-full max-w-sm rounded-3xl p-6" style={{ background: "#0b1326", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="text-center mb-4">
              <span className="material-symbols-outlined text-4xl mb-1" style={{ color: "#22d3ee" }}>encrypted</span>
              <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>Code de connexion</h2>
              <p className="text-sm mt-1" style={{ color: "#859397" }}>Un code a été envoyé à <b style={{ color: "#dae2fd" }}>{twofa.email}</b>.</p>
            </div>
            <input autoFocus value={twofaCode} onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres"
              className="w-full mb-3 px-4 py-3 rounded-2xl outline-none text-center text-lg tracking-[0.4em] font-bold"
              style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
            <button type="submit" disabled={loading} className="w-full py-3 rounded-2xl font-black disabled:opacity-40" style={{ background: "#22d3ee", color: "#00363e" }}>
              {loading ? "Vérification…" : "Se connecter"}
            </button>
            <button type="button" onClick={() => { setTwofa(null); setTwofaCode(""); }} className="w-full mt-2 py-2 text-xs" style={{ color: "#859397" }}>Annuler</button>
          </form>
        </div>
      )}

      {/* Overlay Mot de passe oublié */}
      {forgot && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: "rgba(3,7,18,0.94)", backdropFilter: "blur(6px)" }}>
          <form onSubmit={submitForgot} className="w-full max-w-sm rounded-3xl p-6" style={{ background: "#0b1326", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="text-center mb-4">
              <span className="material-symbols-outlined text-4xl mb-1" style={{ color: "#22d3ee" }}>lock_reset</span>
              <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>Mot de passe oublié</h2>
              <p className="text-sm mt-1" style={{ color: "#859397" }}>
                {forgot.step === 0 ? "Entre ton email : on t'envoie un code." : `Code envoyé à ${forgot.email}. Choisis un nouveau mot de passe.`}
              </p>
            </div>
            {forgot.step === 0 ? (
              <input autoFocus type="email" required value={forgot.email} onChange={(e) => setForgot((f) => ({ ...f, email: e.target.value }))}
                placeholder="ton@email.com" className="w-full mb-3 px-4 py-3 rounded-2xl outline-none text-sm"
                style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
            ) : (
              <>
                <input autoFocus value={forgot.code} onChange={(e) => setForgot((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres"
                  className="w-full mb-2 px-4 py-3 rounded-2xl outline-none text-center tracking-[0.3em] font-bold"
                  style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
                <input type="password" value={forgot.pw} onChange={(e) => setForgot((f) => ({ ...f, pw: e.target.value }))}
                  placeholder="Nouveau mot de passe" className="w-full mb-2 px-4 py-3 rounded-2xl outline-none text-sm"
                  style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
                <input type="password" value={forgot.pw2} onChange={(e) => setForgot((f) => ({ ...f, pw2: e.target.value }))}
                  placeholder="Confirme le mot de passe" className="w-full mb-3 px-4 py-3 rounded-2xl outline-none text-sm"
                  style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
              </>
            )}
            <button type="submit" disabled={loading} className="w-full py-3 rounded-2xl font-black disabled:opacity-40" style={{ background: "#22d3ee", color: "#00363e" }}>
              {loading ? "…" : forgot.step === 0 ? "Envoyer le code" : "Réinitialiser"}
            </button>
            <button type="button" onClick={() => setForgot(null)} className="w-full mt-2 py-2 text-xs" style={{ color: "#859397" }}>Annuler</button>
          </form>
        </div>
      )}
    </>
  );
}
