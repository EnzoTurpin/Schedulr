-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateTable
CREATE TABLE "SalonInvitation" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "invitedById" TEXT,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalonInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalonInvitation_memberId_key" ON "SalonInvitation"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SalonInvitation_tokenHash_key" ON "SalonInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "SalonInvitation_salonId_status_idx" ON "SalonInvitation"("salonId", "status");

-- CreateIndex
CREATE INDEX "SalonInvitation_email_idx" ON "SalonInvitation"("email");

-- AddForeignKey
ALTER TABLE "SalonInvitation" ADD CONSTRAINT "SalonInvitation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonInvitation" ADD CONSTRAINT "SalonInvitation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "SalonMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonInvitation" ADD CONSTRAINT "SalonInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
