import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Email Template Preview",
  robots: "noindex, nofollow",
};

const APP_URL = "https://octopus-review.ai";
const logoUrl = `${APP_URL}/logo.png`;

const features = [
  {
    title: "Akilli Review Ozeti",
    description:
      "Her PR review sonrasi degisikliklerin kisa bir ozetini otomatik olarak olusturuyoruz. Artik uzun diff'leri okumak zorunda degilsiniz.",
  },
  {
    title: "Severity Dashboard",
    description:
      "Tum bulgulari onem derecesine gore tek bir panelde gorun. Kritik sorunlara oncelik verin.",
  },
  {
    title: "Slack Entegrasyonu",
    description:
      "Review sonuclarini dogrudan Slack kanaliniza gonderin. Ekibiniz aninda haberdar olsun.",
  },
];

function getEmailHtml() {
  const featureRows = features
    .map(
      (f) => `
      <tr>
        <td style="padding: 16px 0; border-bottom: 1px solid #1e1e1e;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="40" valign="top" style="padding-right: 16px;">
                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #10D8BE, #1DFAD9); border-radius: 8px; text-align: center; line-height: 32px; font-size: 16px; color: #0C0C0C; font-weight: bold;">&#10003;</div>
              </td>
              <td valign="top">
                <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #ffffff;">${f.title}</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #888888;">${f.description}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email Preview</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0C0C0C; font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden;">Mart 2026 guncellemeleri</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #0C0C0C;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%; background-color: #161616; border-radius: 16px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden;">
          <tr>
            <td style="padding: 32px 40px 24px 40px; text-align: center;">
              <a href="${APP_URL}" style="text-decoration: none;">
                <img src="${logoUrl}" alt="Octopus" width="40" height="42" style="display: inline-block; border: 0;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px;">
              <div style="height: 2px; background: linear-gradient(90deg, #10D8BE, #1DFAD9, #C0F4DA); border-radius: 1px;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 40px 24px 40px; text-align: center;">
              <h1 style="margin: 0 0 12px 0; font-size: 28px; font-weight: 700; line-height: 1.2; color: #ffffff; letter-spacing: -0.02em;">Yeni Ozellikler Sizlerle</h1>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #888888;">Octopus'u daha da guclu hale getiren yeni ozelliklerimizi kesfetmeye hazir misiniz? Iste bu ay eklenen yenilikler:</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 40px 32px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${featureRows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 40px 40px 40px; text-align: center;">
              <a href="${APP_URL}/dashboard" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10D8BE, #1DFAD9); color: #0C0C0C; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">Hemen Dene &rarr;</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px;">
              <div style="height: 1px; background-color: #1e1e1e;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px 40px; text-align: center;">
              <p style="margin: 0 0 12px 0; font-size: 13px; line-height: 1.5; color: #555555;">Bu ozellikler tum Pro ve Team planlarinda aktif.</p>
              <p style="margin: 0; font-size: 12px; color: #444444;">Sent by <a href="${APP_URL}" style="color: #10D8BE; text-decoration: none;">Octopus</a> &mdash; AI-powered code review</p>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #333333;"><a href="${APP_URL}/settings/notifications" style="color: #444444; text-decoration: underline;">Manage email preferences</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default function EmailPreviewPage() {
  const html = getEmailHtml();

  return (
    <div className="min-h-screen bg-neutral-950 p-4">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white">Email Template Preview</h1>
          <span className="rounded bg-yellow-500/10 px-2 py-1 text-xs text-yellow-400">
            Dev only — not indexed
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <iframe
            srcDoc={html}
            title="Email preview"
            className="h-[800px] w-full border-0 bg-[#0C0C0C]"
          />
        </div>
      </div>
    </div>
  );
}
