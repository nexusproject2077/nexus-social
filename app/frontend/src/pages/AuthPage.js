import { useState } from "react";
import axios from "axios";
import { API } from "../App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export default function AuthPage({ setUser }) {
  const { t } = useTranslation();
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
  const [loading, setLoading] = useState(false);

  const handleChange = (field) => (e) =>
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isLogin && formData.password !== formData.confirmPassword) {
      toast.error(t("passwords_mismatch"));
      return;
    }
    if (!isLogin && !termsAccepted) {
      toast.error(t("please_accept_terms"));
      return;
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
          };

      const response = await axios.post(`${API}${endpoint}`, payload);
      const token = response.data.token;
      localStorage.setItem("token", token);

      try {
        const userResponse = await axios.get(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        localStorage.setItem("user", JSON.stringify(userResponse.data));
        setUser(userResponse.data);
        toast.success(isLogin ? t("login_success") : t("register_success"));
      } catch {
        localStorage.setItem("user", JSON.stringify(response.data.user));
        setUser(response.data.user);
        toast.success(isLogin ? t("login_success") : t("register_success"));
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || t("error_occurred"));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full border-none rounded-xl py-4 pl-12 pr-4 text-ns-on-surface placeholder:text-ns-outline/50 focus:ring-1 focus:ring-ns-primary/40 transition-all font-body outline-none";

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
        className="min-h-screen grid lg:grid-cols-2"
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
            <span
              className="font-label uppercase text-xs mb-6 block tracking-[0.2em]"
              style={{ color: "#8aebff", letterSpacing: "0.2em" }}
            >
              The Kinetic Monolith
            </span>
            <h2 className="font-headline text-6xl font-bold leading-[1.1] mb-8">
              Rejoignez le{" "}
              <span style={{ color: "rgba(218,226,253,0.5)" }}>{
                t("future_of_interaction")
              }</span>{" "}
              digitale.
            </h2>
            <p
              className="text-lg leading-relaxed font-light"
              style={{ color: "#bbc9cd" }}
            >
              Une architecture conçue pour la rapidité, l'élégance et la
              clarté. Redéfinissez votre présence sociale.
            </p>
          </div>
        </section>

        {/* Right Column: Form */}
        <section
          className="flex items-center justify-center p-6 sm:p-12 lg:p-24"
          style={{ backgroundColor: "#0b1326" }}
        >
          <div className="w-full max-w-md space-y-10">
            {/* Mobile logo */}
            <div className="space-y-2 lg:hidden">
              <h1 className="font-headline text-2xl font-bold text-kinetic-gradient">
                Nexus Social
              </h1>
            </div>

            <header>
              <h2
                className="font-headline text-4xl font-bold tracking-tight mb-2"
                style={{ color: "#dae2fd" }}
              >
                {isLogin ? t("login_title") : t("register_title")}
              </h2>
              <p style={{ color: "#bbc9cd" }}>
                {isLogin
                  ? t("welcome_back")
                  : t("create_profile_start")}
              </p>
            </header>

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-5">
                {/* Full Name (register only) */}
                {!isLogin && (
                  <div className="space-y-2">
                    <label
                      className="font-label text-xs uppercase tracking-widest ml-1"
                      style={{ color: "#bbc9cd" }}
                      htmlFor="name"
                    >{
                      t("full_name")
                    }</label>
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
                <div className="space-y-2">
                  <label
                    className="font-label text-xs uppercase tracking-widest ml-1"
                    style={{ color: "#bbc9cd" }}
                    htmlFor="email"
                  >{
                    t("email")
                  }</label>
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

                {isLogin ? (
                  /* Login: single password field */
                  <div className="space-y-2">
                    <label
                      className="font-label text-xs uppercase tracking-widest ml-1"
                      style={{ color: "#bbc9cd" }}
                      htmlFor="password"
                    >{
                      t("password")
                    }</label>
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
                ) : (
                  /* Register: password + confirm side by side */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label
                        className="font-label text-xs uppercase tracking-widest ml-1"
                        style={{ color: "#bbc9cd" }}
                        htmlFor="password"
                      >{
                        t("password")
                      }</label>
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

                    <div className="space-y-2">
                      <label
                        className="font-label text-xs uppercase tracking-widest ml-1"
                        style={{ color: "#bbc9cd" }}
                        htmlFor="confirm-password"
                      >{
                        t("confirm")
                      }</label>
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
                <div className="flex items-center gap-3 py-2">
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
                    >{
                      t("terms_of_use")
                    }</a>
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-kinetic-gradient font-headline font-bold py-4 rounded-xl transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
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
                  t("login")
                ) : (
                  t("create_account")
                )}
              </button>
            </form>

            <footer className="text-center pt-8">
              <p className="text-sm" style={{ color: "#bbc9cd" }}>
                {isLogin ? t("not_registered_yet") : t("already_registered")}{" "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-medium hover:underline ml-1 transition-all bg-transparent border-none cursor-pointer"
                  style={{ color: "#8aebff" }}
                >
                  {isLogin ? t("create_an_account") : t("login_here")}
                </button>
              </p>
            </footer>
          </div>
        </section>
      </main>
    </>
  );
}
