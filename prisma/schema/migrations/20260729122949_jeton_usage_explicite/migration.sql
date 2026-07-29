-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('LOGIN', 'EMAIL_VERIFICATION');

-- AlterTable
ALTER TABLE "VerificationToken" ADD COLUMN     "purpose" "TokenPurpose" NOT NULL DEFAULT 'LOGIN';

-- CreateIndex
CREATE INDEX "VerificationToken_identifier_purpose_idx" ON "VerificationToken"("identifier", "purpose");
