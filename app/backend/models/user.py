"""Schémas Pydantic — utilisateurs (inscription, connexion, profils).

Extraits de server.py à l'identique (refactor progressif, Phase 4).
"""
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    bio: Optional[str] = ""
    birthdate: Optional[str] = None  # AAAA-MM-JJ — requis (loi FR : >= 15 ans)
    # Compte privé PAR DÉFAUT (contrôle & vie privée) : seuls les abonnés
    # approuvés voient le contenu. Modifiable ensuite dans les réglages.
    is_private: Optional[bool] = True
    ref: Optional[str] = None  # code de parrainage (username du parrain) via ?ref=


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    email: str
    bio: str = ""
    profile_pic: Optional[str] = None
    cover_pic: Optional[str] = None     # bannière de couverture (façon X)
    followers_count: int = 0
    following_count: int = 0
    is_verified: bool = False           # badge « identité vérifiée » (pièce validée)
    is_premium: bool = False            # abonné Nexus Premium (badge + avantages réels)
    premium_until: Optional[str] = None  # fin d'abonnement (ISO) ; None si non abonné
    # Parrainage : chaque membre partage ?ref=<username>. referral_count = filleuls
    # inscrits ; referral_rewards = mois Premium déjà offerts (1 tous les 3) ;
    # referred_by = id du parrain.
    referral_count: int = 0
    referral_rewards: int = 0
    referred_by: Optional[str] = None
    # Croissance : préférences de notifications utiles + liste d'amis proches
    # (renvoyées dans /auth/me pour que les réglages survivent au rechargement).
    smart_notif_prefs: Dict[str, bool] = {}
    close_friends: List[str] = []
    is_admin: bool = False
    # Vérification d'identité (RGPD : on n'expose JAMAIS la pièce ni la date de
    # naissance en clair ; seuls des statuts/booléens sont renvoyés au client).
    verification_status: str = "unverified"  # unverified | pending | verified | rejected
    age_verified: bool = False          # >= 15 ans confirmé à l'inscription (loi FR)
    email_verified: bool = False
    phone_verified: bool = False
    twofa_enabled: bool = False         # double authentification (code email à la connexion)
    is_private: bool = False            # compte privé (abonnés approuvés uniquement)
    # Protection des mineurs (loi FR / éthique produit). `is_minor` est calculé à
    # partir de la date de naissance (< 18 ans). Il active : compte privé forcé,
    # filtrage des DM d'adultes, barrière anti-scroll (30 min), couvre-feu de nuit
    # et masquage des mots vulgaires. Les adultes gardent l'expérience complète.
    is_minor: bool = False
    # Limite de temps quotidienne configurable (minutes) — bien-être numérique.
    # None = pas de limite. `time_limit_enabled` permet de désactiver l'option.
    daily_time_limit: Optional[int] = None
    time_limit_enabled: bool = True
    show_sports: bool = True            # widget scores de foot en direct (désactivable)
    show_mma: bool = True               # cartes de combat MMA/UFC (désactivable)
    # Confidentialité messagerie (façon Instagram).
    show_active_status: bool = True     # affiche le point de présence + « dernière connexion » aux autres
    read_receipts: bool = True          # confirmation de lecture (« Vu ») ; si False, réciproque coupée
    hide_political: bool = False        # exclut les contenus politiques du fil (bien-être)
    widget_stack_config: Optional[dict] = None  # pile de widgets : {smart_rotate, order}
    privacy_strict: bool = False        # Mode Confidentialité stricte : coupe les
                                        # analytics non essentiels + les pubs ciblées
    muted_words: List[str] = []         # mots/phrases masqués (filtrés du fil + notifs)
    accent_color: Optional[str] = None
    theme: Optional[str] = None
    created_at: str


class UserProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    username: str
    bio: str = ""
    profile_pic: Optional[str] = None
    cover_pic: Optional[str] = None     # bannière de couverture (façon X)
    followers_count: int = 0
    following_count: int = 0
    is_following: bool = False
    is_verified: bool = False
    is_premium: bool = False  # membre Nexus Premium (badge + avantages)
    can_receive_tips: bool = False  # a un compte Stripe Connect → pourboire par carte
    paypal_receivable: bool = False  # PayPal Commerce activé → pourboire PayPal avec commission
    paypal_link: Optional[str] = None  # lien PayPal.me (repli sans commission)
    crypto_wallet: Optional[str] = None  # adresse de tips crypto (Solana/USDT…)
    created_at: str
