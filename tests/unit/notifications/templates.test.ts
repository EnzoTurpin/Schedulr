import { describe, expect, it } from 'vitest'

/** Espaces insécables produits par Intl : invisibles dans le code source. */
const NBSP = /[\u00A0\u202F]/g
import { buildEmail, buildSms } from '@/features/notifications/templates'
import type { AppointmentSummary } from '@/features/notifications/types'

/**
 * Rédaction des messages transactionnels.
 *
 * Deux enjeux vérifiés ici : le contenu affiché au client — dates dans le
 * fuseau du salon, prix lisibles — et l'échappement du HTML, sans lequel un nom
 * de salon malveillant injecterait du script dans les boîtes de réception.
 */

function summary(overrides: Partial<AppointmentSummary> = {}): AppointmentSummary {
  return {
    appointmentId: 'rdv-1',
    salonId: 'salon-1',
    salonName: 'Salon Bellecour',
    salonAddress: '1 place Bellecour, 69002 Lyon',
    salonPhone: '+33478000000',
    timezone: 'Europe/Paris',
    startAt: new Date('2026-09-16T12:00:00Z'),
    memberName: 'Camille',
    services: ['Coupe femme', 'Brushing'],
    totalPriceCents: 5500,
    clientName: 'Léa Petit',
    email: 'lea@example.fr',
    phone: '+33600000000',
    smsConsent: true,
    cancellationDeadlineHours: 24,
    ...overrides,
  }
}

describe('courriels', () => {
  it('should address the client by name', () => {
    const message = buildEmail('booking_confirmed', summary())

    expect(message?.html).toContain('Léa Petit')
    expect(message?.text).toContain('Léa Petit')
  })

  it('should show the appointment time in the salon timezone', () => {
    // 12 h UTC, soit 14 h à Paris : afficher 12 h ferait manquer le rendez-vous.
    const message = buildEmail('booking_confirmed', summary())

    expect(message?.text).toContain('14h00')
    expect(message?.text).toContain('mercredi 16 septembre')
  })

  it('should list the services and the total', () => {
    const message = buildEmail('booking_confirmed', summary())

    expect(message?.text).toContain('Coupe femme, Brushing')
    expect(message?.text.replace(NBSP, ' ')).toContain('55,00 €')
  })

  it('should mention the cancellation deadline', () => {
    const message = buildEmail(
      'booking_confirmed',
      summary({ cancellationDeadlineHours: 48 }),
    )

    expect(message?.text).toContain('48 h')
  })

  it('should provide both HTML and plain text', () => {
    // Certains clients de messagerie n'affichent pas le HTML.
    const message = buildEmail('booking_confirmed', summary())

    expect(message?.html).toContain('<html')
    expect(message?.text).not.toContain('<html')
  })

  it('should return null when the client has no email address', () => {
    expect(buildEmail('booking_confirmed', summary({ email: null }))).toBeNull()
  })

  describe('échappement', () => {
    it('should escape HTML in the salon name', () => {
      // Un nom de salon vient de la saisie : sans échappement, ce script
      // finirait dans la boîte de réception du client.
      const message = buildEmail(
        'booking_confirmed',
        summary({ salonName: '<script>alert(1)</script>' }),
      )

      expect(message?.html).not.toContain('<script>')
      expect(message?.html).toContain('&lt;script&gt;')
    })

    it('should escape HTML in the client name', () => {
      const message = buildEmail(
        'booking_confirmed',
        summary({ clientName: '<img src=x onerror=alert(1)>' }),
      )

      expect(message?.html).not.toContain('<img')
    })

    it('should escape quotes, which could break an attribute', () => {
      const message = buildEmail('booking_confirmed', summary({ memberName: 'A"B' }))

      expect(message?.html).toContain('A&quot;B')
    })
  })

  describe('gabarits', () => {
    it('should announce a confirmation', () => {
      expect(buildEmail('booking_confirmed', summary())?.subject).toMatch(/confirmé/)
    })

    it('should announce a cancellation', () => {
      const message = buildEmail('booking_cancelled', summary())

      expect(message?.subject).toMatch(/annulé/)
      expect(message?.html).toContain('+33478000000')
    })

    it('should announce a reminder', () => {
      expect(buildEmail('reminder_j1', summary())?.subject).toMatch(/demain/)
    })

    it('should omit the phone line when the salon has no number', () => {
      const message = buildEmail('reminder_j1', summary({ salonPhone: null }))

      expect(message?.html).not.toContain('Prévenez le salon')
    })
  })
})

describe('SMS', () => {
  it('should build a short reminder', () => {
    const message = buildSms('reminder_j1', summary())

    expect(message?.body).toContain('Salon Bellecour')
    expect(message?.body).toContain('14h00')
  })

  it('should fit a single segment for typical content', () => {
    // Chaque segment est facturé : un message trop long double le coût.
    const message = buildSms('reminder_j1', summary())

    expect(message!.body.length).toBeLessThanOrEqual(160)
  })

  it('should carry the opt-out mention', () => {
    expect(buildSms('reminder_j1', summary())?.body).toContain('STOP')
  })

  it('should return null without an explicit consent', () => {
    // Le consentement est un acte positif : sans lui, aucun SMS.
    expect(buildSms('reminder_j1', summary({ smsConsent: false }))).toBeNull()
  })

  it('should return null without a phone number', () => {
    expect(buildSms('reminder_j1', summary({ phone: null }))).toBeNull()
  })

  it('should build a confirmation and a cancellation too', () => {
    expect(buildSms('booking_confirmed', summary())?.body).toMatch(/confirmé/)
    expect(buildSms('booking_cancelled', summary())?.body).toMatch(/annulé/)
  })
})
