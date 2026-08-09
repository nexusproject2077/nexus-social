// Page FAQ — questions fréquentes, groupées par thème. Contenu entièrement
// visible (bon pour l'accessibilité et le référencement).
import { Link } from "react-router-dom";
import ContentLayout from "./ContentLayout";

const ACCENT = "#22d3ee";

const FAQ = [
  {
    cat: "Compte et inscription",
    items: [
      ["Nexus Social est-il gratuit ?", "Oui, la création d'un compte et l'utilisation des fonctionnalités principales de Nexus Social sont entièrement gratuites. Certaines options avancées ou de monétisation peuvent être payantes, mais l'expérience de base ne coûte rien."],
      ["Quel est l'âge minimum pour s'inscrire ?", "Conformément à la législation française, vous devez avoir au moins 15 ans pour créer un compte. L'âge est vérifié lors de l'inscription et les comptes ne respectant pas cette règle peuvent être suspendus."],
      ["Comment créer un compte ?", "Rendez-vous sur la page d'inscription, indiquez un nom d'utilisateur, une adresse email valide, votre date de naissance et un mot de passe. Vous recevrez un code par email pour confirmer votre adresse, puis votre compte sera activé."],
      ["J'ai oublié mon mot de passe, que faire ?", "Sur l'écran de connexion, utilisez le lien « Mot de passe oublié ? ». Vous recevrez un code par email qui vous permettra de définir un nouveau mot de passe en toute sécurité."],
      ["Comment supprimer mon compte ?", "Vous pouvez supprimer votre compte à tout moment depuis les paramètres. La suppression entraîne l'effacement ou l'anonymisation de vos données, sous réserve des obligations légales de conservation."],
    ],
  },
  {
    cat: "Publier et créer",
    items: [
      ["Quelle est la différence entre une publication, une Story et un Clip ?", "Une publication reste sur votre profil dans le temps. Une Story est éphémère et disparaît après 24 heures. Un Nexus Clip est une vidéo courte et verticale, pensée pour la découverte. Chaque format répond à un usage différent."],
      ["Combien de temps dure une Story ?", "Une Story reste visible pendant 24 heures, puis disparaît automatiquement. Vous pouvez en publier autant que vous le souhaitez."],
      ["Quelle est la taille maximale d'une vidéo pour un Clip ?", "L'import d'une vidéo de Clip est limité à 50 Mo. Pour des vidéos plus longues ou plus lourdes, un stockage vidéo dédié peut être configuré."],
      ["Puis-je modifier une publication après l'avoir postée ?", "Vous pouvez supprimer une publication à tout moment. Les possibilités de modification dépendent du type de contenu ; en cas de doute, il est parfois plus simple de republier."],
      ["Comment ajouter de la musique ou des stickers à une Story ?", "Dans l'éditeur de Story, appuyez sur l'outil Musique pour rechercher un extrait, et sur l'outil Stickers pour ajouter sondages, questions, mentions, hashtags, GIF, compte à rebours et bien plus. Tous les éléments se déplacent et s'agrandissent au doigt."],
    ],
  },
  {
    cat: "Confidentialité et sécurité",
    items: [
      ["Mes données sont-elles vendues à des tiers ?", "Non. Nexus Social ne vend jamais vos données personnelles. Vos informations sont traitées conformément au RGPD et les données sensibles sont chiffrées."],
      ["Comment rendre mon compte privé ?", "Dans les paramètres de confidentialité, vous pouvez passer votre compte en mode privé : seuls les abonnés que vous approuvez pourront voir vos contenus."],
      ["Qu'est-ce que la double authentification et comment l'activer ?", "La double authentification (2FA) ajoute un code de connexion envoyé par email à chaque connexion, en plus du mot de passe. Vous l'activez dans les paramètres, section Sécurité. C'est l'une des protections les plus efficaces."],
      ["Comment exercer mes droits RGPD ?", "Vous pouvez accéder à vos données, les corriger, les exporter ou les supprimer depuis le Centre de confidentialité, ou en écrivant à dpo@nexussocial.com. Nous répondons sous un mois."],
      ["Comment signaler ou bloquer quelqu'un ?", "Utilisez les options de signalement disponibles sur les profils et les contenus pour alerter notre équipe de modération. Le blocage, lui, coupe immédiatement tout contact avec la personne concernée."],
    ],
  },
  {
    cat: "Modération et communauté",
    items: [
      ["Quels contenus sont interdits ?", "Sont notamment interdits : les contenus illégaux, le harcèlement et les menaces, le spam et les faux comptes, les contenus sexuels non consentis, l'incitation à la haine ou à la violence, l'usurpation d'identité et la violation des droits d'auteur. Consultez nos règles de la communauté pour le détail."],
      ["Que se passe-t-il si je ne respecte pas les règles ?", "Selon la gravité, plusieurs mesures peuvent s'appliquer : avertissement et retrait du contenu, limitation temporaire, suspension, ou bannissement définitif en cas de manquement grave ou répété."],
      ["Comment contester une décision de modération ?", "Si vous estimez qu'une décision est injuste, vous pouvez la contester en contactant notre équipe. Chaque cas signalé est réexaminé avec attention."],
    ],
  },
  {
    cat: "Technique",
    items: [
      ["Sur quels appareils Nexus Social fonctionne-t-il ?", "Nexus Social est accessible depuis un navigateur web, sur téléphone comme sur ordinateur. L'expérience est optimisée pour le mobile et se charge rapidement."],
      ["L'application est-elle disponible hors connexion ?", "Nexus Social nécessite une connexion internet pour la plupart des fonctionnalités. Les notifications push peuvent toutefois vous prévenir même lorsque l'application est fermée, si vous les avez activées."],
      ["Pourquoi certains contenus mettent-ils du temps à charger ?", "Le temps de chargement dépend de votre connexion et de la taille des médias. Nous optimisons en permanence la plateforme pour la rendre plus rapide."],
    ],
  },
];

export default function FaqPage() {
  return (
    <ContentLayout
      title="Foire aux questions (FAQ)"
      description="Réponses aux questions les plus fréquentes sur Nexus Social : compte, publication, confidentialité, sécurité, modération et aspects techniques."
    >
      <h1 style={{ fontSize: 32, color: "#fff", margin: "0 0 12px", letterSpacing: "-0.02em" }}>Foire aux questions</h1>
      <p style={{ color: "#bbc9cd", fontSize: 17, marginBottom: 28 }}>
        Vous trouverez ici les réponses aux questions les plus courantes. Si vous ne trouvez pas ce que vous cherchez, écrivez-nous à <a href="mailto:support@nexussocial.com" style={{ color: ACCENT }}>support@nexussocial.com</a>.
      </p>

      {FAQ.map((section) => (
        <section key={section.cat} style={{ marginBottom: 30 }}>
          <h2 style={{ fontSize: 14, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>{section.cat}</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {section.items.map(([q, a]) => (
              <div key={q} style={{ background: "#131b2e", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "16px 18px" }}>
                <p style={{ color: "#fff", fontWeight: 700, margin: "0 0 6px", fontSize: 16 }}>{q}</p>
                <p style={{ color: "#a7b3cc", margin: 0, lineHeight: 1.6, fontSize: 15 }}>{a}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div style={{ marginTop: 24, padding: 20, background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 16 }}>
        <p style={{ color: "#fff", fontWeight: 700, margin: "0 0 6px" }}>Vous n'avez pas trouvé votre réponse ?</p>
        <p style={{ color: "#a7b3cc", margin: "0 0 4px" }}>Consultez nos <Link to="/guides" style={{ color: ACCENT }}>guides détaillés</Link> ou contactez notre équipe.</p>
      </div>
    </ContentLayout>
  );
}
