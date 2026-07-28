/**
 * Modèles porteurs de `salonId`, donc soumis au cloisonnement par salon
 * (ADR-0002).
 *
 * Cette liste est le point unique de vérité du client scopé. **Tout nouveau
 * modèle métier doit y être ajouté** : un modèle oublié ici n'est pas filtré et
 * devient une fuite entre salons.
 *
 * Les modèles absents de cette liste le sont pour une raison précise :
 *
 *   User, Account, Session, VerificationToken, ConsentRecord
 *     — un compte client n'appartient à aucun salon. Il peut réserver dans
 *       plusieurs salons ; le cloisonnement porte sur les données
 *       professionnelles, pas sur l'identité (ADR-0002).
 *
 *   Salon
 *     — la table des tenants elle-même. Filtrer `Salon` par `salonId` n'aurait
 *       pas de sens ; l'accès à une fiche salon est contrôlé par le RBAC.
 *
 *   AuditLog
 *     — `salonId` y est nullable : les actions de l'administrateur plateforme
 *       n'appartiennent à aucun salon. La lecture passe par le module
 *       inter-salons explicite.
 */
export const TENANT_MODELS = new Set([
  'SalonMember',
  'ServiceCategory',
  'Service',
  'StaffService',
  'OpeningHour',
  'WorkingHour',
  'TimeOff',
  'Closure',
  'Appointment',
  'AppointmentItem',
  'NotificationLog',
] as const)

export type TenantModel = typeof TENANT_MODELS extends Set<infer T> ? T : never

export function isTenantModel(model: string | undefined): boolean {
  return model !== undefined && TENANT_MODELS.has(model as TenantModel)
}
