// Controlled industry vocabulary. Each key maps to the Librarian's coarse industry facet(s)
// plus keywords used to pull sub-vertical collateral (the facet alone lumps 465 docs under "manufacturing").

export type IndustryDef = {
  key: string;
  label: string;
  librarianIndustries: string[];
  keywords: string[]; // Librarian list_documents `query` terms and context for the brief
  examples: string; // helps the classifier
};

export const INDUSTRIES: IndustryDef[] = [
  {
    key: "manufacturing/cement",
    label: "Cement",
    librarianIndustries: ["manufacturing"],
    keywords: ["cement", "kiln", "clinker"],
    examples: "cement producers, clinker grinding units, ready-mix majors",
  },
  {
    key: "manufacturing/metals-mining",
    label: "Steel, Metals & Mining",
    librarianIndustries: ["manufacturing"],
    keywords: ["steel", "zinc", "aluminium", "smelter", "mining"],
    examples: "integrated steel plants, aluminium/zinc/copper smelters, mining companies, ferro alloys",
  },
  {
    key: "manufacturing/chemicals",
    label: "Chemicals, Paints & Process",
    librarianIndustries: ["manufacturing"],
    keywords: ["chemical", "paint", "process plant", "batch"],
    examples: "specialty and bulk chemicals, paints and coatings, fertilizers, petrochemicals",
  },
  {
    key: "manufacturing/textiles",
    label: "Textiles & Apparel",
    librarianIndustries: ["manufacturing"],
    keywords: ["textile", "spinning", "weaving"],
    examples: "spinning, weaving, home textiles, apparel manufacturing",
  },
  {
    key: "manufacturing/engineering",
    label: "Engineering & Industrial Equipment",
    librarianIndustries: ["manufacturing"],
    keywords: ["CMMS", "OEE", "machine shop", "assembly"],
    examples: "electrical equipment, cables, pipes, capital goods, machinery, discrete engineering plants",
  },
  {
    key: "manufacturing/packaging-plastics",
    label: "Packaging, Plastics & Paper",
    librarianIndustries: ["manufacturing"],
    keywords: ["packaging", "plastic", "moulding", "paper"],
    examples: "flexible/rigid packaging, injection moulding, paper and board mills, glass",
  },
  {
    key: "manufacturing/general",
    label: "Manufacturing (Other)",
    librarianIndustries: ["manufacturing"],
    keywords: ["OEE", "energy management", "predictive maintenance"],
    examples: "any other plant-based manufacturer not covered above",
  },
  {
    key: "automotive",
    label: "Automotive & Auto Components",
    librarianIndustries: ["automotive", "manufacturing"],
    keywords: ["automotive", "auto component", "press shop", "forging"],
    examples: "vehicle OEMs, tier-1/tier-2 auto component makers, forging and casting for auto",
  },
  {
    key: "pharma",
    label: "Pharma & Life Sciences",
    librarianIndustries: ["pharma"],
    keywords: ["pharma", "API", "formulation", "cleanroom"],
    examples: "API and formulation manufacturers, biotech, medical devices manufacturing",
  },
  {
    key: "fmcg",
    label: "FMCG, Food & Beverage",
    librarianIndustries: ["fmcg"],
    keywords: ["FMCG", "beverage", "bottling", "food"],
    examples: "bottlers, dairies, packaged food, personal care, tobacco",
  },
  {
    key: "energy-utilities",
    label: "Energy & Utilities",
    librarianIndustries: ["energy-utilities"],
    keywords: ["power plant", "renewable", "thermal", "boiler"],
    examples: "thermal/renewable power generation, captive power, oil and gas, utilities",
  },
  {
    key: "water",
    label: "Water & Wastewater",
    librarianIndustries: ["water"],
    keywords: ["water", "wastewater", "STP", "ETP"],
    examples: "water utilities, treatment plants, desalination, water infrastructure EPCs",
  },
  {
    key: "logistics",
    label: "Logistics, Ports & Warehousing",
    librarianIndustries: ["logistics"],
    keywords: ["warehouse", "port", "fulfilment", "cold chain"],
    examples: "ports and terminals, 3PL, e-commerce fulfilment, cold chain",
  },
  {
    key: "healthcare",
    label: "Healthcare",
    librarianIndustries: ["healthcare"],
    keywords: ["hospital", "healthcare"],
    examples: "hospital chains, diagnostics",
  },
  {
    key: "real-estate",
    label: "Real Estate & Facilities",
    librarianIndustries: ["real-estate"],
    keywords: ["building", "facility", "HVAC"],
    examples: "commercial real estate, facilities management, data centres",
  },
  {
    key: "general",
    label: "Other",
    librarianIndustries: ["general"],
    keywords: ["IoT platform", "industrial AI"],
    examples: "anything that does not fit above (IT services, consulting, finance, etc.)",
  },
];

export const INDUSTRY_KEYS = INDUSTRIES.map((i) => i.key) as [string, ...string[]];

export function industryDef(key: string): IndustryDef {
  return INDUSTRIES.find((i) => i.key === key) ?? INDUSTRIES[INDUSTRIES.length - 1];
}
