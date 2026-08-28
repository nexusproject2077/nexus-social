// Page « À propos » — présentation complète de Nexus Social.
import { Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import ContentLayout, { proseStyle } from "./ContentLayout";

const ACCENT = "#22d3ee";

export default function AboutPage() {
  const { t } = useTranslation();
  return (
    <ContentLayout
      title={t("about.page_title")}
      description={t("about.page_desc")}
    >
      <style>{proseStyle}</style>
      <h1
        style={{
          fontSize: 32,
          color: "#fff",
          margin: "0 0 12px",
          letterSpacing: "-0.02em",
        }}
      >
        {t("about.h1")}
      </h1>
      <p
        style={{
          color: "#bbc9cd",
          fontSize: 18,
          lineHeight: 1.6,
          marginBottom: 8,
        }}
      >
        {t("about.intro")}
      </p>

      <div className="nx-prose">
        <h2>{t("about.mission_h2")}</h2>
        <p>{t("about.mission_p")}</p>

        <h2>{t("about.do_h2")}</h2>
        <p>{t("about.do_intro")}</p>
        <ul>
          <li>
            <Trans i18nKey="about.do_1" components={{ b: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="about.do_2" components={{ b: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="about.do_3" components={{ b: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="about.do_4" components={{ b: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="about.do_5" components={{ b: <strong /> }} />
          </li>
        </ul>

        <h2>{t("about.values_h2")}</h2>
        <h3>{t("about.v_trust_h3")}</h3>
        <p>{t("about.v_trust_p")}</p>

        <h3>{t("about.v_privacy_h3")}</h3>
        <p>{t("about.v_privacy_p")}</p>

        <h3>{t("about.v_creation_h3")}</h3>
        <p>{t("about.v_creation_p")}</p>

        <h3>{t("about.v_community_h3")}</h3>
        <p>
          <Trans
            i18nKey="about.v_community_p"
            components={{ a: <Link to="/guides/regles-de-la-communaute" /> }}
          />
        </p>

        <h2>{t("about.age_h2")}</h2>
        <p>{t("about.age_p")}</p>

        <h2>{t("about.tech_h2")}</h2>
        <p>{t("about.tech_p")}</p>

        <h2>{t("about.join_h2")}</h2>
        <p>
          <Trans
            i18nKey="about.join_p"
            components={{
              a: <Link to="/comment-ca-marche" />,
              b: <Link to="/auth" />,
            }}
          />
        </p>
      </div>

      <div style={{ marginTop: 36, textAlign: "center" }}>
        <Link
          to="/auth"
          style={{
            display: "inline-block",
            textDecoration: "none",
            fontWeight: 800,
            color: "#00363e",
            background: ACCENT,
            padding: "12px 28px",
            borderRadius: 999,
          }}
        >
          {t("about.cta")}
        </Link>
      </div>
    </ContentLayout>
  );
}
