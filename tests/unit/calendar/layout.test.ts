import { describe, expect, it } from 'vitest'
import {
  gridHeight,
  hourMarks,
  instantToOffset,
  layoutEvents,
  offsetToInstant,
  type GridScale,
} from '@/features/calendar/layout'

/**
 * Géométrie de la grille d'agenda (ADR-0005).
 *
 * La disposition des chevauchements est le cas de bord que l'ADR désignait
 * comme le plus risqué du développement interne : il est donc couvert
 * exhaustivement ici, sans navigateur.
 */

const HOUR = 3_600_000

/** Grille 9 h → 19 h, 60 px par heure. */
const scale: GridScale = {
  startAt: new Date('2026-07-15T09:00:00Z').getTime(),
  endAt: new Date('2026-07-15T19:00:00Z').getTime(),
  hourHeight: 60,
}

const at = (hour: number, minutes = 0) =>
  new Date(
    `2026-07-15T${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`,
  ).getTime()

const event = (id: string, startHour: number, endHour: number) => ({
  id,
  startAt: at(startHour),
  endAt: at(endHour),
})

describe('gridHeight', () => {
  it('should be the number of hours times the hour height', () => {
    expect(gridHeight(scale)).toBe(600)
  })
})

describe('instantToOffset', () => {
  it('should place the start of the range at the top', () => {
    expect(instantToOffset(scale.startAt, scale)).toBe(0)
  })

  it('should place an instant proportionally to its distance', () => {
    expect(instantToOffset(at(14), scale)).toBe(300)
  })

  it('should handle a half hour', () => {
    expect(instantToOffset(at(9, 30), scale)).toBe(30)
  })

  it('should place the end of the range at the bottom', () => {
    expect(instantToOffset(scale.endAt, scale)).toBe(600)
  })
})

describe('offsetToInstant', () => {
  it('should convert the top of the grid to the range start', () => {
    expect(offsetToInstant(0, scale, 15)).toBe(scale.startAt)
  })

  it('should snap to the nearest step', () => {
    // 3 px sous 14 h, soit 14 h 03 : ramené à 14 h avec un pas de 15 min.
    expect(offsetToInstant(303, scale, 15)).toBe(at(14))
  })

  it('should snap upwards when closer to the next step', () => {
    // 14 h 12 est plus proche de 14 h 15.
    expect(offsetToInstant(312, scale, 15)).toBe(at(14, 15))
  })

  it('should honour a finer step', () => {
    expect(offsetToInstant(305, scale, 5)).toBe(at(14, 5))
  })

  it('should clamp an offset above the grid to the range start', () => {
    expect(offsetToInstant(-200, scale, 15)).toBe(scale.startAt)
  })

  it('should clamp an offset below the grid to the range end', () => {
    expect(offsetToInstant(9999, scale, 15)).toBe(scale.endAt)
  })

  it('should round-trip with instantToOffset on an aligned instant', () => {
    const instant = at(15, 30)

    expect(offsetToInstant(instantToOffset(instant, scale), scale, 15)).toBe(instant)
  })
})

describe('layoutEvents', () => {
  it('should place a single event across the full column width', () => {
    const [box] = layoutEvents([event('a', 14, 15)], scale)

    expect(box?.top).toBe(300)
    expect(box?.height).toBe(60)
    expect(box?.left).toBe(0)
    expect(box?.width).toBe(1)
  })

  it('should keep two disjoint events at full width', () => {
    const boxes = layoutEvents([event('a', 10, 11), event('b', 14, 15)], scale)

    expect(boxes.every((b) => b.width === 1)).toBe(true)
    expect(boxes.every((b) => b.left === 0)).toBe(true)
  })

  it('should keep consecutive events at full width', () => {
    // Convention semi-ouverte : 14 h–15 h et 15 h–16 h ne se chevauchent pas.
    const boxes = layoutEvents([event('a', 14, 15), event('b', 15, 16)], scale)

    expect(boxes.every((b) => b.width === 1)).toBe(true)
  })

  it('should split the width between two overlapping events', () => {
    const boxes = layoutEvents([event('a', 14, 16), event('b', 15, 17)], scale)

    expect(boxes.map((b) => b.width)).toEqual([0.5, 0.5])
    expect(boxes.map((b) => b.left).sort()).toEqual([0, 0.5])
  })

  it('should split the width between three mutually overlapping events', () => {
    const boxes = layoutEvents(
      [event('a', 14, 17), event('b', 14, 17), event('c', 14, 17)],
      scale,
    )

    expect(boxes).toHaveLength(3)
    expect(boxes.every((b) => Math.abs(b.width - 1 / 3) < 1e-9)).toBe(true)
  })

  it('should treat a transitive overlap chain as a single cluster', () => {
    // A chevauche B, B chevauche C, mais A et C sont disjoints. Les trois
    // doivent malgré tout se partager la colonne, sinon A et C se
    // superposeraient visuellement.
    const boxes = layoutEvents(
      [event('a', 10, 12), event('b', 11, 14), event('c', 13, 15)],
      scale,
    )

    expect(boxes).toHaveLength(3)
    expect(boxes.every((b) => Math.abs(b.width - 1 / 2) < 1e-9)).toBe(true)
  })

  it('should reuse a column when events do not overlap within the cluster', () => {
    // A et C sont disjoints : ils partagent la même colonne, B occupe l'autre.
    const boxes = layoutEvents(
      [event('a', 10, 12), event('b', 11, 15), event('c', 13, 15)],
      scale,
    )

    const a = boxes.find((b) => b.event.id === 'a')
    const c = boxes.find((b) => b.event.id === 'c')
    expect(a?.left).toBe(c?.left)
  })

  it('should truncate an event starting before the visible range', () => {
    const boxes = layoutEvents([{ id: 'tot', startAt: at(7), endAt: at(10) }], scale)

    expect(boxes[0]?.top).toBe(0)
    expect(boxes[0]?.height).toBe(60)
  })

  it('should truncate an event ending after the visible range', () => {
    const boxes = layoutEvents([{ id: 'tard', startAt: at(18), endAt: at(22) }], scale)

    expect(boxes[0]?.top).toBe(540)
    expect(boxes[0]?.height).toBe(60)
  })

  it('should drop an event entirely outside the visible range', () => {
    expect(layoutEvents([{ id: 'nuit', startAt: at(2), endAt: at(4) }], scale)).toEqual(
      [],
    )
  })

  it('should return nothing for no events', () => {
    expect(layoutEvents([], scale)).toEqual([])
  })

  it('should sort boxes from top to bottom', () => {
    const boxes = layoutEvents([event('tard', 16, 17), event('tot', 10, 11)], scale)

    expect(boxes.map((b) => b.event.id)).toEqual(['tot', 'tard'])
  })

  it('should not mutate the input array', () => {
    const events = [event('b', 14, 15), event('a', 10, 11)]
    const snapshot = structuredClone(events)

    layoutEvents(events, scale)

    expect(events).toEqual(snapshot)
  })
})

describe('hourMarks', () => {
  it('should produce one mark per full hour, bounds included', () => {
    const marks = hourMarks(scale)

    expect(marks).toHaveLength(11) // 9 h → 19 h
    expect(marks[0]?.top).toBe(0)
    expect(marks.at(-1)?.top).toBe(600)
  })

  it('should space marks by the hour height', () => {
    const marks = hourMarks(scale)

    expect((marks[1]?.top ?? 0) - (marks[0]?.top ?? 0)).toBe(60)
  })

  it('should start at the first full hour when the range starts mid-hour', () => {
    const offset: GridScale = { ...scale, startAt: scale.startAt + HOUR / 2 }

    const marks = hourMarks(offset)

    expect(marks[0]?.top).toBe(30)
  })
})
