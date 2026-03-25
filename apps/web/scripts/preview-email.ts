/**
 * Generates an HTML preview of the feature announcement email.
 * Run: bun run apps/web/scripts/preview-email.ts
 * Then open: apps/web/scripts/email-preview.html in your browser
 */

import { writeFileSync } from "fs";
import { join } from "path";

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

const subject = "Octopus'ta Yeni: Mart 2026 Guncellemeleri";
const heroTitle = "Yeni Ozellikler Sizlerle";
const heroDescription =
  "Octopus'u daha da guclu hale getiren yeni ozelliklerimizi kesfetmeye hazir misiniz? Iste bu ay eklenen yenilikler:";
const ctaText = "Hemen Dene";
const ctaUrl = `${APP_URL}/dashboard`;
const footerNote = "Bu ozellikler tum Pro ve Team planlarinda aktif.";
const preheader = "Mart 2026 guncellemeleri: Akilli Review Ozeti, Severity Dashboard ve daha fazlasi";

const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0C0C0C; font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #0C0C0C;">${preheader}</div>

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #0C0C0C;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <!-- Main card -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%; background-color: #161616; border-radius: 16px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden;">

          <!-- Logo bar -->
          <tr>
            <td style="padding: 32px 40px 24px 40px; text-align: center;">
              <a href="${APP_URL}" target="_blank" style="text-decoration: none;">
                <img src="${logoUrl}" alt="Octopus" width="40" height="42" style="display: inline-block; border: 0; outline: none;" />
              </a>
            </td>
          </tr>

          <!-- Teal gradient divider -->
          <tr>
            <td style="padding: 0 40px;">
              <div style="height: 2px; background: linear-gradient(90deg, #10D8BE, #1DFAD9, #C0F4DA); border-radius: 1px;"></div>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding: 40px 40px 24px 40px; text-align: center;">
              <h1 style="margin: 0 0 12px 0; font-size: 28px; font-weight: 700; line-height: 1.2; color: #ffffff; letter-spacing: -0.02em;">
                ${heroTitle}
              </h1>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #888888;">
                ${heroDescription}
              </p>
            </td>
          </tr>

          <!-- Features -->
          <tr>
            <td style="padding: 8px 40px 32px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${featureRows}
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 8px 40px 40px 40px; text-align: center;">
              <a href="${ctaUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #10D8BE, #1DFAD9); color: #0C0C0C; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; letter-spacing: -0.01em;">
                ${ctaText} &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer divider -->
          <tr>
            <td style="padding: 0 40px;">
              <div style="height: 1px; background-color: #1e1e1e;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 32px 40px; text-align: center;">
              <p style="margin: 0 0 12px 0; font-size: 13px; line-height: 1.5; color: #555555;">${footerNote}</p>
              <p style="margin: 0; font-size: 12px; color: #444444;">
                Sent by <a href="${APP_URL}" style="color: #10D8BE; text-decoration: none;">Octopus</a> &mdash; AI-powered code review
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #333333;">
                <a href="${APP_URL}/settings/notifications" style="color: #444444; text-decoration: underline;">Manage email preferences</a>
              </p>
            </td>
          </tr>

        </table>
        <!-- /Main card -->

      </td>
    </tr>
  </table>
</body>
</html>`;

const outPath = join(import.meta.dir, "email-preview.html");
writeFileSync(outPath, html, "utf-8");
console.log(`Email preview written to: ${outPath}`);
console.log(`Open it in your browser to see the template.`);
