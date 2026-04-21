import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decryptJson } from "@/lib/crypto";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { finalizeJiraSite } from "../../jira-task-action";

const PENDING_COOKIE = "jira_oauth_pending";

type PendingPayload = {
  orgId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  sites: { cloudId: string; name: string; url: string }[];
};

export default async function SelectJiraSitePage() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PENDING_COOKIE)?.value;
  if (!raw) {
    redirect("/settings/integrations?error=jira_session_expired");
  }

  let payload: PendingPayload;
  try {
    payload = decryptJson<PendingPayload>(raw);
  } catch {
    redirect("/settings/integrations?error=jira_session_expired");
  }

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Choose a Jira site</CardTitle>
          <CardDescription>
            Your Atlassian account has access to multiple sites. Pick the one to
            connect to this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={finalizeJiraSite} className="space-y-4">
            <div className="space-y-2">
              {payload.sites.map((site, idx) => (
                <Label
                  key={site.cloudId}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent"
                >
                  <input
                    type="radio"
                    name="cloudId"
                    value={site.cloudId}
                    defaultChecked={idx === 0}
                    className="mt-1"
                    required
                  />
                  <div>
                    <div className="font-medium">{site.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {site.url}
                    </div>
                  </div>
                </Label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" asChild type="button">
                <a href="/settings/integrations">Cancel</a>
              </Button>
              <Button type="submit">Connect site</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
