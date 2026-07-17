-- AlterTable
-- Welcome credits are granted explicitly at first-org creation (with a ledger
-- row); the column default must not hand them out on other creation paths.
ALTER TABLE "organizations" ALTER COLUMN "freeCreditBalance" SET DEFAULT 0;
