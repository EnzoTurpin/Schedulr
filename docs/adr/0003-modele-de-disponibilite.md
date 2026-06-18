# ADR-0003 : Calcul des disponibilités à la volée, horaires en minutes locales

**Date** : 2026-07-27
**Statut** : Proposé

## Contexte

Le produit repose entièrement sur une question : _quels créneaux sont libres ?_ Cette réponse dépend de la composition de six sources d'information, dont cinq peuvent changer à tout moment :

1. les horaires d'ouverture du salon (récurrents par jour de semaine) ;
2. les horaires de travail du coiffeur (récurrents, différents de ceux du salon) ;
3. ses absences ponctuelles — congés, pauses, formations ;
4. les fermetures exceptionnelles du salon — jours fériés, travaux ;
5. les rendez-vous déjà pris ;
6. les règles de réservation du salon — délai minimum avant un rendez-vous, horizon maximum, granularité des créneaux, temps de préparation et de nettoyage autour des prestations.

S'y ajoutent deux subtilités métier : la durée dépend du **couple prestation/coiffeur** (une coloration prend plus de temps chez un apprenti), et un rendez-vous peut cumuler plusieurs prestations dont la durée s'additionne.

Enfin, un piège structurel : la France change d'heure deux fois par an. « Le salon ouvre à 9 h le mardi » n'est pas un instant, c'est une règle locale. Confondre les deux décale silencieusement les agendas d'une heure, deux fois par an, sur tous les rendez-vous.

### Options envisagées

**(a) Table de créneaux matérialisés.** On pré-génère un enregistrement par créneau réservable sur l'horizon (par exemple 60 jours × 6 coiffeurs × pas de 15 min ≈ 100 000 lignes par salon). Lecture triviale et rapide, réservation par simple mise à jour de ligne.

Problème rédhibitoire : **toute modification de règle invalide la table.** Un gérant qui change ses horaires du jeudi, pose une semaine de congés ou ajoute un jour férié déclenche une régénération. Les régénérations partielles ratées produisent des créneaux fantômes — proposés alors qu'indisponibles, ou masqués alors que libres. Ce sont exactement les bugs les plus coûteux en confiance utilisateur, et les plus difficiles à reproduire.

**(b) Calcul à la volée.** Les règles sont la seule source de vérité ; les créneaux sont dérivés à chaque demande. Aucun état dérivé ne peut se désynchroniser. Coût : du calcul à chaque requête.

**(c) Hybride** — calcul à la volée avec cache court invalidé à l'écriture.

## Décision

Nous retenons l'option **(c)** : calcul à la volée, avec un cache de courte durée.

**Le moteur est constitué de fonctions pures**, rassemblées dans `src/features/availability/`, sans aucune dépendance à Prisma. Elles reçoivent les règles et les rendez-vous déjà chargés, et retournent des créneaux. Une couche d'accès distincte se charge de lire les données en une seule requête par fenêtre. Cette séparation est le point important : elle rend le module testable exhaustivement, y compris sur les cas limites de calendrier, sans base de données.

```
slots(salon, serviceIds[], memberId | ANY, fenêtre) :
  durée   = Σ (StaffService.durationMin ?? Service.durationMin)
  marges  = buffer avant du 1er service, buffer après du dernier
  pour chaque coiffeur candidat :
      fenêtres = WorkingHour ∩ OpeningHour  −  TimeOff  −  Closure
      occupé   = rendez-vous actifs, élargis de leurs marges
      libre    = fenêtres − occupé
      créneaux = découpe(libre, pas = slotStepMin, largeur = marges + durée)
  filtres  : début ≥ maintenant + bookingLeadTimeMin
             début ≤ maintenant + bookingHorizonDays
  ANY      => union par instant, un coiffeur retenu par créneau
              (le moins chargé du jour, égalité tranchée sur l'identifiant)
```

**Représentation du temps** — c'est la partie la plus facile à se tromper, donc elle est figée ici :

| Nature                                             | Stockage                                                                     | Justification                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Horaires récurrents (`OpeningHour`, `WorkingHour`) | `dayOfWeek` + `startMin`/`endMin`, minutes depuis minuit **en heure locale** | Une règle locale reste vraie de part et d'autre du changement d'heure |
| Instants (`Appointment`, `TimeOff`, `Closure`)     | `timestamptz`, en UTC                                                        | Un rendez-vous est un instant unique et non ambigu                    |
| Fuseau                                             | `Salon.timezone`, défaut `Europe/Paris`                                      | Porté par le salon, pas par le serveur                                |

La conversion local → UTC se fait **au moment du calcul**, avec `date-fns-tz`. Le fuseau du serveur n'est jamais utilisé implicitement : `new Date()` sans fuseau explicite est proscrit dans ce module.

**Cache** : 30 à 60 secondes sur les créneaux publics, par clé `(salonId, memberId|ANY, jour, empreinte des prestations)`, invalidé à toute écriture de rendez-vous, d'horaire ou d'absence sur le salon. Les agendas professionnels ne sont jamais servis depuis ce cache — un gérant doit voir l'état réel.

**Fenêtre bornée** à 7 jours par requête, pour garder un coût de calcul prévisible.

**Couverture de tests visée : supérieure à 95 %** sur ce module, avec au minimum les cas suivants — ils constituent le critère d'acceptation de la phase 2 :

- créneau collé au début et à la fin d'une plage de travail ;
- absence chevauchant partiellement une plage, à cheval sur deux jours, ou couvrant la journée entière ;
- prestation plus longue que la plage d'ouverture restante (aucun créneau attendu) ;
- horaires du coiffeur plus larges que ceux du salon (l'intersection borne bien) ;
- marges avant/après empiétant sur un rendez-vous voisin ;
- deux prestations cumulées dépassant la fin de service ;
- **passage à l'heure d'été** : le dimanche ne compte que 23 heures, un créneau à 2 h 30 locale n'existe pas ;
- **retour à l'heure d'hiver** : 25 heures, l'heure locale 2 h 30 est ambiguë et doit être résolue de manière déterministe ;
- délai minimum et horizon maximum aux bornes exactes.

L'horloge est toujours injectée ou figée (`vi.setSystemTime`) : aucun test ne dépend de l'heure réelle.

## Conséquences

**Positives**

- **Aucun état dérivé ne peut se désynchroniser.** Changer un horaire prend effet immédiatement, sans tâche de régénération, sans créneau fantôme.
- Le moteur, étant pur, se teste sur des centaines de cas en quelques millisecondes — y compris les cas de calendrier impossibles à provoquer en base.
- Ajouter une règle (jour férié national, plage de pause déjeuner) revient à ajouter un ensemble à soustraire, sans migration de données.
- Les changements d'heure sont traités par construction et non par correctif.

**Négatives**

- **Coût CPU à chaque affichage** de créneaux, là où l'option (a) ne faisait qu'une lecture indexée. Atténué par le cache et la fenêtre bornée, mais c'est le point à surveiller en charge : un salon très fréquenté consulté par de nombreux visiteurs simultanés est le scénario à mesurer avant mise en production.
- Impossible de poser une réservation par simple mise à jour d'une ligne de créneau : l'intégrité contre la double réservation doit être obtenue autrement — c'est l'objet de l'**ADR-0004**.
- La complexité se concentre dans un module unique. C'est voulu — un bug y est cherché à un seul endroit — mais cela en fait le point de fragilité du produit, d'où l'exigence de couverture.
- La sélection du coiffeur en mode « peu importe » introduit une règle métier (le moins chargé) qui pourra devoir évoluer — équité des revenus entre coiffeurs, préférence du client habituel. Elle est isolée dans une fonction dédiée pour rester remplaçable.

**Hors périmètre**

Les ressources matérielles partagées — bacs de lavage, fauteuils, casques — ne sont pas modélisées. Deux colorations simultanées chez deux coiffeurs différents sont donc considérées comme possibles même si le salon ne dispose que d'un poste. Si le besoin apparaît, il fera l'objet d'un ADR distinct : c'est un problème de contrainte de capacité, structurellement différent de la disponibilité d'une personne.
