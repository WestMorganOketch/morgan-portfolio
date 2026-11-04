"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, ArrowLeft, ExternalLink, Search, X } from "lucide-react";

type JsonRecord = Record<string, unknown>;
type Eligibility = "eligible" | "unknown" | "ineligible";
type Assessment = {
  eligibility: Eligibility;
  eligibility_evidence: { phrase?: string; rule?: string }[];
  fit_score: number;
  fit_breakdown: JsonRecord;
  matched: { type?: string; value?: string; phrase?: string }[];
  missing: { type?: string; value?: string }[];
  reason_codes: string[];
  uncertainty: string[];
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
  tags?: string[];
  salary_text?: string | null;
  status: string;
  assessment: Assessment | null;
  risk_assessment?: string;
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
  docs_url?: string | null;
  auth_type?: string;
  notes?: string | null;
};
type Overview = {
  last_success_at: string | null;
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
  updated_at?: string | null;
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
  created_at?: string;
  updated_at?: string;
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
  updated_at?: string | null;
};
type SetupStatus = {
  configuration: Record<string, { configured: boolean }>;
  JR_SEND_MODE: "draft" | "live";
  tables?: { configured: boolean; missing: string[] };
  intakeTables?: { configured: boolean; missing: string[] };
  assessmentTables?: { configured: boolean; missing: string[] };
};
type WatchlistEntry = { id: string; provider: "greenhouse" | "lever"; token: string; label: string; enabled: boolean };
type SearchLink = { name: string; url: string };
type CareerRun = {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: JsonRecord;
};

const applicationTransitions: Record<string, string[]> = {
  discovered: ["screened", "match_review", "shortlisted", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"],
  screened: ["match_review", "shortlisted", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"],
  match_review: ["screened", "shortlisted", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"],
  shortlisted: ["match_review", "preparation_in_progress", "not_a_fit", "duplicate", "expired", "withdrawn", "needs_manual_attention"],
  preparation_in_progress: ["shortlisted", "ready_for_review", "not_a_fit", "expired", "withdrawn", "needs_manual_attention"],
  ready_for_review: ["shortlisted", "preparation_in_progress", "submitted", "not_a_fit", "expired", "withdrawn", "needs_manual_attention"],
  failed_send: ["preparation_in_progress", "ready_for_review", "withdrawn", "needs_manual_attention"],
  submitted: ["withdrawn", "needs_manual_attention", "expired"],
  blocked_risk: ["not_a_fit", "needs_manual_attention"],
  not_a_fit: ["match_review", "withdrawn"],
  duplicate: ["withdrawn"],
  expired: ["match_review", "withdrawn"],
  withdrawn: ["match_review"],
  needs_manual_attention: ["match_review", "shortlisted", "not_a_fit", "withdrawn"],
};
const applicationStages = [
  { name: "To review", states: ["discovered", "screened", "match_review", "needs_manual_attention"] },
  { name: "Shortlisted", states: ["shortlisted"] },
  { name: "Preparing", states: ["preparation_in_progress", "failed_send"] },
  { name: "Ready to send", states: ["ready_for_review", "approved_to_send"] },
  { name: "Applied", states: ["sent", "submitted"] },
  { name: "Closed", states: ["expired", "duplicate", "blocked_risk", "not_a_fit", "withdrawn"] },
] as const;
const integrationEnvironment: Record<string, string[]> = {
  jooble: ["JOOBLE_API_KEY"],
  careerjet: ["CAREERJET_API_KEY"],
  reliefweb: ["RELIEFWEB_APPNAME"],
};
const integrationDescriptions: Record<string, string> = {
  jooble: "Search listings through Jooble.",
  careerjet: "Search listings through Careerjet.",
  reliefweb: "Search humanitarian and development opportunities through ReliefWeb.",
  arbeitnow: "Read public listings from the Arbeitnow feed.",
  jobicy: "Search remote listings through Jobicy.",
  remotive: "Search remote listings through Remotive.",
  remoteok: "Read listings from the Remote OK feed.",
  ats_watchlist: "Check configured employer boards for matching job listings.",
  manual_import: "Add a listing manually using Add a job.",
};

const careerTabs = [
  { value: "Overview", label: "Today" },
  { value: "Review", label: "Review" },
  { value: "Import", label: "Add a job" },
  { value: "Tracker", label: "Pipeline" },
  { value: "Resume profiles", label: "My resume" },
  { value: "Preferences", label: "Preferences" },
  { value: "Sources and Setup", label: "Sources & setup" },
] as const;
type CareerTab = (typeof careerTabs)[number]["value"];
const reviewLists = ["Shortlist", "Maybe", "Qualified", "Flagged", "Dismissed"] as const;
type ReviewList = (typeof reviewLists)[number];
const applicationStates = [
  "discovered", "screened", "match_review", "shortlisted", "preparation_in_progress",
  "ready_for_review", "approved_to_send", "sent", "failed_send", "submitted",
  "expired", "duplicate", "blocked_risk", "not_a_fit", "withdrawn", "needs_manual_attention",
];
const applicationStateLabels: Record<string, string> = {
  discovered: "Found",
  screened: "Reviewed",
  match_review: "Needs a match check",
  shortlisted: "Shortlisted",
  preparation_in_progress: "Preparing",
  ready_for_review: "Ready for review",
  approved_to_send: "Approved",
  sent: "Sent",
  failed_send: "Send failed",
  submitted: "Submitted",
  expired: "Expired",
  duplicate: "Duplicate",
  blocked_risk: "Blocked for risk",
  not_a_fit: "Not a fit",
  withdrawn: "Withdrawn",
  needs_manual_attention: "Needs attention",
};
const tracks = ["Security Analyst/SOC", "Computer Skills/ICT Trainer"];
const countries = ["Kenya", "Tanzania", "Uganda"];
const secretNames = [
  "JOB_CRON_SECRET", "DOC_ENCRYPTION_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD",
  "GEMINI_API_KEY", "JOOBLE_API_KEY", "CAREERJET_API_KEY", "RELIEFWEB_APPNAME",
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

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: string | null): string | null {
  const href = safeHttpUrl(value);
  return href?.startsWith("https://") ? href : null;
}

function readableDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function nairobiDay(value: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function readableLabel(value: string): string {
  return value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function valuesFromFacts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(string) : [];
}

function EmptyState({
  title,
  children,
  actions,
}: {
  title: string;
  children: string;
  actions: { label: string; onClick: () => void; secondary?: boolean; disabled?: boolean }[];
}) {
  return (
    <div className="career-empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      <div className="career-actions">
        {actions.map((action) => (
          <button
            className={action.secondary ? "button button-secondary" : "button button-primary"}
            disabled={action.disabled}
            key={action.label}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
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
  const [reviewSort, setReviewSort] = useState<"best" | "newest">("best");
  const [reviewSearch, setReviewSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [mobileReviewDetail, setMobileReviewDetail] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [jobs, setJobs] = useState<CareerJob[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [searchLinks, setSearchLinks] = useState<SearchLink[]>([]);
  const [sourceRuns, setSourceRuns] = useState<CareerRun[]>([]);
  const [pipelineView, setPipelineView] = useState<"table" | "board">("table");
  const [checklistCollapsed, setChecklistCollapsed] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [toast, setToast] = useState("");
  const [todayDataLoaded, setTodayDataLoaded] = useState(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationFilter, setApplicationFilter] = useState("all");
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
  const [scanStatus, setScanStatus] = useState<"idle" | "running" | "succeeded" | "failed" | "interrupted" | "skipped">("idle");
  const [scanRunId, setScanRunId] = useState<string | null>(null);
  const [newRoleTrack, setNewRoleTrack] = useState("");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedJobButton = useRef<HTMLButtonElement | null>(null);
  const availableTracks = [...new Set([...tracks, ...settings.role_tracks])];

  const loadOverview = useCallback(async () => {
    const value = await request("/api/admin/career/overview", csrfToken);
    if (!isOverview(value) || !value.sources.every(isSource)) throw new Error("The career service returned unexpected overview data.");
    setOverview(value);
  }, [csrfToken]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
        const current = (scanRunId ? rows.find((row) => row.id === scanRunId) : null) ?? rows[0];
        if (!current || !string(current.status) || !active) return;
        if (current.status === "running") return;
        if (["succeeded", "failed", "interrupted", "skipped"].includes(current.status)) {
          const finalStatus = current.status as "succeeded" | "failed" | "interrupted" | "skipped";
          setScanStatus(finalStatus);
          await loadOverview();
          if (!active) return;
          setToast(finalStatus === "succeeded"
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
    const statuses = reviewList === "Flagged" ? ["flagged"] : ["duplicate"];
    const responses = await Promise.all(statuses.map((status) =>
      request(`/api/admin/career/jobs?status=${status}&limit=50`, csrfToken)));
    const found = responses.flatMap((data) => isRecord(data) && Array.isArray(data.jobs) ? data.jobs.filter(isCareerJob) : []);
    setJobs(found);
  }, [csrfToken, loadOverview, overview, reviewList]);

  const loadProfiles = useCallback(async () => {
    const value = await request("/api/admin/career/resume-profiles", csrfToken);
    if (!Array.isArray(value) || !value.every(isProfile)) throw new Error("The career service returned unexpected profile data.");
    setProfiles(value);
  }, [csrfToken]);

  const loadSources = useCallback(async () => {
    const [sourceData, setupData, watchData, linkData, runData] = await Promise.all([
      request("/api/admin/career/sources", csrfToken),
      request("/api/admin/career/setup", csrfToken),
      request("/api/admin/career/watchlist", csrfToken),
      request("/api/admin/career/search-links", csrfToken),
      request("/api/admin/career/runs", csrfToken),
    ]);
    if (!Array.isArray(sourceData) || !sourceData.every(isSource)) throw new Error("The career service returned unexpected source data.");
    if (!isRecord(setupData) || !isRecord(setupData.configuration)) throw new Error("The setup status could not be read.");
    if (!Array.isArray(watchData) || !Array.isArray(linkData)) throw new Error("The source tools returned unexpected data.");
    setSources(sourceData);
    setSetup({
      configuration: Object.fromEntries(
        Object.entries(setupData.configuration).map(([name, value]) => [
          name,
          { configured: isRecord(value) && value.configured === true },
        ]),
      ),
      JR_SEND_MODE: setupData.JR_SEND_MODE === "live" ? "live" : "draft",
      ...(isRecord(setupData.tables) && Array.isArray(setupData.tables.missing)
        ? { tables: { configured: setupData.tables.configured === true, missing: setupData.tables.missing.filter(string) } } : {}),
      ...(isRecord(setupData.intakeTables) && Array.isArray(setupData.intakeTables.missing)
        ? { intakeTables: { configured: setupData.intakeTables.configured === true, missing: setupData.intakeTables.missing.filter(string) } } : {}),
      ...(isRecord(setupData.assessmentTables) && Array.isArray(setupData.assessmentTables.missing)
        ? { assessmentTables: { configured: setupData.assessmentTables.configured === true, missing: setupData.assessmentTables.missing.filter(string) } } : {}),
    });
    if (!Array.isArray(runData)) throw new Error("Run history returned unexpected data.");
    setSourceRuns(runData.filter((row): row is CareerRun =>
      isRecord(row) && string(row.id) && string(row.trigger) && string(row.status)
      && string(row.started_at) && (row.finished_at === null || string(row.finished_at))
      && isRecord(row.summary)));
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

  const loadTodayData = useCallback(async () => {
    const [applicationData, profileData, settingsData] = await Promise.all([
      request("/api/admin/career/applications", csrfToken),
      request("/api/admin/career/resume-profiles", csrfToken),
      request("/api/admin/career/settings", csrfToken),
    ]);
    if (!Array.isArray(applicationData) || !applicationData.every(isApplication)) throw new Error("The career service returned unexpected application data.");
    if (!Array.isArray(profileData) || !profileData.every(isProfile)) throw new Error("The career service returned unexpected profile data.");
    if (!isRecord(settingsData)) throw new Error("The career service returned unexpected preferences.");
    setApplications(applicationData);
    setProfiles(profileData);
    setSettings({
      ...emptySettings,
      role_tracks: Array.isArray(settingsData.role_tracks) ? settingsData.role_tracks.filter(string) : emptySettings.role_tracks,
      countries: Array.isArray(settingsData.countries) ? settingsData.countries.filter(string) : emptySettings.countries,
      score_threshold: typeof settingsData.score_threshold === "number" ? settingsData.score_threshold : emptySettings.score_threshold,
      max_packets_per_day: typeof settingsData.max_packets_per_day === "number" ? settingsData.max_packets_per_day : emptySettings.max_packets_per_day,
      max_sends_per_day: typeof settingsData.max_sends_per_day === "number" ? settingsData.max_sends_per_day : emptySettings.max_sends_per_day,
      show_company_name: settingsData.show_company_name === true,
    });
    try {
      setPreferencesSaved(window.localStorage.getItem("jr-preferences-saved") === "1");
    } catch {
      setError("Saved preference checklist progress could not be read in this browser.");
    }
    setTodayDataLoaded(true);
  }, [csrfToken]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const initialize = async () => {
        try {
          await loadOverview();
          try {
            const runData = await request("/api/admin/career/runs", csrfToken);
            if (active && Array.isArray(runData)) {
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
      if (tab === "Overview" && !todayDataLoaded) void loadTodayData().catch((cause: unknown) => reportError(cause, "Today’s workspace data could not be loaded."));
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
            updated_at: string(value.updated_at) ? value.updated_at : null,
          });
        }).catch((cause: unknown) => reportError(cause, "Preferences could not be loaded."));
      }
      if (tab === "Sources and Setup") void loadSources().catch((cause: unknown) => reportError(cause, "Source settings could not be loaded."));
      if (tab === "Tracker") void loadApplications().catch((cause: unknown) => reportError(cause, "Applications could not be loaded."));
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [csrfToken, loadApplications, loadProfiles, loadReview, loadSources, loadTodayData, tab, todayDataLoaded]);

  const runAction = useCallback(async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError("");
    setToast("");
    try {
      await action();
      if (success) setToast(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }, []);

  async function startScan() {
    setBusy(true);
    setError("");
    setToast("");
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
      setToast(result.status === "already_running"
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
    if (focus) tabRefs.current[careerTabs.findIndex((item) => item.value === next)]?.focus();
  }

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : careerTabs.length - 1;
      changeTab(careerTabs[next].value, true);
      return;
    }
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = (index + offset + careerTabs.length) % careerTabs.length;
    changeTab(careerTabs[next].value, true);
  }

  const updateJobStatus = useCallback(async (job: CareerJob, status: string) => {
    await runAction(async () => {
      await request(`/api/admin/career/jobs/${job.id}/status`, csrfToken, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadOverview();
      await loadReview();
    }, "Review status updated.");
  }, [csrfToken, loadOverview, loadReview, runAction]);

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
      setPreferencesSaved(true);
      try {
        window.localStorage.setItem("jr-preferences-saved", "1");
      } catch {
        setError("Preferences were saved, but this browser could not retain checklist progress.");
      }
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

  const reviewJobs = reviewList === "Shortlist" ? overview?.shortlist ?? []
    : reviewList === "Maybe" ? overview?.maybe ?? []
      : reviewList === "Qualified" ? overview?.qualified ?? []
        : jobs;
  const visibleReviewJobs = reviewJobs
    .filter((job) => `${job.title} ${job.company ?? ""} ${job.source_name} ${job.location_text}`.toLowerCase().includes(reviewSearch.toLowerCase()))
    .sort((a, b) => reviewSort === "best"
      ? (b.assessment?.fit_score ?? -1) - (a.assessment?.fit_score ?? -1)
      : new Date(b.posted_at ?? b.first_seen_at).getTime() - new Date(a.posted_at ?? a.first_seen_at).getTime());
  const selectedJob = visibleReviewJobs.find((job) => job.id === selectedJobId) ?? visibleReviewJobs[0] ?? null;
  const filteredApplications = applications.filter((application) =>
    applicationFilter === "all" || application.state === applicationFilter);
  const now = new Date();
  const followupsDue = applications.filter((application) =>
    application.followup_at && new Date(application.followup_at) <= now
    && !["submitted", "sent", "expired", "duplicate", "not_a_fit", "withdrawn"].includes(application.state));
  const nairobiDate = nairobiDay(now);
  const preparedToday = applications.filter((application) =>
    ["preparation_in_progress", "ready_for_review"].includes(application.state)
    && application.updated_at
    && !Number.isNaN(new Date(application.updated_at).getTime())
    && nairobiDay(new Date(application.updated_at)) === nairobiDate).length;
  const reviewedCount = Object.entries(overview?.job_counts ?? {})
    .filter(([state]) => ["screened", "match_review", "shortlisted", "not_a_fit", "duplicate"].includes(state))
    .reduce((sum, [, count]) => sum + (typeof count === "number" ? count : 0), 0);
  const checklist = [
    { label: "Add a resume", complete: profiles.some((profile) => !profile.archived_at) },
    { label: "Save preferences", complete: preferencesSaved },
    { label: "Run your first scan", complete: Boolean(overview?.last_success_at) },
    { label: "Review your first job", complete: reviewedCount > 0 },
    { label: "Add a job to Pipeline", complete: applications.length > 0 },
  ];
  const checklistComplete = checklist.every((item) => item.complete);
  const nextAction = !profiles.some((profile) => !profile.archived_at)
    ? { title: "Add your resume", tab: "Resume profiles" as CareerTab, count: null }
    : overview?.stale || !overview?.last_success_at
      ? { title: "Scan now", tab: "Overview" as CareerTab, count: null }
      : overview.review_count > 0
        ? { title: `${overview.review_count} ${overview.review_count === 1 ? "job" : "jobs"} to review`, tab: "Review" as CareerTab, count: overview.review_count }
        : followupsDue.length > 0
          ? { title: `${followupsDue.length} follow-up${followupsDue.length === 1 ? "" : "s"} due`, tab: "Tracker" as CareerTab, count: followupsDue.length }
          : { title: "You're all caught up", tab: "Overview" as CareerTab, count: null };

  const careerTabIndex = careerTabs.findIndex((item) => item.value === tab);
  const totalJobs = Object.values(overview?.job_counts ?? {}).reduce(
    (total, count) => total + (typeof count === "number" ? count : 0),
    0,
  );

  useEffect(() => {
    if (tab !== "Review") return;
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape" && mobileReviewDetail) {
        setMobileReviewDetail(false);
        return;
      }
      if (!visibleReviewJobs.length) return;
      const selectedIndex = Math.max(0, visibleReviewJobs.findIndex((job) => job.id === (selectedJob?.id ?? "")));
      const direction = event.key.toLowerCase() === "j" ? 1 : event.key.toLowerCase() === "k" ? -1 : 0;
      if (direction) {
        event.preventDefault();
        const next = (selectedIndex + direction + visibleReviewJobs.length) % visibleReviewJobs.length;
        setSelectedJobId(visibleReviewJobs[next].id);
        setMobileReviewDetail(true);
      } else if (selectedJob && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void updateJobStatus(selectedJob, "shortlisted");
      } else if (selectedJob && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void updateJobStatus(selectedJob, "not_a_fit");
      } else if (selectedJob && event.key.toLowerCase() === "o") {
        const href = safeHttpsUrl(selectedJob.url);
        if (href) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
        }
      } else if (event.key === "?") {
        setToast("Review shortcuts: j/k next or previous, s shortlist, n not a fit, o open original.");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [mobileReviewDetail, selectedJob, tab, updateJobStatus, visibleReviewJobs]);

  return (
    <section className="career-centre admin-panel" aria-label="Job Radar workspace">

      <div className="career-tabs" role="tablist" aria-label="Career centre sections">
        {careerTabs.map(({ value, label }, index) => (
          <button
            aria-controls={`career-panel-${index}`}
            aria-selected={tab === value}
            className={tab === value ? "career-tab active" : "career-tab"}
            id={`career-tab-${index}`}
            key={value}
            onClick={() => changeTab(value)}
            onKeyDown={(event) => handleTabKey(event, index)}
            ref={(element) => { tabRefs.current[index] = element; }}
            role="tab"
            tabIndex={tab === value ? 0 : -1}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="admin-message admin-error" role="alert">{error}</p> : null}
      {toast ? <p className="career-toast" role="status" aria-live="polite">{toast}</p> : null}
      {loading ? <div aria-label="Loading private career workspace" className="career-skeleton-grid" role="status">
        <span className="career-skeleton" /><span className="career-skeleton" /><span className="career-skeleton" />
      </div> : null}
      {overview ? (
        <p className="career-review-badge" aria-label={`${overview.review_count} jobs to review`}>
          {overview.review_count} {overview.review_count === 1 ? "job" : "jobs"} to review
        </p>
      ) : null}

      <div
        aria-labelledby={`career-tab-${careerTabIndex}`}
        className="career-panel"
        id={`career-panel-${careerTabIndex}`}
        role="tabpanel"
        tabIndex={0}
      >
        {tab === "Overview" ? (
          <div className="career-stack">
            <section className="career-next-action" aria-labelledby="career-next-action-title">
              <span className="career-eyebrow">NEXT BEST ACTION</span>
              <h2 id="career-next-action-title">{todayDataLoaded ? nextAction.title : "Loading your next step…"}</h2>
              <p>{!todayDataLoaded
                ? "Checking your resume, scan, review queue, and follow-ups."
                : nextAction.tab === "Overview"
                  ? overview?.stale || !overview?.last_success_at
                    ? "Refresh your job listings to see what is new."
                    : "Your jobs and follow-ups are up to date."
                  : nextAction.tab === "Resume profiles"
                    ? "Add a resume profile to personalize job matches."
                    : nextAction.tab === "Review"
                      ? "Open the review queue to decide what belongs in your pipeline."
                      : "Open your pipeline to handle the follow-ups that are due."}</p>
              <button
                className="button button-primary"
                disabled={!todayDataLoaded || busy}
                onClick={() => {
                  if (nextAction.tab === "Overview" && nextAction.title === "Scan now") void startScan();
                  else changeTab(nextAction.tab);
                }}
                type="button"
              >
                {nextAction.tab === "Overview" && nextAction.title === "Scan now" ? "Scan now" : nextAction.tab === "Overview" ? "View today" : nextAction.title.startsWith("You're") ? "View today" : "Continue"}
              </button>
            </section>
            <section className={`career-checklist ${checklistComplete ? "complete" : ""}`} aria-labelledby="career-checklist-title">
              <div className="career-checklist-heading">
                <div><h3 id="career-checklist-title">{checklistComplete ? "You're all set" : "Getting started"}</h3><p>{checklist.filter((item) => item.complete).length} of {checklist.length} steps complete</p></div>
                <button aria-expanded={!checklistCollapsed} className="button button-ghost" onClick={() => setChecklistCollapsed(!checklistCollapsed)} type="button">
                  {checklistCollapsed ? "Show checklist" : "Hide checklist"}
                </button>
              </div>
              <div aria-label={`${checklist.filter((item) => item.complete).length} of ${checklist.length} steps complete`} className="career-progress-track" role="progressbar" aria-valuemax={checklist.length} aria-valuemin={0} aria-valuenow={checklist.filter((item) => item.complete).length}>
                <span style={{ width: `${checklist.filter((item) => item.complete).length / checklist.length * 100}%` }} />
              </div>
              {!checklistCollapsed ? (
                <ol className="career-checklist-items">
                  {checklist.map((item) => <li className={item.complete ? "complete" : ""} key={item.label}>
                    <span aria-hidden="true">{item.complete ? "✓" : "○"}</span>{item.label}
                  </li>)}
                </ol>
              ) : null}
            </section>
            <div className="career-stat-grid">
              <article><span>LAST SCAN</span><strong>{overview?.last_success_at ? readableDate(overview.last_success_at) : "Never run"}</strong></article>
              <article><span>JOBS TO REVIEW</span><strong>{overview?.review_count ?? 0}</strong></article>
              <article className="career-cap-tile">
                <span>PREPARED TODAY</span>
                <div aria-label={`${preparedToday} of ${settings.max_sends_per_day} prepared today`} className="career-progress-ring" title="Current applications in preparation or ready for review, updated today in Nairobi time." style={{ "--progress": `${Math.min(100, preparedToday / Math.max(1, settings.max_sends_per_day) * 100)}%` } as CSSProperties}>
                  <strong>{preparedToday}<small> / {settings.max_sends_per_day}</small></strong>
                </div>
                <small>{preparedToday} of {settings.max_sends_per_day} prepared today · daily cap</small>
                <small>Counts current preparation or ready-for-review records updated today in Nairobi time.</small>
              </article>
              <article><span>FOLLOW-UPS DUE</span><strong>{followupsDue.length}</strong></article>
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
              <p className="career-scan-result career-scan-warning" role="status">The latest scan {scanStatus === "failed" ? "failed" : scanStatus === "interrupted" ? "was interrupted" : "was skipped"}. Check source health and run history for details.</p>
            ) : null}
            <div className="career-two-columns">
              <section className="career-subpanel">
                <h3>Source health</h3>
                <div className="career-source-dots" aria-label="Job source status">
                  {(overview?.sources ?? []).map((source) => {
                    const needsAttention = source.consecutive_failures > 0 || source.last_status === "failed";
                    const configured = source.enabled && !needsAttention;
                    const status = needsAttention ? "Needs attention" : configured ? "Configured" : "Not configured";
                    return <span className={`career-source-dot ${needsAttention ? "warning" : configured ? "success" : "muted"}`} key={source.key}>
                      <i aria-hidden="true" />{source.name}: {status}
                    </span>;
                  })}
                </div>
                <details className="career-source-details">
                  <summary>Details</summary>
                  <SourceHealthList sources={overview?.sources ?? []} onOpenSetup={() => changeTab("Sources and Setup")} />
                </details>
              </section>
              <section className="career-subpanel">
                <h3>Applications by stage</h3>
                {Object.keys(overview?.applications_by_state ?? {}).length ? (
                  <div className="career-count-grid">
                    {Object.entries(overview?.applications_by_state ?? {}).map(([state, count]) => (
                      <div key={state}><span>{applicationStateLabels[state] ?? "Other"}</span><strong>{count}</strong></div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No applications yet"
                    actions={[{ label: "Go to Pipeline", onClick: () => changeTab("Tracker") }]}
                  >
                    Add a reviewed listing to start tracking applications.
                  </EmptyState>
                )}
              </section>
            </div>
            {overview && totalJobs === 0 ? (
              <section className="career-subpanel">
                <EmptyState
                  title="No jobs yet"
                  actions={[
                    { label: "Scan now", onClick: () => void startScan(), disabled: busy || scanStatus === "running" },
                    { label: "Add a job", onClick: () => changeTab("Import"), secondary: true },
                  ]}
                >
                  Run a scan or add a listing to start your private review.
                </EmptyState>
              </section>
            ) : totalJobs > 0 ? (
              <section className="career-subpanel">
                <div className="career-review-heading">
                  <div><h3>Jobs needing review</h3><p>{overview?.shortlist_count ?? 0} daily shortlist items · risk is not yet assessed</p></div>
                  <button className="button button-ghost" onClick={() => changeTab("Review")} type="button">Open review queue</button>
                </div>
                {overview?.shortlist.length ? (
                  <ul className="career-overview-jobs">
                    {overview.shortlist.map((job) => {
                      const href = safeHttpUrl(job.url);
                      return <li key={job.id}>
                        <div><strong>{job.title}</strong><span>{job.location_text || job.remote_scope_text || "Location not specified"} · {job.assessment?.fit_score ?? "—"}/100 · risk: not yet assessed</span></div>
                        {href ? <a href={href} rel="noopener noreferrer" target="_blank">{job.attribution_text}</a> : <span>{job.attribution_text}</span>}
                      </li>;
                    })}
                  </ul>
                ) : (
                  <EmptyState
                    title="No jobs match the shortlist yet"
                    actions={[{ label: "Review listings", onClick: () => changeTab("Review") }]}
                  >
                    You can review other listings or adjust your matching preferences.
                  </EmptyState>
                )}
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "Review" ? (
          <div className="career-stack">
            <div className="career-subtabs" role="group" aria-label="Review queue">
              {reviewLists.map((name) => (
                <button aria-pressed={reviewList === name} className={reviewList === name ? "career-chip active" : "career-chip"} key={name} onClick={() => {
                  setReviewList(name);
                  setError("");
                  setMobileReviewDetail(false);
                  setReviewSearch("");
                  if (name === "Flagged" || name === "Dismissed") {
                    void request(`/api/admin/career/jobs?status=${name === "Flagged" ? "flagged" : "duplicate"}&limit=50`, csrfToken)
                      .then((data) => setJobs(isRecord(data) && Array.isArray(data.jobs) ? data.jobs.filter(isCareerJob) : []))
                      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The review list could not be loaded."));
                  }
                }} type="button">{name}</button>
              ))}
            </div>
            {reviewList === "Maybe" ? <p className="career-warning">These listings need location or work-permission verification before any decision.</p> : null}
            <div className="career-review-tools">
              <label className="career-review-search">
                <Search aria-hidden="true" size={18} />
                <span className="sr-only">Search listings</span>
                <input onChange={(event) => setReviewSearch(event.target.value)} placeholder="Search title, company, location…" value={reviewSearch} />
              </label>
              <label className="career-sort-label">Sort
                <select onChange={(event) => setReviewSort(event.target.value as "best" | "newest")} value={reviewSort}>
                  <option value="best">Best match</option><option value="newest">Newest</option>
                </select>
              </label>
              <span className="career-key-help">Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>s</kbd> shortlist · <kbd>n</kbd> not a fit · <kbd>o</kbd> open · <kbd>?</kbd> help</span>
            </div>
            {visibleReviewJobs.length ? (
              <div className={`career-review-workspace ${mobileReviewDetail ? "show-detail" : ""}`}>
                <div className="career-review-list" aria-label={`${reviewList} jobs`}>
                  {visibleReviewJobs.map((job) => {
                    const score = job.assessment?.fit_score;
                    const fit = typeof score !== "number" ? "No score" : score >= 75 ? "Strong" : score >= 55 ? "Good" : "Weak";
                    const href = safeHttpsUrl(job.url);
                    return <button
                      aria-current={selectedJob?.id === job.id ? "true" : undefined}
                      className={`career-review-list-card ${selectedJob?.id === job.id ? "active" : ""}`}
                      key={job.id}
                      onClick={() => { setSelectedJobId(job.id); setMobileReviewDetail(true); }}
                      ref={selectedJob?.id === job.id ? selectedJobButton : undefined}
                      type="button"
                    >
                      <span className="career-review-card-top"><strong>{job.title}</strong><span className="career-fit-ring" aria-label={`Fit score ${score ?? "not available"}, ${fit}`}>{score ?? "—"}<small>{fit}</small></span></span>
                      <span>{job.company ?? "Company not listed"}</span>
                      <span className="career-review-card-meta"><span className="career-source-chip">{job.source_name}</span><span className={`career-eligibility ${job.assessment?.eligibility ?? "unknown"}`}>{job.assessment?.eligibility === "eligible" ? "Eligible" : job.assessment?.eligibility === "ineligible" ? "Not eligible" : "Needs verification"}</span></span>
                      <span className="career-risk-label"><AlertTriangle aria-hidden="true" size={14} />{job.risk_assessment ?? "Risk not yet assessed"}</span>
                      <small>Posted {readableDate(job.posted_at)}</small>
                      {href ? <span className="career-link-indicator">Original link available <ExternalLink aria-hidden="true" size={13} /></span> : null}
                    </button>;
                  })}
                </div>
                {selectedJob ? (
                  <article className="career-review-detail">
                    <button className="button button-ghost career-review-back" onClick={() => setMobileReviewDetail(false)} type="button"><ArrowLeft aria-hidden="true" size={16} /> Back to listings</button>
                    <header>
                      <p className="career-eyebrow">{selectedJob.source_name} · {selectedJob.attribution_text}</p>
                      <h2>{selectedJob.title}</h2>
                      <p>{selectedJob.company ?? "Company not listed"} · {selectedJob.location_text || selectedJob.remote_scope_text || "Location not specified"}</p>
                      <p>Posted {readableDate(selectedJob.posted_at)} · risk: {selectedJob.risk_assessment ?? "not yet assessed"}</p>
                      {safeHttpsUrl(selectedJob.url) ? <a className="button button-secondary" href={safeHttpsUrl(selectedJob.url) ?? undefined} rel="noopener noreferrer" target="_blank">Open original <ExternalLink aria-hidden="true" size={15} /></a> : <span className="admin-help">No HTTPS original link is available.</span>}
                    </header>
                    <div className="career-review-primary-actions">
                      <button className="button button-primary" disabled={busy} onClick={() => void updateJobStatus(selectedJob, "shortlisted")} type="button">Shortlist <kbd>s</kbd></button>
                      <button className="button button-secondary" disabled={busy} onClick={() => void updateJobStatus(selectedJob, "not_a_fit")} type="button">Not a fit <kbd>n</kbd></button>
                      <button className="button button-secondary" disabled={busy} onClick={() => void updateJobStatus(selectedJob, "duplicate")} type="button">Duplicate</button>
                      <button className="button button-secondary" disabled={busy} onClick={() => void openNotes(selectedJob)} type="button">Add note</button>
                      {applications.some((application) => application.job_id === selectedJob.id)
                        ? <span className="career-in-pipeline">In Pipeline</span>
                        : <button className="button button-secondary" disabled={busy} onClick={() => void createApplication(selectedJob)} type="button">Add to Pipeline</button>}
                    </div>
                    <div className="career-review-sections">
                      <details open>
                        <summary>Why this score</summary>
                        <p>Fit score: {selectedJob.assessment?.fit_score ?? "not available"} / 100</p>
                        <div className="career-chip-cloud"><strong>Matched</strong>{selectedJob.assessment?.matched.length ? selectedJob.assessment.matched.map((item, index) => <span key={`${item.value ?? item.phrase}-${index}`}>{item.value ?? item.phrase ?? item.type ?? "Match"}</span>) : <span>None recorded</span>}</div>
                        <div className="career-chip-cloud"><strong>Missing</strong>{selectedJob.assessment?.missing.length ? selectedJob.assessment.missing.map((item, index) => <span key={`${item.value}-${index}`}>{item.value ?? item.type ?? "Requirement"}</span>) : <span>None recorded</span>}</div>
                        <ul>{Object.entries(selectedJob.assessment?.fit_breakdown ?? {}).flatMap(([key, value]) => isRecord(value) && typeof value.points === "number" && typeof value.weight === "number" ? [<li key={key}>{readableLabel(key)}: {value.points} / {value.weight}</li>] : [])}</ul>
                      </details>
                      <details><summary>Eligibility evidence</summary>
                        <p>{selectedJob.assessment?.eligibility_evidence.map((entry) => entry.phrase ?? entry.rule ?? "").filter(Boolean).join("; ") || "No explicit eligibility phrase was recorded."}</p>
                      </details>
                      <details><summary>Risk checks</summary>
                        <p>Risk has not been assessed. Verify the employer and listing independently; no safety conclusion is implied.</p>
                        {safeHttpsUrl(selectedJob.url) ? <a href={safeHttpsUrl(selectedJob.url) ?? undefined} rel="noopener noreferrer" target="_blank">Check the original listing <ExternalLink aria-hidden="true" size={14} /></a> : <p>No HTTPS listing link is available to check.</p>}
                      </details>
                      <details><summary>Documents requested</summary><p>Document request details are not provided for this listing.</p></details>
                      <details><summary>Notes</summary>
                        <p>{applications.find((application) => application.job_id === selectedJob.id)?.private_notes || "No private note saved."}</p>
                        <button className="button button-ghost" onClick={() => void openNotes(selectedJob)} type="button">Add or edit note</button>
                      </details>
                      {selectedJob.description_text ? <details><summary>Advert text</summary><p className="career-advert-text">{selectedJob.description_text}</p></details> : null}
                      <details><summary>5-point manual check</summary><ol>
                        <li>Confirm the employer identity using an independent source.</li>
                        <li>Review the original listing URL and application domain.</li>
                        <li>Check role, location, and work-permission requirements.</li>
                        <li>Never pay fees or share sensitive documents before verifying the process.</li>
                        <li>Record concerns as needs verification; this workspace does not assess risk.</li>
                      </ol></details>
                    </div>
                  </article>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="Nothing to review yet"
                actions={[
                  { label: "Scan now", onClick: () => void startScan(), disabled: busy || scanStatus === "running" },
                  { label: "Add a job", onClick: () => changeTab("Import"), secondary: true },
                ]}
              >
                New listings will appear here after a scan or when you add one.
              </EmptyState>
            )}
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
            <form aria-label={activeProfile ? "Edit resume profile" : "Create resume profile"} className={activeProfile ? "career-form career-resume-drawer is-open" : "career-form career-resume-create"} onSubmit={(event) => void saveProfile(event)} role={activeProfile ? "dialog" : undefined} aria-modal={activeProfile ? true : undefined}>
              {activeProfile ? <button aria-label="Close resume editor" className="career-drawer-close" onClick={() => { setActiveProfile(""); setProfileForm(emptyProfileForm); }} type="button"><X aria-hidden="true" size={18} /></button> : null}
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
              ) : <p className="career-warning">The original resume text cannot be changed. Update only verified skills, tasks, and preferences below.</p>}
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
                <article className="career-profile-row career-profile-card" key={profile.id}>
                  <div><strong>{profile.name}</strong><p>{profile.track}</p><small>Updated {readableDate(profile.updated_at)}</small></div>
                  <div className="career-actions">
                    <button className="button button-secondary" onClick={() => {
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
                    <button className="button button-destructive" disabled={busy} onClick={() => {
                      if (window.confirm(`Archive ${profile.name}?`)) void archiveProfile(profile.id);
                    }} type="button">Archive</button>
                  </div>
                </article>
              )) : (
                <EmptyState
                  title="No resume saved"
                  actions={[{
                    label: "Add your resume",
                    onClick: () => document.getElementById("career-profile-name")?.focus(),
                  }]}
                >
                  Add a master resume and verified details to personalize job matches.
                </EmptyState>
              )}
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
                  <button className="button button-destructive" disabled={settings.role_tracks.length <= 1} onClick={() => setSettings({
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
              <div><label htmlFor="career-send-cap">Daily send limit</label><input id="career-send-cap" max={5} min={1} onChange={(event) => setSettings({ ...settings, max_sends_per_day: Number(event.target.value) })} type="number" value={settings.max_sends_per_day} /></div>
            </div>
            <label className="career-check"><input checked={settings.show_company_name} onChange={(event) => setSettings({ ...settings, show_company_name: event.target.checked })} type="checkbox" />Show company name in any future public view (off by default)</label>
            <p className="career-warning">The workspace uses East Africa Time. Public sharing is off.</p>
            <button className="button button-primary" disabled={busy} type="submit">Save preferences</button>
          </form>
        ) : null}

        {tab === "Sources and Setup" ? (
          <div className="career-stack">
            <section className="career-subpanel">
              <h3 id="career-setup-checklist" tabIndex={-1}>Environment setup checklist</h3>
              <p className="admin-help">Only configured / not configured is shown. Secret values are never read into this page.</p>
              <ul className="career-config-list">
                {secretNames.map((name) => <li key={name}><span>{name}</span><strong>{setup?.configuration[name]?.configured ? "Configured" : "Not configured"}</strong></li>)}
                <li><span>Sending mode</span><strong>{setup?.JR_SEND_MODE === "live" ? "Live mode" : "Draft mode"}</strong></li>
              </ul>
            </section>
            <section className="career-subpanel">
              <h3>Sources</h3>
              <div className="career-integrations">
                {sources.map((source) => {
                  const envNames = integrationEnvironment[source.key] ?? [];
                  const recentRun = sourceRuns.find((run) => isRecord(run.summary[source.key]));
                  let sourceRun: JsonRecord | null = null;
                  if (recentRun) {
                    const sourceSummary = recentRun.summary[source.key];
                    if (isRecord(sourceSummary)) sourceRun = sourceSummary;
                  }
                  const sourceError = sourceRun && string(sourceRun.error) ? sourceRun.error : "";
                  const attention = source.consecutive_failures > 0 || source.last_status === "failed" || Boolean(sourceError);
                  const envConfigured = envNames.every((name) => setup?.configuration[name]?.configured === true);
                  const configured = source.enabled && envConfigured;
                  const status = attention ? "Needs attention" : configured ? "Configured" : "Not configured";
                  return <article className={`career-integration-card ${attention ? "attention" : configured ? "configured" : "not-configured"}`} key={source.key}>
                    <div className="career-integration-heading"><h4>{source.name}</h4><span className={`career-integration-status ${attention ? "warning" : configured ? "success" : "muted"}`}><i aria-hidden="true" />{status}</span></div>
                    <p>{integrationDescriptions[source.key] ?? source.attribution_text}</p>
                    <dl>
                      <dt>Environment variables</dt><dd>{envNames.length ? envNames.join(", ") : "None required"}</dd>
                      <dt>Last run</dt><dd>{readableDate(source.last_attempt_at)} · {source.last_status ?? "Not run"}</dd>
                      <dt>Error summary</dt><dd>{sourceError || (attention ? `${source.consecutive_failures} consecutive failure${source.consecutive_failures === 1 ? "" : "s"}` : "No recent source errors reported.")}</dd>
                      <dt>Interval / daily usage</dt><dd>{Math.round(source.min_interval_seconds / 60)} min · {source.requests_today ?? 0}/{source.max_requests_per_day}</dd>
                      <dt>Attribution</dt><dd>{source.attribution_text}</dd>
                    </dl>
                    {source.docs_url && safeHttpsUrl(source.docs_url) ? <a href={safeHttpsUrl(source.docs_url) ?? undefined} rel="noopener noreferrer" target="_blank">Provider documentation</a> : null}
                  </article>;
                })}
              </div>
            </section>
            <section className="career-subpanel">
              <h3>Run history</h3>
              {sourceRuns.length ? <div className="career-run-table-wrap"><table className="career-run-table">
                <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Summary</th></tr></thead>
                <tbody>{sourceRuns.map((run) => {
                  const errors = Object.entries(run.summary).flatMap(([sourceKey, result]) =>
                    isRecord(result) && string(result.error) ? [`${readableLabel(sourceKey)}: ${result.error}`] : []);
                  const summary = run.summary.message ?? run.summary.error ?? run.summary.error_summary;
                  const summaryText = errors.length ? errors.join("; ") : string(summary) ? summary : run.status === "succeeded" ? "Run completed." : "No additional details recorded.";
                  return <tr key={run.id}><td>{readableDate(run.started_at)}</td><td>{readableLabel(run.trigger)}</td><td>{readableLabel(run.status)}</td><td>{summaryText}</td></tr>;
                })}</tbody>
              </table></div> : <p>No run history is available yet.</p>}
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
              {watchlist.length ? watchlist.map((entry) => <article className="career-profile-row" key={entry.id}>
                <span>{entry.label} · {entry.provider} · {entry.token} · {entry.enabled ? "enabled" : "disabled"}</span>
                <button className="button button-destructive" disabled={busy} onClick={() => void deleteWatchlist(entry.id)} type="button">Remove</button>
              </article>) : (
                <EmptyState
                  title="No employer boards added"
                  actions={[{ label: "Add a board", onClick: () => document.getElementById("career-watch-token")?.focus(), secondary: true }]}
                >
                  Add a provider board to watch for openings from a specific employer.
                </EmptyState>
              )}
            </section>
            <section className="career-subpanel">
              <h3>Saved search links</h3>
              {searchLinks.length ? (
                <div className="career-actions">
                  {searchLinks.map((link) => {
                    const href = safeHttpUrl(link.url);
                    return href ? <a className="button button-quiet" href={href} key={link.name} rel="noopener noreferrer" target="_blank">{link.name}</a> : null;
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No search links available"
                  actions={[{ label: "Review preferences", onClick: () => changeTab("Preferences") }]}
                >
                  Your role tracks and countries help shape the searches shown here.
                </EmptyState>
              )}
            </section>
          </div>
        ) : null}

        {tab === "Tracker" ? (
          <div className="career-stack">
            <div className="career-pipeline-heading">
              <p>Track each job and its next step. This workspace does not send applications.</p>
              <div aria-label="Pipeline view" className="career-view-toggle" role="group">
                <button aria-pressed={pipelineView === "table"} className={pipelineView === "table" ? "active" : ""} onClick={() => setPipelineView("table")} type="button">Table</button>
                <button aria-pressed={pipelineView === "board"} className={pipelineView === "board" ? "active" : ""} onClick={() => setPipelineView("board")} type="button">Board</button>
              </div>
            </div>
            <label className="career-filter-label" htmlFor="career-application-filter">Filter applications
              <select id="career-application-filter" onChange={(event) => setApplicationFilter(event.target.value)} value={applicationFilter}>
                <option value="all">All groups</option>
                {applicationStates.map((state) => <option key={state} value={state}>{applicationStateLabels[state]}</option>)}
              </select>
            </label>
            {filteredApplications.length ? pipelineView === "table" ? (
              <div className="career-pipeline-table-wrap">
                <table className="career-pipeline-table">
                  <thead><tr><th>Job</th><th>Stage</th><th>Next action</th><th>Due</th><th>Change state</th></tr></thead>
                  <tbody>{filteredApplications.map((application) => {
                    const due = Boolean(application.followup_at && new Date(application.followup_at) <= now);
                    return <tr className={due ? "due" : ""} key={application.id}>
                      <td><strong>{application.title}</strong><span>{application.company ?? "Company not listed"} · {application.location_text} · {application.source_name}</span>
                        <details className="career-table-details"><summary>Notes and timeline</summary>
                          <label htmlFor={`application-notes-${application.id}`}>Private notes</label>
                          <textarea id={`application-notes-${application.id}`} maxLength={12000} onChange={(event) => setNotesByApplication({ ...notesByApplication, [application.id]: event.target.value })} rows={3} value={notesByApplication[application.id] ?? application.private_notes} />
                          <label htmlFor={`application-followup-${application.id}`}>Follow-up date</label>
                          <input id={`application-followup-${application.id}`} onChange={(event) => setFollowupsByApplication({ ...followupsByApplication, [application.id]: event.target.value })} type="datetime-local" value={followupsByApplication[application.id] ?? (application.followup_at ? application.followup_at.slice(0, 16) : "")} />
                          <div className="career-actions">
                            <button className="button button-secondary" disabled={busy} onClick={() => void saveApplicationDetails(application)} type="button">Save notes and follow-up</button>
                            <button className="button button-ghost" onClick={() => void loadApplicationEvents(application.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Timeline could not be loaded."))} type="button">View timeline</button>
                          </div>
                          {activeApplication === application.id ? <ApplicationTimeline events={applicationEvents} /> : null}
                        </details>
                      </td>
                      <td>{applicationStateLabels[application.state] ?? readableLabel(application.state)}</td>
                      <td>{nextApplicationAction(application.state)}</td>
                      <td>{application.followup_at ? readableDate(application.followup_at) : "—"}{due ? <span className="career-due-label">Due</span> : null}</td>
                      <td><ApplicationStateSelect application={application} busy={busy} onChange={(state) => void changeApplicationState(application, state)} /></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            ) : (
              <div className="career-pipeline-board">
                {applicationStages.map((stage) => {
                  const stageApplications = filteredApplications.filter((application) => (stage.states as readonly string[]).includes(application.state));
                  return <section className="career-pipeline-column" key={stage.name}>
                    <h3>{stage.name}<span>{stageApplications.length}</span></h3>
                    {stageApplications.length ? stageApplications.map((application) => (
                      <article className={`career-pipeline-card ${application.followup_at && new Date(application.followup_at) <= now ? "due" : ""}`} key={application.id}>
                        <h4>{application.title}</h4>
                        <p>{application.company ?? "Company not listed"} · {application.location_text}</p>
                        <p><strong>Next action:</strong> {nextApplicationAction(application.state)}</p>
                        <p><strong>Due:</strong> {application.followup_at ? readableDate(application.followup_at) : "Not set"}</p>
                        <ApplicationStateSelect application={application} busy={busy} onChange={(state) => void changeApplicationState(application, state)} />
                        <details><summary>Private notes and timeline</summary>
                          <label htmlFor={`application-notes-${application.id}`}>Private notes</label>
                          <textarea id={`application-notes-${application.id}`} maxLength={12000} onChange={(event) => setNotesByApplication({ ...notesByApplication, [application.id]: event.target.value })} rows={3} value={notesByApplication[application.id] ?? application.private_notes} />
                          <label htmlFor={`application-followup-${application.id}`}>Follow-up date</label>
                          <input id={`application-followup-${application.id}`} onChange={(event) => setFollowupsByApplication({ ...followupsByApplication, [application.id]: event.target.value })} type="datetime-local" value={followupsByApplication[application.id] ?? (application.followup_at ? application.followup_at.slice(0, 16) : "")} />
                          <div className="career-actions">
                            <button className="button button-secondary" disabled={busy} onClick={() => void saveApplicationDetails(application)} type="button">Save notes and follow-up</button>
                            <button className="button button-ghost" onClick={() => void loadApplicationEvents(application.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Timeline could not be loaded."))} type="button">View timeline</button>
                          </div>
                          {activeApplication === application.id ? <ApplicationTimeline events={applicationEvents} /> : null}
                        </details>
                      </article>
                    )) : <p className="career-empty-column">No jobs in this stage</p>}
                  </section>;
                })}
              </div>
            ) : applications.length ? (
              <EmptyState
                title="No applications in this group"
                actions={[{ label: "Show all applications", onClick: () => setApplicationFilter("all") }]}
              >
                Choose another group or view all applications.
              </EmptyState>
            ) : (
              <EmptyState
                title="Your pipeline is empty"
                actions={[{ label: "Go to Review", onClick: () => changeTab("Review") }]}
              >
                Add a reviewed job to begin tracking your applications.
              </EmptyState>
            )}
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

function SourceHealthList({ sources, onOpenSetup }: { sources: SourceHealth[]; onOpenSetup: () => void }) {
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
  ) : (
    <EmptyState
      title="No source status yet"
      actions={[{ label: "Open source setup", onClick: onOpenSetup }]}
    >
      Check the setup list to see what is needed before sources can report status.
    </EmptyState>
  );
}

function nextApplicationAction(state: string): string {
  if (state === "discovered" || state === "screened" || state === "match_review") return "Review listing";
  if (state === "shortlisted") return "Check requirements";
  if (state === "preparation_in_progress") return "Continue preparation";
  if (state === "ready_for_review") return "Complete manual review";
  if (state === "failed_send") return "Review the recorded issue";
  if (state === "blocked_risk") return "Verify the concern";
  if (state === "submitted" || state === "sent") return "Check for a response";
  if (state === "needs_manual_attention") return "Review details";
  return "No action";
}

function ApplicationStateSelect({
  application,
  busy,
  onChange,
}: {
  application: Application;
  busy: boolean;
  onChange: (state: string) => void;
}) {
  return (
    <label className="career-state-select-label">
      <span className="sr-only">Change state for {application.title}</span>
      <select aria-label={`Change state for ${application.title}`} disabled={busy} onChange={(event) => onChange(event.target.value)} value={application.state}>
        {applicationStates.map((state) => {
          const protectedState = state === "approved_to_send" || state === "sent";
          const allowed = applicationTransitions[application.state]?.includes(state) === true;
          const disabled = state !== application.state && (protectedState || !allowed);
          const reason = protectedState
            ? "This state is unavailable in this workflow."
            : state === application.state
              ? "Current state"
              : allowed ? "" : "The current workflow does not allow this transition.";
          return <option disabled={disabled} key={state} title={reason} value={state}>
            {applicationStateLabels[state]}{protectedState ? " (Unavailable)" : ""}
          </option>;
        })}
      </select>
    </label>
  );
}

function ApplicationTimeline({ events }: { events: ApplicationEvent[] }) {
  return (
    <section className="career-timeline" aria-label="Application event timeline">
      <h4>Event timeline</h4>
      {events.length ? <ol>{events.map((event) => (
        <li key={event.id}>
          <time dateTime={event.at}>{readableDate(event.at)}</time>
          <strong>{readableLabel(event.event)}</strong>
          {Object.keys(event.detail).length ? <span>{Object.entries(event.detail).map(([key, value]) => `${readableLabel(key)}: ${String(value)}`).join(" · ")}</span> : null}
        </li>
      ))}</ol> : <p className="admin-help">No timeline events have been recorded.</p>}
    </section>
  );
}
