import { fromZonedTime } from 'date-fns-tz'
import { hashPassword } from '../src/lib/auth/password'
import { PrismaClient, type SalonRole } from '../src/generated/prisma'
import {
  ATELIER_CATALOG,
  ATELIER_OPENING,
  EMERAUDE_CATALOG,
  EMERAUDE_OPENING,
  type CategorySeed,
} from './seed/catalog'
import { createRandom } from './seed/random'

/**
 * Jeu de données de développement : 2 salons, 6 coiffeurs, 15 prestations,
 * 40 rendez-vous.
 *
 * Déterminisme : l'aléatoire est initialisé par une graine fixe. Les dates sont
 * ancrées sur minuit du jour d'exécution — seul point de variation, assumé pour
 * que les rendez-vous générés soient toujours à venir et donc utiles à
 * l'écran. Les tests d'intégration ne dépendent pas de ce seed : ils
 * construisent leurs propres données.
 *
 * Les heures sont exprimées en heure locale du salon puis converties en UTC,
 * comme le fera le moteur de disponibilité (ADR-0003).
 */

const prisma = new PrismaClient()
const random = createRandom(20260727)

const SEED_PASSWORD = 'schedulr-dev-2026'

const PARIS = 'Europe/Paris'
const TARGET_APPOINTMENTS = 40

const STAFF_COLORS = ['#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#ef4444']

/** Minuit local du jour d'exécution, en UTC. */
function today(): Date {
  const now = new Date()
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return fromZonedTime(`${iso}T00:00:00`, PARIS)
}

/** Instant UTC correspondant à une heure locale, `dayOffset` jours plus tard. */
function localSlot(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  const day = new Date(base)
  day.setUTCDate(day.getUTCDate() + dayOffset)
  const iso = day.toISOString().slice(0, 10)
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  return fromZonedTime(`${iso}T${time}`, PARIS)
}

async function createUser(
  email: string,
  firstName: string,
  lastName: string,
  role: 'CLIENT' | 'PLATFORM_ADMIN' = 'CLIENT',
) {
  return prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      role,
      emailVerified: new Date(),
      phone: `+3360000${random.int(1000, 9999)}`,
      // Mot de passe unique et connu, réservé au développement.
      passwordHash: await hashPassword(SEED_PASSWORD),
    },
  })
}

async function createCatalog(salonId: string, catalog: CategorySeed[]) {
  const services = []
  for (const [index, category] of catalog.entries()) {
    const created = await prisma.serviceCategory.create({
      data: { salonId, name: category.name, position: index },
    })
    for (const service of category.services) {
      services.push(
        await prisma.service.create({
          data: {
            salonId,
            categoryId: created.id,
            name: service.name,
            durationMin: service.durationMin,
            priceCents: service.priceCents,
            bufferAfterMin: service.bufferAfterMin ?? 0,
          },
        }),
      )
    }
  }
  return services
}

async function createSalon(input: {
  slug: string
  name: string
  city: string
  postalCode: string
  address: string
  catalog: CategorySeed[]
  opening: { dayOfWeek: number; startMin: number; endMin: number }[]
  team: { email: string; firstName: string; lastName: string; role: SalonRole }[]
}) {
  const salon = await prisma.salon.create({
    data: {
      slug: input.slug,
      name: input.name,
      address: input.address,
      city: input.city,
      postalCode: input.postalCode,
      isActive: true,
      description: `${input.name}, salon de coiffure à ${input.city}.`,
      phone: `+3347800${random.int(1000, 9999)}`,
    },
  })

  await prisma.openingHour.createMany({
    data: input.opening.map((slot) => ({ salonId: salon.id, ...slot })),
  })

  const services = await createCatalog(salon.id, input.catalog)

  const members = []
  for (const [index, person] of input.team.entries()) {
    const user = await createUser(person.email, person.firstName, person.lastName)
    const member = await prisma.salonMember.create({
      data: {
        salonId: salon.id,
        userId: user.id,
        role: person.role,
        displayName: person.firstName,
        color: STAFF_COLORS[index % STAFF_COLORS.length] ?? '#8b5cf6',
        bio: `${person.firstName} vous accueille chez ${input.name}.`,
      },
    })

    // Horaires de travail : l'amplitude d'ouverture, restreinte pour un
    // temps partiel, afin que le moteur de disponibilité ait à faire une
    // vraie intersection.
    const worksFullWeek = index % 3 !== 2
    for (const slot of input.opening) {
      if (!worksFullWeek && slot.dayOfWeek >= 5) continue
      await prisma.workingHour.create({
        data: {
          salonId: salon.id,
          memberId: member.id,
          dayOfWeek: slot.dayOfWeek,
          startMin: slot.startMin,
          endMin: slot.endMin,
        },
      })
    }

    // Chaque coiffeur réalise toutes les prestations du salon sauf le dernier,
    // limité à sa catégorie principale : « n'importe quel coiffeur » doit avoir
    // un cas non trivial à résoudre.
    const performed = index === input.team.length - 1 ? services.slice(0, 4) : services
    await prisma.staffService.createMany({
      data: performed.map((service) => ({
        salonId: salon.id,
        memberId: member.id,
        serviceId: service.id,
      })),
    })

    members.push(member)
  }

  return { salon, members, services }
}

async function createAppointments(
  salons: Awaited<ReturnType<typeof createSalon>>[],
  clients: { id: string }[],
) {
  const base = today()

  // Créneaux espacés de deux heures : la prestation la plus longue du jeu
  // (90 min) ne peut donc jamais chevaucher la suivante, y compris marges
  // comprises. Sans cela, le seed violerait la contrainte de l'ADR-0004.
  const hours = [9, 11, 14, 16, 18]

  const candidates = []
  for (const { salon, members, services } of salons) {
    for (const member of members) {
      for (let dayOffset = 1; dayOffset <= 12; dayOffset++) {
        for (const hour of hours) {
          candidates.push({
            salonId: salon.id,
            memberId: member.id,
            dayOffset,
            hour,
            services,
          })
        }
      }
    }
  }

  let created = 0
  for (const candidate of random.shuffle(candidates)) {
    if (created >= TARGET_APPOINTMENTS) break

    const service = random.pick(candidate.services)
    const startAt = localSlot(base, candidate.dayOffset, candidate.hour)
    const endAt = new Date(
      startAt.getTime() + (service.durationMin + service.bufferAfterMin) * 60_000,
    )
    const client = random.pick(clients)

    await prisma.appointment.create({
      data: {
        salonId: candidate.salonId,
        memberId: candidate.memberId,
        clientId: client.id,
        startAt,
        endAt,
        source: random.next() < 0.7 ? 'ONLINE' : 'PHONE',
        items: {
          create: {
            salonId: candidate.salonId,
            serviceId: service.id,
            nameSnapshot: service.name,
            durationMin: service.durationMin,
            priceCents: service.priceCents,
            position: 0,
          },
        },
      },
    })
    created++
  }

  return created
}

async function main(): Promise<void> {
  console.log('Nettoyage…')
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AppointmentItem", "Appointment", "NotificationLog", "AuditLog",
      "StaffService", "Service", "ServiceCategory",
      "WorkingHour", "TimeOff", "Closure", "OpeningHour",
      "SalonMember", "Salon",
      "ConsentRecord", "Session", "Account", "VerificationToken", "User"
    RESTART IDENTITY CASCADE
  `)

  await createUser('admin@schedulr.fr', 'Alex', 'Martin', 'PLATFORM_ADMIN')

  const clients = []
  for (const [firstName, lastName] of [
    ['Camille', 'Bernard'],
    ['Sacha', 'Dubois'],
    ['Léa', 'Petit'],
    ['Noah', 'Moreau'],
    ['Inès', 'Girard'],
  ]) {
    clients.push(
      await createUser(
        `${firstName!.toLowerCase()}.${lastName!.toLowerCase()}@example.fr`,
        firstName!,
        lastName!,
      ),
    )
  }

  const atelier = await createSalon({
    slug: 'atelier-coiffure-lyon',
    name: "L'Atelier Coiffure",
    city: 'Lyon',
    postalCode: '69003',
    address: '12 rue de la Part-Dieu',
    catalog: ATELIER_CATALOG,
    opening: ATELIER_OPENING,
    team: [
      { email: 'julie@atelier.fr', firstName: 'Julie', lastName: 'Roux', role: 'OWNER' },
      { email: 'marc@atelier.fr', firstName: 'Marc', lastName: 'Leroy', role: 'MANAGER' },
      {
        email: 'sofia@atelier.fr',
        firstName: 'Sofia',
        lastName: 'Nguyen',
        role: 'STAFF',
      },
    ],
  })

  const emeraude = await createSalon({
    slug: 'studio-emeraude-villeurbanne',
    name: 'Studio Émeraude',
    city: 'Villeurbanne',
    postalCode: '69100',
    address: '4 cours Émile-Zola',
    catalog: EMERAUDE_CATALOG,
    opening: EMERAUDE_OPENING,
    team: [
      {
        email: 'karim@emeraude.fr',
        firstName: 'Karim',
        lastName: 'Benali',
        role: 'OWNER',
      },
      {
        email: 'elena@emeraude.fr',
        firstName: 'Elena',
        lastName: 'Rossi',
        role: 'STAFF',
      },
      { email: 'tom@emeraude.fr', firstName: 'Tom', lastName: 'Faure', role: 'STAFF' },
    ],
  })

  // Une semaine de congés et une fermeture exceptionnelle : le moteur de
  // disponibilité doit avoir des exceptions à soustraire dès la phase 2.
  const base = today()
  await prisma.timeOff.create({
    data: {
      salonId: atelier.salon.id,
      memberId: atelier.members[2]!.id,
      startAt: localSlot(base, 5, 0),
      endAt: localSlot(base, 12, 0),
      reason: 'Congés',
    },
  })
  await prisma.closure.create({
    data: {
      salonId: emeraude.salon.id,
      startAt: localSlot(base, 8, 0),
      endAt: localSlot(base, 9, 0),
      reason: 'Jour férié',
    },
  })

  const appointments = await createAppointments([atelier, emeraude], clients)

  console.log(`
Seed terminé :
  salons        2
  membres       ${atelier.members.length + emeraude.members.length}
  prestations   ${atelier.services.length + emeraude.services.length}
  clients       ${clients.length}
  rendez-vous   ${appointments}

Comptes créés — mot de passe commun : ${SEED_PASSWORD}
  admin plateforme  admin@schedulr.fr
  gérante salon 1   julie@atelier.fr
  gérant salon 2    karim@emeraude.fr
  cliente           camille.bernard@example.fr
`)
}

main()
  .catch((error: unknown) => {
    console.error('Échec du seed :', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
