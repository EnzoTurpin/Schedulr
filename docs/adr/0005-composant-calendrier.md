# ADR-0005 : Grille d'agenda développée en interne plutôt que bibliothèque sous licence

**Date** : 2026-07-27
**Statut** : Proposé — _décision la plus discutable du lot, à trancher explicitement_

## Contexte

L'agenda professionnel est l'écran où le salon passe sa journée. Il doit offrir :

- une **vue jour multi-coiffeurs** — une colonne par coiffeur, axe horaire vertical. C'est la vue « planning salon », celle qu'un gérant regarde en permanence ;
- une vue semaine pour un coiffeur donné ;
- la création par clic-glisser sur une plage vide ;
- le déplacement et le redimensionnement par glisser-déposer ;
- une **navigation clavier complète** — exigence WCAG 2.1 AA retenue pour le projet : tout ce qui se fait à la souris doit se faire au clavier.

La vue multi-coiffeurs est le point discriminant. Techniquement, c'est une vue « ressources » : plusieurs axes parallèles partageant une échelle de temps.

### Options envisagées

**(a) FullCalendar.** Référence du domaine, très complet. Le paquet standard est sous licence MIT — mais les vues ressources (`resourceTimeGrid`, `resourceTimeline`), c'est-à-dire exactement celle dont nous avons besoin, appartiennent à **FullCalendar Premium**, sous licence commerciale payante. _Le tarif exact et les conditions sont à vérifier auprès de l'éditeur avant tout engagement : ils ont évolué au fil des versions et je ne peux pas les garantir._ Conséquence structurelle : la fonction centrale du produit reposerait sur un abonnement à renouveler, dont l'interruption rendrait l'agenda non conforme à sa licence.

**(b) `react-big-calendar`.** MIT, sans redevance. Mais pas de vue ressources native : la vue multi-coiffeurs devrait être simulée (une instance par coiffeur côte à côte, ou détournement du système de ressources). On paierait le poids de la bibliothèque tout en écrivant la partie la plus difficile soi-même.

**(c) Développement interne** — CSS Grid pour l'échelle de temps, positionnement absolu des blocs de rendez-vous, `@dnd-kit/core` (MIT) pour le glisser-déposer.

**(d) Autres bibliothèques** (Schedule-X, Mobiscroll, Syncfusion…) — soit également payantes pour les vues ressources, soit moins établies, soit très lourdes. Aucune n'améliore le compromis des trois premières.

## Décision

Nous retenons l'option **(c)** : la grille est développée en interne.

Raisonnement : le problème réel — **projeter un intervalle temporel sur des coordonnées en pixels** — est simple. Un rendez-vous placé à `top = (début − ouverture) × hauteurParMinute` et de hauteur `durée × hauteurParMinute`, dans une colonne par coiffeur. Ce n'est pas là que réside la difficulté du produit ; celle-ci est dans le moteur de disponibilité (ADR-0003) et dans l'intégrité des écritures (ADR-0004), tous deux déjà de notre ressort.

Ce qui coûte cher dans un calendrier, ce sont les cas de bord : chevauchements visuels à disposer côte à côte, glisser-déposer fluide, accessibilité clavier, adaptation mobile. Le glisser-déposer est délégué à `@dnd-kit` ; l'accessibilité clavier doit de toute façon être écrite nous-mêmes, aucune des bibliothèques envisagées ne la fournissant au niveau exigé.

**Estimation : 4 à 6 jours** pour la grille, le positionnement, la gestion des chevauchements et le glisser-déposer, hors panneau de détail du rendez-vous.

**Condition de réversibilité — elle fait partie de la décision.** Le composant est isolé dans `src/features/calendar/` derrière une interface étroite :

```ts
type CalendarProps = {
  resources: { id: string; label: string; color: string }[]
  events: { id: string; resourceId: string; startAt: Date; endAt: Date; ... }[]
  range: { from: Date; to: Date }
  onCreate: (draft: { resourceId: string; startAt: Date; endAt: Date }) => Promise<void>
  onMove:   (id: string, next: { resourceId: string; startAt: Date }) => Promise<void>
  onResize: (id: string, next: { endAt: Date }) => Promise<void>
  onSelect: (id: string) => void
}
```

Aucun appel de données, aucune logique métier, aucun accès à la session dans ce composant : il reçoit des ressources et des événements, il émet des intentions. Si le développement dérape au-delà de **8 jours** en phase 4, la bascule vers FullCalendar Premium se fait derrière cette même interface, sans toucher au reste de l'application. Ce seuil est le critère d'abandon, fixé à l'avance pour ne pas être négocié sous l'effet de l'engagement déjà consenti.

## Conséquences

**Positives**

- Aucune licence, aucune redevance récurrente sur la fonction centrale du produit.
- Aucune dépendance lourde dans le lot client ; seul `@dnd-kit` est ajouté.
- Contrôle total sur le rendu et sur l'accessibilité clavier, sans lutter contre le DOM d'une bibliothèque tierce.
- Les particularités métier — couleur par coiffeur, marges de nettoyage visibles, statut absent, plages non travaillées grisées — s'implémentent directement plutôt que par contournement.

**Négatives**

- **4 à 6 jours de développement initial**, contre environ une journée d'intégration pour une bibliothèque prête à l'emploi. C'est le coût assumé, et le principal argument contre cette décision.
- La maintenance nous incombe : compatibilité navigateurs, tactile, fuseaux d'affichage, régressions visuelles.
- **Les cas de bord seront découverts par nous**, alors qu'une bibliothèque mûre les a déjà rencontrés. Le premier candidat : la disposition de trois rendez-vous qui se chevauchent partiellement dans une même colonne.
- L'accessibilité clavier d'une grille temporelle est un exercice non trivial (déplacement de focus sur deux axes, annonce des créneaux au lecteur d'écran). Elle doit être prévue dès la conception, pas ajoutée après.
- Risque de sous-estimation — c'est le motif du seuil d'abandon explicite à 8 jours.

**Vérification attendue en phase 4**

- Tests de composant sur le calcul de position et la disposition des chevauchements (fonctions pures, testables sans DOM).
- Parcours Playwright : créer par glisser, déplacer, redimensionner, avec un cas de conflit `409` vérifiant le retour visuel à la position d'origine (voir ADR-0004).
- `@axe-core/playwright` sans violation bloquante, et parcours clavier complet de bout en bout.

## Amendement du 2026-07-29 — le glisser-déposer est retiré

Cet ADR retenait le glisser-déposer comme geste principal de déplacement, et l'estimait à lui seul une part notable des 4 à 6 jours prévus. Il a été livré, puis retiré.

**Ce que l'usage a montré.** Cliquer pour consulter et tirer pour déplacer sont deux gestes trop proches. Sur une grille dense — le seed d'un salon réel compte une dizaine de rendez-vous par jour et par coiffeur —, un simple tremblement de souris décale un rendez-vous. La conséquence n'est pas cosmétique : un client se présente à une heure qui n'est plus la sienne. Le retour visuel réversible imposé par l'ADR-0004 avertit d'un refus, mais reste muet quand le déplacement accidentel est **valide**.

**Ce qui remplace.** Un clic ouvre la fenêtre du rendez-vous ; l'horaire, la durée et le coiffeur s'y modifient par des champs, et un bouton confirme. Le déplacement devient un acte délibéré.

Trois effets, tous favorables :

1. **Souris et clavier deviennent équivalents.** Le déplacement au clavier avait dû être écrit à part (`Maj + flèches`, `Alt + flèches`), avec ses propres cas de bord. Il disparaît : les deux entrées passent désormais par la même fenêtre. Les flèches ne servent plus qu'à parcourir les rendez-vous.
2. **`@dnd-kit` n'est plus nécessaire.** La grille n'a jamais eu besoin d'en dépendre — le glisser était écrit sur les évènements de pointeur —, mais la question ne se pose plus.
3. **Le composant maigrit.** `CalendarGrid` perd la gestion d'état du glissement, les poignées de redimensionnement et leurs seuils de hauteur.

**Ce que cela coûte.** Déplacer un rendez-vous demande trois interactions au lieu d'un geste : ouvrir, cliquer « Déplacer », saisir. C'est plus lent pour un salon qui réorganise beaucoup sa journée. Ce coût est assumé : la lenteur se rattrape, un rendez-vous décalé à l'insu du salon ne se rattrape pas.

**Ce que cet amendement ne remet pas en cause.** L'interface étroite du composant, condition de réversibilité, demeure : `CalendarGrid` reçoit des ressources et des évènements, et émet `onSelect` et `onCreate`. Les tests Playwright couvrent désormais le déplacement par la fenêtre, y compris le cas de conflit et le retour à la position d'origine.
