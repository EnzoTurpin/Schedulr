import { describe, expect, it } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import {
  computeSlotsByStaff,
  computeSlotsForAnyStaff,
} from '@/features/availability/engine'
import type {
  AvailabilityInput,
  RecurringRange,
  StaffAvailability,
} from '@/features/availability/types'

/**
 * Moteur de disponibilité — cas limites métier (ADR-0003, critère
 * d'acceptation de la phase 2).
 *
 * L'instant courant est toujours injecté : aucun test ne dépend de l'horloge
 * réelle.
 */

const PARIS = 'Europe/Paris'
const h = (hours: number) => hours * 60

/** Mercredi 15 juillet 2026, jour ordinaire d'été. */
const WEDNESDAY = '2026-07-15'
const WEDNESDAY_DOW = 3

/** Heures locales des créneaux, pour des assertions lisibles. */
const at = (slots: { startAt: number }[]) =>
  slots.map((s) => formatInTimeZone(s.startAt, PARIS, 'HH:mm'))

const local = (date: string, time: string) => new Date(`${date}T${time}:00+02:00`)

/** Journée continue 9 h–19 h. */
const fullDay = (dow = WEDNESDAY_DOW): RecurringRange[] => [
  { dayOfWeek: dow, startMin: h(9), endMin: h(19) },
]

/** Journée avec coupure déjeuner 12 h–14 h. */
const splitDay = (dow = WEDNESDAY_DOW): RecurringRange[] => [
  { dayOfWeek: dow, startMin: h(9), endMin: h(12) },
  { dayOfWeek: dow, startMin: h(14), endMin: h(19) },
]

function staff(overrides: Partial<StaffAvailability> = {}): StaffAvailability {
  return {
    memberId: 'camille',
    workingHours: fullDay(),
    timeOff: [],
    busy: [],
    totalDurationMin: 60,
    ...overrides,
  }
}

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    salon: {
      timezone: PARIS,
      bookingLeadTimeMin: 0,
      bookingHorizonDays: 60,
      slotStepMin: 30,
    },
    openingHours: fullDay(),
    closures: [],
    staff: [staff()],
    from: local(WEDNESDAY, '00:00'),
    to: local(WEDNESDAY, '23:59'),
    now: local('2026-07-01', '10:00'),
    ...overrides,
  }
}

/** Créneaux du premier (et souvent unique) coiffeur. */
const slotsOf = (result: AvailabilityInput) => computeSlotsByStaff(result)[0]?.slots ?? []

describe('moteur de disponibilité', () => {
  describe('cas nominal', () => {
    it('should propose slots every step within the working window', () => {
      const slots = slotsOf(input())

      expect(at(slots)[0]).toBe('09:00')
      // Dernier départ possible pour une prestation d'une heure finissant à 19 h.
      expect(at(slots).at(-1)).toBe('18:00')
      expect(slots).toHaveLength(19) // 9 h → 18 h, toutes les 30 min
    })

    it('should end each slot after the full service duration', () => {
      const slots = slotsOf(input())
      const first = slots[0]!

      expect((first.endAt - first.startAt) / 60_000).toBe(60)
    })

    it('should honour the slot step of the salon', () => {
      const slots = slotsOf(
        input({
          salon: {
            timezone: PARIS,
            bookingLeadTimeMin: 0,
            bookingHorizonDays: 60,
            slotStepMin: 15,
          },
        }),
      )

      expect(at(slots).slice(0, 3)).toEqual(['09:00', '09:15', '09:30'])
    })

    it('should return nothing on a day the staff does not work', () => {
      // Les horaires ne couvrent que le mercredi ; on demande le jeudi.
      const slots = slotsOf(
        input({
          from: local('2026-07-16', '00:00'),
          to: local('2026-07-16', '23:59'),
        }),
      )

      expect(slots).toEqual([])
    })
  })

  describe('intersection salon / coiffeur', () => {
    it('should bound staff hours by the salon opening hours', () => {
      const slots = slotsOf(
        input({
          openingHours: [{ dayOfWeek: WEDNESDAY_DOW, startMin: h(10), endMin: h(17) }],
          staff: [staff({ workingHours: fullDay() })],
        }),
      )

      expect(at(slots)[0]).toBe('10:00')
      expect(at(slots).at(-1)).toBe('16:00')
    })

    it('should return nothing when the salon is closed that weekday', () => {
      const slots = slotsOf(
        input({ openingHours: [{ dayOfWeek: 1, startMin: h(9), endMin: h(19) }] }),
      )

      expect(slots).toEqual([])
    })

    it('should not offer a slot spanning the lunch break', () => {
      // 11 h 30 laisserait 30 min avant la coupure : insuffisant pour 60 min.
      const slots = slotsOf(
        input({ openingHours: splitDay(), staff: [staff({ workingHours: splitDay() })] }),
      )

      expect(at(slots)).toContain('11:00')
      expect(at(slots)).not.toContain('11:30')
      expect(at(slots)).toContain('14:00')
    })

    it('should offer a slot ending exactly at the break boundary', () => {
      const slots = slotsOf(
        input({ openingHours: splitDay(), staff: [staff({ workingHours: splitDay() })] }),
      )

      const eleven = slots.find(
        (s) => formatInTimeZone(s.startAt, PARIS, 'HH:mm') === '11:00',
      )
      expect(formatInTimeZone(eleven!.endAt, PARIS, 'HH:mm')).toBe('12:00')
    })
  })

  describe('rendez-vous existants', () => {
    it('should remove a slot already taken', () => {
      const slots = slotsOf(
        input({
          staff: [
            staff({
              busy: [
                {
                  start: local(WEDNESDAY, '14:00').getTime(),
                  end: local(WEDNESDAY, '15:00').getTime(),
                },
              ],
            }),
          ],
        }),
      )

      expect(at(slots)).not.toContain('14:00')
      expect(at(slots)).not.toContain('13:30') // empiéterait sur le rendez-vous
      expect(at(slots)).toContain('13:00')
      expect(at(slots)).toContain('15:00')
    })

    it('should offer the slot starting exactly when an appointment ends', () => {
      // Convention semi-ouverte : un rendez-vous 14 h–15 h laisse 15 h libre.
      const slots = slotsOf(
        input({
          staff: [
            staff({
              busy: [
                {
                  start: local(WEDNESDAY, '14:00').getTime(),
                  end: local(WEDNESDAY, '15:00').getTime(),
                },
              ],
            }),
          ],
        }),
      )

      expect(at(slots)).toContain('15:00')
    })

    it('should handle several appointments in the same day', () => {
      const slots = slotsOf(
        input({
          staff: [
            staff({
              busy: [
                {
                  start: local(WEDNESDAY, '10:00').getTime(),
                  end: local(WEDNESDAY, '11:00').getTime(),
                },
                {
                  start: local(WEDNESDAY, '15:00').getTime(),
                  end: local(WEDNESDAY, '16:30').getTime(),
                },
              ],
            }),
          ],
        }),
      )

      expect(at(slots)).not.toContain('10:00')
      expect(at(slots)).not.toContain('15:00')
      expect(at(slots)).not.toContain('16:00')
      expect(at(slots)).toContain('11:00')
      expect(at(slots)).toContain('17:00')
    })
  })

  describe('absences et fermetures', () => {
    it('should remove slots covered by a time off', () => {
      const slots = slotsOf(
        input({
          staff: [
            staff({
              timeOff: [
                {
                  start: local(WEDNESDAY, '09:00').getTime(),
                  end: local(WEDNESDAY, '13:00').getTime(),
                },
              ],
            }),
          ],
        }),
      )

      expect(at(slots)[0]).toBe('13:00')
    })

    it('should handle a time off spanning several days', () => {
      // Une semaine de congés couvrant le jour demandé.
      const slots = slotsOf(
        input({
          staff: [
            staff({
              timeOff: [
                {
                  start: local('2026-07-13', '00:00').getTime(),
                  end: local('2026-07-20', '00:00').getTime(),
                },
              ],
            }),
          ],
        }),
      )

      expect(slots).toEqual([])
    })

    it('should handle a time off starting mid-day and ending the next morning', () => {
      const slots = slotsOf(
        input({
          staff: [
            staff({
              timeOff: [
                {
                  start: local(WEDNESDAY, '15:00').getTime(),
                  end: local('2026-07-16', '10:00').getTime(),
                },
              ],
            }),
          ],
        }),
      )

      expect(at(slots).at(-1)).toBe('14:00')
    })

    it('should remove slots covered by a salon closure', () => {
      const slots = slotsOf(
        input({
          closures: [
            {
              start: local(WEDNESDAY, '00:00').getTime(),
              end: local('2026-07-16', '00:00').getTime(),
            },
          ],
        }),
      )

      expect(slots).toEqual([])
    })

    it('should apply a closure to every member of the team', () => {
      const result = computeSlotsByStaff(
        input({
          staff: [staff({ memberId: 'camille' }), staff({ memberId: 'alex' })],
          closures: [
            {
              start: local(WEDNESDAY, '00:00').getTime(),
              end: local('2026-07-16', '00:00').getTime(),
            },
          ],
        }),
      )

      expect(result.every((r) => r.slots.length === 0)).toBe(true)
    })
  })

  describe('règles de réservation', () => {
    it('should exclude slots before the minimum lead time', () => {
      const slots = slotsOf(
        input({
          salon: {
            timezone: PARIS,
            bookingLeadTimeMin: 120,
            bookingHorizonDays: 60,
            slotStepMin: 30,
          },
          now: local(WEDNESDAY, '09:00'),
        }),
      )

      // 9 h + 2 h de délai : le premier départ possible est 11 h.
      expect(at(slots)[0]).toBe('11:00')
    })

    it('should include the slot exactly at the lead time boundary', () => {
      const slots = slotsOf(
        input({
          salon: {
            timezone: PARIS,
            bookingLeadTimeMin: 120,
            bookingHorizonDays: 60,
            slotStepMin: 30,
          },
          now: local(WEDNESDAY, '08:00'),
        }),
      )

      expect(at(slots)[0]).toBe('10:00')
    })

    it('should exclude slots beyond the booking horizon', () => {
      const slots = slotsOf(
        input({
          salon: {
            timezone: PARIS,
            bookingLeadTimeMin: 0,
            bookingHorizonDays: 7,
            slotStepMin: 30,
          },
          now: local('2026-07-01', '10:00'),
        }),
      )

      // Le 15 juillet est au-delà de 7 jours après le 1er.
      expect(slots).toEqual([])
    })

    it('should return nothing when the service is longer than the opening window', () => {
      const slots = slotsOf(
        input({
          openingHours: [{ dayOfWeek: WEDNESDAY_DOW, startMin: h(9), endMin: h(11) }],
          staff: [staff({ workingHours: fullDay(), totalDurationMin: h(3) })],
        }),
      )

      expect(slots).toEqual([])
    })

    it('should return nothing when the duration is zero', () => {
      const slots = slotsOf(input({ staff: [staff({ totalDurationMin: 0 })] }))

      expect(slots).toEqual([])
    })
  })

  describe('durée dépendant du coiffeur', () => {
    it('should offer fewer slots to a slower hairdresser', () => {
      const result = computeSlotsByStaff(
        input({
          staff: [
            staff({ memberId: 'rapide', totalDurationMin: 30 }),
            staff({ memberId: 'apprenti', totalDurationMin: 120 }),
          ],
        }),
      )

      const rapide = result.find((r) => r.memberId === 'rapide')!
      const apprenti = result.find((r) => r.memberId === 'apprenti')!

      expect(rapide.slots.length).toBeGreaterThan(apprenti.slots.length)
      expect(at(apprenti.slots).at(-1)).toBe('17:00')
    })
  })

  describe('changement d’heure', () => {
    // 29 mars 2026 : dimanche du passage à l'heure d'été (journée de 23 h).
    const SPRING = '2026-03-29'
    const SUNDAY = 0

    it('should keep opening hours at their local wall-clock time in spring', () => {
      const slots = slotsOf(
        input({
          openingHours: [{ dayOfWeek: SUNDAY, startMin: h(9), endMin: h(19) }],
          staff: [
            staff({
              workingHours: [{ dayOfWeek: SUNDAY, startMin: h(9), endMin: h(19) }],
            }),
          ],
          from: new Date(`${SPRING}T00:00:00+01:00`),
          to: new Date(`${SPRING}T23:00:00+02:00`),
          now: new Date('2026-03-20T10:00:00+01:00'),
        }),
      )

      // Sans conversion explicite, « minuit + 9 h » donnerait 10 h ce jour-là.
      expect(at(slots)[0]).toBe('09:00')
      expect(at(slots).at(-1)).toBe('18:00')
    })

    it('should keep opening hours at their local wall-clock time in autumn', () => {
      // 25 octobre 2026 : retour à l'heure d'hiver, journée de 25 h.
      const AUTUMN = '2026-10-25'
      const slots = slotsOf(
        input({
          openingHours: [{ dayOfWeek: SUNDAY, startMin: h(9), endMin: h(19) }],
          staff: [
            staff({
              workingHours: [{ dayOfWeek: SUNDAY, startMin: h(9), endMin: h(19) }],
            }),
          ],
          from: new Date(`${AUTUMN}T00:00:00+02:00`),
          to: new Date(`${AUTUMN}T23:00:00+01:00`),
          now: new Date('2026-10-20T10:00:00+02:00'),
        }),
      )

      expect(at(slots)[0]).toBe('09:00')
      expect(at(slots).at(-1)).toBe('18:00')
    })

    it('should not duplicate slots on the 25-hour day', () => {
      const AUTUMN = '2026-10-25'
      const slots = slotsOf(
        input({
          openingHours: [{ dayOfWeek: SUNDAY, startMin: h(9), endMin: h(19) }],
          staff: [
            staff({
              workingHours: [{ dayOfWeek: SUNDAY, startMin: h(9), endMin: h(19) }],
            }),
          ],
          from: new Date(`${AUTUMN}T00:00:00+02:00`),
          to: new Date(`${AUTUMN}T23:00:00+01:00`),
          now: new Date('2026-10-20T10:00:00+02:00'),
        }),
      )

      const starts = slots.map((s) => s.startAt)
      expect(new Set(starts).size).toBe(starts.length)
    })
  })

  describe('plage débordant sur le lendemain', () => {
    // Un salon ouvert de 22 h à 2 h s'écrit endMin = 1560 (26 h). La plage
    // traverse minuit local, et le moteur découpe par journée civile : ce cas
    // vérifie qu'aucun créneau n'est ni perdu à la frontière, ni compté deux
    // fois par les fenêtres journalières qui se recouvrent.
    const lateNight = [{ dayOfWeek: WEDNESDAY_DOW, startMin: h(22), endMin: h(26) }]

    const lateInput = () =>
      input({
        openingHours: lateNight,
        staff: [staff({ workingHours: lateNight, totalDurationMin: 60 })],
        from: local(WEDNESDAY, '00:00'),
        to: new Date('2026-07-17T00:00:00+02:00'),
      })

    it('should offer slots on both sides of local midnight', () => {
      const times = at(slotsOf(lateInput()))

      expect(times).toContain('22:00')
      expect(times).toContain('23:00')
      expect(times).toContain('00:00')
      expect(times).toContain('01:00')
    })

    it('should not duplicate the slots that fall after midnight', () => {
      const starts = slotsOf(lateInput()).map((s) => s.startAt)

      expect(new Set(starts).size).toBe(starts.length)
    })

    it('should not offer a slot that would run past closing time', () => {
      const times = at(slotsOf(lateInput()))

      // 01:30 finirait à 02:30, après la fermeture.
      expect(times).not.toContain('01:30')
      expect(times.at(-1)).toBe('01:00')
    })
  })

  describe('« n’importe quel coiffeur »', () => {
    it('should return one slot per start time', () => {
      const slots = computeSlotsForAnyStaff(
        input({ staff: [staff({ memberId: 'camille' }), staff({ memberId: 'alex' })] }),
      )

      const starts = slots.map((s) => s.startAt)
      expect(new Set(starts).size).toBe(starts.length)
    })

    it('should prefer the least loaded hairdresser', () => {
      const busyOne = {
        start: local(WEDNESDAY, '17:00').getTime(),
        end: local(WEDNESDAY, '18:00').getTime(),
      }
      const slots = computeSlotsForAnyStaff(
        input({
          staff: [
            staff({ memberId: 'charge', busy: [busyOne] }),
            staff({ memberId: 'libre' }),
          ],
        }),
      )

      expect(slots[0]?.memberId).toBe('libre')
    })

    it('should be deterministic when hairdressers are equally loaded', () => {
      const build = () =>
        computeSlotsForAnyStaff(
          input({ staff: [staff({ memberId: 'zoe' }), staff({ memberId: 'alex' })] }),
        )

      expect(build()[0]?.memberId).toBe(build()[0]?.memberId)
      // Égalité tranchée sur l'identifiant, par ordre alphabétique.
      expect(build()[0]?.memberId).toBe('alex')
    })

    it('should fall back to the available hairdresser when the other is busy', () => {
      const slots = computeSlotsForAnyStaff(
        input({
          staff: [
            staff({
              memberId: 'alex',
              busy: [
                {
                  start: local(WEDNESDAY, '09:00').getTime(),
                  end: local(WEDNESDAY, '10:00').getTime(),
                },
              ],
            }),
            staff({ memberId: 'zoe' }),
          ],
        }),
      )

      expect(slots[0]?.memberId).toBe('zoe')
      expect(at(slots)[0]).toBe('09:00')
    })

    it('should return nothing when no hairdresser is available', () => {
      const slots = computeSlotsForAnyStaff(input({ staff: [] }))

      expect(slots).toEqual([])
    })
  })

  describe('fenêtre demandée', () => {
    it('should not return slots outside the requested window', () => {
      const slots = slotsOf(
        input({
          from: local(WEDNESDAY, '14:00'),
          to: local(WEDNESDAY, '16:00'),
        }),
      )

      expect(at(slots)[0]).toBe('14:00')
      expect(at(slots).at(-1)).toBe('15:00')
    })

    it('should span several days', () => {
      const result = computeSlotsByStaff(
        input({
          openingHours: [...fullDay(WEDNESDAY_DOW), ...fullDay(4)],
          staff: [staff({ workingHours: [...fullDay(WEDNESDAY_DOW), ...fullDay(4)] })],
          from: local(WEDNESDAY, '00:00'),
          to: local('2026-07-17', '00:00'),
        }),
      )

      const days = new Set(
        result[0]!.slots.map((s) => formatInTimeZone(s.startAt, PARIS, 'yyyy-MM-dd')),
      )
      expect([...days]).toEqual(['2026-07-15', '2026-07-16'])
    })
  })
})
