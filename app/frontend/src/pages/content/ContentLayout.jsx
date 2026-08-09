// Mise en page PUBLIQUE des pages de contenu (À propos, guides, FAQ…).
// Accessible sans connexion, responsive et rapide. Navigation claire en haut,
// pied de page avec liens utiles et pages légales.
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { API } from "@/App";

const ACCENT = "#22d3ee";

const NAV = [
  { to: "/a-propos", label: "À propos" },
  { to: "/comment-ca-marche", label: "Comment ça marche" },
  { to: "/guides", label: "Guides" },
  { to: "/faq", label: "FAQ" },
];

export default function ContentLayout({ title, description, children }) {
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
      {/* En-tête */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(11,19,38,0.9)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <Link to="/a-propos" style={{ textDecoration: "none", fontWeight: 900, fontSize: 18, letterSpacing: "-0.02em", background: `linear-gradient(90deg, ${ACCENT}, #3b82f6)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Nexus Social
          </Link>
          <nav style={{ display: "flex", gap: 14, flexWrap: "wrap", flex: 1 }}>
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} style={{ color: "#bbc9cd", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>{n.label}</Link>
            ))}
          </nav>
          <Link to="/auth" style={{ textDecoration: "none", fontSize: 13, fontWeight: 800, color: "#00363e", background: ACCENT, padding: "8px 16px", borderRadius: 999 }}>
            Rejoindre
          </Link>
        </div>
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
