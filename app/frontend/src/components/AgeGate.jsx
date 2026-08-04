// Contrôle d'âge BLOQUANT pour les comptes existants (créés avant le contrôle à
// l'inscription). Loi française : réseaux sociaux interdits avant 15 ans.
// Tant que l'utilisateur n'a pas confirmé une date de naissance >= 15 ans, il ne
// peut pas utiliser l'app. Un mineur confirmé est bloqué et déconnecté.
import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";

export default function AgeGate({ setUser }) {
  const [birthdate, setBirthdate] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const logout = () => {
    try { localStorage.removeItem("token"); localStorage.removeItem("nexus_user"); } catch { /* ignore */ }
    window.location.href = "/auth";
  };

  const submit = async () => {
    if (!birthdate) return toast.error("Indique ta date de naissance.");
    // Garde-fou client (le backend reste l'autorité).
    const b = new Date(birthdate); const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    if (Number.isNaN(age)) return toast.error("Date invalide.");

    setBusy(true);
    try {
      await axios.post(`${API}/verify/age`, { birthdate });
      // Rafraîchit l'utilisateur (age_verified passe à true) → le gate disparaît.
      try {
        const me = await axios.get(`${API}/auth/me`);
        setUser && setUser(me.data);
      } catch { window.location.reload(); }
      toast.success("Merci, âge confirmé.");
    } catch (e) {
      if (e.response?.status === 403) {
        setBlocked(true); // mineur < 15 → bloqué
      } else {
        toast.error(e.response?.data?.detail || "Impossible d'enregistrer.");
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      style={{ background: "rgba(3,7,18,0.92)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: "#0b1326", border: "1px solid rgba(255,255,255,0.08)" }}>
        {blocked ? (
          <div className="text-center">
            <span className="material-symbols-outlined text-5xl mb-2" style={{ color: "#f87171" }}>block</span>
            <h2 className="font-black text-lg mb-2" style={{ color: "#dae2fd" }}>Accès non autorisé</h2>
            <p className="text-sm mb-5" style={{ color: "#859397" }}>
              La loi française interdit l'accès aux réseaux sociaux avant 15 ans. Ton compte a été suspendu.
            </p>
            <button onClick={logout} className="w-full py-3 rounded-2xl font-bold" style={{ background: "#171f33", color: "#dae2fd" }}>
              Se déconnecter
            </button>
          </div>
        ) : (
          <>
            <div className="text-center mb-4">
              <span className="material-symbols-outlined text-4xl mb-1" style={{ color: ACCENT }}>cake</span>
              <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>Confirme ton âge</h2>
              <p className="text-sm mt-1" style={{ color: "#859397" }}>
                Nouvelle obligation légale : indique ta date de naissance pour continuer à utiliser Nexus Social
                (âge minimum : 15 ans).
              </p>
            </div>
            <label className="text-[11px] font-bold uppercase tracking-widest ml-1" style={{ color: "#bbc9cd" }}>Date de naissance</label>
            <input
              type="date"
              value={birthdate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setBirthdate(e.target.value)}
              className="w-full mt-1 mb-4 px-4 py-3 rounded-2xl outline-none text-sm"
              style={{ background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550", colorScheme: "dark" }}
            />
            <button disabled={busy} onClick={submit} className="w-full py-3 rounded-2xl font-black disabled:opacity-40"
              style={{ background: ACCENT, color: "#00363e" }}>
              {busy ? "Vérification…" : "Confirmer"}
            </button>
            <p className="text-center text-[11px] mt-3" style={{ color: "#5b6b8c" }}>
              Ta date de naissance est chiffrée et jamais rendue publique (RGPD).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
