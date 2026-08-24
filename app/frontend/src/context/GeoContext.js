// Contexte géographique & CONFORMITÉ LÉGALE. Le backend (source de vérité) renvoie
// le profil complet du pays via /geo/status : bloc légal, mode « lecture seule »
// (RU/CN), style de consentement, âge minimum, etc. Le front ne fait qu'AFFICHER la
// bonne UI (bannières, écrans, mode consultation) — il n'ENFORCE rien de sensible.
import { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";

const DEFAULT_GEO = {
  loaded: false,
  country: null,
  block: "GLOBAL_STANDARD",
  consentStyle: "minimal",
  minAge: 15,
  restricted: false,      // rétro-compat (= eu)
  eu: false,
  readOnly: false,        // RU/CN : consultation seule
  readOnlyMessage: null,
  cookieBanner: false,
  consentScreen: false,   // APPI (Japon…)
  adTrackingDefault: true,
};

const GeoContext = createContext(DEFAULT_GEO);

export function GeoProvider({ children }) {
  const [geo, setGeo] = useState(DEFAULT_GEO);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API}/geo/status`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data || {};
        setGeo({
          loaded: true,
          country: d.country || null,
          block: d.block || "GLOBAL_STANDARD",
          consentStyle: d.consent_style || "minimal",
          minAge: d.min_age || 15,
          restricted: !!d.restricted,
          eu: !!d.eu,
          readOnly: !!d.read_only,
          readOnlyMessage: d.read_only_message || null,
          cookieBanner: !!d.cookie_banner,
          consentScreen: !!d.consent_screen,
          adTrackingDefault: d.ad_tracking_default !== false,
        });
      })
      .catch(() => {
        // Échec (ex. GeoIP absente) : profil neutre, aucune friction (fail-open).
        if (!cancelled) setGeo({ ...DEFAULT_GEO, loaded: true });
      });
    return () => { cancelled = true; };
  }, []);

  return <GeoContext.Provider value={geo}>{children}</GeoContext.Provider>;
}

export function useGeo() {
  return useContext(GeoContext);
}
