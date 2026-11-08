import { profile } from "./profile";

export type ResumeSkill = {
  heading: string;
  label: string;
  items: string;
};

export type ResumeExperience = {
  role: string;
  organisation: string;
  location: string;
  period: string;
  bullets: string[];
};

export type ResumeProject = {
  title: string;
  subtitle: string;
  href?: string;
  body: string;
};

export const resume = {
  name: profile.name,
  headline: "Technology Specialist | Web Application Developer | Systems Security | Prompt Engineering",
  location: profile.location,
  email: profile.email,
  links: [
    { label: "LinkedIn", href: profile.linkedin },
    { label: "GitHub", href: profile.github },
  ],
  showPhone: false,
  summary: "Technology specialist and Bachelor of Science graduate in Mathematics and Computer Science, focused on web application development, systems security, prompt engineering, and AI-assisted development. Hands-on experience building web applications and secure APIs, maintaining IT infrastructure, managing data systems, and supporting more than 50 users. Certified Security Analyst (Cyber Shujaa / USIU-Africa), with practical skills across threat analysis, network security, system administration, Python, SQL, Power BI, and cloud-supported web delivery. Uses prompt engineering and AI-assisted (vibe-coding) workflows to accelerate prototyping and implementation, with emphasis on code review, testing, maintainability, and security.",
  skills: [
    { heading: "Core Skills & Expertise", label: "Cybersecurity Analysis", items: "Threat detection, incident response, SIEM fundamentals, vulnerability assessment" },
    { heading: "Core Skills & Expertise", label: "Network Security", items: "VPN configuration, firewall setup, Wireshark traffic analysis, access control" },
    { heading: "Core Skills & Expertise", label: "System Administration", items: "Windows Server, Linux administration, IT lab management (50+ users)" },
    { heading: "Core Skills & Expertise", label: "Data Analysis & Statistical Modelling", items: "Advanced Excel, Python (Pandas, NumPy, Scikit-learn), regression analysis, hypothesis testing, predictive modelling" },
    { heading: "Core Skills & Expertise", label: "Business Intelligence & Visualization", items: "Power BI dashboard design, SQL reporting, KPI tracking, automated executive reporting" },
    { heading: "Core Skills & Expertise", label: "Data Engineering & Management", items: "ETL pipelines, data cleaning and validation, database design, outlier detection" },
    { heading: "Core Skills & Expertise", label: "Web Development & Cloud", items: "ReactJS, REST APIs, JWT authentication, AWS, Vercel" },
    { heading: "Core Competencies", label: "Critical Thinking", items: "Evaluates systems deeply to identify risks, inefficiencies, and improvement opportunities" },
    { heading: "Core Competencies", label: "Resilience & Persistence", items: "Maintains focus under pressure and works through complex technical challenges" },
    { heading: "Core Competencies", label: "Continuous Learning Mindset", items: "Actively builds new skills in cybersecurity, networking, and cloud technologies" },
    { heading: "Core Competencies", label: "Execution Focus", items: "Prioritises practical implementation and measurable outcomes over theory" },
    { heading: "Core Competencies", label: "Ownership & Accountability", items: "Takes responsibility for tasks and delivers reliable, high-quality results" },
    { heading: "Core Competencies", label: "Stakeholder Communication", items: "Technical writing, data storytelling, training delivery, cross-functional collaboration" },
    { heading: "Technical Skills", label: "Languages & Libraries", items: "Python (Pandas, NumPy, Matplotlib, Scikit-learn), SQL, T-SQL, JavaScript" },
    { heading: "Technical Skills", label: "BI & Visualization", items: "Microsoft Power BI, Advanced Excel (PivotTables, Power Query), Matplotlib" },
    { heading: "Technical Skills", label: "Databases", items: "MySQL, PostgreSQL, relational database design, query optimisation" },
    { heading: "Technical Skills", label: "Tools & Platforms", items: "Git/GitHub, Jupyter Notebook, VS Code, Windows Server, Linux, AWS, Vercel" },
    { heading: "Technical Skills", label: "Security", items: "Threat analysis, SIEM fundamentals, secure authentication, VPN deployment, access control, Wireshark" },
    { heading: "Technical Skills", label: "Web Development", items: "ReactJS, REST APIs, JWT token management, HTML/CSS, Node.js" },
  ] satisfies ResumeSkill[],
  experience: [
    {
      role: "ICT Tutor & Data Systems Manager (Volunteer)",
      organisation: "Profia Institute of Professionals College",
      location: "Nairobi, Kenya",
      period: "Apr 2024 – Present",
      bullets: [
        "Manage and maintain the full IT lab environment (hardware, networking, OS), ensuring 99%+ uptime for 50+ active users",
        "Oversee data collection, storage, and backup processes for institutional records; implement structured validation checks to maintain accuracy and consistency across datasets",
        "Deliver hands-on training in network configuration, firewall setup, secure API integration, and database fundamentals; develop structured learning content that improves learner pass rates",
        "Provide tier-1 and tier-2 technical support; diagnose and resolve hardware, software, and network issues, maintaining detailed resolution logs for data-driven troubleshooting",
        "Design and maintain documentation for IT infrastructure, user-access protocols, and data controls — ensuring audit-ready operational records",
      ],
    },
    {
      role: "Mathematics & Physics Teacher (Volunteer)",
      organisation: "Nyakango Secondary School",
      location: "Homa Bay, Kenya",
      period: "May 2021 – Jul 2021",
      bullets: [
        "Taught Mathematics and Physics to secondary-level students, simplifying complex concepts through structured lesson planning and practical examples",
        "Designed and administered periodic assessments; analysed student performance data in Excel to identify learning gaps and deliver targeted interventions",
        "Generated comprehensive student progress reports for administration and parents, strengthening structured reporting and stakeholder communication skills",
      ],
    },
  ] satisfies ResumeExperience[],
  projects: [
    {
      title: "Kenya Debt Analysis",
      subtitle: "Policy Data Visualization",
      href: "https://github.com/WestMorganOketch/Kenya-Debt-Analysis",
      body: "Analysed Kenya’s national debt trajectory using time-series fiscal data; performed data cleaning, trend analysis, and built interactive visualisations to produce policy-relevant insights on fiscal sustainability.",
    },
    {
      title: "SQL Sales Analysis",
      subtitle: "Relational Database & Reporting",
      href: "https://github.com/WestMorganOketch/SQL-SALES-ANALYSIS",
      body: "Designed a normalised relational sales database; wrote complex SQL queries (joins, CTEs, window functions) to generate executive-ready sales reports and performance dashboards.",
    },
    {
      title: "Customer Churn Prediction",
      subtitle: "Logistic Regression",
      href: "https://github.com/WestMorganOketch/churn-logistic-regression",
      body: "Built an end-to-end predictive model using logistic regression; performed feature engineering, cross-validation, and ROC-AUC evaluation to identify at-risk customers and inform retention strategy.",
    },
    {
      title: "Mall Customer Segmentation",
      subtitle: "DBSCAN Clustering",
      href: "https://github.com/WestMorganOketch/DBSCAN-For-Mall-Customer-Segmentation",
      body: "Applied density-based clustering to segment retail customers by purchasing behaviour; visualised distributions and derived segment-specific marketing recommendations.",
    },
    {
      title: "Business Intelligence Dashboard",
      subtitle: "Organisational Performance — Power BI + SQL",
      body: "Designed and deployed an interactive Power BI dashboard connected to a SQL backend; automated recurring reporting and reduced manual workload by 60% through real-time KPI tracking.",
    },
    {
      title: "Secure Web Application Development",
      subtitle: "Apr 2025",
      body: "Developed web applications with robust authentication flows, JWT token management, and REST API security hardening using ReactJS and Node.js.",
    },
  ] satisfies ResumeProject[],
  education: {
    qualification: "Bachelor of Science in Mathematics & Computer Science",
    institution: "Tom Mboya University",
    location: "Homa Bay, Kenya",
    period: "2026",
    coursework: "Statistical Methods, Data Structures & Algorithms, Database Systems, Linear Algebra, Probability Theory, Numerical Analysis, Discrete Mathematics, Regression Analysis",
  },
  certifications: [
    { name: "Networking Fundamentals", issuer: "Cisco Networking Academy", date: "In Progress" },
    { name: "Machine Learning", issuer: "KeDataLab", date: "May 2026" },
    { name: "Business Intelligence — SQL & Power BI", issuer: "KeDataLab, Cohort 1", date: "Apr 2026" },
    { name: "Security Analyst", issuer: "Cyber Shujaa / USIU-Africa", date: "Jan 2026" },
    { name: "Artificial Intelligence", issuer: "ALX Africa", date: "Dec 2025" },
    { name: "Virtual Assistance & Freelance Operations", issuer: "ALX Africa", date: "Dec 2025" },
  ],
  references: "Available upon request.",
  updatedAt: "2026-11-05",
} as const;
