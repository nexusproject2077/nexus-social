// Index des guides (blog / centre d'aide) : liste tous les articles, groupés.
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ContentLayout from "./ContentLayout";
import { ARTICLES, CATEGORY_KEYS } from "@/content/articles";

const ACCENT = "#22d3ee";

export default function GuidesIndexPage() {
  const { t } = useTranslation();
  const byCat = CATEGORY_KEYS.map((key) => ({
    key, items: ARTICLES.filter((a) => a.category === key),
  })).filter((c) => c.items.length > 0);

  return (
    <ContentLayout
      title={t("guides.index_title")}}
      description={t("guides.index_desc")}
    >
      <h1 style={{ fontSize: 30, color: "#fff", margin: "0 0 8px", letterSpacing: "-0.02em" }}>{t("guides.index_h1")}</h1>
      <p style={{ color: "#bbc9cd", marginBottom: 28, fontSize: 17 }}>
        {t("guides.index_intro")}
      </p>

      {byCat.map((cat) => (
        <section key={cat.key} style={{ marginBottom: 34 }}>
          <h2 style={{ fontSize: 14, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>{t("guides.cat_" + cat.key)}</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {cat.items.map((a) => (
              <Link key={a.slug} to={`/guides/${a.slug}`} style={{ textDecoration: "none", display: "block", background: "#131b2e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 18 }}>
                <p style={{ color: "#fff", fontWeight: 800, fontSize: 17, margin: "0 0 6px" }}>{t("guides." + a.slug + "_title")}</p>
                <p style={{ color: "#a7b3cc", fontSize: 14.5, margin: "0 0 8px", lineHeight: 1.55 }}>{t("guides." + a.slug + "_excerpt")}</p>
                <span style={{ color: ACCENT, fontSize: 13, fontWeight: 700 }}>{t("guides.read_guide", { min: a.readMins })}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </ContentLayout>
  );
}
