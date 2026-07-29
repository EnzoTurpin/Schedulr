'use client'

/**
 * Choix des coiffeurs affichés dans l'agenda.
 *
 * Les cases sont des liens et non des boutons : la sélection vit dans l'URL,
 * ce qui la rend partageable, mémorisable en favori, et restaurée telle quelle
 * après un rechargement. Un salon qui consulte toujours les mêmes deux
 * personnes garde son lien.
 */

type Member = { id: string; label: string; color: string }

type Props = {
  staff: Member[]
  /** Identifiants affichés. Vide signifie « toute l'équipe ». */
  selected: string[]
  onChange: (next: string[]) => void
}

export function StaffFilter({ staff, selected, onChange }: Props) {
  // Une sélection vide affiche tout le monde : c'est l'état par défaut, et
  // laisser un agenda vide serait déroutant.
  const showsAll = selected.length === 0
  const isShown = (id: string) => showsAll || selected.includes(id)

  function toggle(id: string) {
    // Depuis « tous », décocher une personne revient à garder les autres.
    const current = showsAll ? staff.map((member) => member.id) : selected
    const next = current.includes(id)
      ? current.filter((memberId) => memberId !== id)
      : [...current, id]

    // Tout décocher n'a pas de sens : on retombe sur l'équipe entière.
    onChange(next.length === 0 || next.length === staff.length ? [] : next)
  }

  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">
        Coiffeurs affichés — cliquez sur une personne pour la masquer ou la réafficher
      </legend>

      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={showsAll}
        className={
          showsAll
            ? 'bg-brand-600 rounded-full px-3 py-1 text-sm font-medium text-white'
            : 'rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50'
        }
      >
        Toute l’équipe
      </button>

      {staff.map((member) => {
        const shown = isShown(member.id)
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => toggle(member.id)}
            aria-pressed={shown}
            title={shown ? `Masquer ${member.label}` : `Afficher ${member.label}`}
            className={
              shown
                ? 'flex items-center gap-2 rounded-full border-2 px-3 py-1 text-sm font-medium text-slate-900'
                : 'flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50'
            }
            style={
              shown
                ? {
                    borderColor: member.color,
                    backgroundColor: `color-mix(in srgb, ${member.color} 12%, white)`,
                  }
                : undefined
            }
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: shown ? member.color : '#cbd5e1' }}
            />
            {member.label}
          </button>
        )
      })}
    </fieldset>
  )
}
