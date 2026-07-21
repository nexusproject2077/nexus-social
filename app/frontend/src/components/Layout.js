import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import CallManager from "@/components/CallManager";

export default function Layout({ children, user, setUser, onCreatePost, compact, hideMobileChrome, bottomNav }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [trending, setTrending] = useState([]);

  // Détection automatique de la langue via le pays (adresse IP).
  // On n'écrase jamais un choix explicite de l'utilisateur.
  useEffect(() => {
    if (localStorage.getItem("nexus_lang_explicit")) return;
    let cancelled = false;
    axios
      .get(`${API}/geo/language`)
      .then((res) => {
        const lang = res.data?.language;
        const supported = res.data?.supported || [];
        if (!cancelled && lang && supported.includes(lang) && lang !== i18n.resolvedLanguage) {
          i18n.changeLanguage(lang);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [i18n]);

  useEffect(() => {
    if (compact) return;
    axios
      .get(`${API}/users/search?q=`)
      .then((res) => {
        const users = Array.isArray(res.data) ? res.data : [];
        setSuggestedUsers(users.filter((u) => u.id !== user.id).slice(0, 3));
      })
      .catch(() => {});

    axios
      .get(`${API}/trending/hashtags?limit=5`)
      .then((res) => {
        setTrending(Array.isArray(res.data?.trending) ? res.data.trending : []);
      })
      .catch(() => setTrending([]));
  }, [user.id, compact]);

  // Connexion WebSocket temps réel (notifications + messages en direct + appels).
  // Reconnexion automatique avec backoff : sans elle, la moindre coupure (mise en
  // veille du service Render, blip réseau, redémarrage backend) tuait le temps réel
  // jusqu'au rechargement de la page — d'où les « WebSocket connection failed ».
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token || !user?.id) return;

    // Dérive l'URL WS de l'API : https://host/api -> wss://host
    const wsBase = API.replace(/^http/, "ws").replace(/\/api\/?$/, "");
    let ws = null;
    let heartbeat = null;
    let reconnectTimer = null;
    let attempts = 0;
    let stopped = false; // vrai quand l'effet est démonté

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      attempts += 1;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)); // 2s → 30s
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
    };

    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`${wsBase}/ws/${user.id}?token=${token}`);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        attempts = 0; // reconnexion réussie → on réinitialise le backoff
        heartbeat = setInterval(() => {
          try { ws.send("ping"); } catch { /* socket fermé */ }
        }, 25000);
      };

      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (!data || !data.type) return;
        // Les pages peuvent réagir (ex. chat live, appels) via cet événement
        window.dispatchEvent(new CustomEvent("nexus:realtime", { detail: data }));
        const label =
          data.data?.message ||
          (data.type === "new_message"
            ? `Nouveau message de @${data.data?.sender_username || ""}`
            : null);
        if (label) toast(label);
      };

      ws.onclose = () => {
        clearInterval(heartbeat);
        scheduleReconnect();
      };
      ws.onerror = () => { try { ws.close(); } catch { /* déclenchera onclose */ } };
    };

    connect();

    return () => {
      stopped = true;
      clearInterval(heartbeat);
      clearTimeout(reconnectTimer);
      try { if (ws) { ws.onclose = null; ws.close(); } } catch { /* déjà fermé */ }
    };
  }, [user?.id]);

  const formatCount = (n) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return `${n}`;
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    if (setUser) setUser(null);
    navigate("/auth");
  };

  const handleCreatePost = () => {
    if (onCreatePost) onCreatePost();
    else navigate("/");
  };

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  // ── Pastilles de notification (messages + notifications non lus) ────────────
  const [badges, setBadges] = useState({ messages: 0, notifications: 0 });
  const fetchBadges = useCallback(() => {
    if (!user?.id) return;
    axios.get(`${API}/badges`)
      .then((r) => setBadges({ messages: r.data?.messages || 0, notifications: r.data?.notifications || 0 }))
      .catch(() => {});
  }, [user?.id]);

  // Recharge au montage et à chaque changement de page (met à jour après lecture).
  useEffect(() => { fetchBadges(); }, [fetchBadges, location.pathname]);

  // Mise à jour live : messages/notifs entrants (WebSocket) + événement local
  // « nexus:badges » émis par les pages après avoir marqué comme lu.
  useEffect(() => {
    const onRealtime = (e) => {
      const type = e.detail?.type;
      if (type === "new_message" || type === "notification") fetchBadges();
    };
    const onBadges = () => fetchBadges();
    window.addEventListener("nexus:realtime", onRealtime);
    window.addEventListener("nexus:badges", onBadges);
    return () => {
      window.removeEventListener("nexus:realtime", onRealtime);
      window.removeEventListener("nexus:badges", onBadges);
    };
  }, [fetchBadges]);

  const badgeFor = (path) =>
    path === "/messages" ? badges.messages
    : path === "/notifications" ? badges.notifications
    : 0;

  // Pastille rouge avec compteur (max 99+).
  const CountBadge = ({ count, className = "" }) =>
    count > 0 ? (
      <span
        className={`min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-black ${className}`}
        style={{ background: "#ef4444", color: "#fff" }}
      >
        {count > 99 ? "99+" : count}
      </span>
    ) : null;

  const navItems = [
    { icon: "home",           label: t("home"),          path: "/",                     testId: "nav-home" },
    { icon: "play_circle",    label: "Nexus Clips",      path: "/clips",                testId: "nav-clips" },
    { icon: "sensors",        label: t("nav_live"),      path: "/live",                 testId: "nav-live" },
    { icon: "explore",        label: t("explore"),       path: "/search",               testId: "nav-search" },
    { icon: "notifications",  label: t("notifications"), path: "/notifications",        testId: "nav-notifications" },
    { icon: "mail",           label: t("messages"),      path: "/messages",             testId: "nav-messages" },
    { icon: "account_circle", label: t("profile"),       path: `/profile/${user.id}`,   testId: "nav-profile" },
    { icon: "settings",       label: t("settings.title"),      path: "/settings",             testId: "nav-settings" },
  ];

  return (
    <div style={{ backgroundColor: "#0b1326", color: "#dae2fd" }}
      className={`${hideMobileChrome ? "h-[100dvh] overflow-hidden lg:h-auto lg:overflow-visible lg:min-h-screen" : "min-h-screen"} font-body`}>

      {/* ===== Desktop Left Sidebar ===== */}
      <aside
        className="fixed left-0 top-0 h-screen w-64 z-40 hidden lg:flex flex-col py-8 px-4 gap-4 select-none"
        style={{ backgroundColor: "#0b1326", borderRight: "1px solid rgba(255,255,255,0.04)" }}
      >
        {/* Logo */}
        <div
          className="font-headline text-2xl font-black tracking-tighter mb-4 px-4 bg-clip-text"
          style={{ background: "linear-gradient(90deg,var(--nexus-accent),#3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          NEXUS
        </div>

        {/* Search */}
        <div className="px-2 mb-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#859397", fontSize: "18px" }}>
              search
            </span>
            <input
              className="w-full border-none rounded-xl py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40 placeholder:text-slate-500"
              style={{ backgroundColor: "#131b2e", color: "#dae2fd" }}
              placeholder={`${t("search")}...`}
              type="text"
              onKeyDown={(e) => { if (e.key === "Enter" && e.target.value) navigate(`/search?q=${e.target.value}`); }}
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                data-testid={item.testId}
                onClick={() => navigate(item.path)}
                className="flex items-center gap-4 py-3 px-4 rounded-xl transition-all duration-200 text-left"
                style={{
                  color: active ? "var(--nexus-accent)" : "#859397",
                  fontWeight: active ? "700" : "400",
                  background: active ? "linear-gradient(to right, rgba(34,211,238,0.1), transparent)" : "transparent",
                  borderLeft: active ? "2px solid var(--nexus-accent)" : "2px solid transparent",
                }}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: active ? "'FILL' 1, 'wght' 400" : "'FILL' 0, 'wght' 300" }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {badgeFor(item.path) > 0 && <span className="ml-auto"><CountBadge count={badgeFor(item.path)} /></span>}
              </button>
            );
          })}
        </nav>

        {/* Create Post */}
        <div className="px-2 mt-2">
          <button
            data-testid="create-post-button"
            onClick={handleCreatePost}
            className="w-full py-3.5 font-headline font-bold rounded-xl transition-all active:scale-95 hover:opacity-90 text-sm"
            style={{ background: "linear-gradient(90deg,var(--nexus-accent),#3b82f6)", color: "#00363e", boxShadow: "0 8px 20px rgba(34,211,238,0.2)" }}
          >
            {t("create_post")}
          </button>
        </div>

        {/* User info */}
        <div className="mt-auto px-2">
          <div className="flex items-center gap-3">
            {user.profile_pic ? (
              <img src={user.profile_pic} alt="Profile" className="w-10 h-10 rounded-full object-cover cursor-pointer" onClick={() => navigate(`/profile/${user.id}`)} />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer flex-shrink-0"
                style={{ background: "linear-gradient(135deg, var(--nexus-accent), #3b82f6)", color: "#00363e" }}
                onClick={() => navigate(`/profile/${user.id}`)}
              >
                {user.username[0].toUpperCase()}
              </div>
            )}
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-xs font-semibold truncate" style={{ color: "#dae2fd" }}>@{user.username}</span>
              <button data-testid="desktop-logout-button" onClick={handleLogout} className="text-[10px] text-left transition-colors hover:text-red-400" style={{ color: "#859397" }}>
                {t("logout")}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Desktop Right Sidebar (hidden when compact) ===== */}
      {!compact && (
        <aside
          className="fixed right-0 top-0 h-screen w-80 z-40 hidden lg:flex flex-col py-8 px-6 gap-8 overflow-y-auto"
          style={{ backgroundColor: "#0b1326", borderLeft: "1px solid rgba(255,255,255,0.04)" }}
        >
          {/* Trending */}
          <section>
            <h2 className="font-headline font-bold text-lg mb-6 tracking-tight" style={{ color: "#dae2fd" }}>{t("trending")}</h2>
            <div className="space-y-6">
              {trending.length === 0 ? (
                <p className="text-xs" style={{ color: "#859397" }}>
                  Aucune tendance pour l'instant. Publiez avec des #hashtags pour lancer les tendances !
                </p>
              ) : (
                trending.map((t, i) => (
                  <button
                    key={t.normalized || t.tag}
                    onClick={() => navigate(`/search?q=${encodeURIComponent(t.tag)}`)}
                    className="group cursor-pointer block w-full text-left"
                  >
                    <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: "#859397" }}>
                      {i + 1} • Tendance
                    </p>
                    <h3 className="text-sm font-bold transition-colors group-hover:text-cyan-400" style={{ color: "#dae2fd" }}>{t.tag}</h3>
                    <p className="text-xs mt-1" style={{ color: "#859397" }}>{formatCount(t.post_count)} posts</p>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* Suggested Users */}
          {suggestedUsers.length > 0 && (
            <section>
              <h2 className="font-headline font-bold text-lg mb-6 tracking-tight" style={{ color: "#dae2fd" }}>{t("suggestions")}</h2>
              <div className="space-y-4">
                {suggestedUsers.map((u) => (
                  <div key={u.id} className="flex items-center justify-between">
                    <button className="flex items-center gap-3" onClick={() => navigate(`/profile/${u.id}`)}>
                      {u.profile_pic ? (
                        <img src={u.profile_pic} alt={u.username} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0" style={{ background: "linear-gradient(135deg, var(--nexus-accent), #3b82f6)", color: "#00363e" }}>
                          {u.username[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-col text-left">
                        <span className="text-xs font-bold" style={{ color: "#dae2fd" }}>{u.first_name || u.username}</span>
                        <span className="text-[10px]" style={{ color: "#859397" }}>@{u.username}</span>
                      </div>
                    </button>
                    <button onClick={() => navigate(`/profile/${u.id}`)} className="px-3 py-1 rounded-full text-[10px] font-bold transition-colors hover:bg-cyan-400/20 hover:text-cyan-400" style={{ backgroundColor: "#222a3d", color: "#dae2fd" }}>
                      Voir
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="mt-auto pt-8">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-medium" style={{ color: "#3c494c" }}>
              <a href={`${API}/legal/terms-of-service`} target="_blank" rel="noopener noreferrer" className="hover:text-slate-400">Conditions</a>
              <a href={`${API}/legal/privacy-policy`} target="_blank" rel="noopener noreferrer" className="hover:text-slate-400">Confidentialité</a>
              <a href={`${API}/legal/cookie-policy`} target="_blank" rel="noopener noreferrer" className="hover:text-slate-400">Cookies</a>
              <span>© 2025 Nexus Social</span>
            </div>
          </footer>
        </aside>
      )}

      {/* ===== Mobile Header ===== */}
      {!hideMobileChrome && (
      <header
        className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 select-none"
        style={{ backgroundColor: "rgba(11,19,38,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div
          className="font-headline font-black text-xl tracking-tighter bg-clip-text"
          style={{ background: "linear-gradient(90deg,var(--nexus-accent),#3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          NEXUS
        </div>
        <div className="flex-1 px-4 max-w-xs mx-auto">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#859397", fontSize: "18px" }}>search</span>
            <input
              className="w-full border-none rounded-full py-1.5 pl-8 pr-4 text-xs outline-none placeholder:text-slate-500"
              style={{ backgroundColor: "#131b2e", color: "#dae2fd" }}
              placeholder={`${t("search")}...`}
              type="text"
              onKeyDown={(e) => { if (e.key === "Enter" && e.target.value) navigate(`/search?q=${e.target.value}`); }}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="relative" style={{ color: "#859397" }} onClick={() => navigate("/notifications")} data-testid="nav-notifications-mobile">
            <span className="material-symbols-outlined">notifications</span>
            {badges.notifications > 0 && (
              <span className="absolute -top-1.5 -right-1.5"><CountBadge count={badges.notifications} /></span>
            )}
          </button>
          <button style={{ color: "#859397" }} onClick={() => navigate("/settings")} data-testid="nav-settings-mobile" title={t("settings.title")}>
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>
      )}

      {/* ===== Main Content ===== */}
      <main className={`ml-0 lg:ml-64 ${compact ? "" : "lg:mr-80"} ${hideMobileChrome ? "min-h-[100dvh] lg:min-h-screen" : "min-h-screen"} ${hideMobileChrome ? "pt-0 pb-0" : "pt-14 pb-20"} lg:pt-0 lg:pb-0`}>
        {children}
      </main>

      {/* ===== Mobile Bottom Nav ===== */}
      {/* bottomNav force l'affichage même quand le reste du chrome mobile est masqué
          (ex. page Messages : footer visible sur la liste des conversations). */}
      {(!hideMobileChrome || bottomNav) && (
      <nav
        className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 px-4 select-none"
        style={{ backgroundColor: "rgba(11,19,38,0.92)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        {/* Home */}
        {[
          { icon: "home",        path: "/",        label: t("home"),      testId: "nav-home" },
          { icon: "play_circle", path: "/clips",   label: "Nexus Clips",  testId: "nav-clips" },
        ].map((item) => {
          const active = isActive(item.path);
          return (
            <button key={item.path} data-testid={item.testId} onClick={() => navigate(item.path)} className="flex flex-col items-center gap-0.5" style={{ color: active ? "var(--nexus-accent)" : "#859397" }}>
              <span className="relative material-symbols-outlined" style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>
                {item.icon}
                {badgeFor(item.path) > 0 && (
                  <span className="absolute -top-2 -right-2.5"><CountBadge count={badgeFor(item.path)} /></span>
                )}
              </span>
              <span className={`text-[9px] ${active ? "font-bold" : ""}`}>{item.label}</span>
            </button>
          );
        })}

        {/* FAB Create Post */}
        <button
          onClick={handleCreatePost}
          className="w-11 h-11 rounded-full flex items-center justify-center -mt-8 transition-transform active:scale-95"
          style={{ background: "linear-gradient(135deg,var(--nexus-accent),#3b82f6)", color: "#00363e", boxShadow: "0 4px 16px rgba(34,211,238,0.4)" }}
        >
          <span className="material-symbols-outlined">add</span>
        </button>

        {/* Messages + Profile */}
        {[
          { icon: "mail",           path: "/messages",           label: t("messages"), testId: "nav-messages" },
          { icon: "account_circle", path: `/profile/${user.id}`, label: t("profile"),  testId: "nav-profile" },
        ].map((item) => {
          const active = isActive(item.path);
          return (
            <button key={item.path} data-testid={item.testId} onClick={() => navigate(item.path)} className="flex flex-col items-center gap-0.5" style={{ color: active ? "var(--nexus-accent)" : "#859397" }}>
              <span className="relative material-symbols-outlined" style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>
                {item.icon}
                {badgeFor(item.path) > 0 && (
                  <span className="absolute -top-2 -right-2.5"><CountBadge count={badgeFor(item.path)} /></span>
                )}
              </span>
              <span className={`text-[9px] ${active ? "font-bold" : ""}`}>{item.label}</span>
            </button>
          );
        })}
      </nav>
      )}

      {/* Gestionnaire d'appels audio/vidéo (global, écoute les appels entrants) */}
      {user?.id && <CallManager user={user} />}
    </div>
  );
}
