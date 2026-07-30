'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { getAvailability } from '@/features/availability'
import { crossSalon } from '@/lib/db/scoped'
import { requireActor, UnauthenticatedError } from '@/lib/auth/actor'
import { assertCan } from '@/lib/authz/can'
import { ForbiddenError, ResourceNotFoundError } from '@/lib/authz/types'
import { SlotConflictError } from '@/lib/db/errors'
import { RULES, callerKey, consume } from '@/lib/rateLimit'
import { cancelBooking } from './cancel'
import { createBooking } from './create'
import {
  AppointmentNotActiveError,
  CancellationTooLateError,
  SlotUnavailableError,
} from './errors'

/**
 * Frontière HTTP de la réservation.
 *
 * Ces fonctions authentifient, valident l'entrée et délèguent. Aucune règle
 * métier ici : elle vit dans `create.ts` et `cancel.ts`, ce qui la rend
 * testable sans passer par Next.js (ADR-0001).
 */

const HORIZON_DAYS = 7

const slotsSchema = z.object({
  salonId: z.string().min(1),
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  memberId: z.string().min(1).nullable(),
  /** Premier jour de la fenêtre, au format `AAAA-MM-JJ`. */
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export type SlotView = { startAt: number; endAt: number; memberId: string }

export type SlotsResult = { ok: true; slots: SlotView[] } | { ok: false; error: string }

/** Créneaux réservables sur une fenêtre de sept jours. */
export async function fetchSlots(raw: unknown): Promise<SlotsResult> {
  const parsed = slotsSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Requête invalide.' }
  }

  const from = new Date(`${parsed.data.fromDate}T00:00:00Z`)
  const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)

  try {
    const availability = await getAvailability({
      salonId: parsed.data.salonId,
      serviceIds: parsed.data.serviceIds,
      memberId: parsed.data.memberId,
      from,
      to,
    })

    return { ok: true, slots: availability.slots }
  } catch (error) {
    console.error('fetchSlots', { salonId: parsed.data.salonId, error })
    return { ok: false, error: 'Impossible de charger les disponibilités.' }
  }
}

const confirmSchema = z.object({
  salonId: z.string().min(1),
  serviceIds: z.array(z.string().min(1)).min(1).max(10),
  memberId: z.string().min(1).nullable(),
  /** Instant de départ en millisecondes. La fin est calculée par le serveur. */
  startAt: z.number().int().positive(),
  clientNote: z.string().max(500).optional(),
})

export type ConfirmResult =
  { ok: true; appointmentId: string } | { ok: false; error: string; retry?: boolean }

/**
 * Confirme la réservation.
 *
 * `retry: true` signale à l'interface qu'elle doit recharger les créneaux :
 * le créneau visé vient d'être pris.
 */
export async function confirmBooking(raw: unknown): Promise<ConfirmResult> {
  const parsed = confirmSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Requête invalide.' }
  }

  if (!consume(callerKey(await headers(), 'booking'), RULES.booking).allowed) {
    return {
      ok: false,
      error: 'Trop de réservations en peu de temps. Réessayez plus tard.',
    }
  }

  try {
    const actor = await requireActor()
    assertCan(actor, 'appointment:book', {
      kind: 'salon',
      salonId: parsed.data.salonId,
    })

    const result = await createBooking(actor, {
      salonId: parsed.data.salonId,
      serviceIds: parsed.data.serviceIds,
      memberId: parsed.data.memberId,
      startAt: new Date(parsed.data.startAt),
      clientNote: parsed.data.clientNote,
    })

    return { ok: true, appointmentId: result.appointmentId }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: 'Connectez-vous pour réserver.' }
    }
    if (error instanceof SlotConflictError || error instanceof SlotUnavailableError) {
      return {
        ok: false,
        error: 'Ce créneau vient d’être réservé. Choisissez-en un autre.',
        retry: true,
      }
    }
    // Journalisation sans donnée personnelle (CLAUDE.md).
    console.error('confirmBooking', { salonId: parsed.data.salonId, error })
    return { ok: false, error: 'La réservation a échoué. Réessayez.' }
  }
}

export type CancelResult = { ok: true } | { ok: false; error: string }

/** Annulation depuis l'espace client. */
export async function cancelAppointment(appointmentId: string): Promise<CancelResult> {
  try {
    const actor = await requireActor()
    await cancelBooking(actor, { appointmentId })
    return { ok: true }
  } catch (error) {
    if (error instanceof CancellationTooLateError) {
      return { ok: false, error: error.message }
    }
    if (error instanceof AppointmentNotActiveError) {
      return { ok: false, error: 'Ce rendez-vous a déjà été annulé.' }
    }
    // Un tiers ne doit pas apprendre que ce rendez-vous existe : même message
    // pour « introuvable » et « interdit » (ADR-0002).
    if (error instanceof ResourceNotFoundError || error instanceof ForbiddenError) {
      return { ok: false, error: 'Rendez-vous introuvable.' }
    }
    console.error('cancelAppointment', { error })
    return { ok: false, error: 'L’annulation a échoué. Réessayez.' }
  }
}

/**
 * Rendez-vous du client chevauchant un créneau, tous salons confondus.
 *
 * Averti et non refusé : un parent réservant pour son enfant depuis son propre
 * compte est un cas légitime, qu'une contrainte en base interdirait. La lecture
 * franchit délibérément la frontière inter-salons — le conflit d'agenda d'une
 * personne ne s'arrête pas à la porte d'un salon.
 */
export async function checkClientOverlapAction(raw: unknown): Promise<{
  ok: boolean
  conflicts: { startAt: number; salonName: string }[]
}> {
  const parsed = z
    .object({ startAt: z.number().int().positive(), endAt: z.number().int().positive() })
    .safeParse(raw)
  if (!parsed.success) return { ok: false, conflicts: [] }

  try {
    const actor = await requireActor()

    const rows = await crossSalon(
      'conflit d’agenda du client, tous salons confondus',
    ).appointment.findMany({
      where: {
        clientId: actor.userId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startAt: { lt: new Date(parsed.data.endAt) },
        endAt: { gt: new Date(parsed.data.startAt) },
      },
      orderBy: { startAt: 'asc' },
      take: 5,
      select: { startAt: true, salon: { select: { name: true } } },
    })

    return {
      ok: true,
      conflicts: rows.map((row) => ({
        startAt: row.startAt.getTime(),
        salonName: row.salon.name,
      })),
    }
  } catch (error) {
    // L'avertissement est un confort : son échec ne doit pas bloquer la
    // réservation.
    console.error('checkClientOverlapAction', { error })
    return { ok: false, conflicts: [] }
  }
}
