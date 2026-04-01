import {
  Html,
  Head,
  Body,
  Container,
  Img,
  Text,
  Section,
  Button,
  Hr,
  Link,
} from "@react-email/components";

const APP_URL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://octopus-review.ai";

// Always use production URL for email assets (images, logo)
// so they render correctly even when sent from localhost
const ASSET_URL = "https://octopus-review.ai";

interface EmailLayoutProps {
  body: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  signature?: { name: string; title: string } | null;
  showUnsubscribe?: boolean;
}

export function EmailLayout({
  body,
  buttonText,
  buttonUrl,
  signature,
  showUnsubscribe = true,
}: EmailLayoutProps) {
  // Split body by newlines into paragraphs, support **bold** and [link](url)
  const paragraphs = body.split("\n").filter((line) => line.trim() !== "");

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Img
            src={`${ASSET_URL}/logo.png`}
            alt="Octopus"
            height={36}
            style={styles.logo}
          />

          {paragraphs.map((p, i) => {
            // Handle bullet points
            if (p.trim().startsWith("- ") || p.trim().startsWith("• ")) {
              return (
                <Text key={i} style={styles.listItem}>
                  {"  • "}
                  <span
                    dangerouslySetInnerHTML={{
                      __html: formatInline(p.trim().slice(2)),
                    }}
                  />
                </Text>
              );
            }

            return (
              <Text
                key={i}
                style={styles.paragraph}
                dangerouslySetInnerHTML={{ __html: formatInline(p) }}
              />
            );
          })}

          {buttonText && buttonUrl && (
            <Section style={styles.buttonSection}>
              <Button style={styles.button} href={buttonUrl}>
                {buttonText}
              </Button>
            </Section>
          )}

          {signature && (
            <Text style={styles.paragraph}>
              -{signature.name}
              <br />
              {signature.title}
            </Text>
          )}

          <Hr style={styles.hr} />

          {showUnsubscribe && (
            <Text style={styles.footer}>
              You&apos;re receiving this because you signed up for Octopus.
              <br />
              <Link
                href={`${APP_URL}/settings/notifications`}
                style={styles.footerLink}
              >
                Manage email preferences
              </Link>
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}

/** Replace **bold**, [text](url), and `code` in inline text */
function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2" style="color: #0366d6; text-decoration: underline;">$1</a>',
    )
    .replace(
      /`(.+?)`/g,
      '<code style="background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-size: 13px;">$1</code>',
    );
}

const styles = {
  body: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    margin: "0" as const,
    padding: "0" as const,
    backgroundColor: "#ffffff",
  },
  container: {
    maxWidth: "580px",
    margin: "0 auto",
    padding: "40px 20px",
  },
  logo: {
    marginBottom: "32px",
  },
  paragraph: {
    fontSize: "15px",
    lineHeight: "1.6",
    color: "#1a1a1a",
    margin: "0 0 16px",
  },
  listItem: {
    fontSize: "15px",
    lineHeight: "1.6",
    color: "#1a1a1a",
    margin: "0 0 8px",
    paddingLeft: "8px",
  },
  buttonSection: {
    margin: "24px 0",
  },
  button: {
    display: "inline-block" as const,
    padding: "12px 24px",
    backgroundColor: "#000000",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: "500" as const,
    textDecoration: "none" as const,
    borderRadius: "6px",
  },
  hr: {
    borderColor: "#e5e5e5",
    margin: "32px 0",
  },
  footer: {
    fontSize: "12px",
    color: "#999999",
    lineHeight: "1.5",
  },
  footerLink: {
    color: "#999999",
  },
};
