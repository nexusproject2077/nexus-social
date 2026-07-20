// Contexte géographique : distingue les visiteurs UE (restreints : pas de pubs
// ni de tracking, bandeau RGPD complet) des visiteurs hors-UE (accès complet).
import { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";

const GeoContext = createContext({ restricted: false, country: null, loaded: false });

export function GeoProvider({ children }) {
  const [geo, setGeo] = useState({ restricted: false, country: null, loaded: false });

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API}/geo/status`)
      .then((res) => {
        if (cancelled) return;
        setGeo({
          restricted: !!res.data?.restricted,
          country: res.data?.country || null,
          loaded: true,
        });
      })
      .catch(() => {
        // En cas d'échec : non-restreint (fail-open), comme le backend.
        if (!cancelled) setGeo({ restricted: false, country: null, loaded: true });
      });
    return () => { cancelled = true; };
  }, []);

  return <GeoContext.Provider value={geo}>{children}</GeoContext.Provider>;
}

export function useGeo() {
  return useContext(GeoContext);
}
