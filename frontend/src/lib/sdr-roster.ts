// SDRs allowed to use the app. Sign-in is refused for anyone not on this list.
export const SDR_ROSTER = [
  { name: "Khush Idnani", email: "khush@faclon.com" },
  { name: "Yash Acharekar", email: "yash.a@faclon.com" },
  { name: "Niketa Sareen", email: "niketa@faclon.com" },
] as const;

export function rosterEntry(email: string) {
  return SDR_ROSTER.find((s) => s.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
}
