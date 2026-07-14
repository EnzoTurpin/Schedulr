import { describe, expect, it } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import {
  addCivilDays,
  civilDateOf,
  civilDatesBetween,
  localDayOfWeek,
  localMidnight,
  localMinutesToInstant,
  localRangeToInterval,
  localTimeExists,
} from '@/features/availability/time'

/**
 * Fuseaux horaires et changements d'heure (ADR-0003).
 *
 * Ces tests sont la raison d'être de la séparation « minutes locales » /
 * « instants absolus ». Ils s'exécutent avec `TZ=UTC` (voir vitest.config.ts) :
 * si le code dépendait du fuseau de la machine, ils échoueraient.
 *
 * Repères Europe/Paris 2026, vérifiés sur la bibliothèque :
 *   - 29 mars  : passage à l'heure d'été. Journée de 23 h, 02:00→03:00.
 *   - 25 octobre : retour à l'heure d'hiver. Journée de 25 h, 03:00→02:00.
 */

const PARIS = 'Europe/Paris'
const h = (hours: number) => hours * 60

/** Heure locale lisible d'un instant, pour des assertions parlantes. */
const localTime = (instant: Date | number) =>
  formatInTimeZone(instant, PARIS, 'yyyy-MM-dd HH:mm')

describe('localMinutesToInstant', () => {
  it('should convert a winter morning to UTC+1', () => {
    const instant = localMinutesToInstant('2026-01-15', h(9), PARIS)

    expect(instant.toISOString()).toBe('2026-01-15T08:00:00.000Z')
  })

  it('should convert a summer morning to UTC+2', () => {
    const instant = localMinutesToInstant('2026-07-15', h(9), PARIS)

    expect(instant.toISOString()).toBe('2026-07-15T07:00:00.000Z')
  })

  it('should round-trip to the same local time on an ordinary day', () => {
    expect(localTime(localMinutesToInstant('2026-07-15', h(14) + 30, PARIS))).toBe(
      '2026-07-15 14:30',
    )
  })

  it('should shift to the next civil day when minutes exceed a day', () => {
    // Une plage se terminant à 01:00 le lendemain s'écrit endMin = 1500.
    const instant = localMinutesToInstant('2026-07-15', h(25), PARIS)

    expect(localTime(instant)).toBe('2026-07-16 01:00')
  })

  it('should handle midnight as minute zero', () => {
    expect(localTime(localMinutesToInstant('2026-07-15', 0, PARIS))).toBe(
      '2026-07-15 00:00',
    )
  })

  describe('passage à l’heure d’été (29 mars 2026)', () => {
    it('should keep 09:00 local as 09:00 local, not 10:00', () => {
      // Le piège central : « minuit + 9 h » donnerait 10 h ce jour-là, la
      // journée ne durant que 23 heures.
      expect(localTime(localMinutesToInstant('2026-03-29', h(9), PARIS))).toBe(
        '2026-03-29 09:00',
      )
    })

    it('should make the day last 23 hours', () => {
      const start = localMidnight('2026-03-29', PARIS)
      const end = localMidnight('2026-03-30', PARIS)

      expect((end - start) / 3_600_000).toBe(23)
    })

    it('should convert 01:30 before the jump to UTC+1', () => {
      expect(localMinutesToInstant('2026-03-29', h(1) + 30, PARIS).toISOString()).toBe(
        '2026-03-29T00:30:00.000Z',
      )
    })

    it('should convert 03:30 after the jump to UTC+2', () => {
      expect(localMinutesToInstant('2026-03-29', h(3) + 30, PARIS).toISOString()).toBe(
        '2026-03-29T01:30:00.000Z',
      )
    })
  })

  describe('retour à l’heure d’hiver (25 octobre 2026)', () => {
    it('should keep 09:00 local as 09:00 local', () => {
      expect(localTime(localMinutesToInstant('2026-10-25', h(9), PARIS))).toBe(
        '2026-10-25 09:00',
      )
    })

    it('should make the day last 25 hours', () => {
      const start = localMidnight('2026-10-25', PARIS)
      const end = localMidnight('2026-10-26', PARIS)

      expect((end - start) / 3_600_000).toBe(25)
    })

    it('should resolve the ambiguous 02:30 deterministically', () => {
      // 02:30 survient deux fois. Peu importe laquelle est choisie, pourvu que
      // le choix soit stable : un créneau ne doit pas se déplacer d'un appel à
      // l'autre.
      const first = localMinutesToInstant('2026-10-25', h(2) + 30, PARIS)
      const second = localMinutesToInstant('2026-10-25', h(2) + 30, PARIS)

      expect(first.toISOString()).toBe(second.toISOString())
      expect(first.toISOString()).toBe('2026-10-25T01:30:00.000Z')
    })
  })
})

describe('localTimeExists', () => {
  it('should report an ordinary local time as existing', () => {
    expect(localTimeExists('2026-07-15', h(9), PARIS)).toBe(true)
  })

  it('should report 02:30 on the spring-forward day as not existing', () => {
    // Cette heure locale n'a jamais lieu : l'horloge saute de 02:00 à 03:00.
    expect(localTimeExists('2026-03-29', h(2) + 30, PARIS)).toBe(false)
  })

  it('should report times around the gap as existing', () => {
    expect(localTimeExists('2026-03-29', h(1) + 59, PARIS)).toBe(true)
    expect(localTimeExists('2026-03-29', h(3), PARIS)).toBe(true)
  })

  it('should report the ambiguous autumn time as existing', () => {
    expect(localTimeExists('2026-10-25', h(2) + 30, PARIS)).toBe(true)
  })
})

describe('localRangeToInterval', () => {
  it('should build an interval from a local range', () => {
    const interval = localRangeToInterval('2026-07-15', h(9), h(12), PARIS)

    expect(interval).not.toBeNull()
    expect(localTime(interval!.start)).toBe('2026-07-15 09:00')
    expect(localTime(interval!.end)).toBe('2026-07-15 12:00')
  })

  it('should return null for an empty range', () => {
    expect(localRangeToInterval('2026-07-15', h(9), h(9), PARIS)).toBeNull()
  })

  it('should return null for an inverted range', () => {
    expect(localRangeToInterval('2026-07-15', h(12), h(9), PARIS)).toBeNull()
  })

  it('should return null for a range entirely inside the spring gap', () => {
    // 02:00–03:00 le 29 mars n'existe à aucun moment : rien à proposer. Sans le
    // décalage vers la première heure réelle, la conversion brute fabriquerait
    // un créneau à 01:00 — un horaire que le salon n'a jamais déclaré.
    expect(localRangeToInterval('2026-03-29', h(2), h(3), PARIS)).toBeNull()
  })

  it('should return null when the end falls in the gap and collapses onto the start', () => {
    // 01:30–02:30 : la fin est rabattue sur le même instant que le début.
    // Sans cette garde, on produirait un intervalle de durée nulle ou négative.
    expect(localRangeToInterval('2026-03-29', h(1) + 30, h(2) + 30, PARIS)).toBeNull()
  })

  it('should shift the start to the first real time when it falls in the gap', () => {
    // 02:30–04:00 : seule la partie 03:00–04:00 existe réellement.
    const interval = localRangeToInterval('2026-03-29', h(2) + 30, h(4), PARIS)

    expect(interval).not.toBeNull()
    expect(localTime(interval!.start)).toBe('2026-03-29 03:00')
    expect(localTime(interval!.end)).toBe('2026-03-29 04:00')
  })

  it('should produce a one-hour-shorter interval across the spring jump', () => {
    // Une garde 01:00–04:00 ne dure que 2 h réelles ce jour-là.
    const interval = localRangeToInterval('2026-03-29', h(1), h(4), PARIS)

    expect(interval).not.toBeNull()
    expect((interval!.end - interval!.start) / 3_600_000).toBe(2)
  })

  it('should produce a one-hour-longer interval across the autumn fallback', () => {
    const interval = localRangeToInterval('2026-10-25', h(1), h(4), PARIS)

    expect(interval).not.toBeNull()
    expect((interval!.end - interval!.start) / 3_600_000).toBe(4)
  })

  it('should keep a normal salon range at its nominal duration on DST days', () => {
    // Les salons ouvrent à 9 h : le changement d'heure ne les affecte pas,
    // mais encore faut-il que le calcul le montre.
    const spring = localRangeToInterval('2026-03-29', h(9), h(19), PARIS)
    const autumn = localRangeToInterval('2026-10-25', h(9), h(19), PARIS)

    expect((spring!.end - spring!.start) / 3_600_000).toBe(10)
    expect((autumn!.end - autumn!.start) / 3_600_000).toBe(10)
  })
})

describe('localDayOfWeek', () => {
  it('should return 0 for a Sunday', () => {
    expect(localDayOfWeek('2026-03-29', PARIS)).toBe(0)
  })

  it('should return 1 for a Monday', () => {
    expect(localDayOfWeek('2026-03-30', PARIS)).toBe(1)
  })

  it('should return 6 for a Saturday', () => {
    expect(localDayOfWeek('2026-03-28', PARIS)).toBe(6)
  })
})

describe('civilDateOf & addCivilDays', () => {
  it('should read the civil date of an instant in the salon timezone', () => {
    // 23 h UTC en été, c'est déjà le lendemain à Paris.
    expect(civilDateOf(new Date('2026-07-15T23:00:00Z'), PARIS)).toBe('2026-07-16')
  })

  it('should add days across a month boundary', () => {
    expect(addCivilDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('should add days across the DST boundary without drifting', () => {
    expect(addCivilDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addCivilDays('2026-03-29', 1)).toBe('2026-03-30')
  })

  it('should subtract days', () => {
    expect(addCivilDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('civilDatesBetween', () => {
  it('should include both bounds', () => {
    const dates = civilDatesBetween(
      new Date('2026-07-15T08:00:00Z'),
      new Date('2026-07-17T08:00:00Z'),
      PARIS,
    )

    expect(dates).toEqual(['2026-07-15', '2026-07-16', '2026-07-17'])
  })

  it('should return a single date when the window stays within one day', () => {
    const dates = civilDatesBetween(
      new Date('2026-07-15T08:00:00Z'),
      new Date('2026-07-15T16:00:00Z'),
      PARIS,
    )

    expect(dates).toEqual(['2026-07-15'])
  })

  it('should span two civil days when the window crosses local midnight', () => {
    const dates = civilDatesBetween(
      new Date('2026-07-15T21:00:00Z'), // 23 h locales
      new Date('2026-07-15T23:00:00Z'), // 01 h locales le lendemain
      PARIS,
    )

    expect(dates).toEqual(['2026-07-15', '2026-07-16'])
  })

  it('should cover the DST day without skipping or duplicating it', () => {
    const dates = civilDatesBetween(
      new Date('2026-03-27T12:00:00Z'),
      new Date('2026-03-31T12:00:00Z'),
      PARIS,
    )

    expect(dates).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ])
  })

  it('should refuse an unreasonably long window', () => {
    expect(() =>
      civilDatesBetween(new Date('2020-01-01'), new Date('2026-01-01'), PARIS),
    ).toThrow(/400 jours/)
  })
})
