"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type JsonRecord = Record<string, unknown>;
type Eligibility = "eligible" | "unknown" | "ineligible";
type Assessment = {
  track?: string | null;
  profile_id?: string | null;
  assessed_at?: string;
  eligibility: Eligibility;
  eligibility_evidence: { phrase?: string; rule?: string }[];
  fit_score: number;
  fit_breakdown: JsonRecord;
  matched: { type?: string; value?: string; phrase?: string }[];
  missing: { type?: string; value?: string }[];
  reason_codes: string[];
  uncertainty: string[];
};
type RiskFinding = { code: string; severity: string; confidence: number; evidence: string };
type RiskAssessment = {
  risk_level: "low" | "medium" | "high" | string;
  label: string;
  risk_findings: RiskFinding[];
  risk_confidence: number;
  unknowns: string[];
  url_checks: { hostname?: string | null; error?: string; https_ok?: boolean };
  risk_assessed_at?: string | null;
};
type CareerJob = {
  id: string;
  title: string;
  company: string | null;
  location_text: string;
  remote_scope_text?: string;
  description_text?: string;
  url: string | null;
  source_key: string;
  source_name: string;
  attribution_text: string;
  posted_at: string | null;
  first_seen_at: string;
  status: string;
  assessment: Assessment | null;
  risk_assessment?: string | RiskAssessment;
};
type SourceHealth = {
  key: string;
  name: string;
  enabled: boolean;
  min_interval_seconds: number;
  max_requests_per_day: number;
  attribution_text: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
  requests_today: number | null;
  window_date: string;
  next_allowed_at: string | null;
};
type Overview = {
  last_success_at: string | null;
  preparation_tables_configured?: boolean;
  preparation_tables_missing?: string[];
  stale: boolean;
  new_jobs_count: number;
  shortlist_count: number;
  drafts_waiting: number;
  review_count: number;
  job_counts: Record<string, number>;
  applications_by_state: Record<string, number>;
  sources: SourceHealth[];
  shortlist: CareerJob[];
  qualified: CareerJob[];
  maybe: CareerJob[];
};
type Profile = {
  id: string;
  name: string;
  track: string;
  original_text: string;
  verified_facts: JsonRecord;
  archived_at: string | null;
};
type Application = {
  id: string;
  job_id: string;
  state: string;
  private_notes: string;
  followup_at: string | null;
  title: string;
  company: string | null;
  location_text: string;
  url: string | null;
  source_name: string;
};
type ApplicationEvent = { id: string; at: string; event: string; detail: JsonRecord };
type Settings = {
  role_tracks: string[];
  countries: string[];
  score_threshold: number;
  max_packets_per_day: number;
  max_sends_per_day: number;
  timezone: "Africa/Nairobi";
  show_company_name: boolean;
  public_publishing: boolean;
  excluded_keywords: string[];
  excluded_companies: string[];
};
type SetupStatus = {
  configuration: Record<string, { configured: boolean }>;
  JR_SEND_MODE: "draft" | "live";
  preparationTables?: { configured: boolean; missing: string[] };
  gmail?: { connected: boolean; email: string | null; scopes: string[]; connected_at: string | null };
};
type ApplicationPacket = {
  id: string;
  application_id: string;
  job_id: string;
  source_profile_id: string;
  version: number;
  status: string;
  resume_text?: string;
  cover_letter_text?: string;
  recipient_email: string;
  highlights: { text?: string; evidenceTerms?: string[]; sourceLine?: number }[];
  missing_requirements: string[];
  warnings: string[];
  source_snapshot: JsonRecord;
  master_resume_sha256: string;
  gmail_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  company: string | null;
  location_text: string;
  application_url: string | null;
  source_name: string | null;
  profile_name: string;
  profile_track: string;
  application_state: string;
  has_resume?: boolean;
  has_cover_letter?: boolean;
};
type CareerRun = {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: JsonRecord;
};
type WatchlistEntry = { id: string; provider: "greenhouse" | "lever"; token: string; label: string; enabled: boolean };
type SearchLink = { name: string; url: string };
type CareerDocument = {
  id: string;
  title: string;
  kind: "master_resume" | "certificate" | "supporting_document" | "employment_record";
  original_filename: string;
  content_type: "application/pdf" | "image/png" | "image/jpeg";
  byte_size: number;
  plaintext_sha256: string;
  created_at: string;
  application_email_consent: boolean;
  public_profile_consent?: boolean;
};
type PublicSnapshotJob = {
  title: string;
  location: string;
  remote_scope: string;
  source: string;
  attribution: string;
  url: string;
  posted_at: string | null;
  first_seen_at: string | null;
  company?: string;
};
type PublicSnapshotPreview = {
  snapshot_sha256: string;
  job_count: number;
  snapshot: { schema_version: number; generated_at: string; verification_notice: string; jobs: PublicSnapshotJob[] };
};
type PublicSnapshotStatus = {
  public_publishing_enabled: boolean;
  latest: { id: string; snapshot_sha256: string; job_count: number; published_by: string; created_at: string } | null;
};

const careerTabs = [
  "Overview", "Review", "Import", "Resume profiles", "Preferences", "Sources and Setup",
  "Private documents", "Application drafts", "Tracker",
] as const;
const careerTabLabels: Record<CareerTab, string> = {
  Overview: "Dashboard",
  Review: "Find & review",
  Import: "Add a job",
  "Resume profiles": "Master CV",
  Preferences: "Search preferences",
  "Sources and Setup": "Sources & automation",
  "Private documents": "Private documents",
  "Application drafts": "Application drafts",
  Tracker: "Applications",
};
type CareerTab = (typeof careerTabs)[number];
const reviewLists = ["Shortlist", "Maybe", "Qualified", "Passed", "Dismissed"] as const;
type ReviewList = (typeof reviewLists)[number];
const applicationStates = [
  "discovered", "screened", "match_review", "shortlisted", "preparation_in_progress",
  "ready_for_review", "approved_to_send", "sent", "failed_send", "submitted",
  "expired", "duplicate", "blocked_risk", "not_a_fit", "withdrawn", "needs_manual_attention",
];
const tracks = ["Security Analyst/SOC", "Computer Skills/ICT Trainer"];
const countries = ["Kenya", "Tanzania", "Uganda"];
const secretNames = [
  "JOB_CRON_SECRET", "DOC_ENCRYPTION_KEY",
  "GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REDIRECT_URI",
];
const emptySettings: Settings = {
  role_tracks: [...tracks],
  countries: [...countries],
  score_threshold: 65,
  max_packets_per_day: 5,
  max_sends_per_day: 5,
  timezone: "Africa/Nairobi",
  show_company_name: false,
  public_publishing: false,
  excluded_keywords: [],
  excluded_companies: [],
};
const emptyProfileForm = {
  id: "",
  name: "",
  track: tracks[0],
  original_text: "",
  requiredSkills: "",
  tasks: "",
  preferredSkills: "",
};
const emptyImport = { title: "", company: "", url: "", text: "" };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function isAssessment(value: unknown): value is Assessment {
  return isRecord(value)
    && ["eligible", "unknown", "ineligible"].includes(String(value.eligibility))
    && typeof value.fit_score === "number"
    && Array.isArray(value.eligibility_evidence)
    && isRecord(value.fit_breakdown)
    && Array.isArray(value.matched)
    && Array.isArray(value.missing)
    && Array.isArray(value.reason_codes)
    && Array.isArray(value.uncertainty);
}

function isCareerJob(value: unknown): value is CareerJob {
  return isRecord(value)
    && string(value.id)
    && string(value.title)
    && (value.company === null || string(value.company))
    && string(value.location_text)
    && (value.url === null || string(value.url))
    && string(value.source_key)
    && string(value.source_name)
    && string(value.attribution_text)
    && string(value.status)
    && (value.assessment === null || isAssessment(value));
}

function isOverview(value: unknown): value is Overview {
  return isRecord(value)
    && (value.last_success_at === null || string(value.last_success_at))
    && typeof value.stale === "boolean"
    && typeof value.new_jobs_count === "number"
    && typeof value.shortlist_count === "number"
    && typeof value.drafts_waiting === "number"
    && typeof value.review_count === "number"
    && isRecord(value.job_counts)
    && isRecord(value.applications_by_state)
    && Array.isArray(value.sources)
    && Array.isArray(value.shortlist)
    && value.shortlist.every(isCareerJob)
    && Array.isArray(value.qualified)
    && value.qualified.every(isCareerJob)
    && Array.isArray(value.maybe)
    && value.maybe.every(isCareerJob);
}

function isProfile(value: unknown): value is Profile {
  return isRecord(value)
    && string(value.id)
    && string(value.name)
    && string(value.track)
    && string(value.original_text)
    && isRecord(value.verified_facts)
    && (value.archived_at === null || string(value.archived_at));
}

function isApplication(value: unknown): value is Application {
  return isRecord(value)
    && string(value.id)
    && string(value.job_id)
    && string(value.state)
    && string(value.private_notes)
    && (value.followup_at === null || string(value.followup_at))
    && string(value.title)
    && (value.company === null || string(value.company))
    && string(value.location_text)
    && (value.url === null || string(value.url))
    && string(value.source_name);
}

function isApplicationPacket(value: unknown): value is ApplicationPacket {
  return isRecord(value)
    && string(value.id)
    && string(value.application_id)
    && string(value.job_id)
    && string(value.source_profile_id)
    && typeof value.version === "number"
    && string(value.status)
    && (value.resume_text === undefined || string(value.resume_text))
    && (value.cover_letter_text === undefined || string(value.cover_letter_text))
    && string(value.recipient_email)
    && Array.isArray(value.highlights)
    && Array.isArray(value.missing_requirements)
    && value.missing_requirements.every(string)
    && Array.isArray(value.warnings)
    && value.warnings.every(string)
    && isRecord(value.source_snapshot)
    && string(value.master_resume_sha256)
    && (value.gmail_message_id === null || string(value.gmail_message_id))
    && (value.sent_at === null || string(value.sent_at))
    && string(value.created_at)
    && string(value.updated_at)
    && string(value.title)
    && (value.company === null || string(value.company))
    && string(value.location_text)
    && (value.application_url === null || string(value.application_url))
    && (value.source_name === null || string(value.source_name))
    && string(value.profile_name)
    && string(value.profile_track)
    && string(value.application_state);
}

function isCareerDocument(value: unknown): value is CareerDocument {
  return isRecord(value)
    && string(value.id)
    && string(value.title)
    && ["master_resume", "certificate", "supporting_document", "employment_record"].includes(String(value.kind))
    && string(value.original_filename)
    && ["application/pdf", "image/png", "image/jpeg"].includes(String(value.content_type))
    && typeof value.byte_size === "number"
    && string(value.plaintext_sha256)
    && string(value.created_at)
    && typeof value.application_email_consent === "boolean";
}

function isPublicSnapshotJob(value: unknown): value is PublicSnapshotJob {
  return isRecord(value)
    && string(value.title)
    && string(value.location)
    && string(value.remote_scope)
    && string(value.source)
    && string(value.attribution)
    && string(value.url)
    && (value.posted_at === null || string(value.posted_at))
    && (value.first_seen_at === null || string(value.first_seen_at))
    && (value.company === undefined || string(value.company));
}

function isPublicSnapshotPreview(value: unknown): value is PublicSnapshotPreview {
  return isRecord(value)
    && string(value.snapshot_sha256)
    && typeof value.job_count === "number"
    && isRecord(value.snapshot)
    && typeof value.snapshot.schema_version === "number"
    && string(value.snapshot.generated_at)
    && string(value.snapshot.verification_notice)
    && Array.isArray(value.snapshot.jobs)
    && value.snapshot.jobs.every(isPublicSnapshotJob)
    && value.job_count === value.snapshot.jobs.length;
}

function isPublicSnapshotStatus(value: unknown): value is PublicSnapshotStatus {
  return isRecord(value)
    && typeof value.public_publishing_enabled === "boolean"
    && (value.latest === null || (
      isRecord(value.latest)
      && string(value.latest.id)
      && string(value.latest.snapshot_sha256)
      && typeof value.latest.job_count === "number"
      && string(value.latest.published_by)
      && string(value.latest.created_at)
    ));
}

function isCareerRun(value: unknown): value is CareerRun {
  return isRecord(value)
    && string(value.id)
    && string(value.trigger)
    && string(value.status)
    && string(value.started_at)
    && (value.finished_at === null || string(value.finished_at))
    && isRecord(value.summary);
}

function parseSetupStatus(value: unknown): SetupStatus | null {
  if (!isRecord(value) || !isRecord(value.configuration)) return null;
  const preparationTables = isRecord(value.preparationTables)
    ? {
        configured: value.preparationTables.configured === true,
        missing: Array.isArray(value.preparationTables.missing) ? value.preparationTables.missing.filter(string) : [],
      }
    : undefined;
  const rawGmail = isRecord(value.gmail) ? value.gmail : null;
  const gmail = rawGmail
    ? {
        connected: rawGmail.connected === true,
        email: string(rawGmail.email) ? rawGmail.email : null,
        scopes: Array.isArray(rawGmail.scopes) ? rawGmail.scopes.filter(string) : [],
        connected_at: string(rawGmail.connected_at) ? rawGmail.connected_at : null,
      }
    : undefined;
  return {
    configuration: Object.fromEntries(
      Object.entries(value.configuration).map(([name, entry]) => [name, { configured: isRecord(entry) && entry.configured === true }]),
    ),
    JR_SEND_MODE: value.JR_SEND_MODE === "live" ? "live" : "draft",
    ...(preparationTables ? { preparationTables } : {}),
    ...(gmail ? { gmail } : {}),
  };
}

function isSource(value: unknown): value is SourceHealth {
  return isRecord(value)
    && string(value.key)
    && string(value.name)
    && typeof value.enabled === "boolean"
    && typeof value.min_interval_seconds === "number"
    && typeof value.max_requests_per_day === "number"
    && string(value.attribution_text)
    && typeof value.consecutive_failures === "number"
    && (value.requests_today === null || typeof value.requests_today === "number");
}

async function request(path: string, csrfToken: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.method && init.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Could not reach the career service. Check your connection and try again.");
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The career service returned an unreadable response.");
    }
  }
  if (!response.ok) {
    throw new Error(isRecord(data) && string(data.error)
      ? data.error
      : `The request failed (${response.status}).`);
  }
  return data;
}

 
async function requestMultipart(path: string, csrfToken: string, body: FormData): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-CSRF-Token": csrfToken },
      body,
    });
  } catch {
    throw new Error("Could not reach the career service. Check your connection and try again.");
  }
  const responseText = await response.text();
  let data: unknown = null;
  if (responseText) {
    try { data = JSON.parse(responseText); } catch {
      throw new Error("The career service returned an unreadable response.");
    }
  }
  if (!response.ok) {
    throw new Error(isRecord(data) && string(data.error) ? data.error : `The request failed (${response.status}).`);
  }
  return data;
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function readableDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function valuesFromFacts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(string) : [];
}

function normalizedRole(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function suggestedProfileForJob(job: CareerJob, profiles: Profile[]): Profile | null {
  const active = profiles.filter((profile) => !profile.archived_at);
  const target = normalizedRole(job.assessment?.track ?? job.title);
  const exact = active.find((profile) => normalizedRole(profile.track) === target);
  if (exact) return exact;
  if (/security|cyber|soc/.test(target)) {
    return active.find((profile) => /(security|cyber|soc)/.test(normalizedRole(profile.track))) ?? active[0] ?? null;
  }
  if (/trainer|training|computer|ict|digital skills/.test(target)) {
    return active.find((profile) => /(trainer|training|computer|ict|digital skills)/.test(normalizedRole(profile.track))) ?? active[0] ?? null;
  }
  return active[0] ?? null;
}

function CareerListEditor({
  id,
  label,
  helper,
  value,
  onChange,
}: {
  id: string;
  label: string;
  helper: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);

  function addItem() {
    const next = draft.trim().replace(/\s+/g, " ");
    if (!next || items.some((item) => item.toLowerCase() === next.toLowerCase())) return;
    onChange([...items, next].join(", "));
    setDraft("");
  }

  function removeItem(item: string) {
    onChange(items.filter((entry) => entry !== item).join(", "));
  }

  return (
    <div className="career-list-editor">
      <div className="career-list-editor-heading">
        <label htmlFor={id}>{label}</label>
        <span>{helper}</span>
      </div>
      {items.length ? (
        <div className="career-list-chips" aria-label={`Saved ${label.toLowerCase()}`}>
          {items.map((item) => (
            <span className="career-list-chip" key={item}>
              {item}
              <button aria-label={`Remove ${item}`} onClick={() => removeItem(item)} type="button">×</button>
            </span>
          ))}
        </div>
      ) : <p className="career-list-empty">No entries added yet.</p>}
      <div className="career-add-role career-add-list-item">
        <div className="career-inline-form">
          <input
            id={id}
            maxLength={100}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addItem();
              }
            }}
            placeholder={`Add a ${label.toLowerCase().replace("verified ", "").replace(/s$/, "")}`}
            value={draft}
          />
          <button className="button button-quiet" disabled={!draft.trim()} onClick={addItem} type="button">Add</button>
        </div>
      </div>
      <details className="career-list-paste">
        <summary>Paste or edit a comma-separated list</summary>
        <input aria-label={`${label} comma-separated values`} onChange={(event) => onChange(event.target.value)} value={value} />
      </details>
    </div>
  );
}

export default function CareerCentre({ csrfToken }: { csrfToken: string }) {
  const [tab, setTab] = useState<CareerTab>("Overview");
  const [reviewList, setReviewList] = useState<ReviewList>("Shortlist");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [jobs, setJobs] = useState<CareerJob[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [searchLinks, setSearchLinks] = useState<SearchLink[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationFilter, setApplicationFilter] = useState("all");
  const [runHistory, setRunHistory] = useState<CareerRun[]>([]);
  const [applicationPackets, setApplicationPackets] = useState<ApplicationPacket[]>([]);
  const [careerDocuments, setCareerDocuments] = useState<CareerDocument[]>([]);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentKind, setDocumentKind] = useState<CareerDocument["kind"]>("master_resume");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentVaultError, setDocumentVaultError] = useState("");
  const [selectedSendDocumentId, setSelectedSendDocumentId] = useState("");
  const [confirmSendDocumentRelease, setConfirmSendDocumentRelease] = useState(false);
  const [snapshotPreview, setSnapshotPreview] = useState<PublicSnapshotPreview | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<PublicSnapshotStatus | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [confirmSnapshotPublication, setConfirmSnapshotPublication] = useState(false);
  const [activePacket, setActivePacket] = useState<ApplicationPacket | null>(null);
  const [preparationJobs, setPreparationJobs] = useState<CareerJob[]>([]);
  const [selectedPreparationJobId, setSelectedPreparationJobId] = useState("");
  const [selectedPreparationProfileId, setSelectedPreparationProfileId] = useState("");
  const [draftResumeText, setDraftResumeText] = useState("");
  const [draftCoverLetterText, setDraftCoverLetterText] = useState("");
  const [draftRecipientEmail, setDraftRecipientEmail] = useState("");
  const [confirmSendWarnings, setConfirmSendWarnings] = useState(false);
  const [confirmSendEligibility, setConfirmSendEligibility] = useState(false);
  const [gmailActionBusy, setGmailActionBusy] = useState(false);
  const [applicationEvents, setApplicationEvents] = useState<ApplicationEvent[]>([]);
  const [activeApplication, setActiveApplication] = useState("");
  const [activeProfile, setActiveProfile] = useState("");
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [settings, setSettings] = useState(emptySettings);
  const [importForm, setImportForm] = useState(emptyImport);
  const [watchForm, setWatchForm] = useState({ provider: "greenhouse", token: "", label: "" });
  const [noteTarget, setNoteTarget] = useState<CareerJob | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteApplicationId, setNoteApplicationId] = useState("");
  const [notesByApplication, setNotesByApplication] = useState<Record<string, string>>({});
  const [followupsByApplication, setFollowupsByApplication] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [scanStatus, setScanStatus] = useState<"idle" | "running" | "succeeded" | "failed" | "interrupted" | "skipped">("idle");
  const [scanRunId, setScanRunId] = useState<string | null>(null);
  const [newRoleTrack, setNewRoleTrack] = useState("");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const availableTracks = [...new Set([...tracks, ...settings.role_tracks])];

  const loadOverview = useCallback(async () => {
    const value = await request("/api/admin/career/overview", csrfToken);
    if (!isOverview(value) || !value.sources.every(isSource)) throw new Error("The career service returned unexpected overview data.");
    setOverview(value);
  }, [csrfToken]);

  useEffect(() => {
    if (scanStatus !== "running") return;
    let active = true;
    let inFlight = false;

    const refreshScan = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await request("/api/admin/career/runs", csrfToken);
        if (!Array.isArray(value)) throw new Error("The scan status response was not valid.");
        const rows = value.filter(isRecord);
        setRunHistory(rows.filter(isCareerRun));
        const current = (scanRunId ? rows.find((row) => row.id === scanRunId) : null) ?? rows[0];
        if (!current || !string(current.status) || !active) return;
        if (current.status === "running") return;
        if (["succeeded", "failed", "interrupted", "skipped"].includes(current.status)) {
          const finalStatus = current.status as "succeeded" | "failed" | "interrupted" | "skipped";
          setScanStatus(finalStatus);
          await loadOverview();
          if (!active) return;
          setMessage(finalStatus === "succeeded"
            ? "Scan completed. The overview and shortlist have been refreshed."
            : finalStatus === "skipped"
              ? "The scan was skipped because another run already held the scan lock."
              : `The scan ${finalStatus}. Check source health and run history for details.`);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Scan status could not be refreshed.");
      } finally {
        inFlight = false;
      }
    };

    void refreshScan();
    const timer = window.setInterval(() => { void refreshScan(); }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [csrfToken, loadOverview, scanRunId, scanStatus]);


  const loadReview = useCallback(async () => {
    if (reviewList === "Shortlist" || reviewList === "Maybe" || reviewList === "Qualified") {
      if (!overview) await loadOverview();
      return;
    }
    const statuses = reviewList === "Passed" ? ["not_a_fit", "passed"] : ["duplicate"];
    const responses = await Promise.all(statuses.map((status) =>
      request(`/api/admin/career/jobs?status=${status}&limit=50`, csrfToken)));
    const found = responses.flatMap((data) => isRecord(data) && Array.isArray(data.jobs) ? data.jobs.filter(isCareerJob) : []);
    setJobs(found);
  }, [csrfToken, loadOverview, overview, reviewList]);

  const loadProfiles = useCallback(async () => {
    const value = await request("/api/admin/career/resume-profiles", csrfToken);
    if (!Array.isArray(value) || !value.every(isProfile)) throw new Error("The career service returned unexpected profile data.");
    setProfiles(value);
    return value;
  }, [csrfToken]);

  const loadRunHistory = useCallback(async () => {
    const value = await request("/api/admin/career/runs", csrfToken);
    if (!Array.isArray(value)) throw new Error("The scan history response was not valid.");
    const rows = value.filter(isCareerRun);
    setRunHistory(rows);
    return rows;
  }, [csrfToken]);

  const loadApplicationPackets = useCallback(async () => {
    const value = await request("/api/admin/career/application-packets", csrfToken);
    if (!Array.isArray(value) || !value.every(isApplicationPacket)) {
      throw new Error("The application draft service returned unexpected data. Check that the Phase 6 database migration is installed.");
    }
    setApplicationPackets(value);
    return value;
  }, [csrfToken]);

  const loadPreparationOptions = useCallback(async () => {
    const [jobData, profileData, setupData] = await Promise.all([
      request("/api/admin/career/jobs?limit=50", csrfToken),
      loadProfiles(),
      request("/api/admin/career/setup", csrfToken),
    ]);
    if (!isRecord(jobData) || !Array.isArray(jobData.jobs) || !jobData.jobs.every(isCareerJob)) {
      throw new Error("The career service returned invalid job options.");
    }
    const foundJobs = jobData.jobs;
    setPreparationJobs(foundJobs);
    const parsedSetup = parseSetupStatus(setupData);
    if (!parsedSetup) throw new Error("The setup status response was not valid.");
    setSetup(parsedSetup);
    setSelectedPreparationJobId((current) => current || foundJobs[0]?.id || "");
    setSelectedPreparationProfileId((current) => current || profileData.find((profile) => !profile.archived_at)?.id || "");
    return { jobs: foundJobs, profiles: profileData, setup: parsedSetup };
  }, [csrfToken, loadProfiles]);

  const loadSources = useCallback(async () => {
    const [sourceData, setupData, watchData, linkData] = await Promise.all([
      request("/api/admin/career/sources", csrfToken),
      request("/api/admin/career/setup", csrfToken),
      request("/api/admin/career/watchlist", csrfToken),
      request("/api/admin/career/search-links", csrfToken),
    ]);
    if (!Array.isArray(sourceData) || !sourceData.every(isSource)) throw new Error("The career service returned unexpected source data.");
    if (!isRecord(setupData) || !isRecord(setupData.configuration)) throw new Error("The setup status could not be read.");
    if (!Array.isArray(watchData) || !Array.isArray(linkData)) throw new Error("The source tools returned unexpected data.");
    setSources(sourceData);
    const parsedSetup = parseSetupStatus(setupData);
    if (!parsedSetup) throw new Error("The setup status response was not valid.");
    setSetup(parsedSetup);
    setWatchlist(watchData.filter((row): row is WatchlistEntry =>
      isRecord(row) && string(row.id) && string(row.token) && string(row.label)
      && (row.provider === "greenhouse" || row.provider === "lever") && typeof row.enabled === "boolean"));
    setSearchLinks(linkData.filter((row): row is SearchLink =>
      isRecord(row) && string(row.name) && string(row.url)));
  }, [csrfToken]);

  const loadApplications = useCallback(async () => {
    const value = await request("/api/admin/career/applications", csrfToken);
    if (!Array.isArray(value) || !value.every(isApplication)) throw new Error("The career service returned unexpected application data.");
    setApplications(value);
  }, [csrfToken]);

  const loadCareerDocuments = useCallback(async () => {
    const value = await request("/api/admin/career/documents", csrfToken);
    if (!Array.isArray(value) || !value.every(isCareerDocument)) {
      throw new Error("The private document vault returned unexpected data.");
    }
    setCareerDocuments(value);
    setDocumentVaultError("");
    return value;
  }, [csrfToken]);

  const loadPublicSnapshotStatus = useCallback(async () => {
    const value = await request("/api/admin/career/public-snapshot/latest", csrfToken);
    if (!isPublicSnapshotStatus(value)) throw new Error("Public snapshot status returned unexpected data.");
    setSnapshotStatus(value);
    setSnapshotError("");
    return value;
  }, [csrfToken]);

  // This one-time effect consumes the Gmail OAuth return marker. Its state updates
  // intentionally route the user to setup and show the result of that external redirect.
  /* eslint-disable react-hooks/set-state-in-effect -- navigation callback state is consumed once, then removed from the URL */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (gmailStatus) {
      setTab("Sources and Setup");
      setMessage(gmailStatus === "connected"
        ? "Gmail connected. Email sending remains off until the server is deliberately switched to live mode."
        : gmailStatus === "denied"
          ? "Gmail connection was cancelled. No sending permission was saved."
          : "Gmail could not be connected. Check the server setup checklist and retry.");
      params.delete("gmail");
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("gmail");
      window.history.replaceState({}, "", nextUrl.toString());
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const initialize = async () => {
        try {
          await loadOverview();
          try {
            const runData = await request("/api/admin/career/runs", csrfToken);
            if (active && Array.isArray(runData)) {
              setRunHistory(runData.filter(isCareerRun));
              const latestRunning = runData.filter(isRecord).find((row) => row.status === "running");
              if (latestRunning) {
                setScanRunId(string(latestRunning.id) ? latestRunning.id : null);
                setScanStatus("running");
              }
            }
          } catch {
            // The overview remains usable if run history is temporarily unavailable.
          }
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : "The career centre could not be loaded.");
        } finally {
          if (active) setLoading(false);
        }
      };
      void initialize();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [csrfToken, loadOverview]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const reportError = (cause: unknown, fallback: string) => {
        if (active) setError(cause instanceof Error ? cause.message : fallback);
      };
      if (tab === "Review") void loadReview().catch((cause: unknown) => reportError(cause, "Review jobs could not be loaded."));
      if (tab === "Resume profiles") void loadProfiles().catch((cause: unknown) => reportError(cause, "Resume profiles could not be loaded."));
      if (tab === "Preferences") {
        void request("/api/admin/career/settings", csrfToken).then((value) => {
          if (!isRecord(value)) throw new Error("The career service returned unexpected preferences.");
          if (!active) return;
          setSettings({
            role_tracks: Array.isArray(value.role_tracks) ? value.role_tracks.filter(string) : emptySettings.role_tracks,
            countries: Array.isArray(value.countries) ? value.countries.filter(string) : emptySettings.countries,
            score_threshold: typeof value.score_threshold === "number" ? value.score_threshold : emptySettings.score_threshold,
            max_packets_per_day: typeof value.max_packets_per_day === "number" ? value.max_packets_per_day : emptySettings.max_packets_per_day,
            max_sends_per_day: typeof value.max_sends_per_day === "number" ? value.max_sends_per_day : emptySettings.max_sends_per_day,
            timezone: "Africa/Nairobi",
            show_company_name: value.show_company_name === true,
            public_publishing: value.public_publishing === true,
            excluded_keywords: Array.isArray(value.excluded_keywords) ? value.excluded_keywords.filter(string) : [],
            excluded_companies: Array.isArray(value.excluded_companies) ? value.excluded_companies.filter(string) : [],
          });
        }).catch((cause: unknown) => reportError(cause, "Preferences could not be loaded."));
      }
      if (tab === "Sources and Setup") {
        void loadSources().catch((cause: unknown) => reportError(cause, "Source settings could not be loaded."));
        void loadPublicSnapshotStatus().catch((cause: unknown) => {
          if (active) setSnapshotError(cause instanceof Error ? cause.message : "Snapshot status could not be loaded.");
        });
      }
      if (tab === "Private documents" || tab === "Application drafts") {
        void loadCareerDocuments().catch((cause: unknown) => {
          if (active) setDocumentVaultError(cause instanceof Error ? cause.message : "Private documents could not be loaded.");
        });
      }
      if (tab === "Tracker") void loadApplications().catch((cause: unknown) => reportError(cause, "Applications could not be loaded."));
      if (tab === "Application drafts") {
        void Promise.all([loadApplicationPackets(), loadPreparationOptions()]).catch((cause: unknown) =>
          reportError(cause, cause instanceof Error ? cause.message : "Application preparation could not be loaded."));
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [csrfToken, loadApplicationPackets, loadApplications, loadCareerDocuments, loadPreparationOptions, loadProfiles, loadPublicSnapshotStatus, loadReview, loadSources, tab]);

  async function runAction(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      if (success) setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request("/api/admin/career/scan-now", csrfToken, {
        method: "POST",
        body: "{}",
      });
      if (!isRecord(result) || (result.id !== undefined && !string(result.id))) {
        throw new Error("The scan service returned an unexpected response.");
      }
      setScanRunId(string(result.id) ? result.id : null);
      setScanStatus("running");
      setMessage(result.status === "already_running"
        ? "A scan is already running. This page will follow its progress."
        : "Scan accepted. The page will update automatically when the run finishes.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The scan could not be started.");
    } finally {
      setBusy(false);
    }
  }

  function addRoleTrack() {
    const value = newRoleTrack.trim().replace(/\s+/g, " ");
    if (!value) return;
    if (settings.role_tracks.some((track) => track.toLowerCase() === value.toLowerCase())) {
      setError("That job title is already in your search profile.");
      return;
    }
    if (settings.role_tracks.length >= 10) {
      setError("You can save up to 10 job titles. Remove one before adding another.");
      return;
    }
    setSettings({ ...settings, role_tracks: [...settings.role_tracks, value] });
    setNewRoleTrack("");
    setError("");
  }

  function changeTab(next: CareerTab, focus = false) {
    setTab(next);
    setError("");
    if (focus) tabRefs.current[careerTabs.indexOf(next)]?.focus();
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : careerTabs.length - 1;
      changeTab(careerTabs[next], true);
      return;
    }
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = (index + offset + careerTabs.length) % careerTabs.length;
    changeTab(careerTabs[next], true);
  }

  async function updateJobStatus(job: CareerJob, status: string) {
    await runAction(async () => {
      await request(`/api/admin/career/jobs/${job.id}/status`, csrfToken, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadOverview();
      await loadReview();
    }, "Review status updated.");
  }

  async function openNotes(job: CareerJob) {
    try {
      const value = await request("/api/admin/career/applications", csrfToken);
      if (!Array.isArray(value) || !value.every(isApplication)) {
        throw new Error("The career service returned unexpected application data.");
      }
      setApplications(value);
      const current = value.find((application) => application.job_id === job.id);
      setNoteApplicationId(current?.id ?? "");
      setNoteText(current?.private_notes ?? "");
      setNoteTarget(job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The private note could not be opened.");
    }
  }

  async function saveJobNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noteTarget) return;
    await runAction(async () => {
      let applicationId = noteApplicationId;
      if (!applicationId) {
        const created = await request("/api/admin/career/applications", csrfToken, {
          method: "POST",
          body: JSON.stringify({ job_id: noteTarget.id }),
        });
        if (!isRecord(created) || !string(created.id)) throw new Error("The application tracker returned an invalid record.");
        applicationId = created.id;
      }
      await request(`/api/admin/career/applications/${applicationId}`, csrfToken, {
        method: "PATCH",
        body: JSON.stringify({ private_notes: noteText }),
      });
      await loadApplications();
      setNoteTarget(null);
      setNoteApplicationId("");
    }, "Private note saved in the tracker.");
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      await request("/api/admin/career/import", csrfToken, {
        method: "POST",
        body: JSON.stringify(importForm),
      });
      setImportForm(emptyImport);
      await loadOverview();
      setTab("Review");
      setReviewList("Shortlist");
    }, "Advert imported for private review.");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const verified_facts = {
        required_skills: profileForm.requiredSkills.split(",").map((item) => item.trim()).filter(Boolean),
        tasks: profileForm.tasks.split(",").map((item) => item.trim()).filter(Boolean),
        preferred_skills: profileForm.preferredSkills.split(",").map((item) => item.trim()).filter(Boolean),
      };
      if (activeProfile) {
        await request(`/api/admin/career/resume-profiles/${activeProfile}`, csrfToken, {
          method: "PATCH",
          body: JSON.stringify({ name: profileForm.name, track: profileForm.track, verified_facts }),
        });
      } else {
        await request("/api/admin/career/resume-profiles", csrfToken, {
          method: "POST",
          body: JSON.stringify({
            name: profileForm.name,
            track: profileForm.track,
            original_text: profileForm.original_text,
            verified_facts,
          }),
        });
      }
      await request("/api/admin/career/assessments/rerun", csrfToken, { method: "POST", body: "{}" });
      await loadProfiles();
      setActiveProfile("");
      setProfileForm(emptyProfileForm);
    }, activeProfile ? "Profile updated and assessments refreshed." : "Profile created and assessments refreshed.");
  }

  async function archiveProfile(id: string) {
    await runAction(async () => {
      await request(`/api/admin/career/resume-profiles/${id}/archive`, csrfToken, { method: "POST", body: "{}" });
      await request("/api/admin/career/assessments/rerun", csrfToken, { method: "POST", body: "{}" });
      await loadProfiles();
    }, "Profile archived and assessments refreshed.");
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const result = await request("/api/admin/career/settings", csrfToken, {
        method: "PUT",
        body: JSON.stringify({ ...settings, remote_eligibility: { Kenya: true } }),
      });
      if (!isRecord(result)) throw new Error("The career service returned invalid preferences.");
      await request("/api/admin/career/assessments/rerun", csrfToken, { method: "POST", body: "{}" });
    }, "Preferences saved.");
  }

  async function saveWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(watchForm.token)) {
      setError("Tokens must contain 2–60 letters, numbers, underscores, or hyphens.");
      return;
    }
    await runAction(async () => {
      await request("/api/admin/career/watchlist", csrfToken, {
        method: "POST",
        body: JSON.stringify(watchForm),
      });
      setWatchForm({ provider: "greenhouse", token: "", label: "" });
      await loadSources();
    }, "ATS board added to the private watchlist.");
  }

  async function deleteWatchlist(id: string) {
    await runAction(async () => {
      await request(`/api/admin/career/watchlist/${id}`, csrfToken, { method: "DELETE" });
      await loadSources();
    }, "ATS board removed.");
  }

  async function changeApplicationState(application: Application, state: string) {
    await runAction(async () => {
      await request(`/api/admin/career/applications/${application.id}/state`, csrfToken, {
        method: "PATCH",
        body: JSON.stringify({ state }),
      });
      await loadApplications();
      await loadOverview();
      if (activeApplication === application.id) await loadApplicationEvents(application.id);
    }, "Application state updated.");
  }

  async function saveApplicationDetails(application: Application) {
    await runAction(async () => {
      const followup = followupsByApplication[application.id];
      await request(`/api/admin/career/applications/${application.id}`, csrfToken, {
        method: "PATCH",
        body: JSON.stringify({
          private_notes: notesByApplication[application.id] ?? application.private_notes,
          ...(followup !== undefined
            ? { followup_at: followup ? new Date(followup).toISOString() : null }
            : {}),
        }),
      });
      await loadApplications();
      await loadApplicationEvents(application.id);
    }, "Application notes and follow-up saved.");
  }

  async function loadApplicationEvents(id: string) {
    const value = await request(`/api/admin/career/applications/${id}/events`, csrfToken);
    if (!Array.isArray(value) || !value.every((row) =>
      isRecord(row) && string(row.id) && string(row.at) && string(row.event) && isRecord(row.detail))) {
      throw new Error("The tracker returned invalid timeline data.");
    }
    setApplicationEvents(value as ApplicationEvent[]);
    setActiveApplication(id);
  }

  async function createApplication(job: CareerJob) {
    await runAction(async () => {
      await request("/api/admin/career/applications", csrfToken, {
        method: "POST",
        body: JSON.stringify({ job_id: job.id }),
      });
      await loadApplications();
      setTab("Tracker");
    }, "Job added to the application tracker.");
  }

  async function openPreparation(job: CareerJob) {
    setError("");
    setMessage("");
    setTab("Application drafts");
    setSelectedPreparationJobId(job.id);
    setPreparationJobs((current) => current.some((entry) => entry.id === job.id) ? current : [job, ...current].slice(0, 50));
    setActivePacket(null);
    setDraftResumeText("");
    setDraftCoverLetterText("");
    setDraftRecipientEmail("");
    setConfirmSendWarnings(false);
    setConfirmSendEligibility(false);
    try {
      const availableProfiles = await loadProfiles();
      const suggested = suggestedProfileForJob(job, availableProfiles);
      if (suggested) setSelectedPreparationProfileId(suggested.id);
      else setSelectedPreparationProfileId("");
      void loadApplicationPackets().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Application drafts could not be loaded."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The master CV profiles could not be loaded.");
    }
  }

  function applyPacketToEditor(packet: ApplicationPacket) {
    setActivePacket(packet);
    setSelectedPreparationJobId(packet.job_id);
    setSelectedPreparationProfileId(packet.source_profile_id);
    setDraftResumeText(packet.resume_text ?? "");
    setDraftCoverLetterText(packet.cover_letter_text ?? "");
    setDraftRecipientEmail(packet.recipient_email ?? "");
    setConfirmSendWarnings(false);
    setConfirmSendEligibility(false);
  }

  async function openPacket(packetId: string) {
    setError("");
    setMessage("");
    try {
      const value = await request(`/api/admin/career/application-packets/${packetId}`, csrfToken);
      if (!isApplicationPacket(value) || !string(value.resume_text) || !string(value.cover_letter_text)) {
        throw new Error("The application packet returned unexpected data. Refresh the list and try again.");
      }
      applyPacketToEditor(value);
      setTab("Application drafts");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The application draft could not be opened.");
    }
  }

  async function prepareSelectedJob() {
    if (!selectedPreparationJobId || !selectedPreparationProfileId) {
      setError("Choose a job and a master CV profile first.");
      return;
    }
    await runAction(async () => {
      const value = await request(`/api/admin/career/jobs/${selectedPreparationJobId}/prepare`, csrfToken, {
        method: "POST",
        body: JSON.stringify({ profile_id: selectedPreparationProfileId }),
      });
      if (!isApplicationPacket(value) || !string(value.resume_text) || !string(value.cover_letter_text)) {
        throw new Error("The application preparation service returned an invalid packet.");
      }
      applyPacketToEditor(value);
      await Promise.all([loadApplicationPackets(), loadApplications(), loadOverview()]);
    }, "Application draft generated from the selected master CV. Review every line before sending.");
  }

  async function savePacketDraft() {
    if (!activePacket) return;
    await runAction(async () => {
      const value = await request(`/api/admin/career/application-packets/${activePacket.id}`, csrfToken, {
        method: "PATCH",
        body: JSON.stringify({
          resume_text: draftResumeText,
          cover_letter_text: draftCoverLetterText,
          recipient_email: draftRecipientEmail,
        }),
      });
      if (!isApplicationPacket(value) || !string(value.resume_text) || !string(value.cover_letter_text)) {
        throw new Error("The saved application packet could not be reloaded.");
      }
      applyPacketToEditor(value);
      await loadApplicationPackets();
      await loadApplications();
      await loadOverview();
    }, "Saved a new reviewable version. Review the version number and warnings again before sending.");
  }

  async function connectGmail() {
    setGmailActionBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await request("/api/admin/career/gmail/oauth/start", csrfToken, {
        method: "POST",
        body: "{}",
      });
      if (!isRecord(value) || !string(value.authorization_url)) {
        throw new Error("The Gmail connection service returned an invalid authorization link.");
      }
      const target = new URL(value.authorization_url);
      if (target.origin !== "https://accounts.google.com" || target.pathname !== "/o/oauth2/v2/auth") {
        throw new Error("The Gmail authorization link failed the destination check.");
      }
      window.location.assign(target.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gmail could not be connected.");
      setGmailActionBusy(false);
    }
  }

  async function disconnectGmailAccount() {
    if (!window.confirm("Disconnect Gmail and revoke this app's saved send permission? This will stop email sending until you connect again.")) return;
    await runAction(async () => {
      await request("/api/admin/career/gmail/disconnect", csrfToken, { method: "POST", body: "{}" });
      const setupData = await request("/api/admin/career/setup", csrfToken);
      const parsedSetup = parseSetupStatus(setupData);
      if (parsedSetup) setSetup(parsedSetup);
    }, "Gmail disconnected and its grant revoked.");
  }

  async function sendApplicationPacket() {
    if (!activePacket) return;
    if (activePacketDirty) {
      setError("Save your latest CV, cover letter, and recipient first. The send action only uses a saved packet version.");
      return;
    }
    if (activePacket.status !== "ready_for_review") {
      setError("Save the packet to create a reviewable version before sending.");
      return;
    }
    if (!setup?.gmail?.connected || setup.JR_SEND_MODE !== "live") {
      setError("Gmail sending is not ready. Connect Gmail and have the server owner enable live sending after reviewing the setup checklist.");
      return;
    }
    if (!draftRecipientEmail.trim()) {
      setError("Enter the recipient email address exactly as shown on the employer's official advert.");
      return;
    }
    if ((activePacket.warnings.length > 0 || activePacket.missing_requirements.length > 0) && !confirmSendWarnings) {
      setError("Review the packet warnings and possible missing requirements, then explicitly acknowledge them before sending.");
      return;
    }
    if (activePacket.source_snapshot.eligibility === "unknown" && !confirmSendEligibility) {
      setError("Confirm you manually checked location and work-authorization eligibility before sending.");
      return;
    }
    if (activePacket.source_snapshot.eligibility === "ineligible") {
      setError("This advert failed the eligibility rules. Job Radar will not send it.");
      return;
    }
    if (!window.confirm(`Send application version ${activePacket.version} to ${draftRecipientEmail.trim()} from ${setup.gmail.email}? This sends an email with the saved CV and cover-letter PDFs. It cannot be recalled here.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await request(`/api/admin/career/application-packets/${activePacket.id}/send`, csrfToken, {
        method: "POST",
        body: JSON.stringify({
          reviewed_version: activePacket.version,
          recipient_email: draftRecipientEmail.trim(),
          confirm_send: true,
          confirm_warnings: confirmSendWarnings,
          confirm_eligibility: confirmSendEligibility,
        }),
      });
      if (!isApplicationPacket(value)) throw new Error("Gmail returned an unexpected application state. Check the packet and Gmail Sent before any retry.");
      applyPacketToEditor(value);
      setMessage("Gmail confirmed the application email was sent. The packet is locked to prevent a duplicate send.");
      await Promise.all([loadApplicationPackets(), loadApplications(), loadOverview(), loadRunHistory()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The email outcome could not be confirmed. Check Gmail Sent before retrying.");
      try {
        const latest = await request(`/api/admin/career/application-packets/${activePacket.id}`, csrfToken);
        if (isApplicationPacket(latest) && string(latest.resume_text) && string(latest.cover_letter_text)) applyPacketToEditor(latest);
        await loadApplicationPackets();
      } catch {
        // Keep the original send error visible if the refresh also fails.
      }
    } finally {
      setBusy(false);
    }
  }

  const activePacketDirty = Boolean(activePacket
    && (
      draftResumeText !== (activePacket.resume_text ?? "")
      || draftCoverLetterText !== (activePacket.cover_letter_text ?? "")
      || draftRecipientEmail !== (activePacket.recipient_email ?? "")
    ));
  const packetNeedsWarningAcknowledgement = Boolean(activePacket
    && (activePacket.warnings.length > 0 || activePacket.missing_requirements.length > 0));
  const packetNeedsEligibilityAcknowledgement = activePacket?.source_snapshot.eligibility === "unknown";
  const packetIsIneligible = activePacket?.source_snapshot.eligibility === "ineligible";
  const canSendPacket = Boolean(activePacket
    && activePacket.status === "ready_for_review"
    && !activePacketDirty
    && draftRecipientEmail.trim()
    && setup?.gmail?.connected
    && setup.JR_SEND_MODE === "live"
    && !packetIsIneligible
    && (!packetNeedsWarningAcknowledgement || confirmSendWarnings)
    && (!packetNeedsEligibilityAcknowledgement || confirmSendEligibility));

  const reviewJobs = reviewList === "Shortlist" ? overview?.shortlist ?? []
    : reviewList === "Maybe" ? overview?.maybe ?? []
      : reviewList === "Qualified" ? overview?.qualified ?? []
        : jobs;
  const filteredApplications = applications.filter((application) =>
    applicationFilter === "all" || application.state === applicationFilter);

  return (
    <section className="career-centre admin-panel" aria-labelledby="career-centre-title">
      <div className="admin-panel-heading career-heading">
        <div>
          <p className="eyebrow">PRIVATE CAREER WORKSPACE</p>
          <h2 id="career-centre-title">Career review centre</h2>
        </div>
        {overview ? <span className="career-review-badge" aria-label={`${overview.review_count} jobs needing review`}>{overview.review_count} to review</span> : null}
      </div>

      <div className="career-tabs" role="tablist" aria-label="Career centre sections">
        {careerTabs.map((name, index) => (
          <button
            aria-controls={`career-panel-${index}`}
            aria-selected={tab === name}
            className={tab === name ? "career-tab active" : "career-tab"}
            id={`career-tab-${index}`}
            key={name}
            onClick={() => changeTab(name)}
            onKeyDown={(event) => handleTabKey(event, index)}
            ref={(element) => { tabRefs.current[index] = element; }}
            role="tab"
            tabIndex={tab === name ? 0 : -1}
            type="button"
          >
            {careerTabLabels[name]}
            {name === "Overview" && overview?.review_count ? <span className="career-tab-count">{overview.review_count}</span> : null}
          </button>
        ))}
      </div>

      {error ? <p className="admin-message admin-error" role="alert">{error}</p> : null}
      {message ? <p className="admin-message" role="status">{message}</p> : null}
      {loading ? <p className="admin-notice" role="status">Loading private career data…</p> : null}

      <div
        aria-labelledby={`career-tab-${careerTabs.indexOf(tab)}`}
        className="career-panel"
        id={`career-panel-${careerTabs.indexOf(tab)}`}
        role="tabpanel"
        tabIndex={0}
      >
        {tab === "Overview" ? (
          <div className="career-stack">
            <div className="career-stat-grid">
              <article><span>LAST SUCCESSFUL SCAN</span><strong>{readableDate(overview?.last_success_at)}</strong></article>
              <article><span>NEW TODAY</span><strong>{overview?.new_jobs_count ?? 0}</strong></article>
              <article><span>DAILY SHORTLIST</span><strong>{overview?.shortlist_count ?? 0}</strong></article>
              <article><span>DRAFTS WAITING</span><strong>{overview?.drafts_waiting ?? 0}</strong></article>
            </div>
            {overview?.stale ? <p className="career-warning" role="status">No successful scan in the last 12 hours. Source results may be stale.</p> : null}
            <div className="career-actions">
              <button className="button button-primary" disabled={busy || scanStatus === "running"} onClick={() => void startScan()} type="button">
                {busy ? "Starting scan…" : scanStatus === "running" ? "Scan running…" : "Scan now"}
              </button>
              <button className="button button-quiet" disabled={busy} onClick={() => void runAction(loadOverview)} type="button">Refresh overview</button>
            </div>
            {scanStatus === "running" ? (
              <div className="career-scan-live" role="status" aria-live="polite">
                <span className="career-scan-spinner" aria-hidden="true" />
                <div><strong>Job scan in progress</strong><p>Sources are being checked and matching adverts are being assessed. This panel refreshes automatically.</p></div>
              </div>
            ) : null}
            {scanStatus === "succeeded" ? <p className="career-scan-result career-scan-success" role="status">Latest scan completed successfully.</p> : null}
            {["failed", "interrupted", "skipped"].includes(scanStatus) ? (
              <p className="career-scan-result career-scan-warning" role="status">Latest scan: {scanStatus}. Check source health and run history for details.</p>
            ) : null}
            {overview?.preparation_tables_configured === false ? (
              <p className="career-warning" role="status">
                Application drafts are not ready yet. Install the private preparation schema from <code>api/migrations/008_career_preparation.sql</code> in Supabase before generating CVs or cover letters.
              </p>
            ) : null}
            <section className="career-subpanel">
              <div className="career-review-heading">
                <div><h3>Recent scan activity</h3><p>{runHistory.length} recent runs · latest run first</p></div>
                <button className="text-link" disabled={busy} onClick={() => void runAction(async () => { await loadRunHistory(); }, "Scan history refreshed.")} type="button">Refresh history</button>
              </div>
              <p className="career-schedule-note">
                Automatic scans run every six hours only after the repository Actions secrets <code>CAREER_API_BASE_URL</code> and <code>JOB_CRON_SECRET</code> are configured, with the same <code>JOB_CRON_SECRET</code> on the API service. Use <strong>Scan now</strong> to start an immediate scan.
              </p>
              {runHistory.length ? (
                <ol className="career-run-list">
                  {runHistory.slice(0, 6).map((run) => {
                    const details = Object.entries(run.summary).filter(([, value]) => isRecord(value)).slice(0, 6);
                    return (
                      <li key={run.id}>
                        <div className="career-run-heading">
                          <strong>{run.trigger === "cron" ? "Scheduled scan" : "Manual scan"}</strong>
                          <span className={`career-run-state state-${run.status}`}>{run.status.replaceAll("_", " ")}</span>
                        </div>
                        <small>{readableDate(run.finished_at ?? run.started_at)}</small>
                        {details.length ? <p>{details.map(([source, detail]) => {
                          const result = detail as JsonRecord;
                          const info = string(result.error) ? "error"
                            : string(result.skipped_reason) ? `skipped: ${result.skipped_reason}`
                              : `${typeof result.new === "number" ? result.new : 0} new · ${typeof result.fetched === "number" ? result.fetched : 0} fetched`;
                          return `${source}: ${info}`;
                        }).join(" · ")}</p> : <p>No source-level diagnostics were recorded for this run.</p>}
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="admin-help">No scan runs have been recorded yet. Select Scan now to test your enabled sources.</p>}
            </section>
            <div className="career-two-columns">
              <section className="career-subpanel">
                <h3>Source health</h3>
                <SourceHealthList sources={overview?.sources ?? []} />
              </section>
              <section className="career-subpanel">
                <h3>Applications by state</h3>
                <div className="career-count-grid">
                  {Object.entries(overview?.applications_by_state ?? {}).map(([state, count]) => (
                    <div key={state}><span>{state.replaceAll("_", " ")}</span><strong>{count}</strong></div>
                  ))}
                </div>
              </section>
            </div>
            <section className="career-subpanel">
              <div className="career-review-heading">
                <div><h3>Jobs needing review</h3><p>{overview?.shortlist_count ?? 0} daily shortlist items · low-risk rule screening only; employer legitimacy is not verified</p></div>
                <button className="text-link" onClick={() => changeTab("Review")} type="button">Open review queue</button>
              </div>
              {overview?.shortlist.length ? (
                <ul className="career-overview-jobs">
                  {overview.shortlist.map((job) => {
                    const href = safeHttpUrl(job.url);
                    return <li key={job.id}>
                      <div><strong>{job.title}</strong><span>{job.location_text || job.remote_scope_text || "Location not specified"} · {job.assessment?.fit_score ?? "—"}/100 · risk: {isRecord(job.risk_assessment) ? string(job.risk_assessment.label) || "review required" : typeof job.risk_assessment === "string" ? job.risk_assessment : "not yet assessed"}</span></div>
                      {href ? <a href={href} rel="noopener noreferrer" target="_blank">{job.attribution_text}</a> : <span>{job.attribution_text}</span>}
                    </li>;
                  })}
                </ul>
              ) : <p className="admin-help">No jobs currently meet the shortlist threshold. The list is never padded.</p>}
            </section>
          </div>
        ) : null}

        {tab === "Review" ? (
          <div className="career-stack">
            <div className="career-subtabs" role="group" aria-label="Review queue">
              {reviewLists.map((name) => (
                <button aria-pressed={reviewList === name} className={reviewList === name ? "career-chip active" : "career-chip"} key={name} onClick={() => {
                  setReviewList(name);
                  setError("");
                  if (name === "Passed" || name === "Dismissed") {
                    void request(`/api/admin/career/jobs?status=${name === "Passed" ? "not_a_fit" : "duplicate"}&limit=50`, csrfToken)
                      .then((data) => setJobs(isRecord(data) && Array.isArray(data.jobs) ? data.jobs.filter(isCareerJob) : []))
                      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The review list could not be loaded."));
                  }
                }} type="button">{name}</button>
              ))}
            </div>
            {reviewList === "Maybe" ? <p className="career-warning">These listings need location or work-permission verification before any decision.</p> : null}
            {reviewJobs.length ? (
              <div className="career-job-list">
                {reviewJobs.map((job) => (
                  <CareerJobCard
                    busy={busy}
                    job={job}
                    key={job.id}
                    onApplication={() => void createApplication(job)}
                    onNotes={() => void openNotes(job)}
                    onPrepare={() => void openPreparation(job)}
                    onStatus={(status) => void updateJobStatus(job, status)}
                  />
                ))}
              </div>
            ) : <p className="admin-help">No jobs in this list yet. The shortlist is capped by your daily packet limit and is never padded.</p>}
          </div>
        ) : null}

        {tab === "Import" ? (
          <form className="career-form" onSubmit={(event) => void submitImport(event)}>
            <p className="admin-help">Paste a job advert or job-alert email text. The URL is stored as supplied and is not fetched.</p>
            <label htmlFor="career-import-title">Job title</label>
            <input id="career-import-title" maxLength={300} onChange={(event) => setImportForm({ ...importForm, title: event.target.value })} required value={importForm.title} />
            <label htmlFor="career-import-company">Company</label>
            <input id="career-import-company" maxLength={200} onChange={(event) => setImportForm({ ...importForm, company: event.target.value })} value={importForm.company} />
            <label htmlFor="career-import-url">Original listing URL <span>optional · HTTP(S); stored, never fetched</span></label>
            <input id="career-import-url" maxLength={2000} onChange={(event) => setImportForm({ ...importForm, url: event.target.value })} type="url" value={importForm.url} />
            <label htmlFor="career-import-text">Advert or alert text <span>plain text · max 6,000 characters</span></label>
            <textarea id="career-import-text" maxLength={6000} onChange={(event) => setImportForm({ ...importForm, text: event.target.value })} rows={8} value={importForm.text} />
            <button className="button button-primary" disabled={busy} type="submit">Import for review</button>
          </form>
        ) : null}

        {tab === "Resume profiles" ? (
          <div className="career-two-columns career-profile-layout">
            <form className="career-form" onSubmit={(event) => void saveProfile(event)}>
              <h3>{activeProfile ? "Edit verified profile" : "Create master profile"}</h3>
              <label htmlFor="career-profile-name">Profile name</label>
              <input id="career-profile-name" maxLength={120} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} required value={profileForm.name} />
              <label htmlFor="career-profile-track">Role track</label>
              <select id="career-profile-track" onChange={(event) => setProfileForm({ ...profileForm, track: event.target.value })} value={profileForm.track}>
                {availableTracks.map((track) => <option key={track} value={track}>{track}</option>)}
              </select>
              {!activeProfile ? (
                <>
                  <label htmlFor="career-profile-original">Master resume text <span>immutable after creation</span></label>
                  <textarea id="career-profile-original" maxLength={60000} onChange={(event) => setProfileForm({ ...profileForm, original_text: event.target.value })} required rows={7} value={profileForm.original_text} />
                </>
              ) : <p className="career-warning">Original resume text is immutable. Update only verified skills, tasks, and preferences below.</p>}
              <p className="admin-help">Add or remove individual entries. Keep every skill and task accurate and supported by your master resume before saving.</p>
              <CareerListEditor
                id="career-profile-required"
                label="Verified required skills"
                helper="Skills the scanner should treat as important"
                value={profileForm.requiredSkills}
                onChange={(value) => setProfileForm({ ...profileForm, requiredSkills: value })}
              />
              <CareerListEditor
                id="career-profile-tasks"
                label="Verified tasks"
                helper="Tasks and responsibilities already supported by your experience"
                value={profileForm.tasks}
                onChange={(value) => setProfileForm({ ...profileForm, tasks: value })}
              />
              <CareerListEditor
                id="career-profile-preferred"
                label="Preferred skills"
                helper="Additional skills that improve a role match"
                value={profileForm.preferredSkills}
                onChange={(value) => setProfileForm({ ...profileForm, preferredSkills: value })}
              />
              <div className="career-actions">
                <button className="button button-primary" disabled={busy} type="submit">{activeProfile ? "Save verified facts" : "Create profile"}</button>
                {activeProfile ? <button className="button button-quiet" onClick={() => { setActiveProfile(""); setProfileForm(emptyProfileForm); }} type="button">Cancel edit</button> : null}
              </div>
            </form>
            <section className="career-subpanel">
              <h3>Saved profiles</h3>
              {profiles.filter((profile) => !profile.archived_at).length ? profiles.filter((profile) => !profile.archived_at).map((profile) => (
                <article className="career-profile-row" key={profile.id}>
                  <div><strong>{profile.name}</strong><p>{profile.track}</p></div>
                  <div className="career-actions">
                    <button className="text-link" onClick={() => {
                      setActiveProfile(profile.id);
                      setProfileForm({
                        id: profile.id,
                        name: profile.name,
                        track: profile.track,
                        original_text: profile.original_text,
                        requiredSkills: valuesFromFacts(profile.verified_facts.required_skills).join(", "),
                        tasks: valuesFromFacts(profile.verified_facts.tasks).join(", "),
                        preferredSkills: valuesFromFacts(profile.verified_facts.preferred_skills).join(", "),
                      });
                    }} type="button">Edit verified facts</button>
                    <button className="text-link delete-action" disabled={busy} onClick={() => {
                      if (window.confirm(`Archive ${profile.name}?`)) void archiveProfile(profile.id);
                    }} type="button">Archive</button>
                  </div>
                </article>
              )) : <p className="admin-help">No active resume profiles. Add a verified master profile to improve fit assessments.</p>}
            </section>
          </div>
        ) : null}

        {tab === "Preferences" ? (
          <form className="career-form career-preferences" onSubmit={(event) => void saveSettings(event)}>
            <fieldset>
              <legend>Job titles and role tracks</legend>
              <p className="admin-help">Add the job titles you want the scanner to recognize. Keep your role titles specific; save up to 10.</p>
              {settings.role_tracks.map((track) => (
                <div className="career-role-track" key={track}>
                  <span>{track}</span>
                  <button className="text-link delete-action" disabled={settings.role_tracks.length <= 1} onClick={() => setSettings({
                    ...settings,
                    role_tracks: settings.role_tracks.filter((item) => item !== track),
                  })} type="button">Remove</button>
                </div>
              ))}
              <div className="career-add-role">
                <label htmlFor="career-new-role">Add a job title</label>
                <div className="career-inline-form">
                  <input id="career-new-role" maxLength={80} onChange={(event) => setNewRoleTrack(event.target.value)} placeholder="e.g. Junior SOC Analyst" value={newRoleTrack} />
                  <button className="button button-quiet" disabled={!newRoleTrack.trim() || settings.role_tracks.length >= 10} onClick={addRoleTrack} type="button">Add title</button>
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Priority countries</legend>
              {countries.map((country) => <label className="career-check" key={country}><input checked={settings.countries.includes(country)} onChange={(event) => setSettings({
                ...settings,
                countries: event.target.checked ? [...settings.countries, country] : settings.countries.filter((item) => item !== country),
              })} type="checkbox" />{country}</label>)}
            </fieldset>
            <label htmlFor="career-threshold">Fit score threshold: {settings.score_threshold}</label>
            <input id="career-threshold" max={100} min={0} onChange={(event) => setSettings({ ...settings, score_threshold: Number(event.target.value) })} type="range" value={settings.score_threshold} />
            <label htmlFor="career-excluded-keywords">Excluded keywords <span>comma-separated</span></label>
            <input id="career-excluded-keywords" onChange={(event) => setSettings({ ...settings, excluded_keywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} value={settings.excluded_keywords.join(", ")} />
            <label htmlFor="career-excluded-companies">Excluded companies <span>comma-separated</span></label>
            <input id="career-excluded-companies" onChange={(event) => setSettings({ ...settings, excluded_companies: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} value={settings.excluded_companies.join(", ")} />
            <div className="form-row">
              <div><label htmlFor="career-packet-cap">Daily shortlist cap</label><input id="career-packet-cap" max={5} min={1} onChange={(event) => setSettings({ ...settings, max_packets_per_day: Number(event.target.value) })} type="number" value={settings.max_packets_per_day} /></div>
              <div><label htmlFor="career-send-cap">Daily send cap <span>reserved for later phase</span></label><input id="career-send-cap" max={5} min={1} onChange={(event) => setSettings({ ...settings, max_sends_per_day: Number(event.target.value) })} type="number" value={settings.max_sends_per_day} /></div>
            </div>
            <label className="career-check"><input checked={settings.show_company_name} onChange={(event) => setSettings({ ...settings, show_company_name: event.target.checked })} type="checkbox" />Show company name in any future public view (off by default)</label>
            <p className="career-warning">Timezone is fixed to Africa/Nairobi. Public publishing remains disabled in this phase.</p>
            <button className="button button-primary" disabled={busy} type="submit">Save preferences</button>
          </form>
        ) : null}

        {tab === "Sources and Setup" ? (
          <div className="career-stack">
            <section className="career-subpanel">
              <h3>Environment setup checklist</h3>
              <p className="admin-help">Only configured / not configured is shown. Secret values are never read into this page.</p>
              <ul className="career-config-list">
                {secretNames.map((name) => <li key={name}><span>{name}</span><strong>{setup?.configuration[name]?.configured ? "Configured" : "Not configured"}</strong></li>)}
                <li><span>JR_SEND_MODE</span><strong>{setup?.JR_SEND_MODE ?? "draft"}</strong></li>
              </ul>
            </section>
            <section className="career-subpanel career-setup-connect">
              <h3>Application documents and email</h3>
              <p className="admin-help">This is private setup. The original master CV stays in your database. The sender permission is limited to Gmail sending.</p>
              <div className="career-setup-status-list">
                <div>
                  <span>Application draft database</span>
                  <strong className={setup?.preparationTables?.configured ? "setup-ready" : "setup-missing"}>
                    {setup?.preparationTables?.configured ? "Ready" : "Needs migration"}
                  </strong>
                </div>
                <div>
                  <span>Gmail sender</span>
                  <strong className={setup?.gmail?.connected ? "setup-ready" : "setup-missing"}>
                    {setup?.gmail?.connected ? "Connected" : "Not connected"}
                  </strong>
                </div>
                <div>
                  <span>Email sending mode</span>
                  <strong>{setup?.JR_SEND_MODE === "live" ? "Live" : "Safe draft mode"}</strong>
                </div>
              </div>
              {setup?.preparationTables?.configured === false ? (
                <p className="career-warning">First apply <code>api/migrations/008_career_preparation.sql</code> in Supabase SQL Editor. It creates only the new private application-packet and Gmail connection tables; it does not modify your master CV or admin account.</p>
              ) : null}
              {setup?.gmail?.connected ? (
                <>
                  <p className="career-gmail-connected">Connected sender: <strong>{setup.gmail.email}</strong> · permission: send email only.</p>
                  <button className="button button-quiet" disabled={busy || gmailActionBusy} onClick={() => void disconnectGmailAccount()} type="button">Disconnect and revoke Gmail</button>
                </>
              ) : (
                <button
                  className="button button-primary"
                  disabled={busy || gmailActionBusy
                    || setup?.preparationTables?.configured !== true
                    || !setup?.configuration.GMAIL_OAUTH_CLIENT_ID?.configured
                    || !setup?.configuration.GMAIL_OAUTH_CLIENT_SECRET?.configured
                    || !setup?.configuration.GMAIL_OAUTH_REDIRECT_URI?.configured
                    || !setup?.configuration.DOC_ENCRYPTION_KEY?.configured}
                  onClick={() => void connectGmail()}
                  type="button"
                >{gmailActionBusy ? "Opening Google…" : "Connect Gmail securely"}</button>
              )}
              {setup?.gmail?.connected && setup.JR_SEND_MODE !== "live" ? (
                <p className="career-warning">Gmail is connected, but sending is intentionally disabled. The server owner must set <code>JR_SEND_MODE=live</code> after the sender, quota, and test settings are verified.</p>
              ) : null}
              {setup?.preparationTables?.configured !== true ? (
                <p className="admin-help">After the migration is applied, return here and refresh this section. The new draft editor will become available automatically.</p>
              ) : null}
            </section>
            <section className="career-subpanel career-schedule-setup">
              <h3>Automatic scanning</h3>
              <p>GitHub Actions requests a scan four times per day: approximately 06:15, 12:15, 18:15 and 00:15 East Africa Time. Source-specific request caps may skip a source until its next allowed window.</p>
              <p className="career-warning">The schedule only runs when both GitHub Actions repository secrets are set and <code>JOB_CRON_SECRET</code> on the API service matches the Actions secret. The app cannot read GitHub’s secret values, so it cannot truthfully report that automation is active from this screen alone.</p>
              <ul>
                <li><code>CAREER_API_BASE_URL</code> — HTTPS origin of your deployed API service.</li>
                <li><code>JOB_CRON_SECRET</code> — the same random secret in GitHub Actions and the API service environment.</li>
              </ul>
              <div className="career-actions">
                <a className="button button-quiet" href="https://github.com/WestMorganOketch/morgan-portfolio/actions/workflows/career-radar-scheduled-scan.yml" rel="noopener noreferrer" target="_blank">Open scheduled scan workflow</a>
                <button className="button button-quiet" disabled={busy || scanStatus === "running"} onClick={() => void startScan()} type="button">Run scan now</button>
              </div>
            </section>
            <section className="career-subpanel">
              <h3>Sources</h3>
              <SourceHealthList sources={sources} />
            </section>
            <section className="career-subpanel">
              <h3>ATS watchlist</h3>
              <form className="career-inline-form" onSubmit={(event) => void saveWatchlist(event)}>
                <label htmlFor="career-watch-provider">Provider</label>
                <select id="career-watch-provider" onChange={(event) => setWatchForm({ ...watchForm, provider: event.target.value })} value={watchForm.provider}>
                  <option value="greenhouse">Greenhouse</option><option value="lever">Lever</option>
                </select>
                <label htmlFor="career-watch-token">Board token</label>
                <input id="career-watch-token" maxLength={60} minLength={2} onChange={(event) => setWatchForm({ ...watchForm, token: event.target.value })} pattern="[A-Za-z0-9_-]{2,60}" required value={watchForm.token} />
                <label htmlFor="career-watch-label">Employer label</label>
                <input id="career-watch-label" maxLength={120} onChange={(event) => setWatchForm({ ...watchForm, label: event.target.value })} required value={watchForm.label} />
                <button className="button button-primary" disabled={busy} type="submit">Add board</button>
              </form>
              {watchlist.map((entry) => <article className="career-profile-row" key={entry.id}>
                <span>{entry.label} · {entry.provider} · {entry.token} · {entry.enabled ? "enabled" : "disabled"}</span>
                <button className="text-link delete-action" disabled={busy} onClick={() => void deleteWatchlist(entry.id)} type="button">Remove</button>
              </article>)}
            </section>
            <section className="career-subpanel">
              <h3>Saved search links</h3>
              <div className="career-actions">
                {searchLinks.map((link) => {
                  const href = safeHttpUrl(link.url);
                  return href ? <a className="button button-quiet" href={href} key={link.name} rel="noopener noreferrer" target="_blank">{link.name}</a> : null;
                })}
              </div>
            </section>
          </div>
        ) : null}

        {tab === "Application drafts" ? (
          <div className="career-stack">
            <section className="career-subpanel">
              <div className="career-review-heading">
                <div>
                  <h3>Prepare an application</h3>
                  <p>Choose a job and a verified master CV. Job Radar prepares a draft; you review it before anything is sent.</p>
                </div>
              </div>
              {setup?.preparationTables?.configured === false ? (
                <p className="career-warning">
                  Draft generation is locked until the server owner applies <code>api/migrations/008_career_preparation.sql</code> in Supabase. No production database changes are made by this screen.
                </p>
              ) : null}
              <div className="career-two-columns career-preparation-choices">
                <div className="career-form">
                  <label htmlFor="career-prepare-job">Job advert</label>
                  <select id="career-prepare-job" onChange={(event) => setSelectedPreparationJobId(event.target.value)} value={selectedPreparationJobId}>
                    <option value="">Choose a reviewed job</option>
                    {preparationJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title} — {job.company ?? "Company not listed"} · {job.assessment?.fit_score ?? "—"}/100
                      </option>
                    ))}
                  </select>
                  <label htmlFor="career-prepare-profile">Master CV profile</label>
                  <select id="career-prepare-profile" onChange={(event) => setSelectedPreparationProfileId(event.target.value)} value={selectedPreparationProfileId}>
                    <option value="">Choose a saved master CV</option>
                    {profiles.filter((profile) => !profile.archived_at).map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name} — {profile.track}</option>
                    ))}
                  </select>
                  {profiles.filter((profile) => !profile.archived_at).length === 0 ? (
                    <p className="career-warning">You need a saved master CV first. Open Master CV to add your original CV and verified skills.</p>
                  ) : (
                    <p className="admin-help">Your master CV is not overwritten. The packet records which source profile was used and keeps the full original CV text intact.</p>
                  )}
                  <button
                    className="button button-primary"
                    disabled={busy || !selectedPreparationJobId || !selectedPreparationProfileId || setup?.preparationTables?.configured === false}
                    onClick={() => void prepareSelectedJob()}
                    type="button"
                  >Generate CV + cover letter draft</button>
                </div>
                <div className="career-subpanel career-preparation-explainer">
                  <h3>What happens next?</h3>
                  <ol>
                    <li>Job Radar reassesses the advert against the selected master CV.</li>
                    <li>It picks relevant lines from the original CV and records where each line came from.</li>
                    <li>It drafts a role-specific cover letter from the verified profile and match evidence.</li>
                    <li>You edit, save a new version, download PDFs, then explicitly approve any email send.</li>
                  </ol>
                  <p className="admin-help">No external AI receives your CV in this workflow. It uses local matching and a reviewable template so unsupported claims are not silently invented.</p>
                </div>
              </div>
            </section>

            <section className="career-subpanel">
              <div className="career-review-heading">
                <div><h3>Saved application packets</h3><p>{applicationPackets.length} latest versions · previous versions remain in the private audit trail</p></div>
                <button className="text-link" disabled={busy} onClick={() => void runAction(async () => { await Promise.all([loadApplicationPackets(), loadPreparationOptions()]); }, "Application drafts refreshed.")} type="button">Refresh drafts</button>
              </div>
              {applicationPackets.length ? (
                <div className="career-packet-list">
                  {applicationPackets.map((packet) => (
                    <article className="career-packet-row" key={packet.id}>
                      <div>
                        <strong>{packet.title}</strong>
                        <p>{packet.company ?? "Company not listed"} · {packet.location_text} · {packet.profile_name}</p>
                        <small>Version {packet.version} · Updated {readableDate(packet.updated_at)} · {packet.status.replaceAll("_", " ")}</small>
                      </div>
                      <div className="career-packet-actions">
                        {typeof packet.source_snapshot.assessmentScore === "number" ? <span className="career-packet-score">{packet.source_snapshot.assessmentScore}/100</span> : null}
                        <button className="button button-quiet" disabled={busy} onClick={() => void openPacket(packet.id)} type="button">Open draft</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="admin-help">No application packets yet. Open Find & review and choose Prepare application on a suitable advert.</p>}
            </section>

            {activePacket ? (
              <section className="career-subpanel career-packet-editor" aria-labelledby="career-packet-title">
                <div className="career-review-heading career-packet-editor-heading">
                  <div>
                    <p className="eyebrow">PRIVATE APPLICATION PACKET · VERSION {activePacket.version}</p>
                    <h3 id="career-packet-title">{activePacket.title}</h3>
                    <p>{activePacket.company ?? "Company not listed"} · {activePacket.location_text} · Master CV: {activePacket.profile_name}</p>
                  </div>
                  <span className={"career-packet-status status-" + activePacket.status}>{activePacket.status.replaceAll("_", " ")}</span>
                </div>
                <div className="career-packet-facts">
                  <div><span>FIT SCORE</span><strong>{typeof activePacket.source_snapshot.assessmentScore === "number" ? activePacket.source_snapshot.assessmentScore + "/100" : "Not scored"}</strong></div>
                  <div><span>ELIGIBILITY</span><strong>{String(activePacket.source_snapshot.eligibility ?? "unknown")}</strong></div>
                  <div><span>MASTER CV CHECK</span><strong>{activePacket.master_resume_sha256.slice(0, 12)}…</strong></div>
                </div>
                <p className="career-form-guide">
                  The original master CV must remain exactly intact in the full-CV section. You can edit the added role-aligned highlights and the cover letter; the server rejects a CV draft that removes or changes the complete original CV text.
                </p>
                {activePacket.warnings.length || activePacket.missing_requirements.length ? (
                  <div className="career-packet-warnings" role="status">
                    <h4>Review before applying</h4>
                    {activePacket.warnings.length ? <ul>{activePacket.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                    {activePacket.missing_requirements.length ? (
                      <>
                        <p><strong>Possible missing requirements — verify these; do not claim them unless true:</strong></p>
                        <ul>{activePacket.missing_requirements.map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    ) : null}
                  </div>
                ) : <p className="career-packet-success">No missing requirements were flagged by the current assessment. Still review the advert and every claim manually.</p>}

                {activePacket.highlights.length ? (
                  <details className="career-packet-evidence" open>
                    <summary>Where the tailored highlights came from ({activePacket.highlights.length} source lines)</summary>
                    <ol>
                      {activePacket.highlights.map((highlight, index) => (
                        <li key={highlight.sourceLine ?? index}>
                          <q>{highlight.text}</q>
                          <small>Master CV line {highlight.sourceLine ?? "—"} · matched: {(highlight.evidenceTerms ?? []).join(", ") || "No explicit keyword recorded"}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}

                <div className="career-actions career-packet-actions">
                  <a className="button button-quiet" href={"/api/admin/career/application-packets/" + activePacket.id + "/resume.pdf"}>Download CV PDF</a>
                  <a className="button button-quiet" href={"/api/admin/career/application-packets/" + activePacket.id + "/cover-letter.pdf"}>Download cover letter PDF</a>
                  {safeHttpUrl(activePacket.application_url) ? (
                    <a className="button button-quiet" href={safeHttpUrl(activePacket.application_url) ?? undefined} rel="noopener noreferrer" target="_blank">Open official advert</a>
                  ) : null}
                </div>
                {activePacket.status === "needs_manual_attention" ? (
                  <p className="career-warning" role="alert">The previous email outcome is uncertain. Check Gmail Sent and the application timeline before doing anything else. Job Radar has blocked another send to avoid a duplicate.</p>
                ) : null}
                {activePacket.status === "sent" ? (
                  <p className="career-packet-success" role="status">Gmail confirmed this packet was sent on {readableDate(activePacket.sent_at)}. This version is locked.</p>
                ) : null}

                <form className="career-form career-packet-form" onSubmit={(event) => { event.preventDefault(); void savePacketDraft(); }}>
                  <label htmlFor="career-packet-resume">CV draft <span>Keep the complete master CV below the role-aligned highlights · max 65,000 characters</span></label>
                  <textarea
                    id="career-packet-resume"
                    disabled={!["draft", "ready_for_review"].includes(activePacket.status)}
                    maxLength={65000}
                    onChange={(event) => { setDraftResumeText(event.target.value); setConfirmSendWarnings(false); setConfirmSendEligibility(false); }}
                    rows={16}
                    value={draftResumeText}
                  />
                  <label htmlFor="career-packet-cover-letter">Cover letter <span>Review and personalize the greeting, role, evidence and closing · max 12,000 characters</span></label>
                  <textarea
                    id="career-packet-cover-letter"
                    disabled={!["draft", "ready_for_review"].includes(activePacket.status)}
                    maxLength={12000}
                    onChange={(event) => { setDraftCoverLetterText(event.target.value); setConfirmSendWarnings(false); setConfirmSendEligibility(false); }}
                    rows={10}
                    value={draftCoverLetterText}
                  />
                  <label htmlFor="career-packet-recipient">Recruiter email <span>Enter only an email address confirmed on the employer’s official advert; Job Radar never guesses it.</span></label>
                  <input
                    id="career-packet-recipient"
                    disabled={!["draft", "ready_for_review"].includes(activePacket.status)}
                    maxLength={254}
                    onChange={(event) => { setDraftRecipientEmail(event.target.value); setConfirmSendWarnings(false); setConfirmSendEligibility(false); }}
                    type="email"
                    value={draftRecipientEmail}
                  />
                  {activePacket.status === "draft" || activePacket.status === "ready_for_review" ? (
                    <div className="career-actions">
                      <button className="button button-primary" disabled={busy} type="submit">
                        {activePacket.status === "ready_for_review" ? "Save new version for review" : "Save and mark ready for review"}
                      </button>
                      <span className="admin-help">{activePacketDirty ? "Unsaved changes — save a new version before sending." : "Only the saved version shown above can be sent."}</span>
                    </div>
                  ) : null}
                </form>

                {packetNeedsWarningAcknowledgement && ["draft", "ready_for_review"].includes(activePacket.status) ? (
                  <label className="career-acknowledgement">
                    <input checked={confirmSendWarnings} onChange={(event) => setConfirmSendWarnings(event.target.checked)} type="checkbox" />
                    I reviewed every warning and possible missing requirement, and I will not claim anything that I cannot verify.
                  </label>
                ) : null}
                {packetNeedsEligibilityAcknowledgement && ["draft", "ready_for_review"].includes(activePacket.status) ? (
                  <label className="career-acknowledgement">
                    <input checked={confirmSendEligibility} onChange={(event) => setConfirmSendEligibility(event.target.checked)} type="checkbox" />
                    I manually checked the employer's location and work-authorization requirements.
                  </label>
                ) : null}
                {packetIsIneligible ? (
                  <p className="career-warning">Automatic email sending is blocked because the current advert failed the eligibility rules. Review the original advert manually.</p>
                ) : null}
                {!setup?.gmail?.connected ? (
                  <p className="admin-help">Gmail is not connected. Open Sources & automation to configure and connect the send-only Gmail account.</p>
                ) : null}
                {setup?.gmail?.connected && setup.JR_SEND_MODE !== "live" ? (
                  <p className="career-warning">Gmail is connected, but the API is in safe draft mode. Sending remains disabled until the server owner deliberately enables JR_SEND_MODE=live.</p>
                ) : null}
                {activePacket.status === "ready_for_review" && setup?.gmail?.connected && setup.JR_SEND_MODE === "live" ? (
                  <button className="button button-primary career-send-final" disabled={busy || !canSendPacket} onClick={() => void sendApplicationPacket()} type="button">
                    {busy ? "Sending…" : "Review complete — send email"}
                  </button>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "Tracker" ? (
          <div className="career-stack">
            <p className="admin-help">Track each reviewed job, keep private notes, record follow-up dates, and inspect the event timeline. Application packets and confirmed email sends are managed in Application drafts.</p>
            <label className="career-filter-label" htmlFor="career-application-filter">Filter by application state
              <select id="career-application-filter" onChange={(event) => setApplicationFilter(event.target.value)} value={applicationFilter}>
                <option value="all">All states</option>
                {applicationStates.map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            {filteredApplications.length ? filteredApplications.map((application) => (
              <article className="career-application" key={application.id}>
                <div className="career-application-heading">
                  <div><h3>{application.title}</h3><p>{application.company ?? "Company not listed"} · {application.location_text} · {application.source_name}</p></div>
                  <label>State
                    <select onChange={(event) => void changeApplicationState(application, event.target.value)} value={application.state}>
                      {applicationStates.map((state) => <option disabled={state === "approved_to_send" || state === "sent"} key={state} value={state}>{state.replaceAll("_", " ")}{state === "approved_to_send" || state === "sent" ? " (Phase 6)" : ""}</option>)}
                    </select>
                  </label>
                </div>
                <div className="career-two-columns">
                  <div>
                    <label htmlFor={`application-notes-${application.id}`}>Private notes</label>
                    <textarea id={`application-notes-${application.id}`} maxLength={12000} onChange={(event) => setNotesByApplication({ ...notesByApplication, [application.id]: event.target.value })} rows={3} value={notesByApplication[application.id] ?? application.private_notes} />
                  </div>
                  <div>
                    <label htmlFor={`application-followup-${application.id}`}>Follow-up date</label>
                    <input id={`application-followup-${application.id}`} onChange={(event) => setFollowupsByApplication({ ...followupsByApplication, [application.id]: event.target.value })} type="datetime-local" value={followupsByApplication[application.id] ?? (application.followup_at ? application.followup_at.slice(0, 16) : "")} />
                    <div className="career-actions">
                      <button className="button button-quiet" disabled={busy} onClick={() => void saveApplicationDetails(application)} type="button">Save notes and follow-up</button>
                      <button className="text-link" onClick={() => void loadApplicationEvents(application.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Timeline could not be loaded."))} type="button">View timeline</button>
                    </div>
                  </div>
                </div>
                {activeApplication === application.id ? <ApplicationTimeline events={applicationEvents} /> : null}
              </article>
            )) : <p className="admin-help">{applications.length ? "No applications match this state." : "No applications in the tracker yet. Add a reviewed job from a job card."}</p>}
          </div>
        ) : null}
      </div>

      {noteTarget ? (
        <div className="career-modal-backdrop" role="presentation">
          <section aria-labelledby="career-note-title" aria-modal="true" className="career-note-modal" onKeyDown={(event) => {
            if (event.key === "Escape") setNoteTarget(null);
          }} role="dialog">
            <h3 id="career-note-title">Private job note</h3>
            <p>{noteTarget.title}</p>
            <form className="career-form" onSubmit={(event) => void saveJobNotes(event)}>
              <label htmlFor="career-job-note">Notes</label>
              <textarea autoFocus id="career-job-note" maxLength={12000} onChange={(event) => setNoteText(event.target.value)} rows={6} value={noteText} />
              <div className="career-actions">
                <button className="button button-primary" disabled={busy} type="submit">Save note</button>
                <button className="button button-quiet" onClick={() => setNoteTarget(null)} type="button">Cancel</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SourceHealthList({ sources }: { sources: SourceHealth[] }) {
  return sources.length ? (
    <div className="career-source-list">
      {sources.map((source) => (
        <article className="career-source" key={source.key}>
          <div>
            <strong>{source.name}</strong>
            <p>{source.enabled ? "Enabled" : "Disabled"} · {source.last_status ?? "not polled"} · {source.consecutive_failures} consecutive failures</p>
            <p>Every {Math.round(source.min_interval_seconds / 60)} min · {source.requests_today ?? 0}/{source.max_requests_per_day} requests today · {source.attribution_text}</p>
            <small>Last attempt: {readableDate(source.last_attempt_at)} · Last success: {readableDate(source.last_success_at)}</small>
          </div>
        </article>
      ))}
    </div>
  ) : <p className="admin-help">Source health is not available until the career tables are installed.</p>;
}

function CareerJobCard({
  job,
  busy,
  onStatus,
  onNotes,
  onApplication,
  onPrepare,
}: {
  job: CareerJob;
  busy: boolean;
  onStatus: (status: string) => void;
  onNotes: () => void;
  onApplication: () => void;
  onPrepare: () => void;
}) {
  const assessment = job.assessment;
  const externalUrl = safeHttpUrl(job.url);
  const breakdown = assessment?.fit_breakdown ?? {};
  const risk = isRecord(job.risk_assessment) ? job.risk_assessment as unknown as RiskAssessment : null;
  const breakdownItems = Object.entries(breakdown).flatMap(([label, value]) =>
    isRecord(value) && typeof value.weight === "number" && typeof value.points === "number"
      ? [{ label, points: value.points, weight: value.weight }]
      : []);
  return (
    <article className="career-job-card">
      <div className="career-job-head">
        <div>
          <p className="eyebrow">
            {externalUrl ? <a href={externalUrl} rel="noopener noreferrer" target="_blank">{job.attribution_text}</a> : job.attribution_text}
            {" · "}{job.source_key}
          </p>
          <h3>{job.title}</h3>
          <p>{job.company ?? "Company not listed"} · {job.location_text || job.remote_scope_text || "Location not specified"}</p>
          <small>Posted: {readableDate(job.posted_at)} · Attribution: {job.attribution_text}</small>
        </div>
        <div className="career-score"><strong>{assessment?.fit_score ?? "—"}</strong><span>FIT / 100</span></div>
      </div>
      {job.description_text ? <p className="career-advert-text">{job.description_text}</p> : null}
      {assessment ? (
        <div className="career-assessment-details">
          <p><strong>Eligibility:</strong> {assessment.eligibility}</p>
          <p><strong>Eligibility evidence:</strong> {assessment.eligibility_evidence.map((item) => item.phrase ?? item.rule ?? "").filter(Boolean).join("; ") || "No explicit phrase recorded."}</p>
          <p><strong>Risk:</strong> {risk?.label ?? (typeof job.risk_assessment === "string" ? job.risk_assessment : "not yet assessed")}</p>
          {risk?.risk_findings.length ? <ul className="career-risk-findings" aria-label="Advert risk indicators">{risk.risk_findings.map((finding) => <li key={finding.code}><strong>{finding.severity}:</strong> {finding.evidence}</li>)}</ul> : null}
          {risk?.unknowns.length ? <p><strong>Still to verify:</strong> {risk.unknowns.join(" ")}</p> : null}
          <p><strong>Matched:</strong> {assessment.matched.map((item) => item.value ?? item.phrase ?? "").filter(Boolean).join(", ") || "None recorded"}</p>
          <p><strong>Missing:</strong> {assessment.missing.map((item) => item.value ?? "").filter(Boolean).join(", ") || "None recorded"}</p>
          <p><strong>Reason codes:</strong> {assessment.reason_codes.join(", ") || "None"}</p>
          {assessment.uncertainty.length ? <p><strong>Uncertainty:</strong> {assessment.uncertainty.join(" ")}</p> : null}
          <details>
            <summary>Fit score breakdown</summary>
            <ul>{breakdownItems.map(({ label, points, weight }) => <li key={label}>{label.replaceAll("_", " ")}: {points} / {weight}</li>)}</ul>
          </details>
        </div>
      ) : <p className="career-warning">No fit assessment is available yet.</p>}
      <div className="career-actions">
        {externalUrl ? <a className="button button-quiet" href={externalUrl} rel="noopener noreferrer" target="_blank">Open original</a> : <span className="admin-help">No valid original link</span>}
        <button className="button button-quiet" disabled={busy} onClick={() => onStatus("shortlisted")} type="button">Shortlist</button>
        <button className="button button-quiet" disabled={busy} onClick={() => onStatus("not_a_fit")} type="button">Not a fit</button>
        <button className="button button-quiet" disabled={busy} onClick={() => onStatus("duplicate")} type="button">Mark duplicate</button>
        <button className="button button-primary" disabled={busy || risk?.risk_level === "high"} onClick={onPrepare} type="button">Prepare application</button>
        <button className="button button-quiet" disabled={busy} onClick={onNotes} type="button">Add notes</button>
        <button className="button button-quiet" disabled={busy} onClick={onApplication} type="button">Add to tracker</button>
      </div>
    </article>
  );
}

function ApplicationTimeline({ events }: { events: ApplicationEvent[] }) {
  return (
    <section className="career-timeline" aria-label="Application event timeline">
      <h4>Event timeline</h4>
      {events.length ? <ol>{events.map((event) => (
        <li key={event.id}>
          <time dateTime={event.at}>{readableDate(event.at)}</time>
          <strong>{event.event.replaceAll(".", " ").replaceAll("_", " ")}</strong>
          {Object.keys(event.detail).length ? <span>{Object.entries(event.detail).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`).join(" · ")}</span> : null}
        </li>
      ))}</ol> : <p className="admin-help">No timeline events have been recorded.</p>}
    </section>
  );
}
