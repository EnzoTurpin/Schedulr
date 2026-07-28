# ADR-0006 : Stockage des images par un service objet, avec téléversement direct

**Date** : 2026-07-29
**Statut** : Proposé

## Contexte

La phase 5 devait livrer les photos de salon — vitrine, intérieur, réalisations — ainsi que les portraits de l'équipe. Elles n'ont pas été faites : aucune décision n'avait été prise sur l'endroit où ces fichiers vivraient, et improviser ce choix engageait durablement le projet.

Ce qui est en jeu :

- **Volume et durée.** Un salon publie une dizaine de photos, une plateforme en compte donc quelques milliers. Ces fichiers survivent aux déploiements et doivent être sauvegardés avec le reste.
- **Contenu téléversé par des tiers.** Un gérant envoie un fichier arbitraire. Une image peut contenir du HTML interprétable, du SVG porteur de script, ou des métadonnées EXIF révélant la position GPS du domicile d'un coiffeur.
- **Coût de service.** Les photos sont sur la fiche salon, la page la plus consultée du produit et son principal canal d'acquisition (ADR-0001). Elles doivent être servies vite et près du visiteur.
- **RGPD.** Un portrait est une donnée personnelle. La suppression d'un membre doit emporter son image, et l'hébergement doit rester dans l'Union européenne ou sous garanties équivalentes.

### Options envisagées

**(a) Colonne binaire en base.** Simple à première vue : les sauvegardes couvrent tout, aucune infrastructure supplémentaire, aucune incohérence possible entre base et fichiers.

Mais PostgreSQL n'est pas un serveur de fichiers. Chaque image traverse l'application avant d'atteindre le visiteur, occupant une connexion de pool pour transférer des centaines de kilooctets. Les sauvegardes gonflent d'un ordre de grandeur, ce qui allonge d'autant la restauration — la procédure documentée dans `docs/exploitation.md` deviendrait impraticable. Aucun cache de périphérie possible.

**(b) Système de fichiers local.** Écarté d'emblée : l'application est déployée sans état, sur des instances éphémères. Un fichier écrit sur une instance n'existe pas sur les autres et disparaît au redéploiement.

**(c) Service de stockage objet, téléversement passant par l'application.** L'image transite par une route applicative qui la valide puis la dépose. Le contrôle est total, mais chaque téléversement mobilise une fonction serveur pendant toute la durée du transfert — et les hébergeurs sans état plafonnent la taille du corps de requête, souvent autour de 4 Mo, ce qu'une photo de téléphone dépasse couramment.

**(d) Service de stockage objet, téléversement direct depuis le navigateur.** L'application ne délivre qu'une autorisation de dépôt à durée limitée ; le navigateur envoie le fichier directement au service. Aucune fonction serveur n'est mobilisée pendant le transfert, aucune limite de corps de requête. En contrepartie, la validation ne peut plus être faite avant le dépôt.

## Décision

Nous retenons l'option **(d)** : stockage objet compatible S3, avec téléversement direct depuis le navigateur.

**Le fournisseur n'est pas figé.** L'accès passe par un module `src/services/storage.ts` exposant quatre opérations — `createUploadUrl`, `delete`, `publicUrl`, `head` — derrière une interface indépendante du service. Vercel Blob, Cloudflare R2 et Scaleway Object Storage conviennent tous ; le choix relève du contexte de déploiement et de la localisation des données, pas de l'architecture. Cette indifférence est délibérée : elle rend la décision réversible, comme l'interface étroite du calendrier (ADR-0005).

### Ce qui rend le téléversement direct acceptable

Le point faible de l'option (d) est qu'on ne peut pas inspecter le fichier avant qu'il arrive. Quatre mesures compensent, et **la décision n'est pas valide sans elles** :

1. **L'autorisation de dépôt est contrainte.** L'application ne la délivre qu'après avoir vérifié le droit `salon:update`, et elle fixe le type MIME accepté, la taille maximale (5 Mo) et le chemin de destination. Un client ne choisit ni où il écrit, ni quoi.

2. **Le fichier est validé après dépôt, avant d'être visible.** Une image reste `PENDING` jusqu'à ce qu'un traitement serveur ait relu ses octets, vérifié que l'en-tête correspond bien à une image — le type MIME annoncé par le navigateur ne prouve rien — puis produit une version WebP redimensionnée. C'est cette version dérivée qui est servie, jamais l'original.

3. **Le SVG est refusé.** Un SVG est un document XML capable de porter du script. Aucun format vectoriel n'est accepté : JPEG, PNG et WebP uniquement.

4. **Les métadonnées EXIF sont supprimées** au réencodage. Une photo prise au téléphone contient couramment la position GPS ; publier le domicile d'un coiffeur serait une faute lourde.

Le domaine de service est ajouté à la directive `img-src` de la politique de sécurité de contenu — et à elle seule. Il ne peut donc pas servir de source de script.

### Modèle de données

```prisma
model SalonImage {
  id       String   @id @default(cuid())
  salonId  String
  /// Clé dans le service de stockage. Jamais une URL : le fournisseur change.
  key      String   @unique
  kind     ImageKind        // COVER | GALLERY | MEMBER_AVATAR
  /// Portrait rattaché à un membre ; nul pour une photo de salon.
  memberId String?
  /// Obligatoire : une image sans texte alternatif est inaccessible.
  alt      String
  width    Int
  height   Int
  status   ImageStatus @default(PENDING)
  position Int      @default(0)
  ...
}
```

`salonId` est présent comme sur toute table métier (ADR-0002), et le chemin de stockage le reprend : `salons/{salonId}/{uuid}.webp`. Une image mal rattachée est ainsi visible dans son emplacement même.

Le texte alternatif est **obligatoire au niveau du schéma**. Le rendre facultatif reviendrait à le rendre absent, et le projet vise WCAG 2.1 AA.

### Suppression

La suppression d'une image, d'un membre ou d'un salon efface les objets correspondants dans le service de stockage. Cette opération peut échouer sans que la transaction en base en pâtisse : un objet orphelin est un coût, pas une faute. Une tâche de rapprochement hebdomadaire les recense et les supprime.

L'anonymisation d'un compte (phase 8) emporte le portrait du membre concerné.

## Conséquences

**Positives**

- Les images ne traversent jamais l'application : ni pool de connexions occupé, ni fonction serveur mobilisée, ni limite de taille de requête.
- Les sauvegardes de la base restent légères, et la procédure de restauration documentée reste praticable.
- Service depuis un réseau de périphérie, ce qui préserve les scores de performance de la fiche salon.
- Le fournisseur peut changer sans toucher au code métier.

**Négatives**

- **Deux systèmes à sauvegarder** au lieu d'un, et deux états qui peuvent diverger. C'est le vrai prix de cette décision : la tâche de rapprochement n'est pas un détail d'implémentation mais une condition de bon fonctionnement.
- **Une fenêtre entre le dépôt et la validation** pendant laquelle un objet non vérifié existe dans le stockage. Il n'est jamais servi — le statut `PENDING` l'en empêche — mais il occupe de la place. Les objets restés `PENDING` au-delà d'une heure sont purgés.
- **Un coût de service supplémentaire**, au stockage et à la bande passante. Marginal à cette échelle, mais il croît avec le nombre de salons.
- **Une dépendance de plus** : `sharp` pour le réencodage. Elle est déjà présente en dépendance transitive de Next.js.
- La localisation des données devient un critère de choix du fournisseur, et non plus une propriété héritée de la base.

**Ce que cette décision ne tranche pas**

Le fournisseur lui-même. Trois candidats conviennent ; le choix dépend de l'hébergement retenu, du budget et de la localisation exigée. Il devra être arrêté avant l'implémentation, et consigné en amendement de cet ADR.
