// Index des guides (blog / centre d'aide) : liste tous les articles, groupés.
import { Link } from "react-router-dom";
import ContentLayout from "./ContentLayout";
import { ARTICLES, CATEGORIES } from "@/content/articles";

const ACCENT = "#22d3ee";

export default function GuidesIndexPage() {
  const byCat = Object.keys(CATEGORIES).map((key) => ({
    key, label: CATEGORIES[key], items: ARTICLES.filter((a) => a.category === key),
  })).filter((c) => c.items.length > 0);

  return (
    <ContentLayout
      title="Guides et conseils"
      description="Tous nos guides pour tirer le meilleur de Nexus Social : Stories, Clips, sécurité, confidentialité, communauté et bien plus."
    >
      <h1 style={{ fontSize: 30, color: "#fff", margin: "0 0 8px", letterSpacing: "-0.02em" }}>Guides et conseils</h1>
      <p style={{ color: "#bbc9cd", marginBottom: 28, fontSize: 17 }}>
        Des articles clairs et concrets pour bien débuter, créer de meilleurs contenus, protéger votre compte et profiter pleinement de Nexus Social.
      </p>

      {byCat.map((cat) => (
        <section key={cat.key} style={{ marginBottom: 34 }}>
          <h2 style={{ fontSize: 14, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>{cat.label}</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {cat.items.map((a) => (
              <Link key={a.slug} to={`/guides/${a.slug}`} style={{ textDecoration: "none", display: "block", background: "#131b2e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 18 }}>
                <p style={{ color: "#fff", fontWeight: 800, fontSize: 17, margin: "0 0 6px" }}>{a.title}</p>
                <p style={{ color: "#a7b3cc", fontSize: 14.5, margin: "0 0 8px", lineHeight: 1.55 }}>{a.excerpt}</p>
                <span style={{ color: ACCENT, fontSize: 13, fontWeight: 700 }}>Lire le guide · {a.readMins} min</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </ContentLayout>
  );
}
