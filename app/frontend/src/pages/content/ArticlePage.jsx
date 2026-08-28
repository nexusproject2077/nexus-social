// Affiche un article/guide par son slug (métadonnées dans src/content/articles.js,
// texte dans les traductions i18n, namespace « guides »).
import { useParams, Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import ContentLayout, { proseStyle } from "./ContentLayout";
import { getArticle, getRelated } from "@/content/articles";

const ACCENT = "#22d3ee";

export default function ArticlePage() {
  const { slug } = useParams();
  const { t } = useTranslation();
  const article = getArticle(slug);
  if (!article) return <Navigate to="/guides" replace />;
  const related = getRelated(slug, 3);
  const title = t("guides." + article.slug + "_title");
  const excerpt = t("guides." + article.slug + "_excerpt");
  const html = t("guides." + article.slug + "_html");
  const dateLabel = new Date(article.date).toLocaleDateString(
    i18n.language || "en",
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <ContentLayout title={title} description={excerpt}>
      <style>{proseStyle}</style>
      <p style={{ marginBottom: 6 }}>
        <Link
          to="/guides"
          style={{
            color: ACCENT,
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {t("guides.all_guides")}
        </Link>
      </p>
      <p
        style={{
          color: ACCENT,
          fontSize: 12,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: "8px 0 4px",
        }}
      >
        {t("guides.cat_" + article.category)}
      </p>
      <h1
        style={{
          fontSize: 30,
          lineHeight: 1.2,
          color: "#fff",
          margin: "0 0 10px",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h1>
      <p
        style={{
          color: "#859397",
          fontSize: 14,
          marginBottom: 24,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: 18,
        }}
      >
        {t("guides.meta", { date: dateLabel, min: article.readMins })}
      </p>

      <div className="nx-prose" dangerouslySetInnerHTML={{ __html: html }} />

      {related.length > 0 && (
        <section
          style={{
            marginTop: 48,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: 24,
          }}
        >
          <h2 style={{ fontSize: 18, color: "#fff", marginBottom: 14 }}>
            {t("guides.also_read")}
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            {related.map((r) => (
              <Link
                key={r.slug}
                to={`/guides/${r.slug}`}
                style={{
                  textDecoration: "none",
                  display: "block",
                  background: "#131b2e",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <p
                  style={{ color: "#fff", fontWeight: 700, margin: "0 0 4px" }}
                >
                  {t("guides." + r.slug + "_title")}
                </p>
                <p style={{ color: "#859397", fontSize: 14, margin: 0 }}>
                  {t("guides." + r.slug + "_excerpt").slice(0, 110)}…
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </ContentLayout>
  );
}
