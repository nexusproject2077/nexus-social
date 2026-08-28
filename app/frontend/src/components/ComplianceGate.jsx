// Couche de conformité pilotée par la géolocalisation (source de vérité : backend
// via /geo/status, exposée par GeoContext). Purement AFFICHAGE — l'enforcement réel
// (blocage inscription/publication/messagerie) est fait côté serveur.
//
//  • Mode consultation (RU / CN) : bandeau « lecture seule » persistant.
//  • Écran de consentement APPI (JP/KR/IN/AU) : transparence des données + accès
//    direct et sans friction à la suppression de compte (Privacy Center).
//
// Le reste du monde : ce composant ne rend RIEN (zéro friction).
import { useEffect, useState } from "react";
import { Eye, ShieldCheck, FileText, Trash2, Check } from "lucide-react";
import { useGeo } from "@/context/GeoContext";
import i18n from "@/i18n";

const APPI_CONSENT_KEY = "appi_consent_v1";

// NB : ce composant est monté HORS du <Router> (au niveau de <App>), donc on ne
// peut pas utiliser useNavigate() ici (il lèverait « useNavigate may be used only
// in the context of a <Router> »). On navigue via window.location — action rare.
const goPrivacyCenter = () => {
  try {
    window.location.assign("/privacy-center");
  } catch {
    /* ignore */
  }
};

export default function ComplianceGate() {
  const geo = useGeo();
  const [roDismissed, setRoDismissed] = useState(false);
  const [appiDone, setAppiDone] = useState(true);

  // Consentement APPI : affiché une seule fois (persisté en localStorage).
  useEffect(() => {
    if (!geo.loaded) return;
    if (geo.consentScreen) {
      let stored = null;
      try {
        stored = localStorage.getItem(APPI_CONSENT_KEY);
      } catch {
        /* ignore */
      }
      setAppiDone(!!stored);
    } else {
      setAppiDone(true);
    }
  }, [geo.loaded, geo.consentScreen]);

  const acceptAppi = () => {
    try {
      localStorage.setItem(APPI_CONSENT_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setAppiDone(true);
  };

  if (!geo.loaded) return null;

  return (
    <>
      {/* ── Écran de consentement APPI (Japon & APAC strict) ─────────────────── */}
      {geo.consentScreen && !appiDone && (
        <div
          className="fixed inset-0 z-[1001] flex items-end sm:items-center justify-center sm:p-4"
          style={{
            background: "rgba(2,6,20,0.86)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
            style={{
              background: "#0d1424",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div
              className="px-6 pt-7 pb-5 text-center"
              style={{ background: "linear-gradient(135deg,#052b2f,#0d1424)" }}
            >
              <div
                className="mx-auto mb-3 w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
                }}
              >
                <ShieldCheck className="w-7 h-7" style={{ color: "#03242b" }} />
              </div>
              <h3 className="text-white font-black text-xl">
                {i18n.t("compliance.appi_title")}
              </h3>
              <p className="text-sm mt-1" style={{ color: "#7fdbe8" }}>
                {i18n.t("compliance.appi_sub")}
              </p>
            </div>

            <div className="px-6 py-5">
              <ul className="space-y-2.5 mb-5">
                {["appi_1", "appi_2", "appi_3", "appi_4"].map((k) => (
                  <li key={k} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(34,211,238,0.14)" }}
                    >
                      <Check
                        className="w-3 h-3"
                        style={{ color: "#22d3ee" }}
                        strokeWidth={3}
                      />
                    </span>
                    <span className="text-sm" style={{ color: "#dae2fd" }}>
                      {i18n.t("compliance." + k)}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                onClick={acceptAppi}
                className="w-full py-3 rounded-2xl font-black text-sm active:scale-[0.98] transition-transform"
                style={{
                  background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
                  color: "#03242b",
                }}
              >
                {i18n.t("compliance.appi_accept")}
              </button>

              <div
                className="flex items-center justify-center gap-4 mt-3 text-xs"
                style={{ color: "#8ea0c4" }}
              >
                <button
                  onClick={() => {
                    acceptAppi();
                    goPrivacyCenter();
                  }}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <FileText className="w-3.5 h-3.5" />{" "}
                  {i18n.t("compliance.my_data")}
                </button>
                <span style={{ color: "#3a4759" }}>·</span>
                <button
                  onClick={() => {
                    acceptAppi();
                    goPrivacyCenter();
                  }}
                  className="inline-flex items-center gap-1.5 hover:underline"
                  style={{ color: "#f7a1a1" }}
                >
                  <Trash2 className="w-3.5 h-3.5" />{" "}
                  {i18n.t("compliance.delete_account")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bandeau « mode consultation » (RU / CN) ──────────────────────────── */}
      {geo.readOnly && !roDismissed && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[1000] w-[94%] max-w-xl">
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl"
            style={{
              background: "rgba(15,23,42,0.96)",
              border: "1px solid #26324a",
              backdropFilter: "blur(12px)",
            }}
          >
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(148,163,184,0.14)" }}
            >
              <Eye className="w-4 h-4" style={{ color: "#94a3b8" }} />
            </span>
            <p
              className="flex-1 text-xs sm:text-sm leading-snug"
              style={{ color: "#cbd5e1" }}
            >
              {geo.readOnlyMessage || i18n.t("compliance.readonly_fallback")}
            </p>
            <button
              onClick={() => setRoDismissed(true)}
              className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "#1e2a44", color: "#cbd5e1" }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );
}
