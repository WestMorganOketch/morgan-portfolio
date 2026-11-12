import { PORTFOLIO_SERVICES } from "@/content/terminal";

export type PortfolioProject = {
  id?: string;
  title: string;
  period: string;
  description: string;
  tags: readonly string[];
  writeup?: string;
  challenges?: string;
  solutions?: string;
  architecture?: string;
  futureImprovements?: string;
  url?: string | null;
  demoUrl?: string | null;
  published?: boolean;
};

export function isPortfolioProjectList(value: unknown): value is PortfolioProject[] {
  return Array.isArray(value) && value.every((project: unknown) => {
    if (typeof project !== "object" || project === null) return false;
    const record = project as Record<string, unknown>;
    return typeof record.title === "string"
      && typeof record.period === "string"
      && typeof record.description === "string"
      && Array.isArray(record.tags)
      && record.tags.every((tag: unknown) => typeof tag === "string")
      && (record.writeup === undefined || typeof record.writeup === "string")
      && (record.url === undefined || record.url === null || typeof record.url === "string")
      && (record.published === undefined || typeof record.published === "boolean");
  });
}

export const profile = {
  name: "Morgan West Oketch",
  title: "Technology Specialist | Web Application Development | Systems Security | Prompt Engineering",
  location: "Nairobi, Kenya",
  email: "westmorgan777@gmail.com",
  github: "https://github.com/WestMorganOketch",
  linkedin: "https://www.linkedin.com/in/morgan-west-415445319/",
  summary:
    "Technology specialist focused on web application development, systems security, prompt engineering, and AI-assisted development. Holds a Bachelor of Science in Mathematics and Computer Science from Tom Mboya University, combining analytical problem-solving with practical experience building web applications, supporting IT infrastructure, and strengthening system and application security. Experienced in secure API integration, network controls, data systems, and supporting more than 50 users. Uses AI tools to accelerate prototyping while reviewing, testing, and refining generated code for quality, reliability, and security.",
  skills: [
    "Web application development (React, Next.js, Node.js, TypeScript)",
    "Systems security and secure API integration",
    "Prompt engineering and LLM integration",
    "AI-assisted development (vibe coding)",
    "Threat analysis",
    "SIEM fundamentals",
    "Network security",
    "VPN and firewall configuration",
    "Wireshark",
    "Windows Server and Linux",
    "Python and SQL",
    "Power BI and Excel",
    "React and Node.js",
    "AWS",
  ],
  experience: [
    {
      role: "ICT Tutor (Volunteer)",
      organization: "Profia Institute of Professionals College",
      period: "Apr 2024 — Present",
      description:
        "Maintain the IT lab environment and support more than 50 users. Deliver hands-on training in networking, firewall configuration, secure API integration, and web application security, alongside tier 1 and tier 2 technical support.",
      highlights: ["IT lab support", "Cybersecurity training", "Tier 1 & 2 support"],
    },
    {
      role: "Mathematics & Physics Teacher (Volunteer)",
      organization: "Nyakango Secondary School",
      period: "May 2021 — Jul 2021",
      description:
        "Taught Mathematics and Physics, prepared structured lessons, and provided targeted academic support to students.",
      highlights: ["Lesson planning", "Student support", "Mathematics & Physics"],
    },
  ],
  projects: [
    {
      title: "Secure VPN Deployment",
      period: "Dec 2024",
      description:
        "Designed and deployed a VPN solution for secure remote access at a local organization, helping reduce exposure to unauthorized access.",
      tags: ["VPN", "Network security", "Remote access"],
    },
    {
      title: "Secure Web Application Development",
      period: "Apr 2025",
      description:
        "Developed web applications with authentication flows, JWT handling, and REST API security hardening using React and Node.js.",
      tags: ["React", "Node.js", "JWT", "REST APIs"],
    },
  ] satisfies PortfolioProject[],
  education: {
    qualification: "Bachelor of Science in Mathematics & Computer Science",
    institution: "Tom Mboya University",
    location: "Homa Bay, Kenya",
    status: "Graduate",
  },
  certifications: [
    {
      name: "Security Analyst",
      issuer: "Cyber Shujaa / USIU-Africa",
      date: "Jan 2026",
      status: "COMPLETED",
    },
    {
      name: "Machine Learning",
      issuer: "KeDataLab",
      date: "May 2026",
      status: "COMPLETED",
    },
    {
      name: "Business Intelligence — SQL & Power BI",
      issuer: "KeDataLab · Cohort 1",
      date: "Apr 2026",
      status: "COMPLETED",
    },
    {
      name: "Artificial Intelligence",
      issuer: "ALX Africa",
      date: "Dec 2025",
      status: "COMPLETED",
    },
    {
      name: "Virtual Assistance & Freelance Operations",
      issuer: "ALX Africa",
      date: "Dec 2025",
      status: "COMPLETED",
    },
    {
      name: "Networking Fundamentals",
      issuer: "Cisco Networking Academy",
      date: "In progress",
      status: "IN PROGRESS",
    },
  ],
  services: PORTFOLIO_SERVICES,
} as const;
