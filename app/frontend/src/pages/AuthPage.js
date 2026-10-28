import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API } from "../App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useGeo } from "@/context/GeoContext";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function AuthPage({ setUser }) {
  const { t } = useTranslation();
  const geo = useGeo();
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
      toast.success(t("auth.login_success"));
    } catch (err) {
      toast.error(err.response?.data?.detail || t("auth.err_code_invalid"));
    } finally { setLoading(false); }
  };

  // Mot de passe oublié : étape 0 = envoi du code, étape 1 = nouveau mot de passe.
  const submitForgot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (forgot.step === 0) {
        await axios.post(`${API}/auth/password/forgot`, { email: forgot.email });
        toast.success(t("auth.forgot_sent"));
        setForgot((f) => ({ ...f, step: 1 }));
      } else {
        if ((forgot.pw || "").length < 6) { toast.error(t("auth.err_pw_min")); setLoading(false); return; }
        if (forgot.pw !== forgot.pw2) { toast.error(t("auth.err_pw_mismatch")); setLoading(false); return; }
        await axios.post(`${API}/auth/password/reset`, { email: forgot.email, code: (forgot.code || "").trim(), new_password: forgot.pw });
        toast.success(t("auth.pw_reset_done"));
        setForgot(null); setIsLogin(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || t("auth.err_reset"));
    } finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isLogin && formData.password !== formData.confirmPassword) {
      toast.error(t("auth.err_pw_mismatch"));
      return;
    }
    if (!isLogin && !termsAccepted) {
      toast.error(t("auth.err_terms"));
      return;
    }
    // Pays en mode consultation (RU/CN) : pas de création de compte (le backend
    // refuse de toute façon, mais on l'explique clairement avant l'envoi).
    if (!isLogin && geo.readOnly) {
      toast.error(geo.readOnlyMessage || t("auth.err_signup_blocked"));
      return;
    }
    // Contrôle d'âge : le seuil dépend du pays (COPPA 13 US, RGPD 15/16 UE…).
    // La vérification finale est faite côté serveur (source de vérité géo).
    if (!isLogin) {
      if (!formData.birthdate) {
        toast.error(t("auth.err_birthdate_required"));
        return;
      }
      const b = new Date(formData.birthdate);
      const now = new Date();
      let age = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
      if (Number.isNaN(age)) {
        toast.error(t("auth.err_birthdate_invalid"));
        return;
      }
      const minAge = geo.minAge || 13;  // plancher permissif : le serveur tranche
      if (age < minAge) {
        toast.error(t("auth.err_min_age", { n: minAge }));
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
            ref:
              (() => {
                try {
                  return (
                    new URLSearchParams(window.location.search).get("ref") ||
                    localStorage.getItem("nexus_ref") ||
                    undefined
                  );
                } catch {
                  return undefined;
                }
              })(),
          };

      const response = await axios.post(`${API}${endpoint}`, payload);
      // Parrainage consommé à l'inscription : on l'efface pour ne pas le réutiliser.
      if (!isLogin) {
        try { localStorage.removeItem("nexus_ref"); } catch { /* ignore */ }
      }

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
        toast.message(t("auth.twofa_sent_title"), { description: t("auth.twofa_sent_desc") });
        return;
      }

      await finishAuth(response.data);
      toast.success(isLogin ? t("auth.login_success") : t("auth.register_success"));
    } catch (error) {
      toast.error(error.response?.data?.detail || t("auth.err_generic"));
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
        {/* Sélecteur de langue — accessible dès l'arrivée sur la page. */}
        <div className="fixed top-3 right-3 z-50 rounded-full px-1.5 py-0.5"
          style={{ background: "rgba(11,19,38,0.7)", backdropFilter: "blur(8px)", colorScheme: "dark" }}>
          <LanguageSwitcher />
        </div>

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
              {t("auth.hero_title_1")}{" "}
              <span style={{ color: "rgba(218,226,253,0.5)" }}>
                {t("auth.hero_title_2")}
              </span>
            </h2>
            <p
              className="text-lg leading-relaxed font-light"
              style={{ color: "#bbc9cd" }}
            >
              {t("auth.hero_body")}
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
                {isLogin ? t("auth.title_login") : t("auth.title_register")}
              </h2>
              <p className="text-sm" style={{ color: "#bbc9cd" }}>
                {isLogin ? t("auth.subtitle_login") : t("auth.subtitle_register")}
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
                      {t("auth.name")}
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
                        placeholder={t("auth.name_placeholder")}
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
                    {t("auth.email")}
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
                      {t("auth.birthdate")}
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
                      {t("auth.age_hint", { n: geo.minAge || 15 })}
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
                      {t("auth.password")}
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
                        {t("auth.forgot_link")}
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
                        {t("auth.password")}
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
                        {t("auth.confirm")}
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
                    {t("auth.terms_accept")}{" "}
                    <a
                      className="hover:underline transition-all"
                      style={{ color: "#8aebff" }}
                      href={`${API}/legal/terms-of-service`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("auth.terms_link")}
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
                    {t("auth.private_account")}
                    <span className="block text-xs" style={{ color: "#859397" }}>
                      {t("auth.private_hint")}
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
                  t("auth.btn_login")
                ) : (
                  t("auth.btn_register")
                )}
              </button>
            </form>

            <footer className="text-center pt-2">
              <p className="text-sm" style={{ color: "#bbc9cd" }}>
                {isLogin ? t("auth.no_account") : t("auth.have_account")}{" "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-medium hover:underline ml-1 transition-all bg-transparent border-none cursor-pointer"
                  style={{ color: "#8aebff" }}
                >
                  {isLogin ? t("auth.cta_register") : t("auth.cta_login")}
                </button>
              </p>
              <nav className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1.5 text-[11px]">
                <Link to="/a-propos" className="hover:underline" style={{ color: "#859397" }}>{t("auth.nav_about")}</Link>
                <Link to="/comment-ca-marche" className="hover:underline" style={{ color: "#859397" }}>{t("auth.nav_how")}</Link>
                <Link to="/guides" className="hover:underline" style={{ color: "#859397" }}>{t("auth.nav_guides")}</Link>
                <Link to="/faq" className="hover:underline" style={{ color: "#859397" }}>{t("auth.nav_faq")}</Link>
                <a href={`${API}/legal/terms-of-service`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#859397" }}>{t("auth.nav_terms")}</a>
                <a href={`${API}/legal/privacy-policy`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#859397" }}>{t("auth.nav_privacy")}</a>
                <a href={`${API}/legal/cookie-policy`} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#859397" }}>{t("auth.nav_cookies")}</a>
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
              <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>{t("auth.twofa_title")}</h2>
              <p className="text-sm mt-1" style={{ color: "#859397" }}>{t("auth.twofa_sent_to")} <b style={{ color: "#dae2fd" }}>{twofa.email}</b>.</p>
            </div>
            <input autoFocus value={twofaCode} onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" maxLength={6} placeholder={t("auth.code_placeholder")}
              className="w-full mb-3 px-4 py-3 rounded-2xl outline-none text-center text-lg tracking-[0.4em] font-bold"
              style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
            <button type="submit" disabled={loading} className="w-full py-3 rounded-2xl font-black disabled:opacity-40" style={{ background: "#22d3ee", color: "#00363e" }}>
              {loading ? t("auth.verifying") : t("auth.btn_login")}
            </button>
            <button type="button" onClick={() => { setTwofa(null); setTwofaCode(""); }} className="w-full mt-2 py-2 text-xs" style={{ color: "#859397" }}>{t("auth.cancel")}</button>
          </form>
        </div>
      )}

      {/* Overlay Mot de passe oublié */}
      {forgot && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: "rgba(3,7,18,0.94)", backdropFilter: "blur(6px)" }}>
          <form onSubmit={submitForgot} className="w-full max-w-sm rounded-3xl p-6" style={{ background: "#0b1326", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="text-center mb-4">
              <span className="material-symbols-outlined text-4xl mb-1" style={{ color: "#22d3ee" }}>lock_reset</span>
              <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>{t("auth.forgot_title")}</h2>
              <p className="text-sm mt-1" style={{ color: "#859397" }}>
                {forgot.step === 0 ? t("auth.forgot_step0") : t("auth.forgot_step1", { email: forgot.email })}
              </p>
            </div>
            {forgot.step === 0 ? (
              <input autoFocus type="email" required value={forgot.email} onChange={(e) => setForgot((f) => ({ ...f, email: e.target.value }))}
                placeholder={t("auth.email_placeholder")} className="w-full mb-3 px-4 py-3 rounded-2xl outline-none text-sm"
                style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
            ) : (
              <>
                <input autoFocus value={forgot.code} onChange={(e) => setForgot((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  inputMode="numeric" maxLength={6} placeholder={t("auth.code_placeholder")}
                  className="w-full mb-2 px-4 py-3 rounded-2xl outline-none text-center tracking-[0.3em] font-bold"
                  style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
                <input type="password" value={forgot.pw} onChange={(e) => setForgot((f) => ({ ...f, pw: e.target.value }))}
                  placeholder={t("auth.new_pw_placeholder")} className="w-full mb-2 px-4 py-3 rounded-2xl outline-none text-sm"
                  style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
                <input type="password" value={forgot.pw2} onChange={(e) => setForgot((f) => ({ ...f, pw2: e.target.value }))}
                  placeholder={t("auth.confirm_pw_placeholder")} className="w-full mb-3 px-4 py-3 rounded-2xl outline-none text-sm"
                  style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" }} />
              </>
            )}
            <button type="submit" disabled={loading} className="w-full py-3 rounded-2xl font-black disabled:opacity-40" style={{ background: "#22d3ee", color: "#00363e" }}>
              {loading ? "…" : forgot.step === 0 ? t("auth.send_code") : t("auth.reset")}
            </button>
            <button type="button" onClick={() => setForgot(null)} className="w-full mt-2 py-2 text-xs" style={{ color: "#859397" }}>{t("auth.cancel")}</button>
          </form>
        </div>
      )}
    </>
  );
}
