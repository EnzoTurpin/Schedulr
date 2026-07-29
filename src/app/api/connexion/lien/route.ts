import { NextResponse, type NextRequest } from 'next/server'
import { consumeMagicLink } from '@/features/auth/actions'
import { SESSION_COOKIE, SESSION_DURATION_DAYS } from '@/lib/auth/constants'

/**
 * Consommation d'un lien de connexion.
 *
 * Un **route handler** et non une page : Next.js interdit d'écrire un cookie
 * depuis un composant serveur, et ouvrir une session en pose un.
 *
 * Le jeton transite par l'URL — c'est la nature d'un lien reçu par courriel —
 * mais il est à usage unique et expire en quinze minutes, ce qui borne la
 * fenêtre d'exploitation d'un historique de navigation ou d'un journal de
 * proxy.
 */

export const dynamic = 'force-dynamic'

/**
 * Redirige vers un chemin **relatif**, en conservant l'origine appelée.
 *
 * `NextResponse.redirect` réclame une URL absolue, qu'il faut alors construire
 * à partir d'une origine devinée. Celle de `request.nextUrl` ne reflète pas
 * toujours l'hôte réellement appelé : un accès sur `127.0.0.1` peut ainsi être
 * renvoyé vers `localhost`. Le navigateur y voit deux domaines distincts et
 * n'envoie pas le cookie de session que l'on vient de poser.
 *
 * Un `Location` relatif — permis par la RFC 7231 — supprime la question : le
 * navigateur le résout contre l'origine courante, quelle qu'elle soit.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('jeton')
  const session = token ? await consumeMagicLink(token) : null

  // Lien invalide, expiré ou déjà utilisé : retour au formulaire avec un
  // message, sans détailler lequel des trois cas s'applique.
  if (!session) return redirectTo('/connexion?lien=expire')

  const response = redirectTo(session.destination)

  // Le cookie est écrit sur la réponse : posé via `cookies()`, il ne serait pas
  // attaché à une redirection construite à la main.
  response.cookies.set(SESSION_COOKIE, session.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000),
  })

  return response
}
