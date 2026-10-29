"use client";

import { useEffect, useState, type FormEvent } from "react";
import AdminExtensions from "@/components/AdminExtensions";

type Project = {
  id: string;
  title: string;
  period: string;
  description: string;
  tags: string[];
  writeup: string;
  challenges: string;
  solutions: string;
  architecture: string;
  futureImprovements: string;
  url: string | null;
  demoUrl: string | null;
  published: boolean;
};

type AnalyticsRow = {
  day: string;
  event: string;
  count: number;
};

type ProjectForm = Omit<Project, "id">;

type ContentEntry = {
  id: string;
  category: string;
  title: string;
  period: string;
  description: string;
  body: string;
  tags: string[];
  url: string | null;
  published: boolean;
};

type ContentForm = Omit<ContentEntry, "id">;

const contentCategories = [
  "experience", "education", "certifications", "achievements", "blog", "gallery",
  "services", "writeups", "inventions", "cheatsheets", "ctfs", "assignments", "skills",
];

const emptyContent: ContentForm = {
  category: "achievements",
  title: "",
  period: "",
  description: "",
  body: "",
  tags: [],
  url: null,
  published: false,
};

const emptyProject: ProjectForm = {
  title: "",
  period: "",
  description: "",
  tags: [],
  writeup: "",
  challenges: "",
  solutions: "",
  architecture: "",
  futureImprovements: "",
  url: null,
  demoUrl: null,
  published: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProjectList(value: unknown): value is Project[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item)
    && typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.period === "string"
    && typeof item.description === "string"
    && Array.isArray(item.tags)
    && item.tags.every((tag: unknown) => typeof tag === "string")
    && typeof item.writeup === "string"
    && typeof item.challenges === "string"
    && typeof item.solutions === "string"
    && typeof item.architecture === "string"
    && typeof item.futureImprovements === "string"
    && (item.url === null || typeof item.url === "string")
    && (item.demoUrl === null || typeof item.demoUrl === "string")
    && typeof item.published === "boolean",
  );
}

function isContentList(value: unknown): value is ContentEntry[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item)
    && typeof item.id === "string"
    && typeof item.category === "string"
    && contentCategories.includes(item.category)
    && typeof item.title === "string"
    && typeof item.period === "string"
    && typeof item.description === "string"
    && typeof item.body === "string"
    && Array.isArray(item.tags)
    && item.tags.every((tag: unknown) => typeof tag === "string")
    && (item.url === null || typeof item.url === "string")
    && typeof item.published === "boolean",
  );
}

function isAnalyticsRows(value: unknown): value is AnalyticsRow[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item)
    && typeof item.day === "string"
    && typeof item.event === "string"
    && typeof item.count === "number",
  );
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status >= 500) {
    throw new Error("The admin API or PostgreSQL is not ready. Configure PostgreSQL and api/.env, then start the API from the api folder.");
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The server returned an unreadable response.");
    }
  }
  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === "string"
      ? data.error
      : `The request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, credentials: "include" });
  return readResponse(response);
}

export default function Admin({ loginOnly = false }: { loginOnly?: boolean }) {
  const [csrfToken, setCsrfToken] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [contentEntries, setContentEntries] = useState<ContentEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([]);
  const [form, setForm] = useState<ProjectForm>(emptyProject);
  const [editingId, setEditingId] = useState("");
  const [contentForm, setContentForm] = useState<ContentForm>(emptyContent);
  const [editingContentId, setEditingContentId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const originalTitle = document.title;
    const robotsMeta = document.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement("meta");
    const hadRobotsMeta = robotsMeta.isConnected;
    const originalRobots = robotsMeta.getAttribute("content");
    robotsMeta.name = "robots";
    robotsMeta.content = "noindex, nofollow";
    if (!hadRobotsMeta) document.head.append(robotsMeta);
    document.title = "Portfolio Admin | Morgan Oketch";
    return () => {
      document.title = originalTitle;
      if (hadRobotsMeta && originalRobots !== null) robotsMeta.content = originalRobots;
      else robotsMeta.remove();
    };
  }, []);

  async function loadDashboard() {
    const [projectData, analyticsData, contentData] = await Promise.all([
      request("/api/admin/projects"),
      request("/api/admin/analytics"),
      request("/api/admin/content"),
    ]);
    if (!isProjectList(projectData) || !isAnalyticsRows(analyticsData) || !isContentList(contentData)) {
      throw new Error("The server returned unexpected admin data.");
    }
    setProjects(projectData);
    setAnalytics(analyticsData);
    setContentEntries(contentData);
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const csrfData = await request("/api/admin/csrf");
        if (!isRecord(csrfData) || typeof csrfData.token !== "string") {
          throw new Error("The server did not provide request verification.");
        }
        if (!active) return;
        setCsrfToken(csrfData.token);

        const response = await fetch("/api/admin/me", { credentials: "include", cache: "no-store" });
        if (response.status === 401) {
          if (loginOnly) {
            const errorCode = new URLSearchParams(window.location.search).get("error");
            const loginErrors: Record<string, string> = {
              not_allowed: "This Google account is not allowed.",
              invalid_state: "The sign-in request expired or could not be verified. Please try again.",
              sign_in_failed: "Google sign-in could not be completed. Please try again.",
            };
            if (errorCode) setError(loginErrors[errorCode] ?? "Sign-in failed. Please try again.");
          } else {
            window.location.replace("/admin/login");
          }
          return;
        }
        const adminData = await readResponse(response);
        if (!isRecord(adminData) || typeof adminData.email !== "string") {
          throw new Error("The server returned unexpected sign-in data.");
        }
        if (!active) return;
        if (loginOnly) {
          window.location.replace("/admin");
          return;
        }
        setAdminEmail(adminData.email);
        const [projectData, analyticsData, contentData] = await Promise.all([
          request("/api/admin/projects"),
          request("/api/admin/analytics"),
          request("/api/admin/content"),
        ]);
        if (!isProjectList(projectData) || !isAnalyticsRows(analyticsData) || !isContentList(contentData)) {
          throw new Error("The server returned unexpected admin data.");
        }
        if (!active) return;
        setProjects(projectData);
        setAnalytics(analyticsData);
        setContentEntries(contentData);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Could not connect to the portfolio API.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => { active = false; };
  }, [loginOnly]);

  function resetForm() {
    setForm(emptyProject);
    setEditingId("");
  }

  function resetContentForm() {
    setContentForm(emptyContent);
    setEditingContentId("");
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const project: ProjectForm = {
      title: form.title.trim(),
      period: form.period.trim(),
      description: form.description.trim(),
      tags: form.tags,
      writeup: form.writeup,
      challenges: form.challenges.trim(),
      solutions: form.solutions.trim(),
      architecture: form.architecture.trim(),
      futureImprovements: form.futureImprovements.trim(),
      url: form.url?.trim() || null,
      demoUrl: form.demoUrl?.trim() || null,
      published: formData.get("published") === "on",
    };
    try {
      await request(editingId ? `/api/admin/projects/${editingId}` : "/api/admin/projects", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(project),
      });
      await loadDashboard();
      setMessage(editingId ? "Project updated." : "Project saved.");
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project could not be saved.");
    }
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    setError("");
    setMessage("");
    try {
      await request(`/api/admin/projects/${project.id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrfToken },
      });
      await loadDashboard();
      if (editingId === project.id) resetForm();
      setMessage("Project deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project could not be deleted.");
    }
  }

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const entry: ContentForm = {
      ...contentForm,
      title: contentForm.title.trim(),
      period: contentForm.period.trim(),
      description: contentForm.description.trim(),
      body: contentForm.body.trim(),
      tags: contentForm.tags,
      url: contentForm.url?.trim() || null,
      published: formData.get("content-published") === "on",
    };
    try {
      await request(editingContentId ? `/api/admin/content/${editingContentId}` : "/api/admin/content", {
        method: editingContentId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(entry),
      });
      await loadDashboard();
      setMessage(editingContentId ? "Portfolio content updated." : "Portfolio content saved.");
      resetContentForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The portfolio content could not be saved.");
    }
  }

  async function deleteContent(entry: ContentEntry) {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    setError("");
    setMessage("");
    try {
      await request(`/api/admin/content/${entry.id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrfToken },
      });
      await loadDashboard();
      if (editingContentId === entry.id) resetContentForm();
      setMessage("Portfolio content deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The portfolio content could not be deleted.");
    }
  }

  async function signOut() {
    setError("");
    try {
      await request("/api/admin/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
      });
      setAdminEmail("");
      setProjects([]);
      setContentEntries([]);
      setAnalytics([]);
      resetForm();
      resetContentForm();
      window.location.replace("/admin/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    }
  }

  const totalEvents = analytics.reduce((total, row) => total + row.count, 0);
  const pageViews = analytics.filter((row) => row.event === "page_view").reduce((total, row) => total + row.count, 0);
  const linkClicks = totalEvents - pageViews;

  return (
    <div className="admin-page">
      <header className="admin-header">
        <a className="wordmark" href="/">
          <span className="wordmark-mark">M<span>O</span></span>
          <span className="wordmark-label">MORGAN OKETCH<span>PORTFOLIO ADMIN</span></span>
        </a>
        <a className="text-link" href="/">← View portfolio</a>
      </header>
      <div className="admin-content">
        {loading ? <p className="admin-notice" role="status">Connecting to the portfolio API… Free hosting can take about a minute to wake on the first visit.</p> : null}
        {error ? <p className="admin-message admin-error" role="alert">{error}</p> : null}
        {message ? <p className="admin-message" role="status">{message}</p> : null}

        {!loading && !adminEmail ? (
          <section className="admin-login">
            <p className="eyebrow">PRIVATE AREA / SIGN IN</p>
            <h1>Welcome back.</h1>
            <p className="admin-help">Sign in to manage your public projects and view private, anonymous aggregate activity.</p>
            <button
              className="button button-primary"
              onClick={() => window.location.assign("/api/admin/auth/google/start")}
              type="button"
            >
              Continue with Google <span aria-hidden="true">→</span>
            </button>
          </section>
        ) : null}

        {!loading && adminEmail ? (
          <>
            <div className="admin-title-row">
              <div><p className="eyebrow">PRIVATE AREA / CONTENT &amp; ACTIVITY</p><h1>Admin dashboard<span className="accent">.</span></h1><p className="admin-help">Signed in as {adminEmail}</p></div>
              <button className="button button-quiet" onClick={() => void signOut()} type="button">Sign out</button>
            </div>

            <section className="admin-stats" aria-label="Aggregate site activity for the last 30 days">
              <article><span>PAGE VIEWS · 30 DAYS</span><strong>{pageViews}</strong></article>
              <article><span>LINK CLICKS · 30 DAYS</span><strong>{linkClicks}</strong></article>
              <article><span>PROJECTS</span><strong>{projects.length}</strong></article>
            </section>
            <p className="admin-privacy">Activity is stored as aggregate event counts only. The analytics table does not store visitor identities, IP addresses, or query strings.</p>

            <section className="admin-panel">
              <div className="admin-panel-heading"><div><p className="eyebrow">CONTENT MANAGEMENT</p><h2>{editingId ? "Edit project" : "Add a project"}</h2></div></div>
              <form className="project-form" onSubmit={(event) => void saveProject(event)}>
                <div className="form-row">
                  <div><label htmlFor="project-title">Project title</label><input id="project-title" maxLength={160} onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></div>
                  <div><label htmlFor="project-period">Date or period</label><input id="project-period" maxLength={60} onChange={(event) => setForm({ ...form, period: event.target.value })} placeholder="e.g. Jun 2026" required value={form.period} /></div>
                </div>
                <label htmlFor="project-description">Short description</label>
                <textarea id="project-description" maxLength={1200} onChange={(event) => setForm({ ...form, description: event.target.value })} required rows={3} value={form.description} />
                <label htmlFor="project-tags">Tags <span>comma-separated</span></label>
                <input id="project-tags" maxLength={500} onChange={(event) => setForm({ ...form, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12) })} placeholder="Incident response, SIEM, Python" value={form.tags.join(", ")} />
                <label htmlFor="project-writeup">Write-up <span>plain text; no HTML · max 12,000 characters</span></label>
                <textarea id="project-writeup" maxLength={12000} onChange={(event) => setForm({ ...form, writeup: event.target.value })} rows={7} value={form.writeup} />
                <div className="form-row">
                  <div><label htmlFor="project-challenges">Challenges <span>optional · plain text</span></label><textarea id="project-challenges" maxLength={4000} onChange={(event) => setForm({ ...form, challenges: event.target.value })} rows={4} value={form.challenges} /></div>
                  <div><label htmlFor="project-solutions">Solutions <span>optional · plain text</span></label><textarea id="project-solutions" maxLength={4000} onChange={(event) => setForm({ ...form, solutions: event.target.value })} rows={4} value={form.solutions} /></div>
                </div>
                <div className="form-row">
                  <div><label htmlFor="project-architecture">Architecture <span>optional · plain text</span></label><textarea id="project-architecture" maxLength={4000} onChange={(event) => setForm({ ...form, architecture: event.target.value })} rows={4} value={form.architecture} /></div>
                  <div><label htmlFor="project-improvements">Future improvements <span>optional · plain text</span></label><textarea id="project-improvements" maxLength={4000} onChange={(event) => setForm({ ...form, futureImprovements: event.target.value })} rows={4} value={form.futureImprovements} /></div>
                </div>
                <label htmlFor="project-url">GitHub repository link <span>optional · HTTPS only</span></label>
                <input id="project-url" maxLength={500} onChange={(event) => setForm({ ...form, url: event.target.value })} type="url" value={form.url ?? ""} />
                <label htmlFor="project-demo-url">Live demo link <span>optional · HTTPS only</span></label>
                <input id="project-demo-url" maxLength={500} onChange={(event) => setForm({ ...form, demoUrl: event.target.value })} type="url" value={form.demoUrl ?? ""} />
                <label className="publish-toggle"><input checked={form.published} name="published" onChange={(event) => setForm({ ...form, published: event.target.checked })} type="checkbox" /> Publish this project on my public portfolio</label>
                <div className="form-actions">
                  <button className="button button-primary" type="submit">{editingId ? "Save project" : "Add project"} <span aria-hidden="true">→</span></button>
                  {editingId ? <button className="button button-quiet" onClick={resetForm} type="button">Cancel edit</button> : null}
                </div>
              </form>
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading"><div><p className="eyebrow">SAVED CONTENT</p><h2>Your projects</h2></div></div>
              {projects.length ? (
                <div className="admin-project-list">
                  {projects.map((project) => (
                    <article className="admin-project" key={project.id}>
                      <div><div className="mission-meta"><span>{project.period}</span><span className={project.published ? "file-status" : "draft-status"}>{project.published ? "PUBLISHED" : "DRAFT"}</span></div><h3>{project.title}</h3><p>{project.description}</p></div>
                      <div className="admin-project-actions">
                        <button className="text-link" onClick={() => { setForm({ ...project, url: project.url ?? "" }); setEditingId(project.id); setMessage(""); }} type="button">Edit</button>
                        <button className="text-link delete-action" onClick={() => void deleteProject(project)} type="button">Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="admin-help">No projects yet. Add one above; unpublished drafts are visible only here.</p>}
            </section>

            <section className="admin-panel" aria-labelledby="portfolio-content-title">
              <div className="admin-panel-heading"><div><p className="eyebrow">PORTFOLIO CMS</p><h2 id="portfolio-content-title">{editingContentId ? "Edit a portfolio entry" : "Add to a portfolio page"}</h2></div></div>
              <p className="admin-help">Create and publish plain-text entries for experience, education, training, achievements, articles, services, write-ups, CTFs, and other portfolio sections. Drafts stay private.</p>
              <form className="project-form" onSubmit={(event) => void saveContent(event)}>
                <div className="form-row">
                  <div>
                    <label htmlFor="content-category">Portfolio page</label>
                    <select id="content-category" onChange={(event) => setContentForm({ ...contentForm, category: event.target.value })} value={contentForm.category}>
                      {contentCategories.map((category) => <option key={category} value={category}>{category.charAt(0).toUpperCase() + category.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="content-period">Date or period <span>optional</span></label>
                    <input id="content-period" maxLength={80} onChange={(event) => setContentForm({ ...contentForm, period: event.target.value })} placeholder="e.g. Jun 2026" value={contentForm.period} />
                  </div>
                </div>
                <label htmlFor="content-title">Entry title</label>
                <input id="content-title" maxLength={160} onChange={(event) => setContentForm({ ...contentForm, title: event.target.value })} required value={contentForm.title} />
                <label htmlFor="content-description">Short description</label>
                <textarea id="content-description" maxLength={1200} onChange={(event) => setContentForm({ ...contentForm, description: event.target.value })} required rows={3} value={contentForm.description} />
                <label htmlFor="content-body">Additional details <span>plain text; no HTML · max 12,000 characters</span></label>
                <textarea id="content-body" maxLength={12000} onChange={(event) => setContentForm({ ...contentForm, body: event.target.value })} rows={6} value={contentForm.body} />
                <label htmlFor="content-tags">Tags <span>comma-separated, optional</span></label>
                <input id="content-tags" maxLength={500} onChange={(event) => setContentForm({ ...contentForm, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12) })} value={contentForm.tags.join(", ")} />
                <label htmlFor="content-url">Public reference link <span>optional · HTTP(S) only</span></label>
                <input id="content-url" maxLength={500} onChange={(event) => setContentForm({ ...contentForm, url: event.target.value })} type="url" value={contentForm.url ?? ""} />
                <label className="publish-toggle"><input checked={contentForm.published} name="content-published" onChange={(event) => setContentForm({ ...contentForm, published: event.target.checked })} type="checkbox" /> Publish this entry on the public portfolio</label>
                <div className="form-actions">
                  <button className="button button-primary" type="submit">{editingContentId ? "Save entry" : "Add entry"} <span aria-hidden="true">→</span></button>
                  {editingContentId ? <button className="button button-quiet" onClick={resetContentForm} type="button">Cancel edit</button> : null}
                </div>
              </form>
            </section>

            <section className="admin-panel" aria-labelledby="saved-content-title">
              <div className="admin-panel-heading"><div><p className="eyebrow">SAVED CONTENT</p><h2 id="saved-content-title">Portfolio entries</h2></div></div>
              {contentEntries.length ? (
                <div className="admin-project-list">
                  {contentEntries.map((entry) => (
                    <article className="admin-project" key={entry.id}>
                      <div>
                        <div className="mission-meta"><span>{entry.category}</span><span>{entry.period || "No date"}</span><span className={entry.published ? "file-status" : "draft-status"}>{entry.published ? "PUBLISHED" : "DRAFT"}</span></div>
                        <h3>{entry.title}</h3><p>{entry.description}</p>
                      </div>
                      <div className="admin-project-actions">
                        <button className="text-link" onClick={() => { setContentForm({ ...entry, url: entry.url ?? "" }); setEditingContentId(entry.id); setMessage(""); }} type="button">Edit</button>
                        <button className="text-link delete-action" onClick={() => void deleteContent(entry)} type="button">Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="admin-help">No additional entries yet. Add a record above; published entries appear on their matching portfolio page.</p>}
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading"><div><p className="eyebrow">PRIVATE AGGREGATES / LAST 30 DAYS</p><h2>Recent activity</h2></div></div>
              {analytics.length ? (
                <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Date</th><th>Event</th><th>Count</th></tr></thead><tbody>
                  {analytics.map((row) => <tr key={`${row.day}-${row.event}`}><td>{row.day}</td><td>{row.event.replaceAll("_", " ")}</td><td>{row.count}</td></tr>)}
                </tbody></table></div>
              ) : <p className="admin-help">No activity has been recorded yet. Metrics appear here after the API is connected to the public site.</p>}
            </section>
            <AdminExtensions csrfToken={csrfToken} />
          </>
        ) : null}
      </div>
    </div>
  );
}
