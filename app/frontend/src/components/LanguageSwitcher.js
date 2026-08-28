import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "../i18n";

/**
 * Sélecteur de langue de l'interface.
 * La langue choisie est mémorisée dans localStorage (clé "nexus_lang")
 * par le détecteur i18next, donc elle persiste entre les sessions.
 */
export default function LanguageSwitcher({ className = "" }) {
  const { i18n } = useTranslation();

  const handleChange = (e) => {
    // Marque un choix explicite pour que la détection par IP ne l'écrase plus.
    try {
      localStorage.setItem("nexus_lang_explicit", "1");
    } catch {
      /* stockage indisponible */
    }
    i18n.changeLanguage(e.target.value);
  };

  const current = (i18n.resolvedLanguage || i18n.language || "en").split(
    "-",
  )[0];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <select
        aria-label="Language"
        value={
          SUPPORTED_LANGUAGES.some((l) => l.code === current) ? current : "en"
        }
        onChange={handleChange}
        className="bg-transparent border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
}
