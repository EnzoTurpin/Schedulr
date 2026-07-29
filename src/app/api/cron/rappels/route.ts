import { NextResponse, type NextRequest } from 'next/server'
import { sendDueReminders } from '@/features/notifications/reminders'
import { tokensMatch } from '@/lib/auth/session'
import { env } from '@/lib/env.server'

/**
 * Déclenchement horaire des rappels J-1.
 *
 * Route protégée par un secret partagé : sans lui, n'importe qui pourrait
 * provoquer une vague d'envois — et chaque SMS est facturé.
 *
 * Le job est idempotent (voir `dispatch.ts`) : un appel supplémentaire, un
 * rejeu ou deux exécutions simultanées ne produisent jamais de doublon.
 */

// Ce traitement lit la base et appelle des services externes : jamais de cache.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization')

  // Comparaison à temps constant : une comparaison ordinaire s'arrête au
  // premier caractère différent et laisse mesurer le secret par sondages
  // successifs.
  if (
    !env.CRON_SECRET ||
    !authorization ||
    !tokensMatch(authorization, `Bearer ${env.CRON_SECRET}`)
  ) {
    // 401 sans détail : ne pas indiquer si le secret est absent ou incorrect.
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  try {
    const run = await sendDueReminders()

    // Le résultat ne contient que des compteurs, aucune donnée personnelle.
    console.warn('[cron] rappels J-1', run)
    return NextResponse.json({ ok: true, ...run })
  } catch (error) {
    console.error('[cron] rappels J-1 en échec', { error })
    return NextResponse.json({ error: 'Traitement en échec.' }, { status: 500 })
  }
}
