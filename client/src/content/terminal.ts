import { profile } from "@/data/profile";

export type TerminalArea = "pentesting" | "web";

export type TerminalProof = {
  label: string;
  href: string;
};

export type TerminalService = {
  id: string;
  area: TerminalArea;
  command: string;
  output: readonly string[];
  title: string;
  summary: string;
  proof?: readonly TerminalProof[];
};

const existingWebSecurity = profile.services[2];
const existingWebDevelopment = profile.services[1];

export const TERMINAL_SERVICES = [
  // OWNER TO CONFIRM
  {
    id: "web-application-security",
    area: "pentesting",
    command: "test-web lab.example.test",
    output: [
      "Scope: authorised lab only",
      "OWASP / auth / session review",
      "Findings queued for report",
    ],
    title: existingWebSecurity.title,
    summary: existingWebSecurity.description,
  },
  // OWNER TO CONFIRM
  {
    id: "reconnaissance-enumeration",
    area: "pentesting",
    command: "recon lab.example.test",
    output: [
      "Passive context and surface mapping",
      "Enumeration notes stay within scope",
      "No production targets touched",
    ],
    title: "Reconnaissance and enumeration",
    summary: "Lab-only discovery and enumeration with a documented scope.",
  },
  // OWNER TO CONFIRM
  {
    id: "vulnerability-assessment",
    area: "pentesting",
    command: "assess lab.example.test",
    output: [
      "Validate severity and affected surface",
      "Evidence collected from the lab",
      "Findings structured for a report",
    ],
    title: "Vulnerability assessment and reporting",
    summary: "Assess authorized lab findings and turn observations into clear reports.",
  },
  // OWNER TO CONFIRM
  {
    id: "api-security-review",
    area: "pentesting",
    command: "review-api example.com",
    output: [
      "Auth and input handling reviewed",
      "API paths checked for exposure",
      "Recommendations kept evidence-led",
    ],
    title: "API security review",
    summary: "Review API security patterns within an explicitly authorized scope.",
  },
  // OWNER TO CONFIRM
  {
    id: "network-vpn-hardening",
    area: "pentesting",
    command: "harden-vpn 192.0.2.10",
    output: [
      "Remote access rules reviewed",
      "Firewall and least privilege checked",
      "Hardening notes prepared",
    ],
    title: "Network and VPN hardening",
    summary: "Review secure remote access, firewall setup and defensive network controls.",
  },
  // OWNER TO CONFIRM
  {
    id: "web-development",
    area: "web",
    command: "build-app example.com",
    output: [
      "React / Next.js application flow",
      "Node.js API integration",
      "Responsive UI structure ready",
    ],
    title: existingWebDevelopment.title,
    summary: existingWebDevelopment.description,
    proof: [
      {
        label: "morgan-portfolio",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  // OWNER TO CONFIRM
  {
    id: "secure-authentication-apis",
    area: "web",
    command: "secure-api example.com",
    output: [
      "JWT and REST patterns reviewed",
      "Trust boundaries documented",
      "Validation stays close to the API",
    ],
    title: "Secure authentication and APIs",
    summary: "Build authentication flows and APIs with security review built into delivery.",
  },
  // OWNER TO CONFIRM
  {
    id: "database-design",
    area: "web",
    command: "design-db example.com",
    output: [
      "Relational schema and queries",
      "Data access patterns documented",
      "Application boundaries kept clear",
    ],
    title: "Database design",
    summary: "Structure application data for relational web workloads and reporting.",
  },
  // OWNER TO CONFIRM
  {
    id: "deployment-ci",
    area: "web",
    command: "deploy-ci example.com",
    output: [
      "Build checks and deployment flow",
      "Release path kept repeatable",
      "Production changes reviewed first",
    ],
    title: "Deployment and CI",
    summary: "Keep application builds and deployments repeatable, testable and reviewable.",
  },
  // OWNER TO CONFIRM
  {
    id: "ai-assisted-development",
    area: "web",
    command: "ai-review example.com",
    output: [
      "Generated code reviewed and tested",
      "Quality and security checks stay human-led",
      "Prototype work remains evidence-led",
    ],
    title: "AI-assisted development",
    summary: "Use AI-assisted prototyping with review, testing and security checks.",
  },
] as const satisfies readonly TerminalService[];

export const TERMINAL_IDENTITY_LINES = [
  "Morgan West Oketch",
  profile.title,
  profile.location,
  "ALERT REVIEW · In progress",
  "APPROACH · Evidence-led",
  "FOCUS · Defensive security",
] as const;

export const TERMINAL_SKILL_LIMIT = 9;

export const TERMINAL_AREAS = {
  pentesting: TERMINAL_SERVICES.filter((service) => service.area === "pentesting"),
  web: TERMINAL_SERVICES.filter((service) => service.area === "web"),
} as const;
