export type NodeTemplate = {
  id: string;
  label: string;
  description?: string;
  defaultPercent?: number;
  defaultFixed?: number;
  childIds?: string[];
  accent?: "primary" | "dark" | "neutral";
  kind?: "standard" | "group";
};

export const rootNodeId = "developerPayout";

export const payoutNodes: Record<string, NodeTemplate> = {
  developerPayout: {
    id: "developerPayout",
    label: "Developer Payout",
    description: "Total commission from developer",
    accent: "dark",
    childIds: [
      "directIcb",
      "taggerCombined",
      "eraAgency",
    ],
  },
  // Direct ICB Flow
  directIcb: {
    id: "directIcb",
    label: "Direct ICB 2.0% + 0.2%",
    description: "ECB 1.7% + ICB top up 0.2%",
    defaultPercent: 0.022,
    childIds: ["ecb", "icb"],
  },
  ecb: {
    id: "ecb",
    label: "ECB 1.7%",
    description: "ECB share of Direct ICB",
    defaultPercent: 1.7 / 2.2, // Exact: 1.7% / 2.2% = 77.2727...% of Direct ICB
  },
  icb: {
    id: "icb",
    label: "ICB 0.3% + 0.2%",
    description: "Indirect ICB payout",
    defaultPercent: 0.5 / 2.2, // Exact: 0.5% / 2.2% = 22.7272...% of Direct ICB
  },
  // Tagger Fee Flow
  taggerFee: {
    id: "taggerFee",
    label: "Tagger Fee 0.3%",
    description: "Commission for tagger",
    defaultPercent: 0.003,
    childIds: ["taggerKw", "taggerEra"],
  },
  taggerCombined: {
    id: "taggerCombined",
    label: "Tagger Fee 0.3% + Incentive",
    description: "Includes both the 0.3% fee and $2,000 incentive",
    kind: "group",
    defaultPercent: 0, // Group node - amount is sum of children, not a percentage of parent
    childIds: ["taggerFee", "taggerIncentive"],
    accent: "primary",
  },
  taggerIncentive: {
    id: "taggerIncentive",
    label: "Tagger Fee (Incentive)",
    description: "Flat incentive for tagger",
    defaultFixed: 2000,
    childIds: ["taggerIncentiveSpecialist", "taggerIncentiveEra"],
  },
  taggerKw: {
    id: "taggerKw",
    label: "KW 85%",
    description: "KW share from tagger fee",
    defaultPercent: 0.85,
    accent: "primary",
    childIds: ["projectSpecialist", "newLaunchTeam", "kwHq"],
  },
  taggerEra: {
    id: "taggerEra",
    label: "ERA 15%",
    description: "ERA share from tagger fee",
    defaultPercent: 0.15,
    accent: "dark",
  },
  taggerIncentiveSpecialist: {
    id: "taggerIncentiveSpecialist",
    label: "Project Specialist 85%",
    description: "Specialist share from incentive",
    defaultPercent: 0.85,
    accent: "primary",
  },
  taggerIncentiveEra: {
    id: "taggerIncentiveEra",
    label: "ERA 15%",
    description: "ERA share from incentive",
    defaultPercent: 0.15,
    accent: "dark",
  },
  // ERA Agency Flow
  eraAgency: {
    id: "eraAgency",
    label: "ERA Agency 0.5%",
    description: "ERA override commission",
    defaultPercent: 0.005,
    accent: "dark",
  },
  // Referral Fee Flow (New)
  referralFee: {
    id: "referralFee",
    label: "Referral Fee",
    description: "Referral commission (if applicable)",
    defaultPercent: 0,
    childIds: ["referralAgent", "referralEra"],
    accent: "neutral",
  },
  referralAgent: {
    id: "referralAgent",
    label: "Referral Agent",
    description: "Primary referral agent share",
    defaultPercent: 0.7,
    accent: "primary",
  },
  referralEra: {
    id: "referralEra",
    label: "ERA Referral Share",
    description: "ERA share of referral fee",
    defaultPercent: 0.3,
    accent: "dark",
  },
  // Override Commission Flow (New)
  overrideCommission: {
    id: "overrideCommission",
    label: "Override Commission",
    description: "Additional override commission (if applicable)",
    defaultPercent: 0,
    childIds: ["overrideManager", "overrideTeam"],
    accent: "neutral",
  },
  overrideManager: {
    id: "overrideManager",
    label: "Manager Override",
    description: "Manager override share",
    defaultPercent: 0.6,
    accent: "primary",
  },
  overrideTeam: {
    id: "overrideTeam",
    label: "Team Override",
    description: "Team override share",
    defaultPercent: 0.4,
    accent: "primary",
  },
  // KW Internal Distribution
  projectSpecialist: {
    id: "projectSpecialist",
    label: "Project Specialist 65%",
    description: "Project specialist share from KW portion",
    defaultPercent: 0.65,
    accent: "primary",
  },
  newLaunchTeam: {
    id: "newLaunchTeam",
    label: "New Launch IC Team 20%",
    description: "New Launch team share from KW portion",
    defaultPercent: 0.2,
    childIds: ["projectDirector", "projectLeads"],
    accent: "primary",
  },
  kwHq: {
    id: "kwHq",
    label: "KW HQ 15%",
    description: "KW headquarters share",
    defaultPercent: 0.15,
    accent: "primary",
  },
  projectDirector: {
    id: "projectDirector",
    label: "Project Director 50%",
    description: "Project director share from New Launch team",
    defaultPercent: 0.5,
    accent: "primary",
  },
  projectLeads: {
    id: "projectLeads",
    label: "Project Leads (IC) 50%",
    description: "Divide equally by IC leads",
    defaultPercent: 0.5,
    accent: "primary",
    childIds: ["shirlyn", "elizabeth", "surya", "benjamin"],
  },
  shirlyn: {
    id: "shirlyn",
    label: "Shirlyn Chin",
    description: "Individual IC lead share",
    defaultPercent: 0.25,
    accent: "primary",
  },
  elizabeth: {
    id: "elizabeth",
    label: "Elizabeth Mok",
    description: "Individual IC lead share",
    defaultPercent: 0.25,
    accent: "primary",
  },
  surya: {
    id: "surya",
    label: "Surya Wijaya",
    description: "Individual IC lead share",
    defaultPercent: 0.25,
    accent: "primary",
  },
  benjamin: {
    id: "benjamin",
    label: "Benjamin Heng",
    description: "Individual IC lead share",
    defaultPercent: 0.25,
    accent: "primary",
  },
};

const buildParentMap = () => {
  const map: Record<string, string | null> = {
    [rootNodeId]: null,
  };
  Object.values(payoutNodes).forEach((node) => {
    node.childIds?.forEach((childId) => {
      map[childId] = node.id;
    });
  });
  return map;
};

export const parentMap = buildParentMap();

