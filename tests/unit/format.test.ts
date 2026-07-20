import { describe, expect, it } from 'vitest'
import {
  dayName,
  formatDateTimeLong,
  formatDayLong,
  formatDuration,
  formatMinutesOfDay,
  formatPrice,
  formatTime,
  groupByDay,
} from '@/lib/format'

const PARIS = 'Europe/Paris'

describe('formatPrice', () => {
  it('should format an amount in euros with two decimals', () => {
    // Espace insécable étroit avant le symbole : c'est la convention française
    // produite par Intl, à ne pas « corriger » en espace ordinaire.
    expect(formatPrice(3500).replace(/ | /g, ' ')).toBe('35,00 €')
  })

  it('should format a non-round amount', () => {
    expect(formatPrice(4250).replace(/ | /g, ' ')).toBe('42,50 €')
  })

  it('should format zero', () => {
    expect(formatPrice(0).replace(/ | /g, ' ')).toBe('0,00 €')
  })
})

describe('formatDuration', () => {
  it('should format a duration under an hour in minutes', () => {
    expect(formatDuration(45)).toBe('45 min')
  })

  it('should format a round hour without minutes', () => {
    expect(formatDuration(60)).toBe('1 h')
  })

  it('should pad the minutes of a mixed duration', () => {
    expect(formatDuration(65)).toBe('1 h 05')
  })

  it('should format an hour and a half', () => {
    expect(formatDuration(90)).toBe('1 h 30')
  })

  it('should format several hours', () => {
    expect(formatDuration(180)).toBe('3 h')
  })
})

describe('formatMinutesOfDay', () => {
  it('should pad hours and minutes', () => {
    expect(formatMinutesOfDay(9 * 60)).toBe('09:00')
    expect(formatMinutesOfDay(14 * 60 + 30)).toBe('14:30')
  })

  it('should wrap past midnight for ranges spilling into the next day', () => {
    // Une plage se terminant à 01:00 le lendemain s'écrit 1500 minutes.
    expect(formatMinutesOfDay(25 * 60)).toBe('01:00')
  })
})

describe('dayName', () => {
  it('should name Sunday as index 0', () => {
    expect(dayName(0)).toBe('Dimanche')
  })

  it('should name Saturday as index 6', () => {
    expect(dayName(6)).toBe('Samedi')
  })

  it('should return an empty string for an invalid index', () => {
    expect(dayName(9)).toBe('')
  })
})

describe('formatTime', () => {
  it('should render an instant in the salon timezone, not the server one', () => {
    // Les tests tournent en UTC : sans conversion explicite on lirait 12:00.
    expect(formatTime(new Date('2026-07-15T12:00:00Z'), PARIS)).toBe('14:00')
  })

  it('should apply the winter offset', () => {
    expect(formatTime(new Date('2026-01-15T12:00:00Z'), PARIS)).toBe('13:00')
  })
})

describe('formatDayLong', () => {
  it('should render a French long day', () => {
    expect(formatDayLong(new Date('2026-07-15T12:00:00Z'), PARIS)).toBe(
      'mercredi 15 juillet',
    )
  })

  it('should use the salon timezone to pick the civil day', () => {
    // 23 h UTC, c'est déjà le lendemain à Paris.
    expect(formatDayLong(new Date('2026-07-15T23:00:00Z'), PARIS)).toBe(
      'jeudi 16 juillet',
    )
  })
})

describe('formatDateTimeLong', () => {
  it('should combine day and time', () => {
    expect(formatDateTimeLong(new Date('2026-07-15T12:00:00Z'), PARIS)).toBe(
      'mercredi 15 juillet à 14:00',
    )
  })
})

describe('groupByDay', () => {
  it('should group slots by civil day of the salon', () => {
    const slots = [
      { startAt: new Date('2026-07-15T08:00:00Z').getTime() },
      { startAt: new Date('2026-07-15T14:00:00Z').getTime() },
      { startAt: new Date('2026-07-16T08:00:00Z').getTime() },
    ]

    const groups = groupByDay(slots, PARIS)

    expect(groups.map((g) => g.date)).toEqual(['2026-07-15', '2026-07-16'])
    expect(groups[0]?.slots).toHaveLength(2)
  })

  it('should place a late-evening slot on the correct local day', () => {
    // 22 h 30 UTC un 15 juillet, c'est 00 h 30 le 16 à Paris.
    const groups = groupByDay(
      [{ startAt: new Date('2026-07-15T22:30:00Z').getTime() }],
      PARIS,
    )

    expect(groups[0]?.date).toBe('2026-07-16')
  })

  it('should return an empty array for no slots', () => {
    expect(groupByDay([], PARIS)).toEqual([])
  })
})
