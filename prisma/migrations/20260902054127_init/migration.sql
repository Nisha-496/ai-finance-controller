-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('SUCCESS', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "match_status_enum" AS ENUM ('MATCHED', 'UNMATCHED', 'MISSING_SETTLEMENT', 'AMOUNT_MISMATCH');

-- CreateEnum
CREATE TYPE "review_status_enum" AS ENUM ('NOT_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "exception_type_enum" AS ENUM ('AMOUNT_MISMATCH', 'MISSING_SETTLEMENT', 'MISSING_PAYMENT', 'DUPLICATE_TRANSACTION', 'PENDING_TRANSACTION', 'INVALID_SETTLEMENT_CALCULATION');

-- CreateEnum
CREATE TYPE "severity_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "exception_status_enum" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_ref" TEXT NOT NULL,
    "normalized_order_ref" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "order_date" TIMESTAMP(3) NOT NULL,
    "customer_name" TEXT,
    "raw_row" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "transaction_ref" TEXT NOT NULL,
    "normalized_transaction_ref" TEXT NOT NULL,
    "order_id" TEXT,
    "order_ref_on_payment" TEXT,
    "normalized_order_ref_on_payment" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payment_date" TIMESTAMP(3) NOT NULL,
    "status" "transaction_status" NOT NULL DEFAULT 'SUCCESS',
    "raw_row" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "settlement_ref" TEXT NOT NULL,
    "normalized_settlement_ref" TEXT NOT NULL,
    "transaction_ref_on_settlement" TEXT,
    "normalized_transaction_ref_on_settlement" TEXT,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "settlement_date" TIMESTAMP(3) NOT NULL,
    "raw_row" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_results" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "settlement_id" TEXT,
    "match_status" "match_status_enum" NOT NULL,
    "review_status" "review_status_enum" NOT NULL DEFAULT 'NOT_REQUIRED',
    "confidence" DECIMAL(5,2) NOT NULL,
    "reference_similarity" DECIMAL(5,2),
    "amount_similarity" DECIMAL(5,2),
    "date_similarity" DECIMAL(5,2),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_exceptions" (
    "id" TEXT NOT NULL,
    "reconciliation_result_id" TEXT,
    "exception_type" "exception_type_enum" NOT NULL,
    "severity" "severity_enum" NOT NULL,
    "description" TEXT NOT NULL,
    "ai_explanation" TEXT,
    "status" "exception_status_enum" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "finance_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_normalized_order_ref_idx" ON "orders"("normalized_order_ref");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transaction_ref_key" ON "transactions"("transaction_ref");

-- CreateIndex
CREATE INDEX "transactions_normalized_transaction_ref_idx" ON "transactions"("normalized_transaction_ref");

-- CreateIndex
CREATE INDEX "transactions_normalized_order_ref_on_payment_idx" ON "transactions"("normalized_order_ref_on_payment");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_settlement_ref_key" ON "settlements"("settlement_ref");

-- CreateIndex
CREATE INDEX "settlements_normalized_settlement_ref_idx" ON "settlements"("normalized_settlement_ref");

-- CreateIndex
CREATE INDEX "settlements_normalized_transaction_ref_on_settlement_idx" ON "settlements"("normalized_transaction_ref_on_settlement");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_results_transaction_id_key" ON "reconciliation_results"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_results_settlement_id_key" ON "reconciliation_results"("settlement_id");

-- CreateIndex
CREATE INDEX "reconciliation_results_match_status_idx" ON "reconciliation_results"("match_status");

-- CreateIndex
CREATE INDEX "reconciliation_results_review_status_idx" ON "reconciliation_results"("review_status");

-- CreateIndex
CREATE INDEX "finance_exceptions_exception_type_idx" ON "finance_exceptions"("exception_type");

-- CreateIndex
CREATE INDEX "finance_exceptions_severity_idx" ON "finance_exceptions"("severity");

-- CreateIndex
CREATE INDEX "finance_exceptions_status_idx" ON "finance_exceptions"("status");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_exceptions" ADD CONSTRAINT "finance_exceptions_reconciliation_result_id_fkey" FOREIGN KEY ("reconciliation_result_id") REFERENCES "reconciliation_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
