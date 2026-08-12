// Mise en page PUBLIQUE des pages de contenu (À propos, guides, FAQ…).
// Accessible sans connexion, responsive et rapide. Navigation claire en haut,
// pied de page avec liens utiles et pages légales.
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { API } from "@/App";

const ACCENT = "#22d3ee";

const NAV = [
  { to: "/a-propos", label: "À propos" },
  { to: "/comment-ca-marche", label: "Comment ça marche" },
  { to: "/guides", label: "Guides" },
  { to: "/faq", label: "FAQ" },
];

// CSS responsive pour l'en-tête. Mobile-first : les liens en ligne et le pied de
// page multi-colonnes n'apparaissent qu'à partir de 720px ; en dessous, le menu
// passe dans un panneau déroulant (hamburger). Injecté une seule fois.
const HEADER_CSS = `
  .nx-nav-inline { display: none; }
  .nx-burger { display: inline-flex; }
  .nx-mobile-menu { display: flex; }
  @media (min-width: 720px) {
    .nx-nav-inline { display: flex; }
    .nx-burger { display: none; }
    .nx-mobile-menu { display: none !important; }
  }
`;

export default function ContentLayout({ title, description, children }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // SEO minimal : titre + meta description mis à jour à l'affichage.
  useEffect(() => {
    if (title) document.title = `${title} · Nexus Social`;
    if (description) {
      let m = document.querySelector('meta[name="description"]');
      if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
      m.setAttribute("content", description);
    }
    window.scrollTo(0, 0);
  }, [title, description]);

  return (
    <div style={{ background: "#0b1326", color: "#dae2fd", minHeight: "100vh" }}>
      <style>{HEADER_CSS}</style>
      {/* En-tête */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(11,19,38,0.9)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}>
          <Link to="/a-propos" onClick={() => setMenuOpen(false)} style={{ textDecoration: "none", fontWeight: 900, fontSize: 18, letterSpacing: "-0.02em", background: `linear-gradient(90deg, ${ACCENT}, #3b82f6)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", whiteSpace: "nowrap" }}>
            Nexus Social
          </Link>
          {/* Liens en ligne (écran large uniquement) */}
          <nav className="nx-nav-inline" style={{ gap: 14, marginLeft: 8, alignItems: "center" }}>
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} style={{ color: "#bbc9cd", textDecoration: "none", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{n.label}</Link>
            ))}
          </nav>
          {/* Pousse le bouton/burger à droite */}
          <div style={{ flex: 1 }} />
          <Link to="/auth" onClick={() => setMenuOpen(false)} style={{ textDecoration: "none", fontSize: 13, fontWeight: 800, color: "#00363e", background: ACCENT, padding: "8px 16px", borderRadius: 999, whiteSpace: "nowrap" }}>
            Rejoindre
          </Link>
          {/* Hamburger (mobile uniquement) */}
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="nx-burger"
            style={{ background: "transparent", border: "none", padding: 6, cursor: "pointer", color: "#dae2fd", alignItems: "center", justifyContent: "center" }}
          >
            {menuOpen ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            )}
          </button>
        </div>
        {/* Panneau déroulant mobile */}
        {menuOpen && (
          <nav className="nx-mobile-menu" style={{ flexDirection: "column", padding: "6px 18px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", gap: 2 }}>
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMenuOpen(false)}
                style={{ color: "#dae2fd", textDecoration: "none", fontSize: 16, fontWeight: 600, padding: "12px 8px", borderRadius: 10 }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* Contenu */}
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "28px 22px 64px", lineHeight: 1.75, fontSize: 16 }}>
        {children}
      </main>

      {/* Pied de page */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "#080f1f" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "32px 22px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 24 }}>
          <div>
            <p style={{ fontWeight: 900, marginBottom: 8, color: "#fff" }}>Nexus Social</p>
            <p style={{ color: "#859397", fontSize: 14 }}>Le réseau social pour créer, partager et échanger, en toute confiance.</p>
          </div>
          <div>
            <p style={{ fontWeight: 700, marginBottom: 8, color: "#dae2fd", fontSize: 14 }}>Découvrir</p>
            {NAV.map((n) => (
              <div key={n.to} style={{ margin: "6px 0" }}>
                <Link to={n.to} style={{ color: "#859397", textDecoration: "none", fontSize: 14 }}>{n.label}</Link>
              </div>
            ))}
          </div>
          <div>
            <p style={{ fontWeight: 700, marginBottom: 8, color: "#dae2fd", fontSize: 14 }}>Légal</p>
            {[["Conditions d'utilisation", "/legal/terms-of-service"], ["Politique de confidentialité", "/legal/privacy-policy"], ["Politique cookies", "/legal/cookie-policy"]].map(([l, p]) => (
              <div key={p} style={{ margin: "6px 0" }}>
                <a href={`${API}${p}`} target="_blank" rel="noopener noreferrer" style={{ color: "#859397", textDecoration: "none", fontSize: 14 }}>{l}</a>
              </div>
            ))}
          </div>
          <div>
            <p style={{ fontWeight: 700, marginBottom: 8, color: "#dae2fd", fontSize: 14 }}>Contact</p>
            <div style={{ margin: "6px 0" }}><a href="mailto:support@nexussocial.com" style={{ color: "#859397", textDecoration: "none", fontSize: 14 }}>support@nexussocial.com</a></div>
            <div style={{ margin: "6px 0" }}><a href="mailto:privacy@nexussocial.com" style={{ color: "#859397", textDecoration: "none", fontSize: 14 }}>privacy@nexussocial.com</a></div>
          </div>
        </div>
        <div style={{ textAlign: "center", padding: "16px", color: "#5b6b8c", fontSize: 13, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          © 2026 Nexus Social. Tous droits réservés.
        </div>
      </footer>
    </div>
  );
}

// Styles réutilisables pour le corps des articles (titres, listes, liens).
export const proseStyle = `
  .nx-prose h2 { font-size: 22px; color: #fff; margin: 30px 0 10px; letter-spacing: -0.01em; }
  .nx-prose h3 { font-size: 17px; color: ${ACCENT}; margin: 20px 0 6px; }
  .nx-prose p { margin: 12px 0; color: #cdd6ea; }
  .nx-prose ul { padding-left: 22px; margin: 12px 0; }
  .nx-prose li { margin: 6px 0; color: #cdd6ea; }
  .nx-prose strong { color: #eef2ff; }
  .nx-prose a { color: ${ACCENT}; }
`;
