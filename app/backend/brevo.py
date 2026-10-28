# app/backend/brevo.py - Emails transactionnels (Brevo / ex-Sendinblue)
#
# La clé API vient UNIQUEMENT d'une variable d'environnement (jamais en dur).
# Si BREVO_API_KEY est absente (ou le SDK non installé), l'envoi est un no-op :
# aucune erreur, aucun email — l'app fonctionne normalement.

import os

try:
    import sib_api_v3_sdk
except ImportError:
    sib_api_v3_sdk = None

BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
SENDER_EMAIL = os.environ.get("BREVO_SENDER_EMAIL", "noreply@nexussocial.com")
SENDER_NAME = os.environ.get("BREVO_SENDER_NAME", "Nexus Social")

EMAIL_ENABLED = bool(BREVO_API_KEY) and sib_api_v3_sdk is not None

_api_instance = None
if EMAIL_ENABLED:
    _config = sib_api_v3_sdk.Configuration()
    _config.api_key["api-key"] = BREVO_API_KEY
    _api_instance = sib_api_v3_sdk.TransactionalEmailsApi(
        sib_api_v3_sdk.ApiClient(_config)
    )
    print("✅ Brevo activé (emails transactionnels)")
elif sib_api_v3_sdk is None:
    print("ℹ️ Brevo indisponible (sib-api-v3-sdk non installé) — aucun email envoyé")
else:
    print("ℹ️ Brevo désactivé (BREVO_API_KEY absente) — aucun email envoyé")


def send_email(to_email: str, subject: str, html_content: str) -> bool:
    """Envoi best-effort d'un email transactionnel. Ne lève jamais d'exception
    (les échecs email ne doivent pas casser l'action métier)."""
    if not EMAIL_ENABLED or not to_email:
        return False
    try:
        message = sib_api_v3_sdk.SendSmtpEmail(
            to=[{"email": to_email}],
            sender={"email": SENDER_EMAIL, "name": SENDER_NAME},
            subject=subject,
            html_content=html_content,
        )
        _api_instance.send_transac_email(message)
        return True
    except Exception as e:  # noqa: BLE001 - best-effort
        print(f"⚠️ Brevo: échec d'envoi à {to_email}: {e}")
        return False
