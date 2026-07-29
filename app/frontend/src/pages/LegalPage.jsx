import { useNavigate } from "react-router-dom";

// Pages légales PUBLIQUES (accessibles sans connexion) : Conditions d'utilisation
// (CGU) et Politique de confidentialité. Les processeurs de paiement (Stripe) et
// les magasins d'applications exigent que ces pages soient publiquement visibles.
// ⚠️ Ce sont des textes de base : fais-les relire par un juriste avant un usage
// commercial à grande échelle.

const CONTACT_EMAIL = "support@nexus-social.app";
const SITE = "Nexus Social";

const CGU = [
  ["1. Objet", `Les présentes conditions régissent l'utilisation de ${SITE}, un réseau social permettant de publier du contenu (textes, photos, vidéos, clips, stories), d'échanger des messages, de diffuser des directs et de soutenir des créateurs. En créant un compte, vous acceptez ces conditions.`],
  ["2. Compte", `Vous devez avoir au moins 15 ans (ou l'âge légal applicable) et fournir des informations exactes. Vous êtes responsable de la confidentialité de vos identifiants et de l'activité sur votre compte.`],
  ["3. Contenu et modération", `Vous restez propriétaire de vos contenus mais accordez à ${SITE} une licence pour les héberger et les afficher dans le cadre du service. Sont interdits : contenus illégaux, haineux, violents, pornographiques, portant atteinte aux droits d'autrui ou au harcèlement. Les contenus sont modérés automatiquement (détection + retrait) et peuvent être supprimés ; les comptes contrevenants peuvent être suspendus.`],
  ["4. Nexus Premium (abonnement)", `Nexus Premium est un abonnement payant à renouvellement automatique donnant accès à des avantages (sans publicité, badge, priorité dans le fil, épinglage, stories prolongées, et fonctionnalités ajoutées au fil du temps). Le tarif est indiqué avant l'achat sur la page « Devenir Premium » et à l'étape de paiement. Le paiement est traité par Stripe. Vous pouvez résilier à tout moment depuis vos paramètres ; l'accès reste actif jusqu'à la fin de la période déjà payée.`],
  ["5. Cadeaux et soutien aux créateurs", `Les utilisateurs peuvent acheter des cadeaux virtuels pour soutenir des créateurs pendant leurs directs. Les sommes sont reversées aux créateurs via Stripe Connect après déduction de la commission de la plateforme. Les cadeaux sont des paiements volontaires et non remboursables, sauf obligation légale.`],
  ["6. Droit de rétractation", `Conformément à la réglementation applicable, en démarrant l'accès à un contenu ou service numérique immédiatement, vous pouvez renoncer à votre droit de rétractation de 14 jours. Les détails sont rappelés au moment de l'achat.`],
  ["7. Responsabilité", `Le service est fourni « en l'état ». ${SITE} ne saurait être tenu responsable des contenus publiés par les utilisateurs ni des interruptions temporaires du service.`],
  ["8. Modification et résiliation", `Nous pouvons faire évoluer ces conditions ; les changements importants seront signalés. Vous pouvez supprimer votre compte à tout moment.`],
  ["9. Contact", `Pour toute question : ${CONTACT_EMAIL}.`],
];

const PRIVACY = [
  ["1. Données collectées", `Nous collectons : les informations de compte (nom d'utilisateur, e-mail), les contenus que vous publiez, les interactions (likes, abonnements, messages), des données techniques (adresse IP, type d'appareil) et, pour les abonnés, les informations de facturation gérées par Stripe (nous ne stockons jamais vos numéros de carte).`],
  ["2. Utilisation", `Les données servent à : faire fonctionner le service, personnaliser le fil, assurer la sécurité et la modération, traiter les paiements et abonnements, et respecter nos obligations légales.`],
  ["3. Partage", `Nous partageons des données uniquement avec les prestataires nécessaires au service (hébergement, paiement via Stripe, stockage média via Firebase/Google Cloud). Nous ne vendons pas vos données personnelles.`],
  ["4. Modération et contenu", `Les contenus médias peuvent être analysés automatiquement (détection de contenus interdits) au moment de la publication. Les contenus signalés peuvent être examinés puis supprimés.`],
  ["5. Conservation", `Vos données sont conservées tant que votre compte est actif. À la suppression du compte, elles sont effacées ou anonymisées, sauf obligation légale de conservation.`],
  ["6. Vos droits (RGPD)", `Vous disposez d'un droit d'accès, de rectification, d'effacement, de portabilité et d'opposition. Vous pouvez exercer ces droits depuis vos paramètres ou en écrivant à ${CONTACT_EMAIL}.`],
  ["7. Cookies", `Nous utilisons des cookies techniques et, avec votre consentement, des cookies de mesure/publicité. Vous pouvez gérer votre consentement à tout moment.`],
  ["8. Sécurité", `Nous mettons en œuvre des mesures raisonnables pour protéger vos données. Aucun système n'étant infaillible, nous vous invitons à utiliser un mot de passe robuste.`],
  ["9. Contact", `Pour toute question relative à vos données : ${CONTACT_EMAIL}.`],
];

export default function LegalPage({ kind = "cgu" }) {
  const navigate = useNavigate();
  const isCGU = kind === "cgu";
  const title = isCGU ? "Conditions d'utilisation" : "Politique de confidentialité";
  const sections = isCGU ? CGU : PRIVACY;

  return (
    <div className="min-h-screen" style={{ background: "#0b1326", color: "#dae2fd" }}>
      <header className="flex items-center gap-3 px-4 h-14 border-b sticky top-0" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(11,19,38,0.9)", backdropFilter: "blur(16px)" }}>
        <button onClick={() => navigate(-1)} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full hover:bg-white/5">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <span className="font-bold">{title}</span>
      </header>

      <div className="max-w-2xl mx-auto px-5 py-8">
        <h1 className="text-2xl font-black mb-1" style={{ fontFamily: "Space Grotesk, sans-serif" }}>{title}</h1>
        <p className="text-xs mb-6" style={{ color: "#859397" }}>Dernière mise à jour : juillet 2026</p>

        <div className="space-y-5">
          {sections.map(([h, body]) => (
            <section key={h}>
              <h2 className="font-bold text-sm mb-1" style={{ color: "#22d3ee" }}>{h}</h2>
              <p className="text-sm leading-relaxed" style={{ color: "#bbc9cd" }}>{body}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 flex gap-4 text-xs" style={{ color: "#859397" }}>
          <button onClick={() => navigate("/cgu")} className="hover:underline">Conditions d'utilisation</button>
          <button onClick={() => navigate("/confidentialite")} className="hover:underline">Confidentialité</button>
          <button onClick={() => navigate("/premium")} className="hover:underline">Nexus Premium</button>
        </div>
      </div>
    </div>
  );
}
