"""
Exemple d'intégration Stripe Connect (API **V2** — nouvelle API `accounts`).

Ce module est un **échantillon autonome** monté sous /connect-sample. Il montre,
de bout en bout :
  1) l'onboarding de comptes connectés (V2 accounts + V2 account links),
  2) la lecture du statut d'onboarding **directement via l'API** (pas de DB),
  3) la création de **produits au niveau plateforme** (mappés à un compte connecté
     via les metadata),
  4) une **vitrine (storefront)** listant produits + comptes connectés,
  5) l'encaissement via **Destination Charge** avec **application fee** (commission
     plateforme), en Checkout hébergé,
  6) un **webhook « thin events »** pour réagir aux changements d'exigences (V2).

Toutes les requêtes passent par un **Stripe Client** (`StripeClient`).
La version d'API est gérée automatiquement par le SDK (dernière version preview
`2026-06-24.dahlia`), il n'y a donc rien à fixer.

⚠️ Nécessite un SDK Stripe récent (V2 core) — voir requirements (`stripe>=12`).
"""

import os
from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, PlainTextResponse

# Le SDK est optionnel : s'il manque, on renvoie une erreur claire plutôt que de
# planter au démarrage.
try:
    from stripe import StripeClient
except Exception:  # SDK absent ou trop ancien
    StripeClient = None

# ─────────────────────────────────────────────────────────────────────────────
# Configuration / Stripe Client
# ─────────────────────────────────────────────────────────────────────────────
# TODO(à renseigner) : votre clé secrète Stripe (mode test `sk_test_...` ou live
# `sk_live_...`). À définir dans la variable d'environnement STRIPE_SECRET_KEY.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")

# TODO(à renseigner) : le secret de signature de votre endpoint webhook
# (`whsec_...`), fourni par le Dashboard Stripe ou la CLI `stripe listen`.
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_CONNECT_SAMPLE_WEBHOOK_SECRET", os.environ.get("STRIPE_WEBHOOK_SECRET", ""))

# Commission de la plateforme prélevée sur chaque vente (%). La plateforme est
# « fees_collector » et « losses_collector » (voir la création de compte).
PLATFORM_FEE_PERCENT = int(os.environ.get("PLATFORM_FEE_PERCENT", "10"))

# On instancie un unique Stripe Client réutilisé pour TOUTES les requêtes.
_client = None
if StripeClient and STRIPE_SECRET_KEY:
    # Astuce : on crée le client avec la clé secrète. Ne PAS fixer la version
    # d'API — le SDK utilise automatiquement la bonne (dernière preview).
    _client = StripeClient(STRIPE_SECRET_KEY)


class SampleConfigError(Exception):
    """Erreur de configuration (clé absente / SDK trop ancien)."""


def get_client():
    """Renvoie le Stripe Client ou lève une erreur explicite si mal configuré."""
    if StripeClient is None:
        raise SampleConfigError(
            "Le SDK Stripe (V2) est introuvable ou trop ancien. Installez-le : "
            "`pip install --upgrade stripe` (voir https://github.com/stripe/stripe-python/releases)."
        )
    if not STRIPE_SECRET_KEY:
        raise SampleConfigError(
            "STRIPE_SECRET_KEY est absente. Définissez la variable d'environnement "
            "STRIPE_SECRET_KEY (ex. `sk_test_...`) puis redémarrez le serveur."
        )
    return _client


router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# Petits utilitaires
# ─────────────────────────────────────────────────────────────────────────────
def _base(request: Request) -> str:
    """URL de base publique (déduite de la requête) pour les URLs de retour."""
    return str(request.base_url).rstrip("/")


def _to_dict(obj):
    """Convertit un objet Stripe en dict (support .to_dict / dict / tel quel)."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        try:
            return obj.to_dict()
        except Exception:
            pass
    return obj


def _deep_get(d, *keys, default=None):
    """Accès imbriqué sûr : _deep_get(acc, 'configuration', 'recipient', ...)."""
    cur = _to_dict(d)
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        cur = _to_dict(cur)
    return cur if cur is not None else default


def _account_status(account) -> dict:
    """Dérive l'état d'onboarding d'un compte V2 (comme la doc Connect V2)."""
    # La capacité de recevoir des virements est-elle active ?
    ready = _deep_get(
        account, "configuration", "recipient", "capabilities",
        "stripe_balance", "stripe_transfers", "status",
    ) == "active"
    # État des exigences (KYC) : « currently_due » / « past_due » = incomplet.
    req_status = _deep_get(account, "requirements", "summary", "minimum_deadline", "status")
    onboarding_complete = req_status not in ("currently_due", "past_due")
    return {"ready_to_receive": bool(ready), "onboarding_complete": bool(onboarding_complete), "requirements_status": req_status}


# ─────────────────────────────────────────────────────────────────────────────
# Gabarit HTML (style sombre, proche de l'app : navy + cyan)
# ─────────────────────────────────────────────────────────────────────────────
def _page(title: str, body: str) -> HTMLResponse:
    html = f"""<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Nexus Connect (démo)</title>
<style>
  :root {{ --bg:#0b1326; --card:#171f33; --line:rgba(255,255,255,.08); --cyan:#22d3ee; --text:#dae2fd; --muted:#859397; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }}
  .wrap {{ max-width:820px; margin:0 auto; padding:24px 16px 64px; }}
  h1 {{ font-size:22px; font-weight:800; letter-spacing:-.02em; }}
  h2 {{ font-size:15px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); margin:28px 0 10px; }}
  a {{ color:var(--cyan); text-decoration:none; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin-bottom:12px; }}
  label {{ display:block; font-size:12px; color:var(--muted); margin:8px 0 4px; }}
  input, select, textarea {{ width:100%; background:#0f1728; border:1px solid var(--line); color:var(--text); border-radius:10px; padding:10px 12px; font-size:14px; outline:none; }}
  .row {{ display:flex; gap:10px; flex-wrap:wrap; }} .row > * {{ flex:1; min-width:160px; }}
  button, .btn {{ display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg,#22d3ee,#3b82f6); color:#00363e; font-weight:800; border:0; border-radius:999px; padding:10px 16px; font-size:14px; cursor:pointer; text-decoration:none; }}
  .btn.ghost {{ background:#222a3d; color:var(--cyan); }}
  .pill {{ display:inline-block; font-size:11px; font-weight:800; padding:3px 8px; border-radius:999px; }}
  .ok {{ background:rgba(34,211,238,.15); color:var(--cyan); }} .warn {{ background:rgba(251,191,36,.15); color:#fbbf24; }}
  .muted {{ color:var(--muted); font-size:12px; }}
  .between {{ display:flex; align-items:center; justify-content:space-between; gap:12px; }}
  .price {{ font-weight:800; }}
  nav a {{ margin-right:16px; font-weight:700; }}
</style></head><body><div class="wrap">
<nav><a href="/connect-sample/">Tableau de bord</a><a href="/connect-sample/storefront">Boutique</a></nav>
{body}
</div></body></html>"""
    return HTMLResponse(html)


def _error_page(e: Exception) -> HTMLResponse:
    return _page("Erreur", f"""<h1>Configuration incomplète</h1>
      <div class="card"><p style="color:#fbbf24">⚠️ {str(e)}</p>
      <p class="muted">Renseignez les variables d'environnement puis rechargez cette page.</p></div>""")


# ─────────────────────────────────────────────────────────────────────────────
# 1) Tableau de bord : créer un compte, voir le statut, créer un produit
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/connect-sample/", response_class=HTMLResponse)
async def dashboard(request: Request):
    try:
        client = get_client()
    except SampleConfigError as e:
        return _error_page(e)

    # On récupère TOUJOURS le statut depuis l'API (pas de stockage local).
    accounts_html = ""
    account_options = ""
    try:
        # include => on demande à Stripe d'inclure la config recipient + requirements.
        listing = client.v2.core.accounts.list(
            params={"include": ["configuration.recipient", "requirements"]}
        )
        data = getattr(listing, "data", None) or _to_dict(listing).get("data", []) or []
        for acc in data:
            acc_d = _to_dict(acc)
            acc_id = acc_d.get("id")
            name = acc_d.get("display_name") or "(sans nom)"
            st = _account_status(acc)
            badge = ('<span class="pill ok">Prêt à encaisser</span>'
                     if st["ready_to_receive"] else
                     '<span class="pill warn">Onboarding requis</span>')
            accounts_html += f"""<div class="card"><div class="between">
                <div><b>{name}</b><div class="muted">{acc_id}</div></div>{badge}</div>
                <div style="margin-top:10px" class="row">
                  <a class="btn" href="/connect-sample/accounts/{acc_id}/onboard">Onboarder pour encaisser</a>
                  <a class="btn ghost" href="/connect-sample/accounts/{acc_id}/status" target="_blank">Voir le statut (API)</a>
                </div></div>"""
            if st["ready_to_receive"]:
                account_options += f'<option value="{acc_id}">{name} — {acc_id}</option>'
    except Exception as e:
        accounts_html = f'<div class="card"><p style="color:#fbbf24">Impossible de lister les comptes : {e}</p></div>'

    body = f"""
    <h1>Nexus Connect — démo (API V2)</h1>
    <p class="muted">Plateforme responsable du prix et de la collecte des frais (fees_collector / losses_collector = application).</p>

    <h2>Créer un compte connecté</h2>
    <form class="card" method="post" action="/connect-sample/accounts">
      <div class="row">
        <div><label>Nom affiché</label><input name="display_name" placeholder="Boutique de Léa" required></div>
        <div><label>Email de contact</label><input name="contact_email" type="email" placeholder="lea@example.com" required></div>
      </div>
      <div style="margin-top:12px"><button type="submit">Créer le compte connecté</button></div>
    </form>

    <h2>Comptes connectés</h2>
    {accounts_html or '<div class="card"><p class="muted">Aucun compte pour le moment.</p></div>'}

    <h2>Créer un produit (niveau plateforme)</h2>
    <form class="card" method="post" action="/connect-sample/products">
      <div class="row">
        <div><label>Nom</label><input name="name" placeholder="T-shirt Nexus" required></div>
        <div><label>Prix (en centimes)</label><input name="price_cents" type="number" min="50" value="1999" required></div>
      </div>
      <label>Description</label><input name="description" placeholder="Coton bio, sérigraphie">
      <label>Vendeur (compte connecté prêt à encaisser)</label>
      <select name="account_id" required>{account_options or '<option value="" disabled>— aucun compte prêt —</option>'}</select>
      <div style="margin-top:12px"><button type="submit">Créer le produit</button></div>
      <p class="muted" style="margin-top:8px">Le produit est créé au niveau plateforme ; le compte vendeur est stocké dans ses <b>metadata</b>.</p>
    </form>

    <p style="margin-top:16px"><a class="btn" href="/connect-sample/storefront">Ouvrir la boutique →</a></p>
    """
    return _page("Tableau de bord", body)


# ─────────────────────────────────────────────────────────────────────────────
# 2) Création d'un compte connecté (API V2 — surtout PAS de type top-level)
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/connect-sample/accounts")
async def create_account(request: Request, display_name: str = Form(...), contact_email: str = Form(...)):
    try:
        client = get_client()
    except SampleConfigError as e:
        return _error_page(e)
    try:
        account = client.v2.core.accounts.create(params={
            "display_name": display_name,
            "contact_email": contact_email,
            "identity": {"country": "us"},          # pays de l'entité
            "dashboard": "express",                  # dashboard Express géré par Stripe
            "defaults": {
                "responsibilities": {
                    # La plateforme collecte les frais ET assume les pertes.
                    "fees_collector": "application",
                    "losses_collector": "application",
                },
            },
            "configuration": {
                "recipient": {
                    "capabilities": {
                        "stripe_balance": {
                            "stripe_transfers": {"requested": True},  # peut recevoir des virements
                        },
                    },
                },
            },
        })
        # 💡 En prod : ici, on stockerait la correspondance utilisateur → account.id
        # dans la base de données (ex. db.users.update({...}, {"stripe_account_id": account.id})).
        _ = _to_dict(account).get("id")
        return RedirectResponse(url="/connect-sample/", status_code=303)
    except Exception as e:
        return _error_page(Exception(f"Création du compte échouée : {e}"))


# ─────────────────────────────────────────────────────────────────────────────
# 3) Onboarding via Account Link (API V2)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/connect-sample/accounts/{account_id}/onboard")
async def onboard(request: Request, account_id: str):
    try:
        client = get_client()
    except SampleConfigError as e:
        return _error_page(e)
    base = _base(request)
    try:
        link = client.v2.core.account_links.create(params={
            "account": account_id,
            "use_case": {
                "type": "account_onboarding",
                "account_onboarding": {
                    "configurations": ["recipient"],
                    "refresh_url": f"{base}/connect-sample/accounts/{account_id}/onboard",
                    "return_url": f"{base}/connect-sample/?accountId={account_id}",
                },
            },
        })
        url = _to_dict(link).get("url") or getattr(link, "url", None)
        return RedirectResponse(url=url, status_code=303)
    except Exception as e:
        return _error_page(Exception(f"Création du lien d'onboarding échouée : {e}"))


# ─────────────────────────────────────────────────────────────────────────────
# 4) Statut d'un compte — TOUJOURS lu directement depuis l'API
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/connect-sample/accounts/{account_id}/status")
async def account_status(request: Request, account_id: str):
    try:
        client = get_client()
    except SampleConfigError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    try:
        account = client.v2.core.accounts.retrieve(
            account_id, params={"include": ["configuration.recipient", "requirements"]}
        )
        return JSONResponse(_account_status(account))
    except Exception as e:
        return JSONResponse({"error": f"{e}"}, status_code=502)


# ─────────────────────────────────────────────────────────────────────────────
# 5) Création de produit au niveau plateforme (mapping via metadata)
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/connect-sample/products")
async def create_product(request: Request, name: str = Form(...), price_cents: int = Form(...),
                         account_id: str = Form(...), description: str = Form("")):
    try:
        client = get_client()
    except SampleConfigError as e:
        return _error_page(e)
    try:
        client.products.create(params={
            "name": name,
            "description": description or None,
            "default_price_data": {"unit_amount": int(price_cents), "currency": "eur"},
            # 🔗 Mapping produit → compte connecté vendeur (aucune DB nécessaire).
            "metadata": {"connected_account_id": account_id},
        })
        return RedirectResponse(url="/connect-sample/storefront", status_code=303)
    except Exception as e:
        return _error_page(Exception(f"Création du produit échouée : {e}"))


# ─────────────────────────────────────────────────────────────────────────────
# 6) Boutique : liste des produits + comptes, achat via Checkout
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/connect-sample/storefront", response_class=HTMLResponse)
async def storefront(request: Request):
    try:
        client = get_client()
    except SampleConfigError as e:
        return _error_page(e)

    cards = ""
    try:
        products = client.products.list(params={"active": True, "limit": 100, "expand": ["data.default_price"]})
        data = getattr(products, "data", None) or _to_dict(products).get("data", []) or []
        for p in data:
            pd = _to_dict(p)
            price = _to_dict(pd.get("default_price"))
            amount = price.get("unit_amount")
            currency = (price.get("currency") or "eur").upper()
            seller = _deep_get(pd, "metadata", "connected_account_id")
            if not amount or not seller:
                continue  # produit non vendable dans cette démo
            pretty = f"{amount/100:.2f} {currency}"
            cards += f"""<div class="card"><div class="between">
                <div><b>{pd.get('name')}</b><div class="muted">{pd.get('description') or ''}</div>
                <div class="muted">Vendeur : {seller}</div></div>
                <div style="text-align:right"><div class="price">{pretty}</div>
                <form method="post" action="/connect-sample/checkout" style="margin-top:8px">
                  <input type="hidden" name="product_id" value="{pd.get('id')}">
                  <button type="submit">Acheter</button>
                </form></div></div></div>"""
    except Exception as e:
        cards = f'<div class="card"><p style="color:#fbbf24">Impossible de lister les produits : {e}</p></div>'

    body = f"""<h1>Boutique Nexus (démo)</h1>
      <p class="muted">Paiement via <b>Destination Charge</b> : la plateforme encaisse, prélève {PLATFORM_FEE_PERCENT}% de commission, et reverse le reste au vendeur.</p>
      {cards or '<div class="card"><p class="muted">Aucun produit en vente.</p></div>'}"""
    return _page("Boutique", body)


# ─────────────────────────────────────────────────────────────────────────────
# 7) Paiement : Checkout hébergé + Destination Charge + application fee
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/connect-sample/checkout")
async def checkout(request: Request, product_id: str = Form(...)):
    try:
        client = get_client()
    except SampleConfigError as e:
        return _error_page(e)
    base = _base(request)
    try:
        # On relit le produit pour connaître le prix (fee) et le vendeur (destination).
        product = client.products.retrieve(product_id, params={"expand": ["default_price"]})
        pd = _to_dict(product)
        price = _to_dict(pd.get("default_price"))
        price_id = price.get("id")
        amount = int(price.get("unit_amount") or 0)
        seller_account = _deep_get(pd, "metadata", "connected_account_id")
        if not (price_id and amount and seller_account):
            return _error_page(Exception("Produit non vendable (prix ou vendeur manquant)."))

        fee = round(amount * PLATFORM_FEE_PERCENT / 100)  # commission plateforme

        session = client.checkout.sessions.create(params={
            "line_items": [{"price": price_id, "quantity": 1}],
            "payment_intent_data": {
                "application_fee_amount": fee,                      # part plateforme
                "transfer_data": {"destination": seller_account},   # reversement au vendeur
            },
            "mode": "payment",
            "success_url": f"{base}/connect-sample/success?session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{base}/connect-sample/storefront",
        })
        url = _to_dict(session).get("url") or getattr(session, "url", None)
        return RedirectResponse(url=url, status_code=303)
    except Exception as e:
        return _error_page(Exception(f"Création du paiement échouée : {e}"))


@router.get("/connect-sample/success", response_class=HTMLResponse)
async def success(request: Request, session_id: str = ""):
    return _page("Merci", f"""<h1>Paiement réussi ✅</h1>
      <div class="card"><p>Merci pour votre achat !</p>
      <p class="muted">Session : {session_id}</p>
      <a class="btn" href="/connect-sample/storefront">Retour à la boutique</a></div>""")


# ─────────────────────────────────────────────────────────────────────────────
# 8) Webhook « thin events » (V2) : réagir aux changements d'exigences
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/connect-sample/webhook")
async def webhook(request: Request):
    """Réception des thin events V2. Configurez un endpoint (Dashboard → Webhooks,
    payload « Thin », événements « Connected accounts ») pointant ici, avec les types :
      - v2.core.account[requirements].updated
      - v2.core.account[configuration.recipient].capability_status_updated
    """
    try:
        client = get_client()
    except SampleConfigError as e:
        return PlainTextResponse(str(e), status_code=500)
    if not STRIPE_WEBHOOK_SECRET:
        return PlainTextResponse(
            "STRIPE_(CONNECT_SAMPLE_)WEBHOOK_SECRET absent : impossible de vérifier la signature.",
            status_code=400,
        )
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        # Les événements V2 sont « thin » : on vérifie la signature puis on récupère
        # l'événement complet via l'API pour connaître les détails.
        thin_event = client.parse_thin_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        return PlainTextResponse("Signature invalide", status_code=400)

    try:
        event = client.v2.core.events.retrieve(thin_event.id)
        etype = getattr(event, "type", None) or _to_dict(event).get("type")

        if etype == "v2.core.account[requirements].updated":
            # Les exigences (KYC) ont changé : on relit le compte pour voir ce qui
            # reste dû et prévenir le vendeur si besoin.
            account_id = _deep_get(_to_dict(event), "related_object", "id")
            if account_id:
                acc = client.v2.core.accounts.retrieve(
                    account_id, params={"include": ["requirements", "configuration.recipient"]}
                )
                print("[connect-sample] requirements.updated", account_id, _account_status(acc))

        elif etype == "v2.core.account[configuration.recipient].capability_status_updated":
            # Une capacité (ex. stripe_transfers) est devenue active/inactive.
            account_id = _deep_get(_to_dict(event), "related_object", "id")
            print("[connect-sample] capability_status_updated", account_id)

        else:
            print("[connect-sample] événement reçu:", etype)
    except Exception as e:
        print("[connect-sample] erreur traitement webhook:", e)

    return PlainTextResponse("ok")
