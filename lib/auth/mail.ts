const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Ballotwise <no-reply@n3el.dev>";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function resetEmail(link: string): { subject: string; text: string; html: string } {
  const subject = "Reset your Ballotwise password";
  const text = `Someone asked to reset the password for this Ballotwise account.\n\nSet a new password: ${link}\n\nThe link works once, for one hour. If you didn't ask for this, ignore this email and your password stays the same.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#1d2125;max-width:480px">
<p>Someone asked to reset the password for this Ballotwise account.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0a3161;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Set a new password</a></p>
<p style="color:#5b636b;font-size:14px">The link works once, for one hour. If you didn't ask for this, ignore this email and your password stays the same.</p>
</div>`;
  return { subject, text, html };
}

/** Resend refused the email. Carries only the status, so it is safe to log. */
export class MailError extends Error {
  constructor(readonly status: number) {
    super(`Resend refused the email (HTTP ${status})`);
  }
}

/** Sends one email through Resend. */
export async function sendEmail(apiKey: string, to: string, mail: { subject: string; text: string; html: string }): Promise<void> {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], ...mail }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new MailError(res.status);
}
