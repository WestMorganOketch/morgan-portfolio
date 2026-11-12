export type TerminalArea = "pentesting" | "web";

export type TerminalProof = {
  label: string;
  href: `https://${string}`;
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

export const TERMINAL_SERVICES = [
  // OWNER TO CONFIRM
  {
    id: "cybersecurity-tutoring",
    area: "pentesting",
    command: "practice-lab lab.example.test",
    output: [
      "Lab scope: agreed and documented",
      "Practice defensive review workflows",
      "Notes focus on safe learning",
    ],
    title: "Cybersecurity tutoring",
    summary: "Practical, beginner-friendly guidance in cybersecurity, networking, and safe lab learning.",
  },
  // OWNER TO CONFIRM
  {
    id: "web-development",
    area: "web",
    command: "build-app example.com",
    output: [
      "React / Next.js application flow",
      "Node.js API integration",
      "Responsive UI, reviewed and tested",
    ],
    title: "Web development",
    summary: "Web application development with React, Node.js, and REST APIs.",
    proof: [
      {
        label: "morgan-portfolio",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  // OWNER TO CONFIRM
  {
    id: "web-application-security",
    area: "pentesting",
    command: "test-web lab.example.test",
    output: [
      "OWASP / authentication review",
      "Session and input handling",
      "Findings documented within scope",
    ],
    title: "Web application security testing",
    summary: "Security testing for web applications only with explicit authorization and an agreed scope.",
  },
] as const satisfies readonly TerminalService[];

export const TERMINAL_AREAS = {
  pentesting: TERMINAL_SERVICES.filter((service) => service.area === "pentesting"),
  web: TERMINAL_SERVICES.filter((service) => service.area === "web"),
} as const;

/**
 * The Services page derives its current cards from this same catalogue.
 * Keep the displayed wording in one place; terminal commands and outputs
 * remain illustrative-only and are never executed.
 */
export const PORTFOLIO_SERVICES = TERMINAL_SERVICES.map((service, index) => ({
  number: String(index + 1).padStart(2, "0"),
  title: service.title,
  description: service.summary,
  note: service.id === "cybersecurity-tutoring"
    ? "Learning support"
    : service.area === "web"
      ? "Web applications"
      : "Authorized scope only",
}));

// # authorised targets only
