'use client'

/**
 * Erreur survenue dans la racine de l'application.
 *
 * Ce composant **remplace** `<html>` et `<body>` : il ne bénéficie ni du
 * layout, ni des styles chargés par lui. La mise en forme est donc portée en
 * ligne, sans quoi la page s'afficherait sans aucun style.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="fr">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          padding: '4rem 1.5rem',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '36rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Une erreur est survenue</h1>
          <p style={{ marginTop: '0.75rem', color: '#475569' }}>
            L’application n’a pas pu démarrer. Réessayez dans un instant.
          </p>
          {error.digest && (
            <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b' }}>
              Référence : <code>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: 0,
              background: '#7c3aed',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  )
}
