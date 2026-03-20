"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { isAdminEmail } from "@/lib/admin";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");
  if (!isAdminEmail(session.user.email)) throw new Error("Not authorized");
  return session;
}

export async function createAvailableModel(
  _prev: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireAdmin();

  const modelId = (formData.get("modelId") as string)?.trim();
  const displayName = (formData.get("displayName") as string)?.trim();
  const provider = (formData.get("provider") as string)?.trim();
  const category = (formData.get("category") as string)?.trim();
  const inputPrice = parseFloat(formData.get("inputPrice") as string);
  const outputPrice = parseFloat(formData.get("outputPrice") as string);

  if (!modelId || !displayName || !provider || !category) {
    return { error: "All fields are required." };
  }
  if (isNaN(inputPrice) || isNaN(outputPrice)) {
    return { error: "Prices must be valid numbers." };
  }

  const existing = await prisma.availableModel.findUnique({
    where: { modelId },
  });
  if (existing) {
    return { error: "A model with this ID already exists." };
  }

  await prisma.availableModel.create({
    data: { modelId, displayName, provider, category, inputPrice, outputPrice },
  });

  revalidatePath("/admin");
  return { success: true };
}

export async function updateAvailableModel(
  _prev: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireAdmin();

  const id = formData.get("id") as string;
  const displayName = (formData.get("displayName") as string)?.trim();
  const inputPrice = parseFloat(formData.get("inputPrice") as string);
  const outputPrice = parseFloat(formData.get("outputPrice") as string);

  if (!id || !displayName) {
    return { error: "Display name is required." };
  }
  if (isNaN(inputPrice) || isNaN(outputPrice)) {
    return { error: "Prices must be valid numbers." };
  }

  await prisma.availableModel.update({
    where: { id },
    data: { displayName, inputPrice, outputPrice },
  });

  revalidatePath("/admin");
  return { success: true };
}

export async function toggleAvailableModel(formData: FormData) {
  await requireAdmin();

  const id = formData.get("id") as string;
  if (!id) throw new Error("Missing model ID");

  const model = await prisma.availableModel.findUniqueOrThrow({
    where: { id },
    select: { isActive: true },
  });

  await prisma.availableModel.update({
    where: { id },
    data: { isActive: !model.isActive },
  });

  revalidatePath("/admin");
}

export async function setPlatformDefault(formData: FormData) {
  await requireAdmin();

  const id = formData.get("id") as string;
  if (!id) throw new Error("Missing model ID");

  const model = await prisma.availableModel.findUniqueOrThrow({
    where: { id },
    select: { category: true },
  });

  // Use transaction to prevent race conditions
  await prisma.$transaction(async (tx) => {
    // Clear existing default for same category
    await tx.availableModel.updateMany({
      where: { category: model.category, isPlatformDefault: true },
      data: { isPlatformDefault: false },
    });

    // Set this model as default
    await tx.availableModel.update({
      where: { id },
      data: { isPlatformDefault: true },
    });
  });

  revalidatePath("/admin");
}

export async function updateSystemReviewConfig(
  config: Record<string, unknown>,
): Promise<{ error?: string; success?: boolean }> {
  await requireAdmin();

  await prisma.systemConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", defaultReviewConfig: config as object },
    update: { defaultReviewConfig: config as object },
  });

  revalidatePath("/admin");
  return { success: true };
}

export async function getSystemReviewConfig(): Promise<Record<string, unknown>> {
  const row = await prisma.systemConfig.findUnique({ where: { id: "singleton" } });
  return (row?.defaultReviewConfig as Record<string, unknown>) ?? {};
}

export async function getGlobalBlockedAuthors(): Promise<string[]> {
  const row = await prisma.systemConfig.findUnique({ where: { id: "singleton" } });
  return (row?.blockedAuthors as string[]) ?? [];
}

export async function updateGlobalBlockedAuthors(
  authors: string[],
): Promise<{ error?: string; success?: boolean }> {
  await requireAdmin();

  if (authors.length > 50) {
    return { error: "Maximum 50 blocked authors allowed." };
  }
  if (authors.some((a) => a.length > 100)) {
    return { error: "Author names must be 100 characters or less." };
  }

  await prisma.systemConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", blockedAuthors: authors },
    update: { blockedAuthors: authors },
  });

  revalidatePath("/admin/blocked-authors");
  return { success: true };
}
