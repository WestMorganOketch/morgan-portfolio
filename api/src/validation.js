import { z } from "zod";

const safeLink = z
  .union([z.literal(""), z.null(), z.string().url().max(500)])
  .refine((value) => value === null || value === "" || ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Links must use HTTP or HTTPS.",
  })
  .transform((value) => value || null);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
});

export const claimAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
  confirmPassword: z.string().min(10).max(200),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"] });

export const changeAdminCredentialsSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  newPassword: z.string().min(10).max(200).optional(),
}).refine((value) => value.newEmail !== undefined || value.newPassword !== undefined);

export const uuidSchema = z.string().uuid();

export const projectSchema = z.object({
  title: z.string().trim().min(1).max(160),
  period: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(1200),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  writeup: z.string().max(12000),
  challenges: z.string().max(4000),
  solutions: z.string().max(4000),
  architecture: z.string().max(4000),
  futureImprovements: z.string().max(4000),
  url: safeLink,
  demoUrl: safeLink,
  published: z.boolean(),
});

export const contentCategories = [
  "experience", "education", "certifications", "achievements", "blog", "gallery",
  "services", "writeups", "inventions", "cheatsheets", "ctfs", "assignments", "skills",
];

export const contentSchema = z.object({
  category: z.enum(contentCategories),
  title: z.string().trim().min(1).max(160),
  period: z.string().trim().max(80),
  description: z.string().trim().min(1).max(1200),
  body: z.string().max(12000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  url: safeLink,
  published: z.boolean(),
});

const analyticsPages = [
  "home", "about", "skills", "experience", "projects", "education", "certifications",
  "timeline", "achievements", "blog", "gallery", "services", "writeups", "inventions",
  "cheatsheets", "ctfs", "assignments", "documents", "triage", "leaderboard", "contact", "privacy",
];

export const analyticsSchema = z.object({
  event: z.enum(["page_view", "github_click", "linkedin_click", "email_click"]),
  page: z.enum(analyticsPages),
});

export function parseInput(schema, input) {
  const result = schema.safeParse(input);
  return result.success ? { data: result.data } : { error: result.error.flatten() };
}
