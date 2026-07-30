'use client'

import { useEffect, useState, useTransition } from 'react'
import { formatDate } from '@/lib/format'
import { clientRecordAction } from './actions'

/**
 * Fiche client vue du salon.
 *
 * Chargée à l'ouverture de la fenêtre et non avec l'agenda : dix rendez-vous
 * d'historique par bloc affiché multiplierait les requêtes sans que personne ne
 * les consulte.
 *
 * Le compte des absences est délibérément visible : c'est l'information qui
 * décide si on rappelle un client la veille, et elle n'existait nulle part.
 */

type RecordResult = Awaited<ReturnType<typeof clientRecordAction>>

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'en attente',
  CONFIRMED: 'confirmé',
  DONE: 'honoré',
  NO_SHOW: 'absent',
  CANCELLED: 'annulé',
}

type Props = { salonId: string; appointmentId: string; timezone: string }

export function ClientRecord({ salonId, appointmentId, timezone }: Props) {
  const [record, setRecord] = useState<RecordResult | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      setRecord(await clientRecordAction({ salonId, appointmentId }))
    })
    // Un changement de rendez-vous doit relancer la lecture.
  }, [salonId, appointmentId])

  if (!record) {
    return <p className="text-sm text-slate-500">Chargement de la fiche…</p>
  }

  if (!record.ok) {
    return (
      <p role="alert" className="text-sm text-red-800">
        {record.error}
      </p>
    )
  }

  const client = record.record
  if (!client) return null

  return (
    <div>
      {client.isGuest ? (
        <p className="text-sm text-slate-600">
          Rendez-vous pris au comptoir : ce client n’a pas de compte, son historique n’est
          donc pas rattaché.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Absences</dt>
            <dd className={client.noShowCount > 0 ? 'font-medium text-amber-700' : ''}>
              {client.noShowCount === 0
                ? 'aucune'
                : `${client.noShowCount} rendez-vous manqué${client.noShowCount > 1 ? 's' : ''}`}
            </dd>
            {client.email && (
              <>
                <dt className="text-slate-500">Courriel</dt>
                <dd className="truncate">{client.email}</dd>
              </>
            )}
          </dl>

          {client.history.length > 0 ? (
            <>
              <h4 className="mt-4 text-sm font-medium">Derniers rendez-vous</h4>
              <ul className="mt-2 divide-y divide-slate-200 text-sm">
                {client.history.map((past) => (
                  <li key={past.id} className="flex flex-wrap gap-x-3 py-2">
                    <span className="text-slate-600">
                      {formatDate(past.startAt, timezone, 'd MMM yyyy')}
                    </span>
                    <span className="flex-1">
                      {past.items.map((item) => item.nameSnapshot).join(', ') ||
                        'Prestation supprimée'}
                    </span>
                    <span className="text-slate-500">{past.member.displayName}</span>
                    <span className="text-slate-500">
                      {STATUS_LABELS[past.status] ?? past.status}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-600">Premier rendez-vous du client.</p>
          )}
        </>
      )}
    </div>
  )
}
