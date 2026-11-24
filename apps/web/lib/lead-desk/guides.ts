/**
 * The step-by-step guides of the Lead sources page (owner, 29 Nov 2026; mock "Lead sources"): for each way leads reach Stack19, the steps and the lines to copy. This is developer-facing text (English by design, like an API page); the owner-facing
 * words (the card titles and lines, the buttons) come from the string store (`lsg.*`). `YOUR_ADDRESS` stands for the lead address of a job, which is shown on the page where the feature is on; nothing here holds a secret.
 */
export const GUIDE_IDS = ["fb", "sheet", "web", "crm", "mart", "auto", "dev"] as const;
export type GuideId = (typeof GUIDE_IDS)[number];
export const isGuide = (v: unknown): v is GuideId => typeof v === "string" && (GUIDE_IDS as readonly string[]).includes(v);

export type Guide = { steps: readonly string[]; code?: string; works?: boolean };
export const GUIDES: Readonly<Record<GuideId, Guide>> = {
  fb: { steps: ["Open your lead form (Instant Form) in Meta Ads Manager.", "Choose a tool that sends new leads to a web address (Meta's own Leads Center, Zapier or Make) and paste YOUR_ADDRESS.", "Send a test lead from Meta's lead ads testing tool. It shows in the Activity list of this page within a minute."] },
  sheet: { steps: ["Open your Google Sheet. Put headings in the first row: name, phone, and what they asked.", "In Extensions > Apps Script paste the snippet below and replace YOUR_ADDRESS. Run it once to allow it.", "Add a trigger: run it on every new form submit or edit. New rows become leads."], code: "function sendLead(e) {\n  const sheet = e.source.getActiveSheet();\n  const row = sheet.getRange(sheet.getLastRow(), 1, 1, 3).getValues()[0];\n  UrlFetchApp.fetch('YOUR_ADDRESS', {\n    method: 'post',\n    contentType: 'application/json',\n    payload: JSON.stringify({ name: row[0], phone: row[1], note: row[2] }),\n  });\n}" },
  web: { steps: ["Make a contact form on your site with at least a name and a phone number field.", "Set the form to send its data to YOUR_ADDRESS (a web request, POST). Most site builders call this a webhook.", "Send yourself a test enquiry from the site. It shows in the Activity list of this page."], code: "<form action=\"YOUR_ADDRESS\" method=\"post\">\n  <input name=\"name\" placeholder=\"Your name\" required>\n  <input name=\"phone\" placeholder=\"Phone number\" required>\n  <input name=\"note\" placeholder=\"What do you need?\">\n  <button>Send</button>\n</form>", works: true },
  crm: { steps: ["In your CRM add a web request (webhook) that runs when a lead is created.", "Use YOUR_ADDRESS as the web address, the POST method and JSON.", "Send the fields name, phone, email and note. Create a test lead in your CRM: it shows in the Activity list of this page."], code: "POST YOUR_ADDRESS\nContent-Type: application/json\n\n{ \"name\": \"Asha\", \"phone\": \"+919800000000\", \"email\": \"asha@example.com\", \"note\": \"Asked about silk\" }", works: true },
  mart: { steps: ["IndiaMART: open the connection card of this page and paste your CRM key. Leads are pulled for you.", "JustDial and other portals that send lead emails: forward those emails to the mail address of the card.", "The first lead can take a few hours to arrive. Each lead is named by its portal so you can tell them apart."] },
  auto: { steps: ["In Zapier, Make, n8n or Pabbly add a step that sends a web request (POST).", "Use YOUR_ADDRESS as the address and send the person's name and phone as JSON.", "Run the step once. The test lead shows in the Activity list of this page."], code: "POST YOUR_ADDRESS\nContent-Type: application/json\n\n{ \"name\": \"Asha\", \"phone\": \"+919800000000\", \"note\": \"Asked about silk\" }", works: true },
  dev: { steps: ["Make an API key on the Developers page. Start with a test key: it never calls anyone.", "Send leads with a web request. Add \"dry_run\": true first: everything is checked and nothing is created.", "Add an Idempotency-Key header so a retry never makes a second lead."], code: "curl -X POST https://api.stack19.in/v1/leads \\\n  -H \"Authorization: Bearer YOUR_KEY\" \\\n  -H \"Idempotency-Key: asha-001\" \\\n  -d '{\"name\":\"Asha\",\"phone\":\"+919800000000\",\"dry_run\":true}'", works: true },
};
export const WORKS_WITH = ["Google Forms", "Zapier", "Make", "n8n", "Pabbly", "WordPress", "Wix", "Zoho CRM", "LeadSquared", "Sell.Do", "HubSpot", "IndiaMART", "JustDial", "Your own server"] as const;

/** The prepared mail "Email this to my developer": a subject and a body with the steps (no secret: the developer is told where the address is shown). */
export function mailFor(title: string, id: GuideId): { subject: string; body: string } {
  const g = GUIDES[id];
  const steps = g.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return { subject: `Sending leads to Stack19: ${title}`, body: `Hello,\n\nWe want leads to reach Stack19. Please follow these steps:\n\n${steps}\n${g.code ? `\n${g.code}\n` : ""}\nThe lead address is in the Lead sources page of our Stack19 account; I will send it to you separately.\n` };
}
