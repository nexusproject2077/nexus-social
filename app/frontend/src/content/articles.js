// Contenu éditorial de Nexus Social (guides, articles, aide).
// Chaque article est du contenu ORIGINAL, rédigé pour informer les utilisateurs
// et pour le référencement (SEO). Le corps est du HTML de confiance (écrit ici,
// jamais saisi par un utilisateur) rendu via dangerouslySetInnerHTML.

export const CATEGORIES = {
  demarrage: "Bien démarrer",
  fonctionnalites: "Fonctionnalités",
  securite: "Sécurité & confidentialité",
  communaute: "Communauté",
};

export const ARTICLES = [
  {
    slug: "bien-utiliser-les-stories",
    title: "Comment bien utiliser les Stories sur Nexus Social",
    category: "fonctionnalites",
    excerpt: "Les Stories sont un format court et spontané pour partager ton quotidien pendant 24 heures. Voici comment les réussir, les rendre vivantes et toucher ta communauté.",
    date: "2026-08-09",
    readMins: 6,
    html: `
<p>Les Stories occupent une place centrale dans la manière dont on partage aujourd'hui : elles sont rapides à créer, éphémères et beaucoup plus spontanées qu'une publication classique. Sur Nexus Social, une Story reste visible pendant 24 heures avant de disparaître automatiquement, ce qui invite à publier sans se soucier de la perfection. Dans ce guide, nous allons voir comment tirer le meilleur parti de ce format, de la prise de vue jusqu'aux petits détails qui font la différence.</p>

<h2>Qu'est-ce qu'une Story et à quoi ça sert ?</h2>
<p>Une Story est une suite de photos ou de courtes vidéos que vos abonnés peuvent regarder les unes après les autres. Contrairement à une publication qui reste sur votre profil, la Story vit dans l'instant : elle est parfaite pour montrer les coulisses de votre journée, réagir à chaud à un événement, poser une question à votre communauté ou simplement partager une ambiance. C'est aussi un excellent moyen de rester présent sans surcharger le fil de vos abonnés.</p>

<h2>Créer votre première Story</h2>
<p>Pour créer une Story, ouvrez le composeur depuis l'accueil ou la barre des Stories, puis choisissez de prendre une photo, d'enregistrer une courte vidéo (jusqu'à quinze secondes) ou d'importer un média depuis votre galerie. Une fois votre visuel prêt, vous entrez dans l'éditeur, où toute la personnalisation se joue.</p>
<ul>
  <li><strong>Le texte :</strong> ajoutez une légende, un titre accrocheur ou une pensée. Jouez avec les couleurs pour rester lisible sur n'importe quel fond.</li>
  <li><strong>Le dessin :</strong> soulignez un détail, entourez un élément ou signez votre Story à main levée.</li>
  <li><strong>Les filtres :</strong> quelques réglages d'ambiance suffisent à donner une identité visuelle cohérente à vos Stories.</li>
</ul>

<h2>Les stickers pour rendre vos Stories interactives</h2>
<p>C'est ici que les Stories prennent vie. Nexus Social propose une palette de stickers pensés pour l'engagement : mentionnez un ami avec un sticker de mention, ajoutez un hashtag pour rejoindre une conversation plus large, épinglez un lieu, insérez un GIF animé, affichez l'heure ou la météo, lancez un sondage, posez une question, ajoutez un curseur emoji pour mesurer une réaction, ou installez un compte à rebours avant un événement. Ces éléments transforment une simple image en une invitation à réagir.</p>
<p>Un conseil : ne surchargez pas. Deux ou trois stickers bien placés valent mieux qu'une image saturée. Laissez respirer votre visuel, et placez les éléments interactifs là où le regard se pose naturellement.</p>

<h2>La musique, l'ingrédient qui change tout</h2>
<p>Ajouter un extrait musical donne immédiatement une atmosphère à votre Story. Choisissez un passage qui colle à l'émotion que vous voulez transmettre, et calez-le au bon moment. Une Story avec la bonne musique se regarde jusqu'au bout ; sans elle, on passe souvent trop vite.</p>

<h2>Gestes fluides : déplacer, agrandir, pivoter</h2>
<p>Tous les éléments que vous ajoutez se manipulent au doigt, de façon naturelle : glissez avec un doigt pour déplacer, pincez avec deux doigts pour agrandir et faites pivoter en même temps. Prenez le temps de composer votre image comme vous le feriez sur une application de retouche : un titre légèrement incliné, un sticker qui suit une ligne de l'image, et le rendu devient tout de suite plus soigné.</p>

<h2>Quelques bonnes pratiques</h2>
<ul>
  <li><strong>Racontez une histoire :</strong> enchaînez plusieurs segments pour créer une progression, plutôt que de publier une image isolée.</li>
  <li><strong>Pensez vertical :</strong> le format plein écran vertical est fait pour le mobile, cadrez en conséquence.</li>
  <li><strong>Restez lisible :</strong> un texte blanc sur fond clair disparaît. Ajoutez une ombre ou un fond au texte si besoin.</li>
  <li><strong>Publiez régulièrement :</strong> la régularité crée l'habitude et fidélise votre audience mieux qu'un gros post occasionnel.</li>
</ul>

<h2>Qui voit vos Stories ?</h2>
<p>Vous gardez le contrôle de votre audience. Selon vos réglages, une Story peut être visible par tous vos abonnés ou réservée à un cercle plus restreint. Prenez l'habitude de vérifier votre visibilité avant de publier un contenu plus personnel. Pour aller plus loin, consultez notre guide dédié à la confidentialité.</p>

<h2>En résumé</h2>
<p>Les Stories sont l'endroit idéal pour être authentique. Un bon visuel, une musique juste, un ou deux stickers interactifs, et surtout de la régularité : voilà la recette. N'attendez pas le contenu parfait, publiez ce qui vous ressemble. C'est cette spontanéité qui crée le lien avec votre communauté.</p>
`,
  },
  {
    slug: "securite-proteger-son-compte",
    title: "Sécurité sur Nexus : protéger efficacement ton compte",
    category: "securite",
    excerpt: "Un compte bien protégé, c'est la tranquillité. Mot de passe, double authentification, hameçonnage : le guide complet pour garder ton compte Nexus Social en sécurité.",
    date: "2026-08-09",
    readMins: 7,
    html: `
<p>Votre compte, c'est votre identité en ligne, vos conversations, vos souvenirs et parfois vos revenus. Le protéger n'est pas une option : c'est le premier réflexe à adopter. La bonne nouvelle, c'est que quelques gestes simples suffisent à rendre votre compte Nexus Social nettement plus sûr. Ce guide fait le tour des mesures essentielles, de la plus basique à la plus avancée.</p>

<h2>Un mot de passe solide, la base de tout</h2>
<p>La majorité des comptes compromis le sont à cause d'un mot de passe faible ou réutilisé. Un bon mot de passe est long (au moins douze caractères), unique à Nexus Social, et difficile à deviner. Évitez les dates de naissance, les prénoms et les suites évidentes. Une méthode efficace consiste à assembler plusieurs mots sans lien entre eux, ce qui donne un mot de passe à la fois long et mémorisable.</p>
<p>Surtout, ne réutilisez jamais le même mot de passe sur plusieurs sites. Si l'un d'eux est piraté, les autres tombent avec lui. Un gestionnaire de mots de passe vous permet d'en générer et d'en retenir un différent pour chaque service.</p>

<h2>Activez la double authentification (2FA)</h2>
<p>La double authentification ajoute une seconde barrière après le mot de passe. Lorsqu'elle est activée sur Nexus Social, une tentative de connexion déclenche l'envoi d'un code de vérification à usage unique par email. Même si quelqu'un connaissait votre mot de passe, il ne pourrait pas se connecter sans ce code. Vous pouvez activer cette protection depuis les paramètres, dans la section Sécurité. C'est l'une des mesures les plus efficaces, et elle ne prend que quelques secondes à mettre en place.</p>

<h2>Reconnaître le hameçonnage (phishing)</h2>
<p>Le hameçonnage consiste à vous piéger pour vous faire saisir vos identifiants sur un faux site ou à vous faire cliquer sur un lien malveillant. Quelques signaux doivent vous alerter :</p>
<ul>
  <li>Un message urgent qui vous menace de suspension si vous n'agissez pas immédiatement.</li>
  <li>Un lien dont l'adresse ne correspond pas au site officiel.</li>
  <li>Une demande de mot de passe ou de code de vérification par message.</li>
  <li>Des fautes d'orthographe ou une mise en page approximative.</li>
</ul>
<p>Retenez une règle d'or : Nexus Social ne vous demandera jamais votre mot de passe ou votre code de connexion par message privé. En cas de doute, ne cliquez pas, et connectez-vous toujours en tapant vous-même l'adresse du site.</p>

<h2>Que faire si mon compte est réinitialisé ?</h2>
<p>Si vous avez oublié votre mot de passe, utilisez la fonction de réinitialisation depuis l'écran de connexion : vous recevrez un code par email pour définir un nouveau mot de passe en toute sécurité. Si vous recevez un email de réinitialisation que vous n'avez pas demandé, ignorez-le et changez votre mot de passe par précaution.</p>

<h2>Surveiller son compte au quotidien</h2>
<ul>
  <li><strong>Déconnexion sur les appareils partagés :</strong> ne restez jamais connecté sur un ordinateur public.</li>
  <li><strong>Vigilance sur les autorisations :</strong> réfléchissez avant d'accorder des accès à des services tiers.</li>
  <li><strong>Mise à jour de l'email :</strong> gardez une adresse email valide et sécurisée, car c'est elle qui reçoit les codes de récupération.</li>
</ul>

<h2>Protéger aussi sa vie privée</h2>
<p>La sécurité ne s'arrête pas au mot de passe. Réfléchissez à ce que vous partagez : une photo peut révéler votre adresse, une Story en direct votre emplacement. Ajustez qui peut voir vos publications, qui peut vous écrire et quelles informations apparaissent sur votre profil. Notre guide sur la confidentialité détaille tous ces réglages.</p>

<h2>Signaler et bloquer</h2>
<p>Si vous êtes victime de harcèlement, d'une usurpation d'identité ou d'un comportement suspect, utilisez les outils de signalement et de blocage. Bloquer une personne coupe tout contact, et signaler un contenu permet à notre équipe de modération d'agir. Vous n'êtes jamais seul : protéger la communauté fait partie de notre mission.</p>

<h2>En résumé</h2>
<p>Un mot de passe unique et solide, la double authentification activée, une vigilance face aux messages suspects et des réglages de confidentialité adaptés : avec ces quatre réflexes, votre compte Nexus Social est déjà bien mieux protégé que la moyenne. La sécurité est une habitude, pas une contrainte.</p>
`,
  },
  {
    slug: "reussir-ses-nexus-clips",
    title: "Réussir ses Nexus Clips : le guide complet des vidéos courtes",
    category: "fonctionnalites",
    excerpt: "Format vertical, accroche, montage, son : découvre comment créer des Nexus Clips qui captent l'attention dès la première seconde et donnent envie d'être regardés jusqu'au bout.",
    date: "2026-08-09",
    readMins: 7,
    html: `
<p>Les Nexus Clips sont le format vidéo court et vertical de Nexus Social, pensé pour être regardé, aimé et partagé en boucle. C'est un terrain de jeu formidable pour la créativité, mais aussi un format exigeant : sur un fil défilant, vous avez à peine une seconde pour convaincre. Voici comment mettre toutes les chances de votre côté.</p>

<h2>Comprendre le format</h2>
<p>Un Clip se regarde en plein écran, à la verticale, souvent avec le son activé. Il tourne en boucle, ce qui récompense les vidéos rythmées et bien montées. L'algorithme de découverte met en avant les clips qui retiennent l'attention : plus les gens regardent votre vidéo jusqu'au bout et interagissent, plus elle est proposée à de nouvelles personnes. Votre objectif est donc double : accrocher vite, et donner envie de rester.</p>

<h2>L'accroche : les trois premières secondes</h2>
<p>Tout se joue au début. Une bonne accroche pose une question, montre un résultat surprenant, annonce une promesse ou crée une tension à résoudre. Évitez les longues introductions : entrez directement dans le sujet. Si votre vidéo raconte comment réussir une recette, montrez le plat final dès la première image, puis expliquez. Le spectateur reste parce qu'il veut savoir comment vous y êtes arrivé.</p>

<h2>Cadrage et lumière</h2>
<p>Filmez à la verticale, stabilisez votre téléphone et soignez la lumière : une source douce face à vous vaut mieux qu'une fenêtre dans le dos qui vous plonge dans l'ombre. Un cadrage propre et une image nette donnent immédiatement une impression de qualité, même avec un simple smartphone.</p>

<h2>Le son fait la moitié du travail</h2>
<p>Une vidéo au son clair est bien plus agréable qu'une belle image mal enregistrée. Rapprochez-vous du micro, évitez les environnements trop bruyants, et pensez à la musique : un fond sonore bien choisi installe une ambiance et donne du rythme. Veillez toutefois à ce que la musique ne couvre pas votre voix si vous parlez.</p>

<h2>Le montage : rythme et clarté</h2>
<ul>
  <li><strong>Coupez le superflu :</strong> chaque seconde doit apporter quelque chose. Supprimez les temps morts.</li>
  <li><strong>Variez les plans :</strong> alterner les angles maintient l'attention.</li>
  <li><strong>Ajoutez du texte à l'écran :</strong> beaucoup regardent d'abord sans le son. Un sous-titre ou un mot-clé aide à comprendre en un coup d'oeil.</li>
  <li><strong>Terminez par une invitation :</strong> une question, un appel à commenter ou à s'abonner encourage l'interaction.</li>
</ul>

<h2>Publier et légender intelligemment</h2>
<p>La légende n'est pas un détail. Elle donne le contexte, ajoute une touche d'humour ou pose une question qui invite à commenter. Restez concis et authentique. Publiez de préférence au moment où votre audience est la plus active, et n'hésitez pas à tester différents horaires pour voir ce qui fonctionne.</p>

<h2>Analyser et s'améliorer</h2>
<p>Regardez quels clips fonctionnent le mieux et pourquoi. Un taux de visionnage élevé signifie que votre accroche et votre rythme sont bons. Beaucoup de partages indiquent un contenu utile ou divertissant que les gens veulent transmettre. En observant ces signaux, vous affinez peu à peu votre style et vous progressez à chaque vidéo.</p>

<h2>Rester soi-même</h2>
<p>La technique aide, mais l'authenticité l'emporte toujours. Les meilleurs créateurs ne sont pas forcément les plus équipés : ce sont ceux qui ont une voix, un point de vue, une énergie. Publiez régulièrement, amusez-vous, et laissez votre personnalité transparaître. C'est ce que votre communauté viendra chercher.</p>

<h2>En résumé</h2>
<p>Une accroche forte, un cadrage soigné, un bon son, un montage rythmé et une légende engageante : voilà les ingrédients d'un Nexus Clip réussi. Ajoutez-y de la régularité et de la sincérité, et vous verrez votre audience grandir clip après clip.</p>
`,
  },
  {
    slug: "publier-son-premier-post",
    title: "Publier son premier post : le guide du débutant",
    category: "demarrage",
    excerpt: "Vous venez d'arriver sur Nexus Social ? Ce guide vous accompagne pas à pas pour créer un profil soigné et publier votre première publication en toute confiance.",
    date: "2026-08-09",
    readMins: 6,
    html: `
<p>Se lancer sur un nouveau réseau social peut intimider. Par où commencer ? Que publier ? Comment se faire remarquer sans en faire trop ? Ce guide est fait pour vous accompagner dans vos tout premiers pas sur Nexus Social, du profil à votre première publication.</p>

<h2>Soigner son profil avant tout</h2>
<p>Votre profil est votre carte de visite. Avant même de publier, prenez cinq minutes pour le remplir correctement. Choisissez une photo de profil nette et reconnaissable, idéalement votre visage ou un logo si vous représentez une marque. Rédigez une biographie courte qui dit qui vous êtes et ce que l'on va trouver chez vous. Un profil complet inspire confiance et donne envie de s'abonner.</p>

<h2>Comprendre les différents formats</h2>
<p>Nexus Social propose plusieurs façons de partager, et chacune a son usage :</p>
<ul>
  <li><strong>La publication classique :</strong> une photo, une vidéo ou un texte qui reste sur votre profil. Idéale pour un contenu que vous voulez garder dans le temps.</li>
  <li><strong>La Story :</strong> un contenu éphémère de 24 heures, parfait pour le quotidien et la spontanéité.</li>
  <li><strong>Le Clip :</strong> une vidéo courte et verticale, faite pour la découverte et le divertissement.</li>
  <li><strong>Les messages :</strong> pour échanger en privé, en tête à tête ou en groupe.</li>
</ul>
<p>Pour débuter, une simple publication est parfaite. Vous explorerez les autres formats à votre rythme.</p>

<h2>Créer votre première publication</h2>
<p>Ouvrez le composeur de publication, ajoutez une photo ou une vidéo, puis rédigez un texte qui l'accompagne. Pas besoin d'être un écrivain : dites simplement ce que vous avez envie de partager. Une phrase sincère vaut mieux qu'un long texte impersonnel. Vous pouvez ajouter des hashtags pour être trouvé sur un sujet, et mentionner des amis avec l'arobase.</p>

<h2>Choisir un bon visuel</h2>
<p>Sur un réseau social, l'image attire l'oeil en premier. Privilégiez une photo lumineuse, bien cadrée et qui raconte quelque chose. Vous n'avez pas besoin d'un appareil professionnel : un smartphone récent et une bonne lumière naturelle suffisent largement. Évitez les images floues ou trop sombres qui donnent une impression de négligence.</p>

<h2>Interagir, la clé pour grandir</h2>
<p>Publier, c'est bien ; participer, c'est mieux. Aimez les publications qui vous plaisent, laissez des commentaires sincères, répondez à ceux que vous recevez. Les réseaux sociaux récompensent l'engagement réciproque : plus vous êtes présent et bienveillant, plus votre communauté grandit naturellement. N'attendez pas que les autres viennent à vous, allez à leur rencontre.</p>

<h2>Trouver son rythme</h2>
<p>Inutile de publier dix fois par jour. Mieux vaut une publication régulière et soignée qu'un flot de contenus sans intérêt. Trouvez un rythme tenable, qui vous laisse le plaisir de créer sans pression. La constance sur la durée compte bien plus que l'intensité de départ.</p>

<h2>Les erreurs de débutant à éviter</h2>
<ul>
  <li>Laisser un profil vide ou sans photo.</li>
  <li>Copier le style des autres au lieu de trouver le sien.</li>
  <li>Se décourager après quelques publications peu vues : la visibilité se construit avec le temps.</li>
  <li>Négliger la légende, qui donne le contexte et l'envie de réagir.</li>
</ul>

<h2>En résumé</h2>
<p>Un profil complet, un premier post sincère, un visuel soigné et une vraie envie d'échanger : vous avez tout ce qu'il faut pour bien commencer. Ne cherchez pas la perfection, cherchez l'authenticité. Bienvenue sur Nexus Social.</p>
`,
  },
  {
    slug: "confidentialite-maitriser-son-audience",
    title: "Confidentialité : maîtriser qui voit votre contenu",
    category: "securite",
    excerpt: "Compte public ou privé, visibilité des Stories, contrôle des messages : découvrez tous les réglages pour partager exactement ce que vous voulez, avec qui vous voulez.",
    date: "2026-08-09",
    readMins: 6,
    html: `
<p>Partager, c'est le coeur d'un réseau social, mais partager ne veut pas dire tout montrer à tout le monde. Nexus Social vous donne des outils précis pour décider qui voit quoi. Prendre quelques minutes pour configurer votre confidentialité, c'est vous garantir une expérience plus sereine.</p>

<h2>Compte public ou compte privé ?</h2>
<p>C'est le premier choix à faire. Un compte public permet à n'importe qui de voir vos publications et de s'abonner sans validation : idéal si vous cherchez à toucher un large public ou à développer une audience. Un compte privé, à l'inverse, exige que vous approuviez chaque nouvel abonné, et seuls vos abonnés voient vos contenus. C'est le réglage recommandé si vous partagez surtout avec vos proches ou si vous souhaitez garder un cercle restreint.</p>

<h2>La visibilité de vos Stories</h2>
<p>Les Stories peuvent avoir leur propre niveau de visibilité, indépendant du reste. Vous pouvez ainsi partager un moment plus personnel avec un cercle restreint tout en gardant un profil public. Prenez l'habitude de vérifier à qui s'adresse votre Story avant de publier un contenu sensible ou localisé.</p>

<h2>Contrôler les messages</h2>
<p>Vous n'êtes pas obligé d'accepter les messages de tout le monde. Selon vos réglages, vous pouvez limiter qui a le droit de vous écrire, filtrer les demandes de personnes que vous ne suivez pas, ou couper une conversation à tout moment. Si quelqu'un vous importune, le blocage met fin immédiatement à tout contact.</p>

<h2>Réfléchir avant de publier</h2>
<p>Le meilleur réglage de confidentialité reste votre bon sens. Avant de publier, posez-vous quelques questions simples :</p>
<ul>
  <li>Cette photo révèle-t-elle une information que je préfère garder privée, comme mon adresse ou mon lieu de travail ?</li>
  <li>Suis-je à l'aise si ce contenu était vu par ma famille, mon employeur ou un inconnu ?</li>
  <li>Ai-je le consentement des autres personnes présentes sur l'image ?</li>
</ul>
<p>Une publication peut être supprimée, mais on ne maîtrise jamais totalement ce qui a déjà été vu ou enregistré. La prudence est votre meilleure alliée.</p>

<h2>Vos données personnelles</h2>
<p>Nexus Social s'engage à protéger vos données conformément au RGPD. Vous gardez la main : vous pouvez consulter les informations que nous détenons, les corriger, les exporter ou demander leur suppression. Les données sensibles sont chiffrées, et nous ne vendons jamais vos informations personnelles à des tiers. Pour tout savoir, consultez notre Politique de confidentialité.</p>

<h2>Gérer les personnes indésirables</h2>
<p>Blocage, restriction, signalement : ces outils existent pour vous protéger, utilisez-les sans hésiter. Bloquer une personne l'empêche de voir votre contenu et de vous contacter. Signaler un contenu ou un compte alerte notre équipe de modération, qui peut prendre des sanctions. Vous n'avez jamais à supporter un comportement abusif.</p>

<h2>En résumé</h2>
<p>Choisissez le niveau de compte adapté à votre usage, ajustez la visibilité de vos Stories, filtrez vos messages et réfléchissez à ce que vous partagez. La confidentialité n'est pas une contrainte : c'est la liberté de partager en confiance, à vos conditions.</p>
`,
  },
  {
    slug: "regles-de-la-communaute",
    title: "Les règles de la communauté Nexus Social",
    category: "communaute",
    excerpt: "Respect, bienveillance, contenus interdits, modération : comprenez les règles qui font de Nexus Social un espace sûr et agréable pour tout le monde.",
    date: "2026-08-09",
    readMins: 6,
    html: `
<p>Un réseau social n'est agréable que si chacun y respecte quelques règles de vie commune. Sur Nexus Social, nous voulons un espace où l'on peut s'exprimer librement, créer et échanger sans craindre la haine ou le harcèlement. Ce guide résume l'esprit de nos règles et ce qui est attendu de chaque membre.</p>

<h2>Le respect avant tout</h2>
<p>La liberté d'expression s'arrête là où commence le manque de respect envers autrui. On peut ne pas être d'accord, débattre, avoir des avis tranchés, tant que cela se fait sans insulte, sans mépris et sans attaque personnelle. Traitez les autres comme vous aimeriez être traité : c'est le principe le plus simple et le plus efficace.</p>

<h2>Ce qui est strictement interdit</h2>
<p>Certains contenus n'ont pas leur place sur Nexus Social, quelle que soit l'intention. En publiant, vous vous engagez à ne pas diffuser :</p>
<ul>
  <li><strong>Des contenus illégaux</strong> ou contraires à la loi.</li>
  <li><strong>Du harcèlement, des menaces ou du doxxing</strong> (divulgation d'informations privées d'autrui).</li>
  <li><strong>Du spam, des bots ou de faux comptes</strong> destinés à tromper ou manipuler.</li>
  <li><strong>Des contenus sexuels non consentis</strong>, et de manière absolue tout contenu impliquant des mineurs, qui est signalé aux autorités.</li>
  <li><strong>De l'incitation à la haine ou à la violence</strong> envers une personne ou un groupe.</li>
  <li><strong>De l'usurpation d'identité.</strong></li>
  <li><strong>Des contenus violant les droits d'auteur.</strong></li>
</ul>
<p>Cette liste n'est pas exhaustive : l'esprit compte autant que la lettre. En cas de doute, abstenez-vous.</p>

<h2>Comment fonctionne la modération</h2>
<p>La modération combine des outils automatiques et une intervention humaine. Lorsqu'un contenu enfreint les règles, plusieurs mesures graduées peuvent s'appliquer : un simple avertissement et le retrait du contenu, une limitation temporaire de certaines fonctions, une suspension du compte, et dans les cas graves un bannissement définitif. Les infractions les plus sérieuses, comme les menaces crédibles, entraînent une action immédiate.</p>

<h2>Signaler un contenu</h2>
<p>La communauté est notre meilleur allié. Si vous voyez un contenu ou un comportement qui enfreint les règles, signalez-le : cela alerte notre équipe et permet d'agir vite. Le signalement est confidentiel. Bloquer une personne, de votre côté, coupe immédiatement tout contact avec elle.</p>

<h2>Contester une décision</h2>
<p>La modération n'est pas infaillible. Si vous estimez qu'une décision est injuste, vous pouvez la contester en contactant notre équipe. Nous réexaminons les cas signalés avec attention. Notre objectif n'est pas de sanctionner, mais de protéger la communauté.</p>

<h2>Construire une communauté positive</h2>
<p>Au-delà des interdits, une bonne communauté se construit sur des gestes positifs : encourager les créateurs, laisser des commentaires bienveillants, partager les contenus qui méritent d'être vus, accueillir les nouveaux venus. Chaque membre contribue à l'ambiance générale. En donnant le meilleur, vous incitez les autres à faire de même.</p>

<h2>En résumé</h2>
<p>Respect, refus de la haine et du harcèlement, contenus légaux et consentis, et un esprit de bienveillance : voilà le socle de la communauté Nexus Social. Ensemble, nous faisons de cet espace un endroit où il fait bon partager.</p>
`,
  },
  {
    slug: "notifications-et-temps-decran",
    title: "Gérer ses notifications et son temps d'écran",
    category: "demarrage",
    excerpt: "Reprenez le contrôle : configurez vos notifications, activez les alertes qui comptent et gardez un usage sain de Nexus Social sans vous laisser déborder.",
    date: "2026-08-09",
    readMins: 5,
    html: `
<p>Les notifications sont utiles : elles vous préviennent d'un nouveau message, d'un abonné ou d'une interaction. Mais mal réglées, elles deviennent envahissantes et fractionnent votre attention. Voici comment configurer Nexus Social pour rester informé de l'essentiel sans vous laisser submerger.</p>

<h2>Comprendre les types de notifications</h2>
<p>Sur Nexus Social, vous recevez plusieurs sortes d'alertes : les mentions J'aime et commentaires sur vos publications, les nouveaux abonnés, les messages privés, les mentions dans les Stories ou les publications, et les notifications de l'application même lorsque vous êtes déconnecté (notifications push). Chacune peut être activée ou désactivée indépendamment.</p>

<h2>Activer les notifications push</h2>
<p>Les notifications push vous permettent d'être prévenu même quand l'application est fermée. Elles sont pratiques pour ne pas manquer un message important, mais réservez-les à ce qui compte vraiment. Vous pouvez les activer depuis la cloche de notifications ou les paramètres, et votre navigateur vous demandera l'autorisation. Vous restez libre de les couper à tout moment.</p>

<h2>Filtrer l'essentiel</h2>
<p>Posez-vous la question : qu'est-ce que je veux vraiment savoir en temps réel ? Pour beaucoup, seuls les messages privés et les interactions directes méritent une alerte immédiate. Le reste peut attendre votre prochaine visite. En désactivant les notifications secondaires, vous réduisez le bruit et vous vous concentrez sur ce qui a de la valeur pour vous.</p>

<h2>Garder un usage sain</h2>
<p>Un réseau social est fait pour être un plaisir, pas une contrainte. Quelques habitudes aident à garder un usage équilibré :</p>
<ul>
  <li><strong>Fixez-vous des moments :</strong> consultez l'application à des horaires choisis plutôt qu'en réaction à chaque notification.</li>
  <li><strong>Coupez la nuit :</strong> désactiver les alertes le soir améliore le sommeil et la concentration.</li>
  <li><strong>Faites des pauses :</strong> il est sain de se déconnecter régulièrement.</li>
  <li><strong>Privilégiez la qualité :</strong> mieux vaut quelques échanges enrichissants qu'un défilement sans fin.</li>
</ul>

<h2>Notifications et vie privée</h2>
<p>Vos préférences de notification sont personnelles et modifiables à tout moment. Elles n'affectent pas ce que voient les autres : désactiver une alerte ne signale rien à personne. Vous gardez la main sur votre expérience, sans pression.</p>

<h2>En résumé</h2>
<p>Activez les notifications qui vous rendent service, coupez celles qui vous distraient, et fixez-vous des moments dédiés. Bien réglé, Nexus Social s'adapte à votre vie, et non l'inverse. Le contrôle de votre attention vous appartient.</p>
`,
  },
  {
    slug: "messagerie-et-instantanes",
    title: "Messagerie et Instantanés : bien communiquer en privé",
    category: "fonctionnalites",
    excerpt: "Conversations en tête-à-tête, groupes, messages vocaux, notes et Instantanés éphémères : le guide pour tirer le meilleur de la messagerie de Nexus Social.",
    date: "2026-08-09",
    readMins: 6,
    html: `
<p>Au-delà du fil public, Nexus Social est aussi un espace de conversation privée. La messagerie vous permet d'échanger en tête-à-tête ou en groupe, de partager des médias, d'envoyer des messages vocaux et de rester proche de vos amis. Ce guide fait le tour de tout ce qu'elle offre.</p>

<h2>Démarrer une conversation</h2>
<p>Pour écrire à quelqu'un, ouvrez la messagerie et recherchez la personne par son nom d'utilisateur, ou lancez la discussion depuis son profil. Vous pouvez envoyer du texte, des photos, des vidéos, des liens et bien plus. Les conversations récentes s'affichent en haut de votre liste, la plus active en premier.</p>

<h2>Les groupes</h2>
<p>Les discussions de groupe rassemblent plusieurs personnes autour d'un sujet, d'un projet ou simplement d'un cercle d'amis. Vous pouvez nommer le groupe, y ajouter des participants et échanger comme dans une conversation classique. Les groupes sont parfaits pour organiser un événement ou garder le contact avec un ensemble de proches.</p>

<h2>Les messages vocaux</h2>
<p>Parfois, un message vocal dit mieux les choses qu'un texte. La messagerie vous permet d'enregistrer votre voix et de l'envoyer en quelques secondes. C'est pratique quand vous êtes en déplacement, ou pour transmettre une émotion qu'un texte ne rendrait pas. Le destinataire peut l'écouter, le mettre en pause et se déplacer dans l'enregistrement à sa guise.</p>

<h2>Les notes</h2>
<p>Les notes sont de courts statuts que vous partagez avec vos abonnements mutuels, visibles en haut de la messagerie. C'est un moyen léger et amusant de faire savoir votre humeur du moment ou de lancer une petite phrase, sans publier une Story complète. Une note disparaît d'elle-même après un temps, gardant votre messagerie fraîche et vivante.</p>

<h2>Les Instantanés</h2>
<p>Les Instantanés sont des photos éphémères que vous envoyez directement dans une conversation, à la manière d'un clin d'oeil visuel. Ils s'effacent après avoir été vus, ce qui invite à la spontanéité. C'est le format idéal pour partager un moment fugace avec une personne précise, sans le laisser traîner.</p>

<h2>Réactions et confort de lecture</h2>
<p>Vous pouvez réagir rapidement à un message d'un simple geste, ce qui évite de répondre par un mot quand un emoji suffit. Les conversations sont pensées pour être fluides sur mobile, avec une saisie confortable et un affichage clair, même lors d'échanges nourris.</p>

<h2>Communiquer en toute sécurité</h2>
<p>La messagerie reste un espace privé, mais quelques réflexes s'imposent. Ne partagez jamais vos mots de passe ni vos codes de connexion, même à un proche. Méfiez-vous des liens inattendus. Et si une conversation devient désagréable, vous pouvez la quitter, bloquer la personne ou la signaler. Vos réglages déterminent aussi qui a le droit de vous écrire.</p>

<h2>En résumé</h2>
<p>Conversations, groupes, messages vocaux, notes et Instantanés : la messagerie de Nexus Social couvre tous les usages, du plus posé au plus spontané. Explorez-la, trouvez les formats qui vous conviennent, et gardez toujours à l'esprit les bons réflexes de sécurité.</p>
`,
  },
];

export const getArticle = (slug) => ARTICLES.find((a) => a.slug === slug) || null;
export const getRelated = (slug, n = 3) =>
  ARTICLES.filter((a) => a.slug !== slug).slice(0, n);
