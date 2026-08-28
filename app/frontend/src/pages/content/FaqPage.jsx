// Page FAQ — questions fréquentes, groupées par thème. Contenu entièrement
// visible (bon pour l'accessibilité et le référencement).
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ContentLayout from "./ContentLayout";

const ACCENT = "#22d3ee";

// Structure : préfixe de catégorie → nombre de questions. Les libellés viennent
// du namespace i18n « faq » (faq.cN_cat, faq.cN_qM, faq.cN_aM).
const SECTIONS = [
  { c: "c1", n: 5 },
  { c: "c2", n: 5 },
  { c: "c3", n: 5 },
  { c: "c4", n: 3 },
  { c: "c5", n: 3 },
];

export default function FaqPage() {
  const { t } = useTranslation();
  return (
    <ContentLayout title={t("faq.page_title")} description={t("faq.page_desc")}>
      <h1
        style={{
          fontSize: 32,
          color: "#fff",
          margin: "0 0 12px",
          letterSpacing: "-0.02em",
        }}
      >
        {t("faq.h1")}
      </h1>
      <p style={{ color: "#bbc9cd", fontSize: 17, marginBottom: 28 }}>
        {t("faq.lead")}{" "}
        <a href="mailto:support@nexussocial.com" style={{ color: ACCENT }}>
          support@nexussocial.com
        </a>
        .
      </p>

      {SECTIONS.map((section) => (
        <section key={section.c} style={{ marginBottom: 30 }}>
          <h2
            style={{
              fontSize: 14,
              color: ACCENT,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 14,
            }}
          >
            {t("faq." + section.c + "_cat")}
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            {Array.from({ length: section.n }).map((_, i) => {
              const q = t("faq." + section.c + "_q" + (i + 1));
              const a = t("faq." + section.c + "_a" + (i + 1));
              return (
                <div
                  key={i}
                  style={{
                    background: "#131b2e",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 14,
                    padding: "16px 18px",
                  }}
                >
                  <p
                    style={{
                      color: "#fff",
                      fontWeight: 700,
                      margin: "0 0 6px",
                      fontSize: 16,
                    }}
                  >
                    {q}
                  </p>
                  <p
                    style={{
                      color: "#a7b3cc",
                      margin: 0,
                      lineHeight: 1.6,
                      fontSize: 15,
                    }}
                  >
                    {a}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div
        style={{
          marginTop: 24,
          padding: 20,
          background: "rgba(34,211,238,0.06)",
          border: "1px solid rgba(34,211,238,0.2)",
          borderRadius: 16,
        }}
      >
        <p style={{ color: "#fff", fontWeight: 700, margin: "0 0 6px" }}>
          {t("faq.cta_title")}
        </p>
        <p style={{ color: "#a7b3cc", margin: "0 0 4px" }}>
          {t("faq.cta_body_1")}{" "}
          <Link to="/guides" style={{ color: ACCENT }}>
            {t("faq.cta_guides")}
          </Link>{" "}
          {t("faq.cta_body_2")}
        </p>
      </div>
    </ContentLayout>
  );
}
