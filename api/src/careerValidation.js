import { z } from "zod";

const jsonRecord = z.record(z.string().max(80), z.json());

function boundedJsonRecord(value, context) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 32_768) {
    context.addIssue({ code: "custom", message: "Verified facts must be no larger than 32 KB." });
  }
}

const verifiedFacts = jsonRecord.superRefine(boundedJsonRecord);

export const careerSettingsSchema = z.object({
  role_tracks: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
  countries: z.array(z.enum(["Kenya", "Tanzania", "Uganda"])).min(1).max(3),
  remote_eligibility: z.record(z.string().max(60), z.boolean()),
  score_threshold: z.number().int().min(0).max(100),
  max_packets_per_day: z.number().int().min(1).max(5),
  max_sends_per_day: z.number().int().min(1).max(5),
  timezone: z.literal("Africa/Nairobi"),
  show_company_name: z.boolean(),
  public_publishing: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new Set(value.role_tracks).size !== value.role_tracks.length) {
    context.addIssue({ code: "custom", path: ["role_tracks"], message: "Role tracks must be unique." });
  }
  if (new Set(value.countries).size !== value.countries.length) {
    context.addIssue({ code: "custom", path: ["countries"], message: "Countries must be unique." });
  }
});

export const resumeProfileCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  track: z.string().trim().min(1).max(80),
  original_text: z.string().max(60_000),
  verified_facts: verifiedFacts.default({}),
}).strict();

export const resumeProfilePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  track: z.string().trim().min(1).max(80).optional(),
  verified_facts: verifiedFacts.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one editable field.");

export const sourcePatchSchema = z.object({
  enabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide enabled or notes.");

export const uuidSchema = z.string().uuid();

export const careerJobsQuerySchema = z.object({
  source: z.string().regex(/^[a-z0-9_]{1,60}$/).optional(),
  status: z.enum(["discovered", "shortlisted", "maybe", "flagged", "passed", "duplicate", "expired", "closed"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().regex(/^\d{1,8}$/).optional(),
}).strict();

export const careerImportSchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().max(200).optional(),
  url: z.string().trim().max(2000).refine((value) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "URL must use HTTP or HTTPS and must not include credentials.").optional(),
  text: z.string().max(6000).default(""),
}).strict();

export const atsWatchlistCreateSchema = z.object({
  provider: z.enum(["greenhouse", "lever"]),
  token: z.string().regex(/^[A-Za-z0-9_-]{2,60}$/),
  label: z.string().trim().min(1).max(120),
}).strict();

export function parseCareerInput(schema, input) {
  const result = schema.safeParse(input);
  return result.success ? { data: result.data } : { error: result.error.flatten() };
}
