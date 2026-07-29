import { NextResponse, type NextRequest } from 'next/server'
import { purgeExpiredData } from '@/features/privacy/dataSubject'
import { tokensMatch } from '@/lib/auth/session'
import { env } from '@/lib/env.server'

/**
 * Purge des données au-delà de leur durée de conservation (RGPD).
 *
 * Déclenchée quotidiennement. Protégée par le même secret que les rappels :
 * une purge provoquée par un tiers détruirait des données.
 */

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
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  try {
    const report = await purgeExpiredData()

    // Le rapport ne contient que des compteurs.
    console.warn('[cron] purge des données expirées', report)
    return NextResponse.json({ ok: true, ...report })
  } catch (error) {
    console.error('[cron] purge en échec', { error })
    return NextResponse.json({ error: 'Traitement en échec.' }, { status: 500 })
  }
}
