import { describe, expect, it } from 'vitest'
import {
  contains,
  duration,
  intersect,
  normalize,
  pad,
  sliceIntoStarts,
  subtract,
  totalDuration,
  union,
  type Interval,
} from '@/features/availability/intervals'

/**
 * Les instants sont exprimés en minutes pour la lisibilité : `h(9)` vaut 9 h.
 * L'algèbre est indifférente à l'unité.
 */
const h = (hours: number) => hours * 60
const iv = (start: number, end: number): Interval => ({ start, end })

describe('normalize', () => {
  it('should sort intervals by start', () => {
    const result = normalize([iv(h(14), h(15)), iv(h(9), h(10))])

    expect(result).toEqual([iv(h(9), h(10)), iv(h(14), h(15))])
  })

  it('should merge overlapping intervals', () => {
    const result = normalize([iv(h(9), h(12)), iv(h(11), h(14))])

    expect(result).toEqual([iv(h(9), h(14))])
  })

  it('should merge touching intervals', () => {
    const result = normalize([iv(h(9), h(12)), iv(h(12), h(14))])

    expect(result).toEqual([iv(h(9), h(14))])
  })

  it('should drop empty intervals', () => {
    const result = normalize([iv(h(9), h(9)), iv(h(10), h(11))])

    expect(result).toEqual([iv(h(10), h(11))])
  })

  it('should drop inverted intervals', () => {
    const result = normalize([iv(h(15), h(9))])

    expect(result).toEqual([])
  })

  it('should absorb a fully contained interval', () => {
    const result = normalize([iv(h(9), h(18)), iv(h(11), h(12))])

    expect(result).toEqual([iv(h(9), h(18))])
  })

  it('should not mutate its input', () => {
    const input = [iv(h(9), h(12)), iv(h(11), h(14))]
    const snapshot = structuredClone(input)

    normalize(input)

    expect(input).toEqual(snapshot)
  })

  it('should return an empty array for empty input', () => {
    expect(normalize([])).toEqual([])
  })
})

describe('intersect', () => {
  it('should return the common part of two overlapping intervals', () => {
    const result = intersect([iv(h(9), h(18))], [iv(h(14), h(20))])

    expect(result).toEqual([iv(h(14), h(18))])
  })

  it('should return nothing for disjoint intervals', () => {
    expect(intersect([iv(h(9), h(12))], [iv(h(14), h(18))])).toEqual([])
  })

  it('should return nothing for merely touching intervals', () => {
    // Convention semi-ouverte : 12 h n'appartient pas à [9 h, 12 h).
    expect(intersect([iv(h(9), h(12))], [iv(h(12), h(18))])).toEqual([])
  })

  it('should intersect a salon lunch break with a full staff day', () => {
    const opening = [iv(h(9), h(12)), iv(h(14), h(19))]
    const working = [iv(h(8), h(20))]

    expect(intersect(working, opening)).toEqual([iv(h(9), h(12)), iv(h(14), h(19))])
  })

  it('should bound staff hours declared wider than the salon opening', () => {
    const result = intersect([iv(h(7), h(22))], [iv(h(9), h(19))])

    expect(result).toEqual([iv(h(9), h(19))])
  })

  it('should handle multiple intervals on both sides', () => {
    const result = intersect(
      [iv(h(9), h(12)), iv(h(14), h(18))],
      [iv(h(11), h(15)), iv(h(17), h(20))],
    )

    expect(result).toEqual([iv(h(11), h(12)), iv(h(14), h(15)), iv(h(17), h(18))])
  })

  it('should return nothing when one side is empty', () => {
    expect(intersect([], [iv(h(9), h(18))])).toEqual([])
    expect(intersect([iv(h(9), h(18))], [])).toEqual([])
  })
})

describe('subtract', () => {
  it('should carve a hole in the middle', () => {
    const result = subtract([iv(h(9), h(18))], [iv(h(12), h(13))])

    expect(result).toEqual([iv(h(9), h(12)), iv(h(13), h(18))])
  })

  it('should trim the start', () => {
    expect(subtract([iv(h(9), h(18))], [iv(h(8), h(10))])).toEqual([iv(h(10), h(18))])
  })

  it('should trim the end', () => {
    expect(subtract([iv(h(9), h(18))], [iv(h(17), h(20))])).toEqual([iv(h(9), h(17))])
  })

  it('should remove the interval entirely when fully covered', () => {
    expect(subtract([iv(h(9), h(18))], [iv(h(8), h(20))])).toEqual([])
  })

  it('should leave the interval untouched when the blocker is disjoint', () => {
    expect(subtract([iv(h(9), h(12))], [iv(h(14), h(18))])).toEqual([iv(h(9), h(12))])
  })

  it('should leave the interval untouched when the blocker merely touches it', () => {
    expect(subtract([iv(h(9), h(12))], [iv(h(12), h(18))])).toEqual([iv(h(9), h(12))])
  })

  it('should apply several blockers to the same interval', () => {
    const result = subtract([iv(h(9), h(19))], [iv(h(10), h(11)), iv(h(14), h(15))])

    expect(result).toEqual([iv(h(9), h(10)), iv(h(11), h(14)), iv(h(15), h(19))])
  })

  it('should handle a blocker spanning two separate intervals', () => {
    // Une absence à cheval sur la pause déjeuner ampute les deux demi-journées.
    const result = subtract([iv(h(9), h(12)), iv(h(14), h(19))], [iv(h(11), h(15))])

    expect(result).toEqual([iv(h(9), h(11)), iv(h(15), h(19))])
  })

  it('should ignore a blocker entirely before the base', () => {
    expect(subtract([iv(h(14), h(18))], [iv(h(9), h(12))])).toEqual([iv(h(14), h(18))])
  })

  it('should return the base unchanged when there is no blocker', () => {
    expect(subtract([iv(h(9), h(18))], [])).toEqual([iv(h(9), h(18))])
  })

  it('should merge overlapping blockers before subtracting', () => {
    const result = subtract([iv(h(9), h(19))], [iv(h(11), h(14)), iv(h(13), h(16))])

    expect(result).toEqual([iv(h(9), h(11)), iv(h(16), h(19))])
  })
})

describe('union', () => {
  it('should merge sets of intervals', () => {
    const result = union([iv(h(9), h(12))], [iv(h(11), h(14))], [iv(h(16), h(18))])

    expect(result).toEqual([iv(h(9), h(14)), iv(h(16), h(18))])
  })
})

describe('pad', () => {
  it('should widen intervals on both sides', () => {
    expect(pad([iv(h(14), h(15))], 15, 30)).toEqual([iv(h(14) - 15, h(15) + 30)])
  })

  it('should merge intervals that collide once padded', () => {
    // Deux rendez-vous consécutifs dont les marges se rejoignent forment un
    // seul bloc occupé.
    const result = pad([iv(h(14), h(15)), iv(h(15), h(16))], 0, 15)

    expect(result).toEqual([iv(h(14), h(16) + 15)])
  })
})

describe('sliceIntoStarts', () => {
  it('should produce starts aligned on the step', () => {
    const result = sliceIntoStarts([iv(h(9), h(10))], { width: 30, step: 15, anchor: 0 })

    expect(result).toEqual([h(9), h(9) + 15, h(9) + 30])
  })

  it('should align on the anchor rather than the window start', () => {
    // Une plage débutant à 9 h 07 doit proposer 9 h 15, pas 9 h 07.
    const result = sliceIntoStarts([iv(h(9) + 7, h(10))], {
      width: 30,
      step: 15,
      anchor: 0,
    })

    expect(result).toEqual([h(9) + 15, h(9) + 30])
  })

  it('should produce nothing when the window is shorter than the service', () => {
    expect(
      sliceIntoStarts([iv(h(9), h(9) + 20)], { width: 30, step: 15, anchor: 0 }),
    ).toEqual([])
  })

  it('should produce exactly one start when the window fits the service exactly', () => {
    const result = sliceIntoStarts([iv(h(9), h(9) + 30)], {
      width: 30,
      step: 15,
      anchor: 0,
    })

    expect(result).toEqual([h(9)])
  })

  it('should never let a service span two separate windows', () => {
    // 11 h 45 serait libre 15 min avant la pause, mais la prestation dure
    // 30 min : elle empiéterait sur la pause déjeuner.
    const result = sliceIntoStarts([iv(h(9), h(12)), iv(h(14), h(15))], {
      width: 30,
      step: 15,
      anchor: 0,
    })

    expect(result).not.toContain(h(11) + 45)
    expect(result.at(-1)).toBe(h(14) + 30)
  })

  it('should reject a non-positive width', () => {
    expect(() =>
      sliceIntoStarts([iv(0, 100)], { width: 0, step: 15, anchor: 0 }),
    ).toThrow(/strictement positifs/)
  })

  it('should reject a non-positive step', () => {
    expect(() =>
      sliceIntoStarts([iv(0, 100)], { width: 30, step: 0, anchor: 0 }),
    ).toThrow(/strictement positifs/)
  })
})

describe('helpers', () => {
  it('should compute the duration of an interval', () => {
    expect(duration(iv(h(9), h(12)))).toBe(h(3))
  })

  it('should compute the total duration of a normalised set', () => {
    // Le chevauchement ne doit pas être compté deux fois.
    expect(totalDuration([iv(h(9), h(12)), iv(h(11), h(14))])).toBe(h(5))
  })

  it('should detect an instant inside an interval', () => {
    expect(contains([iv(h(9), h(12))], h(10))).toBe(true)
  })

  it('should treat the exclusive end as outside', () => {
    expect(contains([iv(h(9), h(12))], h(12))).toBe(false)
  })
})
