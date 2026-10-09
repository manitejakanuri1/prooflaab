/**
 * An administrator's wording for a welcome email (table email_templates, migration 105).
 *
 * Only the subject and the opening paragraph can be changed, and both are
 * plain text: they are escaped before they go into the page, so nothing an
 * admin types can become markup or a link. The button and its address are
 * never part of the template. {{name}} is replaced by the person's name.
 */
export interface EmailOverride {
  subject: string;
  intro: string;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderOverride(
  override: EmailOverride,
  name: string,
  buttonUrl: string,
  buttonLabel: string,
): { subject: string; html: string } {
  // split/join, not replace(): a name containing "$&" must stay a name.
  const fill = (text: string) => text.split("{{name}}").join(name);
  const paragraphs = fill(override.intro).split(/\n{2,}/).map((p) =>
    `<p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">${
      escapeHtml(p.trim()).replace(/\n/g, "<br>")
    }</p>`
  ).join("");
  return {
    subject: fill(override.subject).replace(/[\r\n]+/g, " ").slice(0, 150),
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">${paragraphs}<p style="margin: 24px 0;"><a href="${
      escapeHtml(buttonUrl)
    }" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">${
      escapeHtml(buttonLabel)
    }</a></p></div>`,
  };
}
