// CookieConsent.jsx - Bandeau cookies adapté à la région
// UE (restricted) : bandeau RGPD complet (Accepter / Refuser, overlay).
// Hors-UE : notice discrète en bas de page (un simple « OK »).

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Shield } from "lucide-react";
import { useGeo } from "@/context/GeoContext";
import { useTranslation } from "react-i18next";

export default function CookieConsent() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const { restricted, loaded } = useGeo();

  useEffect(() => {
    if (!loaded) return;
    const consent = localStorage.getItem("cookie_consent");
    if (!consent) {
      const t = setTimeout(() => setShow(true), 1000);
      return () => clearTimeout(t);
    }
  }, [loaded]);

  const setConsent = (value) => {
    localStorage.setItem("cookie_consent", value);
    localStorage.setItem("cookie_consent_date", new Date().toISOString());
    setShow(false);
  };

  if (!show || !loaded) return null;

  // ── Hors-UE : notice discrète ────────────────────────────────────────────────
  if (!restricted) {
    return (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[1000] w-[94%] max-w-xl animate-slide-up">
        <div className="flex items-center gap-3 bg-slate-900/95 border border-slate-800 backdrop-blur-xl rounded-2xl px-4 py-3 shadow-xl">
          <span className="text-lg">🍪</span>
          <p className="flex-1 text-xs sm:text-sm text-slate-300 leading-snug">
            Nous utilisons des cookies pour améliorer votre expérience.{" "}
            <a
              href="/api/legal/cookie-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline"
            >
              En savoir plus
            </a>
          </p>
          <Button
            onClick={() => setConsent("accepted")}
            size="sm"
            className="flex-shrink-0 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 h-8 text-xs font-semibold"
          >
            OK
          </Button>
        </div>
      </div>
    );
  }

  // ── UE : bandeau RGPD complet ────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[999]" />
      <div className="fixed bottom-0 left-0 right-0 z-[1000] animate-slide-up">
        <div className="bg-slate-900/98 border-t border-slate-800 backdrop-blur-xl shadow-2xl">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-cyan-500/10 rounded-full flex items-center justify-center">
                  <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-cyan-500" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-sm sm:text-base font-semibold text-white mb-1">
                  🍪 Nous respectons votre vie privée
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Nous utilisons uniquement des{" "}
                  <strong>cookies essentiels</strong> pour le fonctionnement du
                  site (connexion, préférences).
                  <span className="hidden sm:inline">
                    {" "}
                    Pas de cookies publicitaires ni de tracking tiers.
                  </span>
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <a
                    href="/api/legal/cookie-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Politique des cookies
                  </a>
                  <span className="text-slate-600">•</span>
                  <a
                    href="/api/legal/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    {t("privacy")}
                  </a>
                </div>
              </div>

              <div className="flex gap-2 sm:gap-3 w-full sm:w-auto flex-shrink-0">
                <Button
                  onClick={() => setConsent("rejected")}
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-initial border-slate-700 text-slate-300 hover:bg-slate-800 h-9 sm:h-10 text-xs sm:text-sm"
                >
                  Refuser
                </Button>
                <Button
                  onClick={() => setConsent("accepted")}
                  size="sm"
                  className="flex-1 sm:flex-initial bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 h-9 sm:h-10 text-xs sm:text-sm font-semibold"
                >
                  Accepter
                </Button>
              </div>
            </div>

            <button
              onClick={() => setConsent("rejected")}
              className="absolute top-2 right-2 sm:hidden p-2 text-slate-400 hover:text-white transition-colors"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
