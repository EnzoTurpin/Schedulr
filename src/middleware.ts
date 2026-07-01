import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/constants'

/**
 * Redirection par espace.
 *
 * ⚠️ Ce middleware ne constitue **pas** un contrôle d'accès. Il s'exécute sur le
 * runtime Edge, sans accès à la base : il ne peut que constater la présence
 * d'un cookie, pas vérifier qu'il correspond à une session valide ni quel rôle
 * il porte.
 *
 * Sa seule fonction est d'épargner à un visiteur non connecté le chargement
 * d'une page protégée. L'autorisation réelle est rejouée dans chaque page et
 * chaque server action via `requireActor()` puis `assertCan()` — c'est la règle
 * non négociable du plan d'action, §2.
 */

const PROTECTED_PREFIXES = ['/mon-compte', '/pro', '/admin']
const AUTH_PAGES = ['/connexion', '/inscription']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE)

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  if (isProtected && !hasSessionCookie) {
    const url = request.nextUrl.clone()
    url.pathname = '/connexion'
    // Mémorise la destination pour y revenir après connexion. Le chemin est
    // relatif et validé à l'usage : une URL absolue permettrait une redirection
    // ouverte vers un site tiers.
    url.searchParams.set('suite', pathname)
    return NextResponse.redirect(url)
  }

  // Un visiteur déjà porteur d'un cookie n'a rien à faire sur la page de
  // connexion. Si le cookie est en réalité invalide, la page d'atterrissage le
  // renverra ici : le coût est un aller-retour, jamais un accès indu.
  if (AUTH_PAGES.includes(pathname) && hasSessionCookie) {
    const url = request.nextUrl.clone()
    url.pathname = '/mon-compte'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/mon-compte/:path*',
    '/pro/:path*',
    '/admin/:path*',
    '/connexion',
    '/inscription',
  ],
}
