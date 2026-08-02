import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import EditProfileModal from "@/components/EditProfileModal";
import FollowListModal from "@/components/FollowListModal";
import PullToRefresh from "@/components/PullToRefresh";
import { Lock, Clock, UserPlus, UserMinus, Edit, Share2 } from "lucide-react";
import { toast } from "sonner";

// ── Design tokens (from Tailwind config) ──────────────────────────────────────
const C = {
  surface:          "#0b1326",
  surfaceLow:       "#131b2e",
  surfaceContainer: "#171f33",
  surfaceHigh:      "#222a3d",
  surfaceHighest:   "#2d3449",
  surfaceBright:    "#31394d",
  primary:          "#8aebff",
  primaryContainer: "var(--nexus-accent)",
  onPrimary:        "#00363e",
  outline:          "#859397",
  outlineVariant:   "#3c494c",
  onSurface:        "#dae2fd",
};

const glass = {
  background: "rgba(19, 27, 46, 0.72)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
};

export default function ProfilePage({ user, setUser }) {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile]         = useState(null);
  const [posts, setPosts]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [followStatus, setFollowStatus] = useState("not_following");
  const [stats, setStats]             = useState({ followers: 0, following: 0, posts: 0 });
  const [activeTab, setActiveTab]     = useState("media");
  const [reposts, setReposts]         = useState([]);
  const [mentions, setMentions]       = useState([]);
  const [followModal, setFollowModal] = useState(null); // { kind: "followers"|"following" }
  const [showTip, setShowTip] = useState(false); // sélecteur de montant de pourboire

  const isOwnProfile = user && userId && user.id === userId;

  // Retour de Stripe après un pourboire (?tip=success|cancel).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("tip");
    if (p === "success") toast.success("Merci pour votre pourboire 💸");
    else if (p === "cancel") toast("Pourboire annulé");
    if (p) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const sendTip = async (euros) => {
    try {
      const res = await axios.post(`${API}/users/${userId}/tip-checkout`, { amount_cents: Math.round(euros * 100) });
      if (res.data?.url) window.location.href = res.data.url;
    } catch (e) {
      toast.error(e.response?.data?.detail || "Pourboire momentanément indisponible");
    } finally {
      setShowTip(false);
    }
  };

  useEffect(() => {
    if (userId) {
      fetchProfile();
      fetchUserPosts();
      if (!isOwnProfile) fetchFollowStatus();
    }
  }, [userId]);

  // Tirer vers le bas pour rafraîchir (profil + publications).
  const refreshProfile = async () => {
    await Promise.all([
      fetchProfile(),
      fetchUserPosts(),
      ...(isOwnProfile ? [] : [fetchFollowStatus()]),
    ]);
  };

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${API}/users/${userId}`);
      setProfile(res.data);
      try {
        const statsRes = await axios.get(`${API}/users/${userId}/stats`);
        setStats(statsRes.data);
      } catch {
        setStats({
          followers: res.data.followers_count || 0,
          following: res.data.following_count || 0,
          posts: 0,
        });
      }
    } catch (err) {
      console.error("Erreur profil:", err);
      toast.error("Erreur lors du chargement du profil");
    }
  };

  const fetchFollowStatus = async () => {
    try {
      const res = await axios.get(`${API}/users/${userId}/follow-status`);
      setFollowStatus(res.data.status);
    } catch (err) {
      console.error("Erreur statut:", err);
    }
  };

  const fetchUserPosts = async () => {
    try {
      const res = await axios.get(`${API}/users/${userId}/posts`);
      setPosts(res.data);
      setStats((prev) => ({ ...prev, posts: res.data.length }));
    } catch (err) {
      console.error("Erreur posts:", err);
      if (err.response?.status !== 403)
        toast.error("Erreur lors du chargement des publications");
    } finally {
      setLoading(false);
    }
  };

  // Change d'onglet et charge reposts / mentions à la demande.
  const switchTab = (id) => {
    setActiveTab(id);
    if (id === "reposts" && userId) {
      axios.get(`${API}/users/${userId}/reposts`).then((r) => setReposts(r.data || [])).catch(() => {});
    }
    if (id === "mentions" && userId) {
      axios.get(`${API}/users/${userId}/mentions`).then((r) => setMentions(r.data || [])).catch(() => {});
    }
  };

  // ── Follow / Unfollow ──────────────────────────────────────────────────────
  const handleFollow = async () => {
    if (!user) { toast.error("Vous devez être connecté"); return; }
    try {
      setFollowLoading(true);
      const res = await axios.post(`${API}/users/${userId}/follow`);
      setFollowStatus(res.data.status);
      if (res.data.status === "pending") toast.success("Demande d'abonnement envoyée");
      else { toast.success("Abonné avec succès"); setStats((p) => ({ ...p, followers: p.followers + 1 })); }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors de l'action");
    } finally { setFollowLoading(false); }
  };

  const handleUnfollow = async () => {
    if (!user) { toast.error("Vous devez être connecté"); return; }
    try {
      setFollowLoading(true);
      await axios.delete(`${API}/users/${userId}/follow`);
      setFollowStatus("not_following");
      toast.success("Désabonné avec succès");
      setStats((p) => ({ ...p, followers: Math.max(0, p.followers - 1) }));
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors de l'action");
    } finally { setFollowLoading(false); }
  };

  // ── Post handlers ──────────────────────────────────────────────────────────
  const handleProfileUpdate = (updated) => { setUser(updated); setProfile(updated); setShowEditProfile(false); };
  const handlePostUpdate    = (updated) => setPosts(posts.map((p) => (p.id === updated.id ? updated : p)));
  const handlePostDelete    = (id) => { setPosts(posts.filter((p) => p.id !== id)); setStats((p) => ({ ...p, posts: Math.max(0, p.posts - 1) })); };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fmt = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
    return n;
  };

  const canViewContent = isOwnProfile || !profile?.is_private || followStatus === "following";
  const mediaPosts     = posts.filter((p) => p.media_url);

  // ── Follow button ──────────────────────────────────────────────────────────
  const FollowButton = () => {
    const spinner = (color = "#fff") => (
      <div style={{ width: 14, height: 14, border: `2px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
    );

    if (isOwnProfile) return (
      <div className="flex items-center gap-2">
        <button
          data-testid="edit-profile-button"
          onClick={() => setShowEditProfile(true)}
          style={{ background: C.surfaceHigh, color: C.primary, border: `1px solid ${C.primaryContainer}33` }}
          className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 hover:opacity-90"
        >
          <Edit size={14} /> Modifier le profil
        </button>
        <button
          data-testid="saved-shortcut"
          onClick={() => navigate("/enregistres")}
          title="Enregistrés"
          style={{ background: C.surfaceHigh, color: C.onSurface, border: `1px solid ${C.outlineVariant}` }}
          className="flex items-center justify-center w-10 h-10 rounded-xl transition-all active:scale-95 hover:opacity-90"
        >
          <span className="material-symbols-outlined text-lg">bookmark</span>
        </button>
      </div>
    );

    if (followStatus === "following") return (
      <button
        data-testid="unfollow-button"
        onClick={handleUnfollow}
        disabled={followLoading}
        style={{ background: C.surfaceHigh, color: C.onSurface, border: `1px solid ${C.outlineVariant}` }}
        className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 hover:opacity-80"
      >
        {followLoading ? spinner(C.onSurface) : <UserMinus size={14} />} Suivi
      </button>
    );

    if (followStatus === "pending") return (
      <button
        data-testid="cancel-request-button"
        onClick={handleUnfollow}
        disabled={followLoading}
        className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
        style={{ background: "rgba(245,158,11,0.1)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }}
      >
        {followLoading ? spinner("#fbbf24") : <Clock size={14} />} Demande envoyée
      </button>
    );

    return (
      <button
        data-testid="follow-button"
        onClick={handleFollow}
        disabled={followLoading}
        className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
        style={{ background: "linear-gradient(135deg, var(--nexus-accent), #3b82f6)", color: C.onPrimary, boxShadow: "0 4px 14px rgba(34,211,238,0.25)" }}
      >
        {followLoading ? spinner(C.onPrimary) : <UserPlus size={14} />}
        {profile?.is_private ? "Demander à suivre" : "Suivre"}
      </button>
    );
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!profile) return (
    <Layout user={user} setUser={setUser}>
      <div className="flex justify-center items-center" style={{ minHeight: "60vh" }}>
        <div className="flex items-center gap-3 px-8 py-3 rounded-full" style={{ ...glass, border: `1px solid ${C.outlineVariant}22` }}>
          <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: `${C.primaryContainer}33`, borderTopColor: C.primaryContainer }} />
          <span className="text-sm font-bold tracking-widest uppercase" style={{ color: C.outline }}>Chargement...</span>
        </div>
      </div>
    </Layout>
  );

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const tabs = [
    { id: "posts",    label: "Publications", icon: "article"         },
    { id: "media",    label: "Médias",       icon: "grid_on"         },
    { id: "reposts",  label: "Reposts",      icon: "repeat"          },
    { id: "mentions", label: "Mentions",     icon: "alternate_email" },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout user={user} setUser={setUser} hideMobileHeader>
      {/* Tirer vers le bas pour rafraîchir le profil (mobile). */}
      <PullToRefresh onRefresh={refreshProfile} />

      {/* Header collant mobile (mon profil) : contient le bouton Paramètres,
          fond translucide (blur). Reste toujours accessible au scroll ; les
          onglets se collent juste en dessous, sans espace vide. */}
      {isOwnProfile && (
        <div
          className="lg:hidden sticky top-0 z-[56] flex items-center justify-end px-3"
          style={{ height: 48, background: "rgba(11,19,38,0.5)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
        >
          <button
            onClick={() => navigate("/settings")}
            data-testid="profile-settings-button"
            className="w-10 h-10 flex items-center justify-center rounded-full transition-transform active:scale-90"
            style={{ color: "#dae2fd", background: "transparent", textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}
            title="Paramètres"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 26 }}>settings</span>
          </button>
        </div>
      )}

      {/* ── Cinematic Hero ───────────────────────────────────────────────── */}
      <div className="relative w-full overflow-hidden" style={{ height: 290 }}>
        {/* Gradient banner */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0a1628 0%, #0d1e3d 35%, #071525 65%, #0b1326 100%)" }} />
        {/* Ambient glows */}
        <div className="absolute rounded-full blur-3xl" style={{ width: 320, height: 320, top: -40, left: "20%", background: "radial-gradient(circle, rgba(34,211,238,0.12), transparent)" }} />
        <div className="absolute rounded-full blur-3xl" style={{ width: 240, height: 240, top: 0, right: "25%", background: "radial-gradient(circle, rgba(59,130,246,0.10), transparent)" }} />
        {/* Fade to surface */}
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 0%, ${C.surface}80 60%, ${C.surface} 100%)`, zIndex: 1 }} />

        {/* Profile overlay */}
        <div className="absolute bottom-0 left-0 w-full px-5 sm:px-8 pb-6" style={{ zIndex: 2 }}>
          <div className="flex flex-col sm:flex-row items-end gap-5 sm:gap-8 max-w-5xl mx-auto">

            {/* Avatar */}
            <div className="relative flex-shrink-0 group">
              <div className="absolute inset-0 rounded-full blur-2xl opacity-0 group-hover:opacity-30 transition-opacity" style={{ background: C.primaryContainer }} />
              <div
                className="relative rounded-full p-[3px]"
                style={{
                  width: 128, height: 128,
                  background: `linear-gradient(135deg, ${C.primaryContainer}, #1e3a5f, #3b82f6)`,
                  boxShadow: `0 0 20px rgba(34,211,238,0.30)`,
                }}
              >
                {profile.profile_pic ? (
                  <img src={profile.profile_pic} alt={profile.username} className="w-full h-full rounded-full object-cover" style={{ border: `4px solid ${C.surface}` }} />
                ) : (
                  <div
                    className="w-full h-full rounded-full flex items-center justify-center text-4xl font-black"
                    style={{ background: `linear-gradient(135deg, ${C.primaryContainer}, #3b82f6)`, color: C.onPrimary, border: `4px solid ${C.surface}` }}
                  >
                    {profile.username?.[0]?.toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="flex-1 min-w-0 mb-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1
                  className="text-3xl sm:text-[2.8rem] font-black tracking-tighter leading-none text-white"
                  style={{ fontFamily: "Space Grotesk, sans-serif", textShadow: "0 0 28px rgba(34,211,238,0.38)" }}
                >
                  {profile.username}
                </h1>
                {profile.is_verified && (
                  <span
                    className="material-symbols-outlined"
                    style={{ color: "#3b82f6", fontVariationSettings: "'FILL' 1", fontSize: "24px" }}
                    title="Compte vérifié"
                  >
                    verified
                  </span>
                )}
                {/* Badge Premium (avantage réel) */}
                {profile.is_premium && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black"
                    style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}
                    title="Membre Nexus Premium"
                  >
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                    Premium
                  </span>
                )}
                {profile.is_private && <Lock size={18} color={C.outline} />}
                <FollowButton />
                {/* Pourboire (Tip) — seulement pour les créateurs ayant activé Stripe Connect. */}
                {!isOwnProfile && profile.can_receive_tips && (
                  <button
                    data-testid="tip-button"
                    title="Envoyer un pourboire"
                    onClick={() => setShowTip(true)}
                    style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-lg">volunteer_activism</span>
                    Pourboire
                  </button>
                )}
                {/* Partager le profil : copie l'URL /profil/:userId (ou partage natif). */}
                <button
                  data-testid="share-profile"
                  title="Partager le profil"
                  onClick={async () => {
                    const url = `${window.location.origin}/profil/${userId}`;
                    try {
                      if (navigator.share) await navigator.share({ title: `@${profile.username} sur Nexus`, url });
                      else { await navigator.clipboard.writeText(url); toast.success("Lien du profil copié"); }
                    } catch { /* annulé */ }
                  }}
                  style={{ background: C.surfaceHigh, color: C.onSurface, border: `1px solid ${C.outlineVariant}` }}
                  className="flex items-center justify-center w-9 h-9 rounded-xl transition-all active:scale-95 hover:opacity-80"
                >
                  <Share2 size={16} />
                </button>
                {!isOwnProfile && profile.crypto_wallet && (
                  <button
                    data-testid="tip-crypto"
                    onClick={() => {
                      navigator.clipboard?.writeText(profile.crypto_wallet).then(
                        () => toast.success("Adresse wallet copiée — envoyez votre tip 🙌"),
                        () => toast.info(profile.crypto_wallet)
                      );
                    }}
                    title={profile.crypto_wallet}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
                    style={{ background: "rgba(34,211,238,0.12)", color: C.primary, border: `1px solid ${C.primaryContainer}33` }}
                  >
                    <span className="material-symbols-outlined text-base">volunteer_activism</span>
                    Tip crypto
                  </button>
                )}
              </div>
              {profile.bio && (
                <p className="text-sm leading-relaxed max-w-md" style={{ color: C.outline }}>
                  {profile.bio}
                </p>
              )}
            </div>

            {/* Stats — desktop */}
            <div className="hidden sm:flex gap-3 flex-shrink-0 mb-1">
              {[
                { label: "Publications", value: fmt(stats.posts), kind: null },
                { label: "Abonnés",      value: fmt(stats.followers), kind: "followers" },
                { label: "Abonnements",  value: fmt(stats.following), kind: "following" },
              ].map((s) => {
                const clickable = s.kind && canViewContent;
                return (
                  <button
                    key={s.label}
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && setFollowModal({ kind: s.kind })}
                    className={`text-center px-5 py-3 rounded-2xl ${clickable ? "hover:brightness-125 transition-all cursor-pointer" : "cursor-default"}`}
                    style={{ ...glass, border: `1px solid ${C.outlineVariant}18` }}
                  >
                    <span className="block text-[10px] uppercase tracking-widest font-bold mb-0.5" style={{ color: C.outline }}>
                      {s.label}
                    </span>
                    <span className="text-xl font-black text-white" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
                      {s.value}
                    </span>
                  </button>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* Stats — mobile */}
      <div className="sm:hidden flex gap-3 px-5 pt-4 overflow-x-auto pb-1">
        {[
          { label: "Publications", value: fmt(stats.posts), kind: null },
          { label: "Abonnés",      value: fmt(stats.followers), kind: "followers" },
          { label: "Abonnements",  value: fmt(stats.following), kind: "following" },
        ].map((s) => {
          const clickable = s.kind && canViewContent;
          return (
            <button
              key={s.label}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && setFollowModal({ kind: s.kind })}
              className={`flex-shrink-0 text-center px-4 py-2.5 rounded-xl ${clickable ? "active:brightness-125" : ""}`}
              style={{ ...glass, border: `1px solid ${C.outlineVariant}18` }}
            >
              <span className="block text-[9px] uppercase tracking-widest font-bold mb-0.5" style={{ color: C.outline }}>
                {s.label}
              </span>
              <span className="text-lg font-black text-white" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
                {s.value}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div
        className="sticky z-30 mt-6"
        style={{ top: isOwnProfile ? 48 : 0, background: `${C.surface}d9`, backdropFilter: "blur(16px)", borderTop: `1px solid ${C.outlineVariant}18`, borderBottom: `1px solid ${C.outlineVariant}18` }}
      >
        <div className="max-w-5xl mx-auto flex">
          {tabs.map(({ id, label, icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => switchTab(id)}
                className="flex-1 py-4 flex items-center justify-center gap-2 relative transition-all"
              >
                <span
                  className="material-symbols-outlined text-lg"
                  style={{ color: active ? C.primaryContainer : C.outline, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {icon}
                </span>
                <span
                  className="font-bold text-sm tracking-tight"
                  style={{ fontFamily: "Space Grotesk, sans-serif", color: active ? C.primaryContainer : C.outline }}
                >
                  {label}
                </span>
                {active && (
                  <div
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-full"
                    style={{ width: 56, height: 3, background: C.primaryContainer, boxShadow: `0 0 10px ${C.primaryContainer}cc` }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 py-8 pb-28 md:pb-8">

        {/* Private lock — cadenas SVG 100% personnalisé */}
        {!canViewContent ? (
          <div className="text-center py-16 px-6 rounded-2xl" style={{ background: `${C.surfaceContainer}80`, border: `1px solid ${C.outlineVariant}18` }}>
            <svg
              width="96" height="96" viewBox="0 0 96 96" fill="none"
              className="mx-auto mb-6" role="img" aria-label="Profil privé"
            >
              <defs>
                <linearGradient id="nexusLockGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={C.primaryContainer || "#22d3ee"} />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              {/* halo */}
              <circle cx="48" cy="48" r="46" fill={`${C.primaryContainer || "#22d3ee"}14`} />
              {/* anse du cadenas */}
              <path
                d="M32 44 V34 a16 16 0 0 1 32 0 V44"
                stroke="url(#nexusLockGrad)" strokeWidth="6"
                strokeLinecap="round" fill="none"
              />
              {/* corps du cadenas */}
              <rect x="26" y="43" width="44" height="34" rx="8" fill="url(#nexusLockGrad)" />
              {/* trou de serrure */}
              <circle cx="48" cy="57" r="5" fill={C.surface || "#0b1326"} />
              <rect x="46" y="59" width="4" height="10" rx="2" fill={C.surface || "#0b1326"} />
            </svg>
            <h3 className="text-2xl font-black text-white mb-2" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
              Ce profil est privé
            </h3>
            <p className="text-sm" style={{ color: C.outline }}>
              Suivez ce profil pour voir ces contenus
            </p>
          </div>

        ) : loading ? (
          <div className="flex justify-center py-16">
            <div className="flex items-center gap-3 px-8 py-3 rounded-full" style={{ ...glass, border: `1px solid ${C.outlineVariant}22` }}>
              <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: `${C.primaryContainer}33`, borderTopColor: C.primaryContainer }} />
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: C.outline }}>Chargement...</span>
            </div>
          </div>

        ) : (
          <>
            {/* ── Médias grid ───────────────────────────────────────────── */}
            {activeTab === "media" && (
              mediaPosts.length === 0 ? (
                <div className="text-center py-16" style={{ color: C.outline }}>
                  <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">photo_library</span>
                  <p className="text-sm">Aucun média publié</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  {mediaPosts.map((post) => (
                    <div
                      key={post.id}
                      className="group relative rounded-2xl overflow-hidden cursor-pointer"
                      style={{ aspectRatio: "1 / 1", background: C.surfaceLow }}
                    >
                      {post.media_type === "video" ? (
                        <video src={post.media_url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" muted playsInline />
                      ) : (
                        <img src={post.media_url} alt="Post" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                      )}

                      {/* Hover overlay */}
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-6"
                        style={{ background: "rgba(45,52,73,0.65)", backdropFilter: "blur(2px)" }}
                      >
                        {[
                          { icon: "favorite",    count: post.likes_count    || 0 },
                          { icon: "chat_bubble", count: post.comments_count || 0 },
                        ].map(({ icon, count }) => (
                          <div key={icon} className="flex items-center gap-1.5 text-white">
                            <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
                            <span className="font-black text-base" style={{ fontFamily: "Space Grotesk, sans-serif" }}>{fmt(count)}</span>
                          </div>
                        ))}
                      </div>

                      {/* Video badge */}
                      {post.media_type === "video" && (
                        <div className="absolute top-3 right-3 p-1.5 rounded-lg" style={{ background: "rgba(11,19,38,0.78)", backdropFilter: "blur(4px)" }}>
                          <span className="material-symbols-outlined text-white text-sm">play_circle</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ── Publications list ─────────────────────────────────────── */}
            {activeTab === "posts" && (
              posts.length === 0 ? (
                <div className="text-center py-16" style={{ color: C.outline }}>
                  <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">article</span>
                  <p className="text-sm">Aucune publication</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {posts.map((post) => (
                    <PostCard key={post.id} post={post} currentUser={user} onUpdate={handlePostUpdate} onDelete={handlePostDelete} />
                  ))}
                </div>
              )
            )}

            {/* ── Reposts ───────────────────────────────────────────────── */}
            {activeTab === "reposts" && (
              reposts.length === 0 ? (
                <div className="text-center py-16" style={{ color: C.outline }}>
                  <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">repeat</span>
                  <p className="text-sm">Aucune republication</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reposts.map((post) => (
                    <PostCard key={post.id} post={post} currentUser={user} onUpdate={handlePostUpdate}
                      onDelete={(id) => { setReposts((r) => r.filter((p) => p.id !== id)); handlePostDelete(id); }} />
                  ))}
                </div>
              )
            )}

            {/* ── Mentions ──────────────────────────────────────────────── */}
            {activeTab === "mentions" && (
              mentions.length === 0 ? (
                <div className="text-center py-16" style={{ color: C.outline }}>
                  <span className="material-symbols-outlined text-5xl block mb-3 opacity-30">alternate_email</span>
                  <p className="text-sm">Aucune mention</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {mentions.map((post) => (
                    <PostCard key={post.id} post={post} currentUser={user} onUpdate={handlePostUpdate} onDelete={handlePostDelete} />
                  ))}
                </div>
              )
            )}
          </>
        )}
      </div>

      <EditProfileModal open={showEditProfile} onClose={() => setShowEditProfile(false)} user={user} onUpdate={handleProfileUpdate} />

      {/* Sélecteur de montant de pourboire */}
      {showTip && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4" style={{ background: "rgba(2,6,20,0.8)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowTip(false); }}>
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5" style={{ background: "#171f33", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined" style={{ color: "var(--nexus-accent)" }}>volunteer_activism</span>
              <h3 className="font-bold text-white">Envoyer un pourboire à @{profile.username}</h3>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[1, 2, 5, 10].map((v) => (
                <button key={v} onClick={() => sendTip(v)}
                        className="py-3 rounded-xl font-black text-sm active:scale-95 transition-all"
                        style={{ background: "#222a3d", color: "#dae2fd", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {v} €
                </button>
              ))}
            </div>
            <p className="text-[11px] text-center" style={{ color: C.outline }}>
              Paiement sécurisé via Stripe. Le créateur reçoit le montant après commission de la plateforme.
            </p>
            <button onClick={() => setShowTip(false)} className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#222a3d", color: C.onVariant }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {followModal && (
        <FollowListModal
          userId={userId}
          kind={followModal.kind}
          title={followModal.kind === "followers" ? "Abonnés" : "Abonnements"}
          currentUserId={user?.id}
          manageFollowers={isOwnProfile && followModal.kind === "followers"}
          onClose={() => setFollowModal(null)}
          onCountChange={(d) =>
            setStats((p) => ({
              ...p,
              [followModal.kind === "followers" ? "followers" : "following"]:
                Math.max(0, p[followModal.kind === "followers" ? "followers" : "following"] + d),
            }))
          }
        />
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Layout>
  );
}
