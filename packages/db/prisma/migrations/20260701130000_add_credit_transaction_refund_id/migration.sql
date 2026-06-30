-- AlterTable
ALTER TABLE "credit_transactions" ADD COLUMN     "stripeRefundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_stripeRefundId_key" ON "credit_transactions"("stripeRefundId");
