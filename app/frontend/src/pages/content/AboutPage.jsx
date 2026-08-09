// Page « À propos » — présentation complète de Nexus Social.
import { Link } from "react-router-dom";
import ContentLayout, { proseStyle } from "./ContentLayout";

const ACCENT = "#22d3ee";

export default function AboutPage() {
  return (
    <ContentLayout
      title="À propos de Nexus Social"
      description="Nexus Social est un réseau social moderne pour créer, partager et échanger en toute confiance. Découvrez notre mission, nos valeurs et nos fonctionnalités."
    >
      <style>{proseStyle}</style>
      <h1 style={{ fontSize: 32, color: "#fff", margin: "0 0 12px", letterSpacing: "-0.02em" }}>À propos de Nexus Social</h1>
      <p style={{ color: "#bbc9cd", fontSize: 18, lineHeight: 1.6, marginBottom: 8 }}>
        Nexus Social est un réseau social nouvelle génération, pensé pour rassembler ce que l'on aime dans le partage en ligne — la spontanéité des Stories, la créativité des vidéos courtes, la richesse des conversations — dans une expérience rapide, élégante et respectueuse de votre vie privée.
      </p>

      <div className="nx-prose">
        <h2>Notre mission</h2>
        <p>Nous croyons qu'un réseau social devrait rapprocher les gens sans les épuiser, valoriser la création sans céder à la course aux clics, et protéger ses utilisateurs plutôt que d'exploiter leurs données. Notre mission est simple : offrir un espace où chacun peut s'exprimer librement, découvrir des contenus qui l'inspirent et tisser des liens authentiques, en gardant toujours le contrôle de son expérience.</p>

        <h2>Ce que vous pouvez faire sur Nexus Social</h2>
        <p>Nexus Social réunit plusieurs façons de partager, chacune adaptée à un moment et à une envie :</p>
        <ul>
          <li><strong>Les publications</strong> pour partager des photos, des vidéos et des idées qui restent sur votre profil.</li>
          <li><strong>Les Stories</strong> pour raconter votre quotidien en format éphémère, avec des stickers interactifs, de la musique et des effets.</li>
          <li><strong>Les Nexus Clips</strong>, notre format de vidéos courtes et verticales, faites pour être découvertes et regardées en boucle.</li>
          <li><strong>La messagerie</strong>, avec conversations privées, groupes, messages vocaux, notes et Instantanés éphémères.</li>
          <li><strong>Un fil personnalisé</strong> qui met en avant ce qui vous intéresse vraiment, grâce à un classement transparent basé sur vos centres d'intérêt.</li>
        </ul>

        <h2>Nos valeurs</h2>
        <h3>La confiance et la sécurité</h3>
        <p>Nous mettons la protection de nos utilisateurs au coeur de nos priorités. Double authentification, chiffrement des données sensibles, outils de signalement et de blocage, modération active : tout est conçu pour que vous vous sentiez en sécurité. Nous ne vendons jamais vos données personnelles.</p>

        <h3>Le respect de la vie privée</h3>
        <p>Vous décidez qui voit votre contenu, qui peut vous contacter et quelles informations vous partagez. Conformément au RGPD, vous pouvez accéder à vos données, les corriger, les exporter ou les supprimer à tout moment. La confidentialité n'est pas une option cachée : c'est un droit que nous rendons simple à exercer.</p>

        <h3>La création avant tout</h3>
        <p>Nexus Social est un espace pensé pour les créateurs, qu'ils débutent ou soient déjà suivis. Des outils d'édition puissants et fluides, un format vidéo moderne, une découverte équitable : nous voulons donner à chacun les moyens de faire entendre sa voix.</p>

        <h3>Une communauté saine</h3>
        <p>Un réseau social ne vaut que par sa communauté. Nous appliquons des règles claires contre la haine, le harcèlement et les contenus illégaux, et nous encourageons la bienveillance. Découvrez nos <Link to="/guides/regles-de-la-communaute">règles de la communauté</Link>.</p>

        <h2>Un âge minimum responsable</h2>
        <p>Conformément à la législation française, l'inscription à Nexus Social est réservée aux personnes âgées d'au moins 15 ans. Nous prenons au sérieux la protection des plus jeunes et vérifions l'âge à l'inscription.</p>

        <h2>Une technologie au service de l'expérience</h2>
        <p>Rapidité, fluidité et fiabilité guident nos choix techniques. Nexus Social est optimisé pour le mobile, se charge vite et fonctionne aussi bien sur téléphone que sur ordinateur. Nous améliorons la plateforme en continu, à l'écoute de notre communauté.</p>

        <h2>Rejoignez-nous</h2>
        <p>Que vous cherchiez à partager votre quotidien, à développer une audience ou simplement à rester en contact avec vos proches, Nexus Social vous accueille. <Link to="/comment-ca-marche">Découvrez comment ça marche</Link> ou <Link to="/auth">créez votre compte</Link> dès maintenant.</p>
      </div>

      <div style={{ marginTop: 36, textAlign: "center" }}>
        <Link to="/auth" style={{ display: "inline-block", textDecoration: "none", fontWeight: 800, color: "#00363e", background: ACCENT, padding: "12px 28px", borderRadius: 999 }}>
          Créer un compte gratuitement
        </Link>
      </div>
    </ContentLayout>
  );
}
