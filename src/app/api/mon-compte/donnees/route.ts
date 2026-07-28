import { NextResponse } from 'next/server'
import { exportPersonalData } from '@/features/privacy/dataSubject'
import { currentActor } from '@/lib/auth/actor'

/**
 * Droit d'accès : export des données personnelles au format JSON.
 *
 * Le format lisible par machine est explicitement prévu par le RGPD au titre
 * de la portabilité.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const actor = await currentActor()

  if (!actor) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }

  const data = await exportPersonalData(actor)

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="mes-donnees-schedulr.json"',
      // Des données personnelles ne doivent jamais être mises en cache.
      'Cache-Control': 'no-store',
    },
  })
}
