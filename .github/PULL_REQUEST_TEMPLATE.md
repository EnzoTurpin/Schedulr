## Contexte

<!-- Pourquoi ce changement est-il nécessaire ? -->

## Changements effectués

<!-- Liste des modifications principales -->

## Comment tester

<!-- Étapes de reproduction / validation -->

## Checklist

- [ ] Tests ajoutés / mis à jour
- [ ] Documentation mise à jour
- [ ] Pas de breaking change (ou documenté)
- [ ] Reviewed localement

### Spécifique à Schedulr

- [ ] Toute nouvelle table métier porte `salonId` et passe par le client scopé (ADR-0002)
- [ ] Toute écriture de rendez-vous respecte la contrainte d'exclusion (ADR-0004)
- [ ] Aucune donnée personnelle ni identifiant dans les logs
- [ ] Éléments interactifs accessibles au clavier
