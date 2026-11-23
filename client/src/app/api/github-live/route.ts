import { NextResponse } from "next/server";

export const revalidate = 180;

const GITHUB_API = "https://api.github.com";
const GITHUB_LOGIN = "WestMorganOketch";
const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function githubGet(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: githubHeaders,
    next: { revalidate: 180 },
  });

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error("GitHub's public API is temporarily rate-limited. Please retry in a few minutes.");
    }
    throw new Error(`GitHub's public API returned status ${response.status}.`);
  }

  return response.json() as Promise<unknown>;
}

function normalizeProfile(value: unknown) {
  if (!isRecord(value)) throw new Error("GitHub returned an invalid profile response.");
  return {
    login: stringValue(value.login) ?? GITHUB_LOGIN,
    html_url: stringValue(value.html_url) ?? `https://github.com/${GITHUB_LOGIN}`,
    public_repos: numberValue(value.public_repos),
    followers: numberValue(value.followers),
    following: numberValue(value.following),
  };
}

function normalizeRepositories(value: unknown) {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid repositories response.");

  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.html_url !== "string") return [];
    const owner = isRecord(entry.owner) ? stringValue(entry.owner.login) : null;
    if (owner?.toLowerCase() !== GITHUB_LOGIN.toLowerCase()) return [];

    return [{
      id: typeof entry.id === "number" ? entry.id : entry.name,
      name: entry.name,
      full_name: stringValue(entry.full_name) ?? `${GITHUB_LOGIN}/${entry.name}`,
      html_url: entry.html_url,
      description: stringValue(entry.description),
      language: stringValue(entry.language),
      stargazers_count: numberValue(entry.stargazers_count),
      forks_count: numberValue(entry.forks_count),
      updated_at: stringValue(entry.updated_at),
      fork: entry.fork === true,
      archived: entry.archived === true,
    }];
  });
}

function normalizeEvents(value: unknown) {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid activity response.");

  return value.slice(0, 8).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.type !== "string" || typeof entry.created_at !== "string") return [];
    const repo = isRecord(entry.repo) ? stringValue(entry.repo.name) : null;
    if (!repo) return [];
    const payload = isRecord(entry.payload) ? entry.payload : {};
    const pullRequest = isRecord(payload.pull_request) ? payload.pull_request : {};
    const issue = isRecord(payload.issue) ? payload.issue : {};
    const release = isRecord(payload.release) ? payload.release : {};
    const commits = Array.isArray(payload.commits) ? payload.commits.length : null;
    const prNumber = typeof pullRequest.number === "number" ? pullRequest.number : null;
    const issueNumber = typeof issue.number === "number" ? issue.number : null;

    return [{
      id: stringValue(entry.id) ?? `${entry.type}-${entry.created_at}-${repo}`,
      type: entry.type,
      created_at: entry.created_at,
      repository: repo,
      payload: {
        action: stringValue(payload.action),
        ref: stringValue(payload.ref),
        ref_type: stringValue(payload.ref_type),
        commit_count: commits,
        pull_request_title: stringValue(pullRequest.title),
        pull_request_number: prNumber,
        pull_request_merged: pullRequest.merged === true,
        issue_title: stringValue(issue.title),
        issue_number: issueNumber,
        release_tag: stringValue(release.tag_name),
      },
    }];
  });
}

function readableError(reason: unknown): string {
  return reason instanceof Error ? reason.message : "A GitHub data source could not be reached.";
}

export async function GET() {
  const results = await Promise.allSettled([
    githubGet(`${GITHUB_API}/users/${GITHUB_LOGIN}`),
    githubGet(`${GITHUB_API}/users/${GITHUB_LOGIN}/repos?sort=updated&per_page=100&type=owner`),
    githubGet(`${GITHUB_API}/users/${GITHUB_LOGIN}/events/public?per_page=8`),
  ]);

  let profile: ReturnType<typeof normalizeProfile> | null = null;
  let repositories: ReturnType<typeof normalizeRepositories> | null = null;
  let events: ReturnType<typeof normalizeEvents> | null = null;
  const errors: string[] = [];

  if (results[0].status === "fulfilled") {
    try {
      profile = normalizeProfile(results[0].value);
    } catch (error) {
      errors.push(readableError(error));
    }
  } else {
    errors.push(readableError(results[0].reason));
  }

  if (results[1].status === "fulfilled") {
    try {
      repositories = normalizeRepositories(results[1].value);
    } catch (error) {
      errors.push(readableError(error));
    }
  } else {
    errors.push(readableError(results[1].reason));
  }

  if (results[2].status === "fulfilled") {
    try {
      events = normalizeEvents(results[2].value);
    } catch (error) {
      errors.push(readableError(error));
    }
  } else {
    errors.push(readableError(results[2].reason));
  }

  const hasData = profile !== null || repositories !== null || events !== null;
  const response = NextResponse.json(
    { profile, repositories, events, errors, fetchedAt: hasData ? new Date().toISOString() : null },
    {
      status: hasData ? 200 : 503,
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=180, stale-while-revalidate=300",
      },
    },
  );

  return response;
}
