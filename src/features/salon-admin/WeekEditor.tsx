'use client'

import { dayName, formatMinutesOfDay } from '@/lib/format'

/**
 * Grille de saisie d'une semaine type.
 *
 * Partagée par les horaires d'ouverture du salon et les horaires individuels
 * des membres : les deux éditent la même structure et doivent se comporter
 * identiquement, notamment sur la coupure déjeuner.
 */

export type Range = { startMin: number; endMin: number }
export type Week = Record<number, Range[]>

/** Ordre d'affichage : la semaine commence le lundi, pas le dimanche. */
const DAYS = [1, 2, 3, 4, 5, 6, 0]

/** `HH:MM` → minutes depuis minuit. */
export function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** Retire les jours sans plage : le serveur attend une semaine compacte. */
export function compactWeek(week: Week): Week {
  return Object.fromEntries(Object.entries(week).filter(([, r]) => r.length > 0))
}

type Props = {
  week: Week
  onChange: (week: Week) => void
  /**
   * Préfixe des identifiants de champs. Deux grilles peuvent coexister sur une
   * même page — celles de deux membres — et un `id` dupliqué casse
   * l'association des libellés.
   */
  idPrefix: string
}

export function WeekEditor({ week, onChange, idPrefix }: Props) {
  function updateRange(day: number, index: number, patch: Partial<Range>) {
    onChange({
      ...week,
      [day]: (week[day] ?? []).map((range, i) =>
        i === index ? { ...range, ...patch } : range,
      ),
    })
  }

  function addRange(day: number) {
    onChange({
      ...week,
      [day]: [...(week[day] ?? []), { startMin: 9 * 60, endMin: 19 * 60 }],
    })
  }

  function removeRange(day: number, index: number) {
    onChange({
      ...week,
      [day]: (week[day] ?? []).filter((_, i) => i !== index),
    })
  }

  return (
    <ul className="divide-y divide-slate-200">
      {DAYS.map((day) => {
        const ranges = week[day] ?? []
        return (
          <li key={day} className="flex flex-wrap items-start gap-4 py-4">
            <span className="w-24 shrink-0 pt-2 font-medium">{dayName(day)}</span>

            <div className="flex-1">
              {ranges.length === 0 && (
                <p className="pt-2 text-sm text-slate-500">Repos</p>
              )}

              {ranges.map((range, index) => (
                <div key={index} className="mb-2 flex flex-wrap items-center gap-2">
                  <label
                    className="sr-only"
                    htmlFor={`${idPrefix}-start-${day}-${index}`}
                  >
                    {dayName(day)} — début, plage {index + 1}
                  </label>
                  <input
                    id={`${idPrefix}-start-${day}-${index}`}
                    type="time"
                    step={300}
                    value={formatMinutesOfDay(range.startMin)}
                    onChange={(e) =>
                      updateRange(day, index, { startMin: toMinutes(e.target.value) })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5"
                  />
                  <span aria-hidden="true">–</span>
                  <label className="sr-only" htmlFor={`${idPrefix}-end-${day}-${index}`}>
                    {dayName(day)} — fin, plage {index + 1}
                  </label>
                  <input
                    id={`${idPrefix}-end-${day}-${index}`}
                    type="time"
                    step={300}
                    value={formatMinutesOfDay(range.endMin)}
                    onChange={(e) =>
                      updateRange(day, index, { endMin: toMinutes(e.target.value) })
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => removeRange(day, index)}
                    className="text-sm text-slate-600 underline"
                  >
                    Retirer
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => addRange(day)}
                className="text-sm text-slate-600 underline"
              >
                Ajouter une plage
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
