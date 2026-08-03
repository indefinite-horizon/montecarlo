/** Builds the HTML email body for magic-link sign-in. */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function magicLinkEmail({
  appName,
  url,
  email,
  expiresInSeconds,
}: {
  appName: string;
  url: string;
  email: string;
  expiresInSeconds: number;
}) {
  const safeAppName = escapeHtml(appName);
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(url);
  const expiresInMinutes = Math.max(1, Math.round(expiresInSeconds / 60));
  const expiryLabel = `${expiresInMinutes} minute${expiresInMinutes === 1 ? "" : "s"}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to ${safeAppName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 20px;text-align:center;border-bottom:1px solid #e2e8f0;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#0f172a;">${safeAppName}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#334155;">Use this secure link to sign in as <strong>${safeEmail}</strong>.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 28px;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:13px 28px;background-color:#0f172a;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:6px;">Sign in</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:14px;color:#64748b;">Or copy and paste this link into your browser:</p>
              <p style="margin:0 0 24px;font-size:14px;color:#2563eb;word-break:break-all;">${safeUrl}</p>
              <p style="margin:0;font-size:13px;color:#94a3b8;">This link expires in ${expiryLabel}. If you did not request this email, you can safely ignore it.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
