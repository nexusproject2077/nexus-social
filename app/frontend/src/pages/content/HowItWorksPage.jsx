// Page « Comment ça marche » — parcours complet d'utilisation de Nexus Social.
import { Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import ContentLayout, { proseStyle } from "./ContentLayout";

const ACCENT = "#22d3ee";

export default function HowItWorksPage() {
  const { t } = useTranslation();
  return (
    <ContentLayout
      title={t("how.page_title")}}
      description={t("how.page_desc")}
    >
      <style>{proseStyle}</style>
      <h1 style={{ fontSize: 32, color: "#fff", margin: "0 0 12px", letterSpacing: "-0.02em" }}>{t("how.h1")}</h1>
      <p style={{ color: "#bbc9cd", fontSize: 18, lineHeight: 1.6 }}>
        {t("how.intro")}
      </p>

      <div className="nx-prose">
        <h2>{t("how.s1_h")}</h2>
        <p>{t("how.s1_p")}</p>

        <h2>{t("how.s2_h")}</h2>
        <p>{t("how.s2_p")}</p>

        <h2>{t("how.s3_h")}</h2>
        <p><Trans i18nKey="how.s3_p" components={{ a: <Link to="/guides/publier-son-premier-post" /> }} /></p>

        <h2>{t("how.s4_h")}</h2>
        <p><Trans i18nKey="how.s4_p" components={{ a: <Link to="/guides/bien-utiliser-les-stories" /> }} /></p>

        <h2>{t("how.s5_h")}</h2>
        <p><Trans i18nKey="how.s5_p" components={{ a: <Link to="/guides/reussir-ses-nexus-clips" /> }} /></p>

        <h2>{t("how.s6_h")}</h2>
        <p>{t("how.s6_p")}</p>

        <h2>{t("how.s7_h")}</h2>
        <p>{t("how.s7_p")}</p>

        <h2>{t("how.s8_h")}</h2>
        <p><Trans i18nKey="how.s8_p" components={{ a: <Link to="/guides/confidentialite-maitriser-son-audience" /> }} /></p>

        <h2>{t("how.s9_h")}</h2>
        <p><Trans i18nKey="how.s9_p" components={{ a: <Link to="/guides/securite-proteger-son-compte" /> }} /></p>

        <h2>{t("how.q_h")}</h2>
        <p><Trans i18nKey="how.q_p" components={{ a: <Link to="/faq" /> }} /></p>
      </div>

      <div style={{ marginTop: 36, textAlign: "center" }}>
        <Link to="/auth" style={{ display: "inline-block", textDecoration: "none", fontWeight: 800, color: "#00363e", background: ACCENT, padding: "12px 28px", borderRadius: 999 }}>
          {t("how.cta")}
        </Link>
      </div>
    </ContentLayout>
  );
}
