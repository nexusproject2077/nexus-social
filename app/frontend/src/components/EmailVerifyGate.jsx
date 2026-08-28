// Gate BLOQUANT de vérification par email (remplace l'ancienne vérification
// d'identité). Tant que l'email n'est pas confirmé, l'accès est bloqué.
// Le code est envoyé par Brevo ; en l'absence d'envoi configuré, le backend
// renvoie le code (mode démo) pour rester testable.
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import { useTranslation, Trans } from "react-i18next";

const ACCENT =
  (typeof window !== "undefined" &&
    window.localStorage.getItem("nexus_accent")) ||
  "#22d3ee";
const IN = {
  background: "#131b2e",
  color: "#dae2fd",
  border: "1px solid #2a3550",
};

export default function EmailVerifyGate({ user, setUser }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const sentOnce = useRef(false);

  const send = async (silent = false) => {
    setSending(true);
    try {
      const r = await axios.post(`${API}/verify/email/send`);
      if (r.data?.dev_code)
        toast.message(t("emailverify.demo_code", { code: r.data.dev_code }), {
          description: t("emailverify.demo_desc"),
        });
      else if (!silent)
        toast.success(t("emailverify.code_sent", { email: user?.email }));
    } catch (e) {
      if (!silent)
        toast.error(e.response?.data?.detail || t("emailverify.send_failed"));
    } finally {
      setSending(false);
    }
  };

  // Envoi automatique du code au premier affichage.
  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    send(true);
    // eslint-disable-next-line
  }, []);

  const confirm = async () => {
    if (code.trim().length < 4) return toast.error(t("emailverify.enter_code"));
    setBusy(true);
    try {
      await axios.post(`${API}/verify/email/confirm`, { code: code.trim() });
      const me = await axios.get(`${API}/auth/me`);
      setUser && setUser(me.data);
      toast.success(t("emailverify.confirmed"));
    } catch (e) {
      toast.error(e.response?.data?.detail || t("emailverify.invalid_code"));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("nexus_user");
    } catch {
      /* ignore */
    }
    window.location.href = "/auth";
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(3,7,18,0.94)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6 my-auto"
        style={{
          background: "#0b1326",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="text-center mb-4">
          <span
            className="material-symbols-outlined text-4xl mb-1"
            style={{ color: ACCENT }}
          >
            mark_email_read
          </span>
          <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>
            {t("emailverify.title")}
          </h2>
          <p className="text-sm mt-1" style={{ color: "#859397" }}>
            <Trans
              i18nKey="emailverify.sent_to"
              values={{ email: user?.email }}
              components={{ b: <b style={{ color: "#dae2fd" }} /> }}
            />
          </p>
        </div>
        <input
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          inputMode="numeric"
          maxLength={6}
          placeholder={t("emailverify.placeholder")}
          className="w-full mb-3 px-4 py-3 rounded-2xl outline-none text-center text-lg tracking-[0.4em] font-bold"
          style={IN}
        />
        <button
          disabled={busy}
          onClick={confirm}
          className="w-full py-3 rounded-2xl font-black disabled:opacity-40"
          style={{ background: ACCENT, color: "#00363e" }}
        >
          {busy ? t("emailverify.verifying") : t("emailverify.confirm")}
        </button>
        <button
          disabled={sending}
          onClick={() => send(false)}
          className="w-full mt-2 py-2 text-xs font-bold disabled:opacity-40"
          style={{ color: ACCENT }}
        >
          {sending ? t("emailverify.sending") : t("emailverify.resend")}
        </button>
        <p
          className="text-center text-[11px] mt-3"
          style={{ color: "#5b6b8c" }}
        >
          {t("emailverify.spam_hint")}
          <button
            onClick={logout}
            className="ml-1 underline"
            style={{ color: "#859397" }}
          >
            {t("emailverify.logout")}
          </button>
        </p>
      </div>
    </div>
  );
}
