"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconTerminal2, IconCheck, IconLoader2 } from "@tabler/icons-react";

interface Organization {
  id: string;
  name: string;
  slug: string;
}

function AuthorizeContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");

  const [orgs, setOrgs] = React.useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [approving, setApproving] = React.useState(false);
  const [approved, setApproved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!code) return;

    const abortController = new AbortController();

    fetch("/api/cli/auth/orgs", { signal: abortController.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load organizations");
        return res.json() as Promise<{ organizations: Organization[] }>;
      })
      .then((data) => {
        setOrgs(data.organizations);
        if (data.organizations.length === 1) {
          setSelectedOrgId(data.organizations[0].id);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => abortController.abort();
  }, [code]);

  async function handleAuthorize() {
    if (!selectedOrgId || !code) return;

    setApproving(true);
    setError(null);

    try {
      const res = await fetch("/api/cli/auth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: code, organizationId: selectedOrgId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Authorization failed");
      }

      setApproved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed");
      setApproving(false);
    }
  }

  if (!code) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Invalid Request</CardTitle>
            <CardDescription>
              Missing device code. Please run <code>octopus login</code> from your terminal.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (approved) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <div className="bg-primary/10 text-primary mb-2 flex size-12 items-center justify-center rounded-full">
              <IconCheck className="size-6" />
            </div>
            <CardTitle>CLI Authorized</CardTitle>
            <CardDescription>
              You can close this window and return to your terminal.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="bg-muted mb-2 flex size-12 items-center justify-center rounded-full">
            <IconTerminal2 className="size-6" />
          </div>
          <CardTitle>Authorize Octopus CLI</CardTitle>
          <CardDescription>
            Select an organization to grant CLI access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <IconLoader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="text-muted-foreground text-center text-sm">
              You are not a member of any organization.
            </p>
          ) : (
            <div className="space-y-2">
              {orgs.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => setSelectedOrgId(org.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedOrgId === org.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="font-medium">{org.name}</div>
                  <div className="text-muted-foreground text-sm">{org.slug}</div>
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="mt-3 text-center text-sm text-red-500">{error}</p>
          )}
        </CardContent>
        {orgs.length > 0 && !loading && (
          <CardFooter>
            <Button
              className="w-full"
              disabled={!selectedOrgId || approving}
              onClick={handleAuthorize}
            >
              {approving ? (
                <>
                  <IconLoader2 className="size-4 animate-spin" data-icon="inline-start" />
                  Authorizing...
                </>
              ) : (
                "Authorize"
              )}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

export default function CliAuthorizePage() {
  return (
    <Suspense>
      <AuthorizeContent />
    </Suspense>
  );
}
