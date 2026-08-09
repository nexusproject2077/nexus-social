// Affiche un article/guide par son slug (contenu de src/content/articles.js).
import { useParams, Link, Navigate } from "react-router-dom";
import ContentLayout, { proseStyle } from "./ContentLayout";
import { CATEGORIES, getArticle, getRelated } from "@/content/articles";

const ACCENT = "#22d3ee";

export default function ArticlePage() {
  const { slug } = useParams();
  const article = getArticle(slug);
  if (!article) return <Navigate to="/guides" replace />;
  const related = getRelated(slug, 3);
  const dateLabel = new Date(article.date).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });

  return (
    <ContentLayout title={article.title} description={article.excerpt}>
      <style>{proseStyle}</style>
      <p style={{ marginBottom: 6 }}>
        <Link to="/guides" style={{ color: ACCENT, textDecoration: "none", fontSize: 13, fontWeight: 700 }}>← Tous les guides</Link>
      </p>
      <p style={{ color: ACCENT, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", margin: "8px 0 4px" }}>
        {CATEGORIES[article.category] || "Guide"}
      </p>
      <h1 style={{ fontSize: 30, lineHeight: 1.2, color: "#fff", margin: "0 0 10px", letterSpacing: "-0.02em" }}>{article.title}</h1>
      <p style={{ color: "#859397", fontSize: 14, marginBottom: 24, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 18 }}>
        {dateLabel} · {article.readMins} min de lecture
      </p>

      <div className="nx-prose" dangerouslySetInnerHTML={{ __html: article.html }} />

      {related.length > 0 && (
        <section style={{ marginTop: 48, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24 }}>
          <h2 style={{ fontSize: 18, color: "#fff", marginBottom: 14 }}>À lire aussi</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {related.map((r) => (
              <Link key={r.slug} to={`/guides/${r.slug}`} style={{ textDecoration: "none", display: "block", background: "#131b2e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 16 }}>
                <p style={{ color: "#fff", fontWeight: 700, margin: "0 0 4px" }}>{r.title}</p>
                <p style={{ color: "#859397", fontSize: 14, margin: 0 }}>{r.excerpt.slice(0, 110)}…</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </ContentLayout>
  );
}
