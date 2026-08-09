// Page « Comment ça marche » — parcours complet d'utilisation de Nexus Social.
import { Link } from "react-router-dom";
import ContentLayout, { proseStyle } from "./ContentLayout";

const ACCENT = "#22d3ee";

export default function HowItWorksPage() {
  return (
    <ContentLayout
      title="Comment ça marche"
      description="Guide pas à pas pour utiliser Nexus Social : créer un compte, publier, utiliser les Stories et les Clips, discuter et découvrir du contenu."
    >
      <style>{proseStyle}</style>
      <h1 style={{ fontSize: 32, color: "#fff", margin: "0 0 12px", letterSpacing: "-0.02em" }}>Comment ça marche</h1>
      <p style={{ color: "#bbc9cd", fontSize: 18, lineHeight: 1.6 }}>
        Nexus Social est simple à prendre en main. Voici, étape par étape, comment créer votre compte, partager vos contenus et profiter de toutes les fonctionnalités.
      </p>

      <div className="nx-prose">
        <h2>1. Créer votre compte</h2>
        <p>Tout commence par l'inscription. Renseignez un nom d'utilisateur, une adresse email valide, votre date de naissance (l'âge minimum est de 15 ans) et un mot de passe solide. Pour votre sécurité, votre adresse email est confirmée par un code. Une fois votre compte activé, vous pouvez le personnaliser : photo de profil, biographie et couleur d'accent.</p>

        <h2>2. Découvrir votre fil</h2>
        <p>Votre fil d'actualité rassemble les publications des comptes que vous suivez ainsi qu'une sélection de contenus susceptibles de vous plaire. Le classement met en avant ce qui vous intéresse, en s'appuyant sur vos interactions. Plus vous aimez, commentez et regardez de contenus, plus votre fil devient pertinent.</p>

        <h2>3. Publier votre premier contenu</h2>
        <p>Appuyez sur le bouton de création pour publier une photo, une vidéo ou un texte. Ajoutez une légende, des hashtags pour être trouvé sur un sujet, et mentionnez des amis si vous le souhaitez. Votre publication apparaît sur votre profil et dans le fil de vos abonnés. Pour aller plus loin, suivez notre guide <Link to="/guides/publier-son-premier-post">Publier son premier post</Link>.</p>

        <h2>4. Partager des Stories</h2>
        <p>Les Stories sont des contenus éphémères visibles pendant 24 heures. Depuis le composeur, prenez une photo ou une courte vidéo, puis enrichissez-la : texte, dessin, filtres, musique et une large gamme de stickers interactifs (sondages, questions, mentions, hashtags, GIF, compte à rebours, curseur emoji, localisation, heure et météo). Tous les éléments se déplacent, s'agrandissent et pivotent au doigt, pour une composition fluide. Notre guide <Link to="/guides/bien-utiliser-les-stories">Comment bien utiliser les Stories</Link> vous dit tout.</p>

        <h2>5. Créer des Nexus Clips</h2>
        <p>Les Nexus Clips sont des vidéos courtes et verticales, parfaites pour la découverte. Filmez directement depuis l'application ou importez une vidéo, ajoutez une légende, et publiez. L'algorithme de découverte met en avant les clips qui captent l'attention. Pour progresser, consultez <Link to="/guides/reussir-ses-nexus-clips">Réussir ses Nexus Clips</Link>.</p>

        <h2>6. Discuter en privé</h2>
        <p>La messagerie vous permet d'échanger en tête-à-tête ou en groupe. Envoyez du texte, des photos, des messages vocaux, partagez des notes visibles par vos amis proches, ou des Instantanés éphémères. Tout est pensé pour une conversation fluide et agréable, sur mobile comme sur ordinateur.</p>

        <h2>7. Suivre, aimer, commenter</h2>
        <p>Un réseau social prend vie grâce aux interactions. Abonnez-vous aux comptes qui vous inspirent, aimez les contenus qui vous plaisent, commentez, partagez. Ces gestes construisent votre communauté et affinent votre fil. La réciprocité est la meilleure façon de grandir.</p>

        <h2>8. Régler sa confidentialité</h2>
        <p>Depuis les paramètres, vous décidez qui voit vos contenus (compte public ou privé), qui peut vous écrire, et vous activez des protections comme la double authentification. Prenez quelques minutes pour configurer ces réglages : notre guide <Link to="/guides/confidentialite-maitriser-son-audience">Confidentialité</Link> vous accompagne.</p>

        <h2>9. Rester en sécurité</h2>
        <p>Choisissez un mot de passe unique, activez la double authentification et méfiez-vous des messages suspects. En cas de souci, les outils de signalement et de blocage sont là pour vous protéger. Consultez <Link to="/guides/securite-proteger-son-compte">Sécurité sur Nexus</Link> pour les bons réflexes.</p>

        <h2>Une question ?</h2>
        <p>Notre <Link to="/faq">FAQ</Link> répond aux questions les plus fréquentes, et notre équipe reste joignable à support@nexussocial.com. Bonne découverte sur Nexus Social !</p>
      </div>

      <div style={{ marginTop: 36, textAlign: "center" }}>
        <Link to="/auth" style={{ display: "inline-block", textDecoration: "none", fontWeight: 800, color: "#00363e", background: ACCENT, padding: "12px 28px", borderRadius: 999 }}>
          Commencer maintenant
        </Link>
      </div>
    </ContentLayout>
  );
}
