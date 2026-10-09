// Pure functions: raw sheet rows -> normalized prospects + skipped rows. No I/O here.

export type ColumnKey =
  | "name"
  | "firstName"
  | "lastName"
  | "title"
  | "company"
  | "linkedin"
  | "email"
  | "notes"
  | "phone"
  | "mobile"
  | "state"
  | "timeZone";
export type ColumnMap = Partial<Record<ColumnKey, number>>;

export type ParsedProspect = {
  row: number; // 1-based sheet row (header = row 1)
  name: string;
  title: string | null;
  companyName: string;
  companyKey: string;
  linkedinUrl: string | null;
  email: string;
  personKey: string;
  callNotes: string | null;
  phone: string | null; // direct line, else mobile
  location: string | null;
  timeZone: string | null;
};

export type SkippedProspect = { row: number; name: string; company: string; reason: string };

const HEADER_SYNONYMS: Record<ColumnKey, RegExp> = {
  name: /^(full\s*name|name|prospect(\s*name)?|contact(\s*name)?|person)$/i,
  firstName: /^first\s*name$/i,
  lastName: /^(last\s*name|surname)$/i,
  title: /^(title|job\s*title|designation|role|position)$/i,
  company: /^(company(\s*name)?|organi[sz]ation|account(\s*name)?|employer)$/i,
  // "Person Linkedin Url" (Apollo exports) but never "Company Linkedin Url"
  linkedin: /^((person|contact)\s*)?linked\s*in(\s*(profile))?(\s*(url|link))?$|^profile(\s*(url|link))?$/i,
  email: /^(e-?mail(\s*(id|address))?|work\s*e-?mail|business\s*e-?mail)$/i,
  notes: /^(notes?|call\s*notes?|comments?|remarks?|call\s*outcome)$/i,
  phone: /^(work\s*direct\s*phone|direct\s*(dial|phone)|work\s*phone|phone(\s*number)?|corporate\s*phone)$/i,
  mobile: /^(mobile(\s*phone)?|cell(\s*phone)?)$/i,
  state: /^((company|person)\s*)?state$/i,
  timeZone: /^(us\s*)?time\s*zone$/i,
};

export function detectColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((raw, idx) => {
    const h = raw.trim().replace(/[_*:]/g, " ").replace(/\s+/g, " ");
    for (const key of Object.keys(HEADER_SYNONYMS) as ColumnKey[]) {
      if (map[key] === undefined && HEADER_SYNONYMS[key].test(h)) {
        map[key] = idx;
        break;
      }
    }
  });
  return map;
}

export function missingColumns(map: ColumnMap): string[] {
  const missing: string[] = [];
  if (map.name === undefined && map.firstName === undefined) missing.push("Name");
  if (map.company === undefined) missing.push("Company");
  if (map.email === undefined) missing.push("Email");
  return missing;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const COMPANY_SUFFIXES =
  /\b(private|pvt|limited|ltd|llp|inc|incorporated|corp|corporation|co|company|plc|gmbh|india|the)\b\.?/gi;

/** Normalized company key so "JSW Steel Ltd." and "JSW Steel Limited" share one research record. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** Canonical LinkedIn profile URL, or null when the value isn't a profile URL. */
export function normalizeLinkedin(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = value.trim().match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

export function personKey(linkedin: string | null, email: string): string {
  return linkedin ?? `email:${email}`;
}

function cell(row: string[], idx: number | undefined): string {
  return idx === undefined ? "" : String(row[idx] ?? "").trim();
}

export function parseRows(
  rows: string[][],
  opts: { activeEmails?: Map<string, string> } = {},
): { columns: ColumnMap; prospects: ParsedProspect[]; skipped: SkippedProspect[] } {
  const [header = [], ...body] = rows;
  const columns = detectColumns(header);
  const missing = missingColumns(columns);
  if (missing.length) throw new Error(`Sheet is missing required column(s): ${missing.join(", ")}`);

  const prospects: ParsedProspect[] = [];
  const skipped: SkippedProspect[] = [];
  const seen = new Set<string>();

  body.forEach((r, i) => {
    const rowNum = i + 2;
    const name =
      cell(r, columns.name) || [cell(r, columns.firstName), cell(r, columns.lastName)].filter(Boolean).join(" ");
    const company = cell(r, columns.company);
    const email = cell(r, columns.email).replace(/^mailto:/i, "").toLowerCase();
    if (!name && !company && !email) return; // blank row

    const skip = (reason: string) => skipped.push({ row: rowNum, name, company, reason });
    if (!email) return skip("No email address");
    if (!EMAIL_RE.test(email)) return skip(`Invalid email "${email}"`);
    if (!name) return skip("No name");
    if (!company) return skip("No company");
    if (seen.has(email)) return skip("Duplicate of an earlier row");
    const owner = opts.activeEmails?.get(email);
    if (owner) return skip(`Already in an active cadence (${owner})`);
    seen.add(email);

    const linkedinUrl = normalizeLinkedin(cell(r, columns.linkedin));
    prospects.push({
      row: rowNum,
      name,
      title: cell(r, columns.title) || null,
      companyName: company,
      companyKey: companyKey(company),
      linkedinUrl,
      email,
      personKey: personKey(linkedinUrl, email),
      callNotes: cell(r, columns.notes) || null,
      phone: cell(r, columns.phone) || cell(r, columns.mobile) || null,
      location: cell(r, columns.state) || null,
      timeZone: cell(r, columns.timeZone) || null,
    });
  });

  return { columns, prospects, skipped };
}
