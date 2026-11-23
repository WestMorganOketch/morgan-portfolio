"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowUpRight, ExternalLink, GitCommitHorizontal, GitFork,
  GitPullRequest, Radio, RefreshCw, ShieldCheck, Star,
} from "lucide-react";

type Profile = { login: string; html_url: string; public_repos: number; followers: number; following: number };
type Repository = {
  id: number | string; name: string; full_name: string; html_url: string;
  description: string | null; language: string | null; stargazers_count: number;
  forks_count: number; updated_at: string | null; fork: boolean; archived: boolean;
};
type GitHubEvent = {
  id: string; type: string; created_at: string; repository: string;
  payload: {
    action: string | null; ref: string | null; ref_type: string | null; commit_count: number | null;
    pull_request_title: string | null; pull_request_number: number | null; pull_request_merged: boolean;
    issue_title: string | null; issue_number: number | null; release_tag: string | null;
  };
};
type LiveResponse = { profile: Profile | null; repositories: Repository[] | null; events: GitHubEvent[] | null; errors: string[]; fetchedAt: string | null };

const LANGUAGE_COLOURS: Record<string, string> = {
  HTML: "#ff5144", TypeScript: "#08a8ef", JavaScript: "#f5c400", Python: "#8b7af6",
  CSS: "#d873ce", SQL: "#d88b40", Java: "#dd734d", Shell: "#55aa82",
  "C++": "#6594d8", C: "#6594d8", Jupyter: "#d88b40", PHP: "#8b7af6", Go: "#3bb9c5",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiveResponse(value: unknown): value is LiveResponse {
  if (!isObject(value)) return false;
  const profileOk = value.profile === null || (
    isObject(value.profile) && typeof value.profile.login === "string"
    && typeof value.profile.html_url === "string" && typeof value.profile.public_repos === "number"
    && typeof value.profile.followers === "number" && typeof value.profile.following === "number"
  );
  const reposOk = value.repositories === null || (
    Array.isArray(value.repositories) && value.repositories.every((repo) =>
      isObject(repo) && (typeof repo.id === "number" || typeof repo.id === "string")
      && typeof repo.name === "string" && typeof repo.html_url === "string"
      && (repo.language === null || typeof repo.language === "string")
      && typeof repo.stargazers_count === "number" && typeof repo.forks_count === "number")
  );
  const eventsOk = value.events === null || (
    Array.isArray(value.events) && value.events.every((event) =>
      isObject(event) && typeof event.id === "string" && typeof event.type === "string"
      && typeof event.created_at === "string" && typeof event.repository === "string")
  );
  return profileOk && reposOk && eventsOk && Array.isArray(value.errors)
    && value.errors.every((error) => typeof error === "string")
    && (value.fetchedAt === null || typeof value.fetchedAt === "string");
}

function number(value: number): string { return new Intl.NumberFormat("en").format(value); }
function colour(language: string): string { return LANGUAGE_COLOURS[language] ?? "#76958a"; }

function timeAgo(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + "d ago";
  if (days < 35) return Math.floor(days / 7) + "w ago";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(timestamp);
}

function activityText(event: GitHubEvent): { verb: string; detail: string | null } {
  const p = event.payload;
  switch (event.type) {
    case "PushEvent": return { verb: "pushed to", detail: p.commit_count ? p.commit_count + " commit" + (p.commit_count === 1 ? "" : "s") : null };
    case "CreateEvent": return { verb: p.ref_type === "repository" ? "created repository" : "created " + (p.ref_type || "a reference") + " in", detail: p.ref_type === "repository" ? null : p.ref };
    case "DeleteEvent": return { verb: "deleted " + (p.ref_type || "a reference") + " in", detail: p.ref };
    case "PullRequestEvent": return { verb: p.pull_request_merged ? "merged pull request in" : (p.action || "updated") + " pull request in", detail: p.pull_request_number ? "#" + p.pull_request_number : p.pull_request_title };
    case "IssuesEvent": return { verb: (p.action || "updated") + " issue in", detail: p.issue_number ? "#" + p.issue_number : p.issue_title };
    case "IssueCommentEvent": return { verb: "commented in", detail: p.issue_number ? "issue #" + p.issue_number : null };
    case "WatchEvent": return { verb: "starred", detail: null };
    case "ForkEvent": return { verb: "forked", detail: null };
    case "ReleaseEvent": return { verb: "published a release in", detail: p.release_tag };
    case "PublicEvent": return { verb: "made public", detail: null };
    default: return { verb: "updated", detail: event.type.replace(/Event$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() };
  }
}

function EventIcon({ type }: { type: string }) {
  if (type === "PushEvent") return <GitCommitHorizontal size={15} aria-hidden="true" />;
  if (type === "PullRequestEvent") return <GitPullRequest size={15} aria-hidden="true" />;
  if (type === "ForkEvent") return <GitFork size={15} aria-hidden="true" />;
  if (type === "WatchEvent") return <Star size={15} aria-hidden="true" />;
  return <Activity size={15} aria-hidden="true" />;
}

export default function GithubLiveDashboard() {
  const [data, setData] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestActive = useRef(false);
  const hasLoaded = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (requestActive.current) return;
    requestActive.current = true;
    if (!quiet) setRefreshing(true);
    if (!hasLoaded.current) setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch("/api/github-live", {
        headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal,
      });
      const raw: unknown = await response.json();
      if (!isLiveResponse(raw)) throw new Error("The live GitHub service returned an unexpected response.");
      if (!response.ok && !raw.profile && !raw.repositories && !raw.events) {
        throw new Error(raw.errors.join(" ") || "GitHub is temporarily unavailable. Please retry.");
      }
      setData(raw);
      hasLoaded.current = true;
      setError(raw.errors.length ? raw.errors.join(" ") : "");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "GitHub could not be reached. Please retry.");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      requestActive.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 5 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
      controllerRef.current?.abort();
    };
  }, [refresh]);

  const repositories = data?.repositories ?? null;
  const original = useMemo(() => repositories?.filter((repo) => !repo.fork) ?? [], [repositories]);
  const stars = useMemo(() => (repositories ?? []).reduce((sum, repo) => sum + repo.stargazers_count, 0), [repositories]);
  const forks = useMemo(() => (repositories ?? []).reduce((sum, repo) => sum + repo.forks_count, 0), [repositories]);
  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const repo of original) if (repo.language) counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, percentage: total ? Math.round(count / total * 100) : 0, colour: colour(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [original]);
  const latest = useMemo(() => {
    const source = original.length ? original : repositories ?? [];
    return [...source].sort((a, b) => Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? "")).slice(0, 6);
  }, [original, repositories]);

  const stats = [
    { label: "Public repos", value: data?.profile ? number(data.profile.public_repos) : null, note: "public projects" },
    { label: "Followers", value: data?.profile ? number(data.profile.followers) : null, note: "on GitHub" },
    { label: "Following", value: data?.profile ? number(data.profile.following) : null, note: "accounts" },
    { label: "Total stars", value: repositories ? number(stars) : null, note: "across owned repos" },
    { label: "Total forks", value: repositories ? number(forks) : null, note: "across owned repos" },
  ];

  if (loading && !data) {
    return (
      <section className="github-live-dashboard page-container" aria-labelledby="github-live-title" aria-busy="true">
        <div className="github-live-intro">
          <p className="github-live-kicker"><span>//</span> GITHUB · LIVE</p>
          <h1 id="github-live-title">The work, <em>in real time.</em></h1>
          <p className="github-live-lede">Connecting to GitHub’s public data for the latest work, activity, and profile totals.</p>
        </div>
        <div className="github-live-stat-grid" aria-hidden="true">{stats.map((stat) => <div className="github-live-stat github-live-skeleton" key={stat.label}><span /><strong /><small /></div>)}</div>
        <div className="github-live-panels"><div className="github-live-panel github-live-skeleton github-live-large-skeleton" /><div className="github-live-panel github-live-skeleton github-live-large-skeleton" /></div>
        <p className="github-live-loading"><Radio size={14} aria-hidden="true" /> Requesting current data from GitHub…</p>
      </section>
    );
  }

  const checkedAt = data?.fetchedAt
    ? new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(Date.parse(data.fetchedAt))
    : null;

  return (
    <section className="github-live-dashboard page-container" aria-labelledby="github-live-title">
      <div className="github-live-intro">
        <div className="github-live-kicker-row">
          <p className="github-live-kicker"><span>//</span> GITHUB · LIVE</p>
          <span className={error ? "github-live-status is-degraded" : "github-live-status"}><span aria-hidden="true" />{error ? "PARTIAL DATA" : "LIVE CONNECTION"}</span>
        </div>
        <h1 id="github-live-title">The work, <em>in real time.</em></h1>
        <p className="github-live-lede">Streaming directly from <a href="https://github.com/WestMorganOketch" target="_blank" rel="noreferrer">github.com/WestMorganOketch</a>. Public repository and activity data refresh automatically.</p>
        <div className="github-live-meta-row">
          <span>{checkedAt ? "Last checked at " + checkedAt : "Live data is not currently available"}</span>
          <button type="button" className="github-live-refresh" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh GitHub data">
            <RefreshCw size={13} aria-hidden="true" className={refreshing ? "is-spinning" : ""} />{refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </div>

      <div className="github-live-stat-grid" aria-label="Live GitHub profile statistics">
        {stats.map((stat) => <div className="github-live-stat" key={stat.label}><span>{stat.label}</span><strong>{stat.value ?? "—"}</strong><small>{stat.note}</small></div>)}
      </div>

      {error && <div className="github-live-notice" role="status"><ShieldCheck size={16} aria-hidden="true" /><p>{error} {data ? "Available sections are still shown below." : "Use Refresh now to retry."}</p></div>}

      <div className="github-live-panels">
        <section className="github-live-panel github-live-languages" aria-labelledby="github-live-language-title">
          <div className="github-live-panel-heading"><h2 id="github-live-language-title">Language breakdown</h2><span>{repositories ? original.length + " original repos" : "Awaiting data"}</span></div>
          {languages.length ? (
            <>
              <div className="github-live-language-bar" role="img" aria-label={languages.map((lang) => lang.name + ": " + lang.percentage + "%").join(", ")}>
                {languages.map((lang) => <span key={lang.name} style={{ width: (lang.count / languages.reduce((sum, item) => sum + item.count, 0) * 100) + "%", backgroundColor: lang.colour }} />)}
              </div>
              <ul className="github-live-language-legend">
                {languages.map((lang) => <li key={lang.name}><span className="github-live-language-name"><i style={{ backgroundColor: lang.colour }} />{lang.name}</span><span>{lang.percentage}%</span></li>)}
              </ul>
              <p className="github-live-panel-footnote">Share of original repositories by primary language, not a measure of lines of code.</p>
            </>
          ) : <div className="github-live-empty"><span>{repositories ? "No language data found yet." : "Repository language data is unavailable."}</span><small>When GitHub returns repositories, the distribution appears here.</small></div>}
        </section>

        <section className="github-live-panel github-live-activity" aria-labelledby="github-live-activity-title">
          <div className="github-live-panel-heading"><h2 id="github-live-activity-title">Latest activity</h2><span className={data?.events ? "github-live-activity-pulse" : "github-live-activity-pulse is-muted"} aria-label={data?.events ? "Activity data available" : "Activity data unavailable"} /></div>
          {data?.events?.length ? (
            <ol className="github-live-activity-list">
              {data.events.slice(0, 7).map((event) => {
                const activity = activityText(event);
                return <li key={event.id}><span className="github-live-activity-icon"><EventIcon type={event.type} /></span><div><p><strong>{activity.verb}</strong> <a href={"https://github.com/" + event.repository} target="_blank" rel="noreferrer">{event.repository.split("/").pop()}</a>{activity.detail ? <span className="github-live-activity-detail"> · {activity.detail}</span> : null}</p><time dateTime={event.created_at}>{timeAgo(event.created_at)}</time></div></li>;
              })}
            </ol>
          ) : <div className="github-live-empty"><span>{data?.events ? "No recent public activity was returned." : "Recent activity is unavailable."}</span><small>Only events made public by GitHub can appear here.</small></div>}
          <a className="github-live-subtle-link" href="https://github.com/WestMorganOketch?tab=overview" target="_blank" rel="noreferrer">View GitHub profile <ArrowUpRight size={13} aria-hidden="true" /></a>
        </section>
      </div>

      <section className="github-live-repositories" aria-labelledby="github-live-repositories-title">
        <div className="github-live-repositories-heading"><div><p className="github-live-kicker"><span>//</span> PUBLIC CODE</p><h2 id="github-live-repositories-title">Latest repositories.</h2></div><a href="https://github.com/WestMorganOketch?tab=repositories" target="_blank" rel="noreferrer">View all on GitHub <ArrowUpRight size={14} aria-hidden="true" /></a></div>
        {latest.length ? (
          <div className="github-live-repository-grid">
            {latest.map((repo) => <article className="github-live-repository-card" key={repo.id}>
              <div className="github-live-repository-top"><span className="github-live-repository-icon"><GitCommitHorizontal size={16} aria-hidden="true" /></span><span className={repo.archived ? "github-live-repository-state is-archived" : "github-live-repository-state"}>{repo.archived ? "Archived" : "Public"}</span></div>
              <h3><a href={repo.html_url} target="_blank" rel="noreferrer">{repo.name}<ExternalLink size={13} aria-hidden="true" /></a></h3>
              <p>{repo.description?.trim() || "Public repository. Open the project to explore its source code and documentation."}</p>
              <div className="github-live-repository-bottom"><span className="github-live-repository-language">{repo.language ? <i style={{ backgroundColor: colour(repo.language) }} /> : null}{repo.language || "Source code"}</span><span><Star size={13} aria-hidden="true" />{number(repo.stargazers_count)}</span><span><GitFork size={13} aria-hidden="true" />{number(repo.forks_count)}</span>{repo.updated_at ? <time dateTime={repo.updated_at}>{timeAgo(repo.updated_at)}</time> : null}</div>
            </article>)}
          </div>
        ) : <div className="github-live-repository-empty"><p>{repositories ? "No public repositories were found for this profile." : "Latest repositories are temporarily unavailable."}</p><a href="https://github.com/WestMorganOketch?tab=repositories" target="_blank" rel="noreferrer">Open GitHub repositories <ArrowUpRight size={13} aria-hidden="true" /></a></div>}
      </section>
      <p className="github-live-disclaimer"><span aria-hidden="true">↳</span> Live data is provided by GitHub’s public API. Public activity can be delayed or omitted by GitHub; private work is never displayed.</p>
    </section>
  );
}
