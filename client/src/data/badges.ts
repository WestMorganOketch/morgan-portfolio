import type { LucideIcon } from "lucide-react";
import {
  BookOpen, Code2, Crosshair, Database, ListChecks, Network, Server, Shield,
} from "lucide-react";

type BadgeBase = {
  id: string;
  title: string;
  meaning: string;
  icon: LucideIcon;
};

type DraftBadgeKind = "specialization" | "framework";

type StudyingBadge = BadgeBase & {
  kind: DraftBadgeKind;
  status: "studying";
  evidenceHref?: never;
  evidenceLabel?: never;
};

type AppliedBadge = BadgeBase & {
  kind: "specialization";
  status: "applied";
  evidenceHref: string;
  evidenceLabel: string;
};

export type CredentialBadge = BadgeBase & {
  id: string;
  kind: "credential";
  status: "earned";
  issuedDate: string | null;
  verifyUrl: string | null;
  evidenceHref: string;
  evidenceLabel: string;
};

export type PortfolioBadge = StudyingBadge | AppliedBadge | CredentialBadge;
export type PortfolioBadgeDraft = StudyingBadge | AppliedBadge;

export const portfolioBadgeDrafts = [
  // OWNER TO CONFIRM
  {
    id: "security-monitoring-alert-triage",
    kind: "specialization",
    title: "Security Monitoring and Alert Triage",
    meaning: "Review security signals and practice a structured alert investigation workflow.",
    status: "studying",
    icon: Shield,
  },
  // OWNER TO CONFIRM
  {
    id: "network-vpn-security",
    kind: "specialization",
    title: "Network and VPN Security",
    meaning: "Configure and troubleshoot secure network access.",
    status: "applied",
    evidenceHref: "/projects",
    evidenceLabel: "Secure VPN Deployment project",
    icon: Network,
  },
  // OWNER TO CONFIRM
  {
    id: "secure-web-development",
    kind: "specialization",
    title: "Secure Web Development",
    meaning: "Build web applications with secure API and authentication practices.",
    status: "applied",
    evidenceHref: "/projects",
    evidenceLabel: "Secure Web Application Development project",
    icon: Code2,
  },
  // OWNER TO CONFIRM
  {
    id: "it-support-infrastructure",
    kind: "specialization",
    title: "IT Support and Infrastructure",
    meaning: "Support users and maintain practical IT lab environments.",
    status: "studying",
    icon: Server,
  },
  // OWNER TO CONFIRM
  {
    id: "data-analytics-reporting",
    kind: "specialization",
    title: "Data Analytics and Reporting",
    meaning: "Use analytical thinking and business-intelligence tools to explore data.",
    status: "studying",
    icon: Database,
  },
  // OWNER TO CONFIRM
  {
    id: "security-documentation-awareness",
    kind: "specialization",
    title: "Security Documentation and Awareness",
    meaning: "Document findings and explain practical security concepts.",
    status: "studying",
    icon: BookOpen,
  },
  // OWNER TO CONFIRM
  {
    id: "mitre-attck",
    kind: "framework",
    title: "MITRE ATT&CK",
    meaning: "Study adversary tactics and techniques as a structure for security analysis.",
    status: "studying",
    icon: Crosshair,
  },
  // OWNER TO CONFIRM
  {
    id: "nist-cybersecurity-framework",
    kind: "framework",
    title: "NIST Cybersecurity Framework",
    meaning: "Study a framework for organizing cybersecurity risk management outcomes.",
    status: "studying",
    icon: Shield,
  },
  // OWNER TO CONFIRM
  {
    id: "owasp-top-10",
    kind: "framework",
    title: "OWASP Top 10",
    meaning: "Study common web application security risks and mitigations.",
    status: "studying",
    icon: Code2,
  },
  // OWNER TO CONFIRM
  {
    id: "cis-critical-security-controls",
    kind: "framework",
    title: "CIS Critical Security Controls",
    meaning: "Study prioritized safeguards for improving cybersecurity posture.",
    status: "studying",
    icon: ListChecks,
  },
  // OWNER TO CONFIRM
  {
    id: "cyber-kill-chain",
    kind: "framework",
    title: "Cyber Kill Chain",
    meaning: "Study a model for understanding stages of cyber intrusion activity.",
    status: "studying",
    icon: Network,
  },
  // OWNER TO CONFIRM
  {
    id: "iso-iec-27001-awareness",
    kind: "framework",
    title: "ISO/IEC 27001 (awareness)",
    meaning: "Study information security management system concepts and terminology.",
    status: "studying",
    icon: BookOpen,
  },
] satisfies readonly PortfolioBadgeDraft[];
