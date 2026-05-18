-- First-boot admin/admin user is created with mustChangePassword=true so
-- the user is forced to set a real password before any other UI renders.
ALTER TABLE "users"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
