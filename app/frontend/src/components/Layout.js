import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import CallManager from "@/components/CallManager";

export default function Layout({
  children,
  user,
  setUser,
  onCreatePost,
  compact,
  hideMobileChrome,
  hideMobileHeader,
  bottomNav,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [trending, setTrending] = useState([]);
  // Sidebar PC : repliée par défaut (pictogrammes seuls), se déploie au survol.
  const [sbExpanded, setSbExpanded] = useState(false);
  // En-tête mobile masqué au scroll vers le bas (page d'accueil), réaffiché au scroll vers le haut.
  const [headerHidden, setHeaderHidden] = useState(false);
  // Onglets de fil (Pour vous / Abonnements) déplacés dans le header mobile.
  const [feedTab, setFeedTab] = useState(
    () => localStorage.getItem("nexus_feedtab") || "foryou",
  );
  const selectFeed = (key) => {
    setFeedTab(key);
    localStorage.setItem("nexus_feedtab", key);
    window.dispatchEvent(new CustomEvent("nexus:feedtab", { detail: key }));
  };
  useEffect(() => {
    const onTab = (e) =>
      setFeedTab(
        e.detail || localStorage.getItem("nexus_feedtab") || "following",
      );
    window.addEventListener("nexus:feedtab", onTab);
    return () => window.removeEventListener("nexus:feedtab", onTab);
  }, []);

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
        if (
          !cancelled &&
          lang &&
          supported.includes(lang) &&
          lang !== i18n.resolvedLanguage
        ) {
          i18n.changeLanguage(lang);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
    let everConnected = false; // pour ne resynchroniser qu'aux RECONNEXIONS

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      attempts += 1;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)); // 2s → 30s
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
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
        // Reconnexion (pas la 1re connexion) → on demande aux pages de se
        // resynchroniser pour rattraper les messages/stories reçus pendant la
        // coupure (ex. mise en veille du backend Render).
        if (everConnected) {
          window.dispatchEvent(new CustomEvent("nexus:resync"));
        }
        everConnected = true;
        attempts = 0; // reconnexion réussie → on réinitialise le backoff
        heartbeat = setInterval(() => {
          try {
            ws.send("ping");
          } catch {
            /* socket fermé */
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!data || !data.type) return;
        // Les pages peuvent réagir (ex. chat live, appels) via cet événement
        window.dispatchEvent(
          new CustomEvent("nexus:realtime", { detail: data }),
        );
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
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* déclenchera onclose */
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      clearInterval(heartbeat);
      clearTimeout(reconnectTimer);
      try {
        if (ws) {
          ws.onclose = null;
          ws.close();
        }
      } catch {
        /* déjà fermé */
      }
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
    else navigate("/feed");
  };

  const isActive = (path) => {
    if (path === "/feed")
      return (
        location.pathname === "/feed" ||
        location.pathname === "/feed" ||
        location.pathname === "/"
      );
    return location.pathname.startsWith(path);
  };

  // ── Pastilles de notification (messages + notifications non lus) ────────────
  const [badges, setBadges] = useState({ messages: 0, notifications: 0 });
  const fetchBadges = useCallback(() => {
    if (!user?.id) return;
    axios
      .get(`${API}/badges`)
      .then((r) =>
        setBadges({
          messages: r.data?.messages || 0,
          notifications: r.data?.notifications || 0,
        }),
      )
      .catch(() => {});
  }, [user?.id]);

  // Recharge au montage et à chaque changement de page (met à jour après lecture).
  useEffect(() => {
    fetchBadges();
  }, [fetchBadges, location.pathname]);

  // Mise à jour live : messages/notifs entrants (WebSocket) + événement local
  // « nexus:badges » émis par les pages après avoir marqué comme lu.
  useEffect(() => {
    const onRealtime = (e) => {
      const type = e.detail?.type;
      if (type === "new_message" || type === "notification") fetchBadges();
    };
    const onBadges = () => fetchBadges();
    const onResync = () => fetchBadges();
    window.addEventListener("nexus:realtime", onRealtime);
    window.addEventListener("nexus:badges", onBadges);
    window.addEventListener("nexus:resync", onResync);
    // Filet de sécurité : si le temps réel décroche (veille backend), on
    // rafraîchit les pastilles toutes les 25 s tant que l'onglet est visible.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") fetchBadges();
    }, 25000);
    return () => {
      window.removeEventListener("nexus:realtime", onRealtime);
      window.removeEventListener("nexus:badges", onBadges);
      window.removeEventListener("nexus:resync", onResync);
      clearInterval(poll);
    };
  }, [fetchBadges]);

  // Barres de défilement : visibles sur Messages / Profil / Recherche, masquées
  // ailleurs (via la classe `hide-scroll` sur <body>).
  useEffect(() => {
    const showScroll = ["/messages", "/profil", "/search"].some((p) =>
      location.pathname.startsWith(p),
    );
    document.documentElement.classList.toggle("hide-scroll", !showScroll);
    return () => document.documentElement.classList.remove("hide-scroll");
  }, [location.pathname]);

  // Masque l'en-tête mobile quand on descend, le réaffiche quand on remonte
  // (uniquement sur la page d'accueil).
  useEffect(() => {
    if (location.pathname !== "/feed" && location.pathname !== "/") {
      setHeaderHidden(false);
      return;
    }
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY && y > 60)
        setHeaderHidden(true); // scroll ↓ → masque
      else if (y < lastY - 4) setHeaderHidden(false); // scroll ↑ → affiche
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

  const badgeFor = (path) =>
    path === "/messages"
      ? badges.messages
      : path === "/notifications"
        ? badges.notifications
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
    { icon: "home", label: t("home"), path: "/feed", testId: "nav-home" },
    {
      icon: "play_circle",
      label: t("nexus_clips"),
      path: "/nexus-clips",
      testId: "nav-clips",
    },
    {
      icon: "sensors",
      label: t("nav_live"),
      path: "/live",
      testId: "nav-live",
    },
    {
      icon: "explore",
      label: t("explore"),
      path: "/search",
      testId: "nav-search",
    },
    {
      icon: "notifications",
      label: t("notifications"),
      path: "/notifications",
      testId: "nav-notifications",
    },
    {
      icon: "mail",
      label: t("messages"),
      path: "/messages",
      testId: "nav-messages",
    },
    {
      icon: "account_circle",
      label: t("profile"),
      path: `/profil/${user.id}`,
      testId: "nav-profile",
    },
    {
      icon: "bookmark",
      label: t("saved.title"),
      path: "/enregistres",
      testId: "nav-saved",
    },
    {
      icon: "workspace_premium",
      label: t("premium.title"),
      path: "/premium",
      testId: "nav-premium",
    },
    {
      icon: "settings",
      label: t("settings.title"),
      path: "/settings",
      testId: "nav-settings",
    },
  ];

  return (
    <div
      style={{ backgroundColor: "#0b1326", color: "#dae2fd" }}
      className={`${hideMobileChrome ? "h-[100dvh] overflow-hidden lg:h-auto lg:overflow-visible lg:min-h-screen" : "min-h-screen"} font-body`}
    >
      {/* ===== Desktop Left Sidebar (repliée → pictos seuls ; survol → pictos+noms) ===== */}
      <aside
        onMouseEnter={() => setSbExpanded(true)}
        onMouseLeave={() => setSbExpanded(false)}
        className={`fixed left-0 top-0 h-screen z-40 hidden lg:flex flex-col py-8 gap-4 select-none overflow-hidden transition-[width] duration-200 ease-out ${sbExpanded ? "w-64 px-4 shadow-2xl" : "w-20 px-2"}`}
        style={{
          backgroundColor: "#0b1326",
          borderRight: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {/* Logo : « NEXUS » déployé, « N » replié */}
        <div
          className={`font-headline font-black tracking-tighter mb-4 bg-clip-text whitespace-nowrap ${sbExpanded ? "text-2xl px-4" : "text-2xl text-center"}`}
          style={{
            background: "linear-gradient(90deg,var(--nexus-accent),#3b82f6)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {sbExpanded ? "NEXUS" : "N"}
        </div>

        {/* Recherche : champ déployé, bouton picto replié */}
        {sbExpanded ? (
          <div className="px-2 mb-2">
            <div className="relative">
              <span
                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "#859397", fontSize: "18px" }}
              >
                search
              </span>
              <input
                className="w-full border-none rounded-xl py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40 placeholder:text-slate-500"
                style={{ backgroundColor: "#131b2e", color: "#dae2fd" }}
                placeholder={`${t("search")}...`}
                type="text"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target.value)
                    navigate(`/search?q=${e.target.value}`);
                }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => navigate("/search")}
            title={t("search")}
            className="mb-2 h-11 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: "#131b2e", color: "#859397" }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "20px" }}
            >
              search
            </span>
          </button>
        )}

        {/* Navigation */}
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                data-testid={item.testId}
                onClick={() => navigate(item.path)}
                title={item.label}
                className={`relative flex items-center py-3 rounded-xl transition-all duration-200 text-left ${sbExpanded ? "gap-4 px-4" : "justify-center px-0"}`}
                style={{
                  color: active ? "var(--nexus-accent)" : "#859397",
                  fontWeight: active ? "700" : "400",
                  background: active
                    ? "linear-gradient(to right, rgba(34,211,238,0.1), transparent)"
                    : "transparent",
                  borderLeft: active
                    ? "2px solid var(--nexus-accent)"
                    : "2px solid transparent",
                }}
              >
                <span
                  className="material-symbols-outlined flex-shrink-0"
                  style={{
                    fontVariationSettings: active
                      ? "'FILL' 1, 'wght' 400"
                      : "'FILL' 0, 'wght' 300",
                  }}
                >
                  {item.icon}
                </span>
                {sbExpanded && (
                  <span className="whitespace-nowrap">{item.label}</span>
                )}
                {badgeFor(item.path) > 0 &&
                  (sbExpanded ? (
                    <span className="ml-auto">
                      <CountBadge count={badgeFor(item.path)} />
                    </span>
                  ) : (
                    <span className="absolute top-1.5 right-2.5">
                      <CountBadge count={badgeFor(item.path)} />
                    </span>
                  ))}
              </button>
            );
          })}
        </nav>

        {/* Créer une publication — page d'accueil uniquement. */}
        {(location.pathname === "/feed" || location.pathname === "/") && (
          <div className={`mt-2 ${sbExpanded ? "px-2" : ""}`}>
            <button
              data-testid="create-post-button"
              onClick={handleCreatePost}
              title={t("create_post")}
              className={`font-headline font-bold rounded-xl transition-all active:scale-95 hover:opacity-90 text-sm flex items-center justify-center ${sbExpanded ? "w-full py-3.5" : "w-11 h-11 mx-auto"}`}
              style={{
                background:
                  "linear-gradient(90deg,var(--nexus-accent),#3b82f6)",
                color: "#00363e",
                boxShadow: "0 8px 20px rgba(34,211,238,0.2)",
              }}
            >
              {sbExpanded ? (
                t("create_post")
              ) : (
                <span className="material-symbols-outlined">add</span>
              )}
            </button>
          </div>
        )}

        {/* Profil / déconnexion */}
        <div className={`mt-auto ${sbExpanded ? "px-2" : ""}`}>
          <div
            className={`flex items-center ${sbExpanded ? "gap-3" : "justify-center"}`}
          >
            {user.profile_pic ? (
              <img
                src={user.profile_pic}
                alt="Profile"
                className="w-10 h-10 rounded-full object-cover cursor-pointer flex-shrink-0"
                onClick={() => navigate(`/profil/${user.id}`)}
              />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm cursor-pointer flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, var(--nexus-accent), #3b82f6)",
                  color: "#00363e",
                }}
                onClick={() => navigate(`/profil/${user.id}`)}
              >
                {user.username[0].toUpperCase()}
              </div>
            )}
            {sbExpanded && (
              <div className="flex flex-col flex-1 min-w-0">
                <span
                  className="text-xs font-semibold truncate"
                  style={{ color: "#dae2fd" }}
                >
                  @{user.username}
                </span>
                <button
                  data-testid="desktop-logout-button"
                  onClick={handleLogout}
                  className="text-[10px] text-left transition-colors hover:text-red-400"
                  style={{ color: "#859397" }}
                >
                  {t("logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ===== Desktop Right Sidebar (hidden when compact) ===== */}
      {!compact && (
        <aside
          className="fixed right-0 top-0 h-screen w-80 z-40 hidden lg:flex flex-col py-8 px-6 gap-8 overflow-y-auto"
          style={{
            backgroundColor: "#0b1326",
            borderLeft: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          {/* Trending */}
          <section>
            <h2
              className="font-headline font-bold text-lg mb-6 tracking-tight"
              style={{ color: "#dae2fd" }}
            >
              {t("trending")}
            </h2>
            <div className="space-y-6">
              {trending.length === 0 ? (
                <p className="text-xs" style={{ color: "#859397" }}>
                  {t("no_trends_yet")}
                </p>
              ) : (
                trending.map((t, i) => (
                  <button
                    key={t.normalized || t.tag}
                    onClick={() =>
                      navigate(`/search?q=${encodeURIComponent(t.tag)}`)
                    }
                    className="group cursor-pointer block w-full text-left"
                  >
                    <p
                      className="text-[10px] uppercase tracking-widest font-bold mb-1"
                      style={{ color: "#859397" }}
                    >
                      {i + 1} • Tendance
                    </p>
                    <h3
                      className="text-sm font-bold transition-colors group-hover:text-cyan-400"
                      style={{ color: "#dae2fd" }}
                    >
                      {t.tag}
                    </h3>
                    <p className="text-xs mt-1" style={{ color: "#859397" }}>
                      {formatCount(t.post_count)} posts
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* Suggested Users */}
          {suggestedUsers.length > 0 && (
            <section>
              <h2
                className="font-headline font-bold text-lg mb-6 tracking-tight"
                style={{ color: "#dae2fd" }}
              >
                {t("suggestions")}
              </h2>
              <div className="space-y-4">
                {suggestedUsers.map((u) => (
                  <div key={u.id} className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-3"
                      onClick={() => navigate(`/profil/${u.id}`)}
                    >
                      {u.profile_pic ? (
                        <img
                          src={u.profile_pic}
                          alt={u.username}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                          style={{
                            background:
                              "linear-gradient(135deg, var(--nexus-accent), #3b82f6)",
                            color: "#00363e",
                          }}
                        >
                          {u.username[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-col text-left">
                        <span
                          className="text-xs font-bold"
                          style={{ color: "#dae2fd" }}
                        >
                          {u.first_name || u.username}
                        </span>
                        <span
                          className="text-[10px]"
                          style={{ color: "#859397" }}
                        >
                          @{u.username}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={() => navigate(`/profil/${u.id}`)}
                      className="px-3 py-1 rounded-full text-[10px] font-bold transition-colors hover:bg-cyan-400/20 hover:text-cyan-400"
                      style={{ backgroundColor: "#222a3d", color: "#dae2fd" }}
                    >
                      {t("view")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="mt-auto pt-8">
            <div
              className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-medium"
              style={{ color: "#3c494c" }}
            >
              <a
                href={`${API}/legal/terms-of-service`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-400"
              >
                {t("terms")}
              </a>
              <a
                href={`${API}/legal/privacy-policy`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-400"
              >
                {t("privacy")}
              </a>
              <a
                href={`${API}/legal/cookie-policy`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-400"
              >
                {t("cookies")}
              </a>
              <span>© 2025 Nexus Social</span>
            </div>
          </footer>
        </aside>
      )}

      {/* ===== Mobile Header ===== */}
      {!hideMobileChrome && !hideMobileHeader && (
        <header
          className="lg:hidden fixed top-0 left-0 right-0 z-50 flex flex-col select-none transition-transform duration-300"
          style={{
            backgroundColor: "rgba(11,19,38,0.85)",
            backdropFilter: "blur(20px)",
            transform: headerHidden ? "translateY(-100%)" : "translateY(0)",
          }}
        >
          {/* Ligne 1 : « Nexus Social » centré, cloche de notifications à droite
            (comme avant). Pas de trait de séparation. */}
          <div className="relative h-14 flex items-center justify-center px-4">
            <div
              className="font-headline font-black text-lg tracking-tighter bg-clip-text"
              style={{
                background:
                  "linear-gradient(90deg,var(--nexus-accent),#3b82f6)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Nexus Social
            </div>
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2"
              style={{ color: "#859397" }}
              onClick={() => navigate("/notifications")}
              data-testid="nav-notifications-mobile"
            >
              <span className="relative material-symbols-outlined">
                notifications
                {badges.notifications > 0 && (
                  <span className="absolute -top-1.5 -right-1.5">
                    <CountBadge count={badges.notifications} />
                  </span>
                )}
              </span>
            </button>
          </div>

          {/* Ligne 2 : onglets de fil (accueil uniquement), fondus dans le header
            (aucun fond ni bordure ni forme). Actif = couleur accent + soulignement. */}
          {(location.pathname === "/feed" || location.pathname === "/") && (
            <div className="flex items-center justify-center gap-8 pb-2">
              {[
                { key: "foryou", label: t("for_you") },
                { key: "following", label: t("following") },
              ].map(({ key, label }) => {
                const active = feedTab === key;
                return (
                  <button
                    key={key}
                    data-testid={`header-feed-${key}`}
                    onClick={() => selectFeed(key)}
                    className="relative text-sm bg-transparent border-0 p-0 transition-colors"
                    style={{
                      color: active ? "var(--nexus-accent)" : "#859397",
                      fontWeight: active ? 800 : 500,
                    }}
                  >
                    {label}
                    {active && (
                      <span
                        className="absolute -bottom-1 left-0 right-0 h-[2px] rounded-full"
                        style={{ background: "var(--nexus-accent)" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </header>
      )}

      {/* ===== Main Content ===== */}
      {/* lg:ml-20 = largeur de la sidebar repliée (pas de chevauchement ; la
          sidebar déployée passe au-dessus au survol). */}
      <main
        className={`ml-0 lg:ml-20 ${compact ? "" : "lg:mr-80"} ${hideMobileChrome ? "min-h-[100dvh] lg:min-h-screen" : "min-h-screen"} ${hideMobileChrome ? "pt-0 pb-0" : hideMobileHeader ? "pt-0 pb-20" : location.pathname === "/feed" || location.pathname === "/" ? "pt-[5.5rem] pb-20" : "pt-14 pb-20"} lg:pt-0 lg:pb-0`}
      >
        {children}
      </main>

      {/* ===== Mobile Bottom Nav ===== */}
      {/* bottomNav force l'affichage même quand le reste du chrome mobile est masqué
          (ex. page Messages : footer visible sur la liste des conversations). */}
      {(!hideMobileChrome || bottomNav) && (
        <>
          <nav
            className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 px-4 select-none"
            style={{
              backgroundColor: "rgba(11,19,38,0.92)",
              backdropFilter: "blur(20px)",
              borderTop: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {/* Le bouton « + » n'est plus au centre : il flotte en bas à droite (FAB,
            page d'accueil uniquement). Recherche = pictogramme entre Messages et Profil. */}
            {[
              {
                icon: "home",
                path: "/feed",
                label: t("home"),
                testId: "nav-home",
              },
              {
                icon: "play_circle",
                path: "/nexus-clips",
                label: t("nexus_clips"),
                testId: "nav-clips",
              },
              {
                icon: "mail",
                path: "/messages",
                label: t("messages"),
                testId: "nav-messages",
              },
              {
                icon: "search",
                path: "/search",
                label: t("search"),
                testId: "nav-search-mobile",
              },
              {
                icon: "account_circle",
                path: `/profil/${user.id}`,
                label: t("profile"),
                testId: "nav-profile",
              },
            ].map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  data-testid={item.testId}
                  onClick={() => navigate(item.path)}
                  className="flex flex-col items-center gap-0.5"
                  style={{ color: active ? "var(--nexus-accent)" : "#859397" }}
                >
                  <span
                    className="relative material-symbols-outlined"
                    style={{
                      fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
                    }}
                  >
                    {item.icon}
                    {badgeFor(item.path) > 0 && (
                      <span className="absolute -top-2 -right-2.5">
                        <CountBadge count={badgeFor(item.path)} />
                      </span>
                    )}
                  </span>
                  <span className={`text-[9px] ${active ? "font-bold" : ""}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* FAB « + » flottant en bas à droite — PAGE D'ACCUEIL uniquement.
          (Sur Nexus Clips, l'ajout se fait via le bouton en haut à droite ;
          ailleurs, plus de bouton d'ajout de publication.) */}
          {(location.pathname === "/feed" || location.pathname === "/") && (
            <button
              data-testid="fab-create-post"
              onClick={handleCreatePost}
              className="lg:hidden fixed right-4 z-[55] w-14 h-14 rounded-full flex items-center justify-center transition-transform active:scale-95"
              style={{
                bottom: "calc(4.5rem + env(safe-area-inset-bottom))",
                background:
                  "linear-gradient(135deg,var(--nexus-accent),#3b82f6)",
                color: "#00363e",
                boxShadow: "0 6px 20px rgba(34,211,238,0.45)",
              }}
              aria-label={t("create_post")}
            >
              <span className="material-symbols-outlined text-3xl">add</span>
            </button>
          )}
        </>
      )}

      {/* Gestionnaire d'appels audio/vidéo (global, écoute les appels entrants) */}
      {user?.id && <CallManager user={user} />}
    </div>
  );
}
