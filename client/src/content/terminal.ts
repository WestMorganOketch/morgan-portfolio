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

const SITE_SERVICES = [
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
    summary: "Security testing for web applications with explicit authorization and an agreed scope.",
  },
] as const satisfies readonly TerminalService[];

/**
 * Terminal-only showcase catalogue. The Services page intentionally keeps
 * using SITE_SERVICES so the live terminal update changes the hero card only.
 * Commands and outputs are illustrative; the UI never executes them.
 */
export const TERMINAL_SERVICES = [
  {
    id: "authorized-network-reconnaissance",
    area: "pentesting",
    command: "nmap -sV --script safe lab.example.test",
    output: [
      "Inventory approved hosts and services",
      "Review exposure inside written scope",
      "Capture evidence for risk triage",
    ],
    title: "Authorized network reconnaissance",
    summary: "Map exposed services on explicitly authorized assets and document risk clearly.",
    proof: [
      {
        label: "security learning repo",
        href: "https://github.com/WestMorganOketch/cybersecurity-learning-portfolio",
      },
    ],
  },
  {
    id: "web-application-security",
    area: "pentesting",
    command: "zap-baseline.py -t https://app.example.test",
    output: [
      "Run passive baseline checks against an approved URL",
      "Review response headers and common misconfigurations",
      "Document evidence and remediation steps",
    ],
    title: "Web application security testing",
    summary: "Review web-application exposure and common security misconfigurations within an agreed scope.",
    proof: [
      {
        label: "application repo",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  {
    id: "api-security-review",
    area: "pentesting",
    command: "curl -sS -D - -o /dev/null https://api.example.test/v1/profile",
    output: [
      "Inspect response headers and redirect behaviour",
      "Review authentication and access-control boundaries",
      "Record reproducible findings and remediation",
    ],
    title: "API authentication & access-control review",
    summary: "Review API exposure, authentication flows, and authorization assumptions through agreed test cases.",
    proof: [
      {
        label: "API / app repo",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  {
    id: "firewall-network-controls",
    area: "pentesting",
    command: "sudo ufw status verbose",
    output: [
      "Inspect inbound rules and default policy",
      "Compare exposed services to intended access",
      "Document least-privilege corrections",
    ],
    title: "Firewall & network controls review",
    summary: "Review firewall rules, remote-access controls, and exposed services against intended network access.",
    proof: [
      {
        label: "security learning repo",
        href: "https://github.com/WestMorganOketch/cybersecurity-learning-portfolio",
      },
    ],
  },
  {
    id: "dependency-vulnerability-review",
    area: "pentesting",
    command: "npm audit --omit=dev",
    output: [
      "Review dependency advisories",
      "Prioritize reachable and exploitable risks",
      "Document practical remediation options",
    ],
    title: "Dependency vulnerability triage",
    summary: "Prioritize dependency risks and prepare clear remediation guidance for application owners.",
    proof: [
      {
        label: "project repo",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  {
    id: "web-development",
    area: "web",
    command: "npm run dev",
    output: [
      "Next.js / React application starts locally",
      "Responsive interface and routed content",
      "Fast feedback for iterative development",
    ],
    title: "Full-stack web development",
    summary: "Build responsive web applications with Next.js, React, TypeScript, and backend APIs.",
    proof: [
      {
        label: "morgan-portfolio",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  {
    id: "responsive-frontend-development",
    area: "web",
    command: "npm run build",
    output: [
      "Compile application routes and interface",
      "Review responsive layouts and interaction states",
      "Prepare production frontend assets",
    ],
    title: "Responsive frontend & portfolio design",
    summary: "Create polished, accessible interfaces with clear visual hierarchy, responsive layouts, and thoughtful motion.",
    proof: [
      {
        label: "frontend repo",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  {
    id: "secure-api-integration",
    area: "web",
    command: 'git grep -n "Authorization" client/src api',
    output: [
      "Trace authenticated request flows",
      "Review JWT and role-aware API integration",
      "Keep access checks enforced server-side",
    ],
    title: "Secure API & authentication integration",
    summary: "Integrate REST APIs and authentication flows with careful validation and access-control handling.",
    proof: [
      {
        label: "API / app repo",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
  },
  {
    id: "database-backed-admin-systems",
    area: "web",
    command: "npm run lint && npm run build",
    output: [
      "Check project consistency and production compilation",
      "Connect UI workflows to APIs and persistent data",
      "Keep admin interfaces structured and maintainable",
    ],
    title: "Database-backed admin systems",
    summary: "Build practical admin interfaces and data workflows around APIs, storage, and deployment services.",
    proof: [
      {
        label: "admin app repo",
        href: "https://github.com/WestMorganOketch/morgan-portfolio",
      },
    ],
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
export const PORTFOLIO_SERVICES = SITE_SERVICES.map((service, index) => ({
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
