import { profile } from "@/data/profile";

export const publicPages = [
  { href: "/", label: "Home", description: "Morgan's introduction and featured work." },
  { href: "/about", label: "About", description: "Professional background and focus." },
  { href: "/skills", label: "Skills", description: "Technical skills and current learning." },
  { href: "/experience", label: "Experience", description: "Teaching, support, and IT experience." },
  { href: "/projects", label: "Projects", description: "Selected work and public GitHub projects." },
  { href: "/education", label: "Education", description: "Academic background and learning." },
  { href: "/certifications", label: "Certifications", description: "Completed programs and training." },
  { href: "/timeline", label: "Timeline", description: "Education, work, and project milestones." },
  { href: "/achievements", label: "Achievements", description: "Verified milestones and contributions." },
  { href: "/documents", label: "Documents", description: "Published résumé and verified professional documents." },
  { href: "/triage", label: "SOC Challenge", description: "Practice defensive alert triage in a server-scored challenge." },
  { href: "/leaderboard", label: "Leaderboard", description: "Top anonymous alert triage scores." },
  { href: "/blog", label: "Blog", description: "Articles and learning notes." },
  { href: "/gallery", label: "Gallery", description: "A visual space for portfolio photos." },
  { href: "/services", label: "Services", description: "Learning, web, and authorized security support." },
  { href: "/writeups", label: "Write-ups", description: "Security and technical case studies." },
  { href: "/inventions", label: "Experiments", description: "Ideas, prototypes, and technical experiments." },
  { href: "/cheatsheets", label: "Cheatsheets", description: "Quick technical references." },
  { href: "/ctfs", label: "CTFs", description: "Capture-the-flag learning notes." },
  { href: "/assignments", label: "Assignments", description: "Selected academic and practical work." },
  { href: "/contact", label: "Contact", description: "Professional contact details and message form." },
] as const;

export type PageSlug = Exclude<(typeof publicPages)[number]["href"], "/" | "/contact"> extends `/${infer Slug}` ? Slug : never;

export const skillGroups = [
  {
    name: "Security operations",
    icon: "shield",
    skills: [
      ["Threat analysis", "Review security signals and practice a structured investigation workflow.", "Practicing"],
      ["SIEM fundamentals", "Foundational exposure to alert triage, event context, and SIEM workflows.", "Foundational"],
      ["Incident response", "Learning the identify, contain, investigate, and recover lifecycle.", "Practicing"],
      ["Vulnerability assessment", "Understand and document findings within authorized environments.", "Foundational"],
      ["Security hardening", "Apply defensive configuration and least-privilege principles.", "Practicing"],
      ["Digital forensics", "Build familiarity with evidence handling and forensic fundamentals.", "Learning"],
    ],
  },
  {
    name: "Networking",
    icon: "network",
    skills: [
      ["TCP/IP, DNS & DHCP", "Core network concepts for troubleshooting and security analysis.", "Practicing"],
      ["VPNs & firewalls", "Hands-on experience with secure remote access and firewall setup.", "Practicing"],
      ["Wireshark", "Inspect packet captures to build network troubleshooting skills.", "Practicing"],
      ["Cisco networking", "Networking Academy fundamentals; currently learning.", "Learning"],
      ["Routing & switching", "Build and troubleshoot foundational network configurations.", "Learning"],
    ],
  },
  {
    name: "Software & web",
    icon: "code",
    skills: [
      ["JavaScript & TypeScript", "Use in interactive web interfaces and application projects.", "Practicing"],
      ["Python & C", "Programming foundations for scripting, problem-solving, and study.", "Practicing"],
      ["React & Next.js", "Build responsive, component-based user experiences.", "Practicing"],
      ["Node.js & REST APIs", "Develop server-side routes and API integrations.", "Practicing"],
      ["SQL", "Query and structure relational data for applications and analytics.", "Practicing"],
      ["HTML & CSS", "Create accessible, responsive interfaces.", "Practicing"],
      ["JWT & authentication", "Understand authentication flows and secure API patterns.", "Practicing"],
    ],
  },
  {
    name: "Systems, cloud & data",
    icon: "server",
    skills: [
      ["Linux & Windows", "Work across common operating systems and command-line tools.", "Practicing"],
      ["Windows Server", "Support systems administration and lab environments.", "Practicing"],
      ["AWS & cloud fundamentals", "Learning cloud concepts and service fundamentals.", "Learning"],
      ["Power BI & Excel", "Use business intelligence and spreadsheets to explore data.", "Practicing"],
      ["Data analytics", "Apply analytical thinking and data preparation to practical problems.", "Practicing"],
    ],
  },
  {
    name: "Professional",
    icon: "users",
    skills: [
      ["Communication", "Explain technical concepts to learners and non-technical users.", "Experienced"],
      ["Teaching & mentoring", "Support learners through structured, practical instruction.", "Experienced"],
      ["Critical thinking", "Use a methodical approach to troubleshoot and investigate.", "Practicing"],
      ["Leadership & teamwork", "Coordinate day-to-day support and collaborative learning.", "Practicing"],
    ],
  },
] as const;

export const timeline = [
  {
    date: "May – Jul 2021",
    title: "Mathematics & Physics Teacher",
    organization: "Nyakango Secondary School",
    detail: "Taught Mathematics and Physics, planned lessons, and mentored learners.",
    type: "experience",
  },
  {
    date: "Apr 2024 – Present",
    title: "ICT Tutor (Volunteer)",
    organization: "Profia Institute of Professionals College",
    detail: "Support an IT lab serving 50+ users and deliver practical IT and security training.",
    type: "experience",
  },
  {
    date: "Dec 2024",
    title: "Secure VPN Deployment",
    organization: "Project",
    detail: "Designed and deployed a VPN solution for secure remote access.",
    type: "project",
  },
  {
    date: "Apr 2025",
    title: "Secure Web Application Development",
    organization: "Project",
    detail: "Built web applications using React, Node.js, JWT, and REST API security practices.",
    type: "project",
  },
  {
    date: "Nov 2026 (expected)",
    title: "BSc Mathematics & Computer Science",
    organization: "Tom Mboya University",
    detail: "Currently completing an undergraduate degree.",
    type: "education",
  },
] as const;

export const details: Record<string, { title: string; eyebrow: string; intro: string }> = {
  about: {
    title: "Curious by nature. Security-minded by design.",
    eyebrow: "ABOUT MORGAN",
    intro: profile.summary,
  },
  skills: {
    title: "Building skills that make systems more resilient.",
    eyebrow: "SKILLS & LEARNING",
    intro: "A qualitative overview of current strengths and learning areas. These labels are intentionally not percentage ratings or claims of years of experience.",
  },
  experience: {
    title: "Practical experience, built around people and systems.",
    eyebrow: "EXPERIENCE",
    intro: "IT support and teaching experience shaped by real users, practical labs, and the need to explain technology clearly.",
  },
  projects: {
    title: "Learning through hands-on projects.",
    eyebrow: "SELECTED WORK",
    intro: "A growing collection of security, networking, and web development work. Public repositories are loaded from GitHub when available.",
  },
  education: {
    title: "A strong foundation in mathematics and computing.",
    eyebrow: "EDUCATION",
    intro: "Academic study and continued self-directed learning inform how Morgan approaches technical problems.",
  },
  certifications: {
    title: "Learning, recognized and ongoing.",
    eyebrow: "CERTIFICATIONS & TRAINING",
    intro: "Completed programs and in-progress training are listed separately. Verification links will appear when Morgan supplies them.",
  },
  timeline: {
    title: "A journey of learning, teaching, and building.",
    eyebrow: "TIMELINE",
    intro: "Selected milestones based on Morgan's confirmed education, experience, and projects.",
  },
  achievements: {
    title: "Progress worth making visible.",
    eyebrow: "MILESTONES",
    intro: "Verified contributions and milestones from Morgan's supplied professional history. Awards and rankings are not claimed where none have been provided.",
  },
  documents: {
    title: "Professional documents, published with care.",
    eyebrow: "DOCUMENT VAULT",
    intro: "Browse the résumé and certificates Morgan has chosen to publish. Drafts and unapproved files stay private.",
  },
  triage: {
    title: "Can you separate signal from noise?",
    eyebrow: "SOC ALERT TRIAGE",
    intro: "Work through a balanced set of defensive security alerts. The server keeps the answer key private until you submit the round.",
  },
  leaderboard: {
    title: "Measured by practice, not personal data.",
    eyebrow: "ALERT TRIAGE LEADERBOARD",
    intro: "See the top 20 scores by nickname. No email addresses or visitor IP addresses are stored with scores.",
  },
  blog: {
    title: "Notes from the learning process.",
    eyebrow: "BLOG",
    intro: "A home for future security write-ups, study notes, and practical lessons. Articles will be added as they are ready to share.",
  },
  gallery: {
    title: "A visual space, ready for Morgan's story.",
    eyebrow: "GALLERY",
    intro: "Personal photos and certificate artwork have not been supplied yet. This space is intentionally not populated with stock images or invented credentials.",
  },
  services: {
    title: "Practical support, with responsible boundaries.",
    eyebrow: "SERVICES",
    intro: "Learning support, web development, and authorized security work offered with clear expectations and scope.",
  },
  writeups: {
    title: "Documenting the thinking behind the work.",
    eyebrow: "WRITE-UPS",
    intro: "Technical case studies and defensive security notes will be published here as they are reviewed and ready.",
  },
  inventions: {
    title: "Ideas become useful when you build them.",
    eyebrow: "EXPERIMENTS",
    intro: "Prototypes and technical experiments will be collected here as Morgan develops and documents them.",
  },
  cheatsheets: {
    title: "Useful references, made for the next time.",
    eyebrow: "CHEATSHEETS",
    intro: "Concise technical references will be added here after they have been tested and reviewed.",
  },
  ctfs: {
    title: "Practice deliberately. Document responsibly.",
    eyebrow: "CTF LEARNING",
    intro: "Capture-the-flag notes and challenge reflections will be shared here only where publication is permitted.",
  },
  assignments: {
    title: "Coursework and practical learning.",
    eyebrow: "ASSIGNMENTS",
    intro: "Selected academic and hands-on assignments will be added as Morgan confirms which work is appropriate to publish.",
  },
  contact: {
    title: "Let's start a thoughtful conversation.",
    eyebrow: "CONTACT",
    intro: "Open to cybersecurity, IT support, data, and software opportunities, as well as collaboration and mentoring.",
  },
  privacy: {
    title: "A clear, minimal privacy approach.",
    eyebrow: "PRIVACY",
    intro: "The portfolio is designed to share professional information while collecting as little visitor data as practical.",
  },
};
