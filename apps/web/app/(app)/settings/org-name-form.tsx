"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { IconCamera, IconPencil, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrganizationName } from "../actions";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/gif";

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export function OrgNameForm({
  currentName,
  avatarUrl,
  isOwner,
}: {
  currentName: string;
  avatarUrl: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateOrganizationName, {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentUrl, setCurrentUrl] = useState(avatarUrl);
  const [uploading, startUpload] = useTransition();
  const [dragActive, setDragActive] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`Image must be smaller than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    const formData = new FormData();
    formData.append("file", file);

    startUpload(async () => {
      try {
        const res = await fetch("/api/organizations/avatar", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Upload failed.");
          return;
        }
        setCurrentUrl(data.avatarUrl);
        toast.success("Organization picture updated.");
        router.refresh();
      } catch {
        toast.error("Upload failed. Please try again.");
      }
    });
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    startUpload(async () => {
      try {
        const res = await fetch("/api/organizations/avatar", { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Remove failed.");
          return;
        }
        setCurrentUrl(null);
        toast.success("Organization picture removed.");
        router.refresh();
      } catch {
        toast.error("Remove failed. Please try again.");
      }
    });
  }

  const canEdit = isOwner && !uploading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Organization details and preferences.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (!canEdit) return;
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              aria-label={currentUrl ? "Change organization picture" : "Upload organization picture"}
              className={`group relative size-24 rounded-full transition-all ${
                canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-70"
              } ${dragActive ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
            >
              <span
                className={`flex size-full items-center justify-center overflow-hidden rounded-full border bg-muted text-2xl font-semibold text-muted-foreground transition-colors ${
                  canEdit ? "group-hover:border-ring" : ""
                }`}
              >
                {currentUrl ? (
                  <Image
                    src={currentUrl}
                    alt={currentName}
                    width={96}
                    height={96}
                    className="size-full object-cover"
                    unoptimized
                  />
                ) : (
                  getInitials(currentName)
                )}

                {canEdit && (
                  <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <IconCamera className="size-5" />
                    <span className="text-[11px] font-medium">
                      {currentUrl ? "Change" : "Upload"}
                    </span>
                  </span>
                )}
              </span>

              {canEdit && (
                <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-foreground text-background shadow">
                  <IconPencil className="size-3" />
                </span>
              )}
            </button>

            {currentUrl && canEdit && (
              <button
                type="button"
                onClick={handleRemove}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
              >
                <IconX className="size-3" />
                Remove
              </button>
            )}
            {!currentUrl && (
              <p className="text-center text-[11px] leading-tight text-muted-foreground">
                Click or drop
                <br />
                PNG/JPG/WEBP ≤5MB
              </p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>

          <form action={formAction} className="flex-1 space-y-2">
            <Label htmlFor="name">Organization name</Label>
            <div className="flex max-w-sm gap-3">
              <Input
                id="name"
                name="name"
                defaultValue={currentName}
                placeholder="Acme Inc."
                required
                minLength={2}
                maxLength={100}
                disabled={!isOwner}
                className="flex-1"
              />
              <Button type="submit" disabled={pending || !isOwner} size="sm">
                {pending ? "Saving..." : "Save"}
              </Button>
            </div>
            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            {state.success && (
              <p className="text-sm text-green-600">Updated successfully.</p>
            )}
            {!isOwner && (
              <p className="text-muted-foreground text-xs">
                Only owners can change the organization details.
              </p>
            )}
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
