import { z } from 'zod'
import type { Actor } from '@/lib/authz/types'
import { prisma } from '@/lib/db/client'

/**
 * Profil du titulaire du compte.
 *
 * Le téléphone n'est pas un détail de confort : sans lui, le canal SMS —
 * consentement, rappels J-1, quota mensuel — reste hors d'atteinte. Il n'était
 * jusqu'ici saisissable nulle part, alors que `ConsentToggle` invitait à le
 * renseigner « dans votre profil ».
 */

/**
 * Numéro au format E.164, seul accepté par Twilio.
 *
 * Les séparateurs usuels — espaces, points, tirets, parenthèses — sont retirés
 * avant validation : les refuser ferait échouer une saisie parfaitement
 * lisible. Le préfixe `0` français est converti en `+33`, forme sous laquelle
 * la quasi-totalité des numéros seront saisis ici.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s.\-()]/g, ''))
  .transform((value) => (/^0[1-9]\d{8}$/.test(value) ? `+33${value.slice(1)}` : value))
  .refine((value) => /^\+[1-9]\d{7,14}$/.test(value), {
    message:
      'Numéro invalide. Attendu : 06 12 34 56 78, ou un format international (+33…).',
  })

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Prénom requis').max(80),
  lastName: z.string().trim().min(1, 'Nom requis').max(80),
  // Vide accepté : le téléphone reste facultatif, on ne bloque pas un compte
  // qui n'utilise que le courriel.
  phone: z.union([z.literal(''), phoneSchema]),
})

export type ProfileInput = z.infer<typeof profileSchema>

export async function getProfile(actor: Actor) {
  return prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { email: true, firstName: true, lastName: true, phone: true },
  })
}

/**
 * Enregistre le profil.
 *
 * Effacer le numéro ne retire pas le consentement SMS déjà donné : celui-ci est
 * un fait daté, que le registre doit conserver (RGPD). L'envoi, lui, s'arrête
 * de lui-même faute de destinataire.
 */
export async function updateProfile(actor: Actor, input: ProfileInput): Promise<void> {
  await prisma.user.update({
    where: { id: actor.userId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone === '' ? null : input.phone,
    },
  })
}
