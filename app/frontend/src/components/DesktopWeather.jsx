import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API } from "@/App";

const REFRESH_MS = 10 * 60 * 1000;

const weatherIcon = (condition, isDay) => {
  if (!isDay && ["clear", "partly"].includes(condition)) return "dark_mode";
  return {
    clear: "sunny",
    partly: "partly_cloudy_day",
    cloudy: "cloud",
    fog: "foggy",
    drizzle: "rainy_light",
    rain: "rainy",
    snow: "weather_snowy",
    storm: "thunderstorm",
  }[condition] || "partly_cloudy_day";
};

// Carte météo réservée au bureau. Elle utilise exactement la même route et la
// même ville configurée que le widget mobile, avec une actualisation toutes les
// dix minutes. Sans ville choisie, la géolocalisation du navigateur est utilisée.
export default function DesktopWeather({ user }) {
  const [weather, setWeather] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const city = useMemo(() => {
    const saved = user?.widget_stack_config?.weather_city;
    return saved && typeof saved === "object" ? saved : null;
  }, [user?.widget_stack_config?.weather_city]);
  const cityKey = city ? `${city.lat},${city.lon}` : "auto";

  useEffect(() => {
    let active = true;
    let timer;
    const load = (lat, lon) => axios.get(`${API}/weather`, { params: { lat, lon } })
      .then((res) => { if (active) setWeather(res.data?.weather || null); })
      .catch(() => { if (active) setWeather(null); });
    const refresh = () => {
      if (city && Number.isFinite(Number(city.lat)) && Number.isFinite(Number(city.lon))) {
        setLocationDenied(false);
        load(city.lat, city.lon);
        return;
      }
      if (!navigator.geolocation) {
        if (active) setLocationDenied(true);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => { if (active) { setLocationDenied(false); load(position.coords.latitude, position.coords.longitude); } },
        () => { if (active) setLocationDenied(true); },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: REFRESH_MS },
      );
    };
    refresh();
    timer = window.setInterval(refresh, REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [city, cityKey]);

  const iconColor = weather?.is_day ? "#fbbf24" : "#93c5fd";
  return (
    <section className="rounded-2xl p-5" style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-headline font-bold text-lg tracking-tight" style={{ color: "#dae2fd" }}>Météo</h2>
        <span className="material-symbols-outlined" style={{ color: iconColor, fontSize: 20 }}>{weatherIcon(weather?.cond, weather?.is_day)}</span>
      </div>
      {weather ? (
        <div className="flex items-center gap-4">
          <span className="font-extralight leading-none" style={{ color: "#f4f8ff", fontSize: 44 }}>
            {weather.temp != null ? weather.temp : "--"}°
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "#dae2fd" }}>{weather.location || city?.name || "Ma position"}</p>
            <p className="text-[11px] truncate" style={{ color: "#8b96a8" }}>
              {weather.label}{weather.feels_like != null && ` · ressenti ${weather.feels_like}°`}{weather.humidity != null && ` · ${weather.humidity}%`}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "#859397" }}>
          {locationDenied ? "Autorisez la localisation pour afficher la météo." : "Mise à jour de la météo…"}
        </p>
      )}
    </section>
  );
}
