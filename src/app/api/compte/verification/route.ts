import { NextResponse, type NextRequest } from 'next/server'
import { confirmEmail } from '@/lib/auth/emailVerification'

/**
 * Confirmation d'une adresse électronique.
 *
 * Route handler et non page : la confirmation écrit en base, ce qu'un
 * composant serveur ne doit pas faire sur une simple visite.
 *
 * Aucune session n'est requise — le lien peut être ouvert depuis un autre
 * navigateur que celui de l'inscription, cas courant quand la boîte est
 * consultée sur téléphone.
 */

export const dynamic = 'force-dynamic'

/**
 * Redirige vers un chemin relatif, en conservant l'origine appelée.
 *
 * Une origine reconstruite ne reflète pas toujours l'hôte réellement appelé,
 * et le changement de domaine ferait perdre le cookie de session (voir
 * `src/app/api/connexion/lien/route.ts`).
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('jeton')
  const email = token ? await confirmEmail(token) : null

  return redirectTo(
    email ? '/mon-compte?adresse=confirmee' : '/mon-compte?adresse=expiree',
  )
}
