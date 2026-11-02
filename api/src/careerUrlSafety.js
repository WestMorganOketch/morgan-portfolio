import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { stripHtml } from "./careerSources.js";

const maximumResponseBytes = 512 * 1024;
const requestTimeoutMs = 8_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const rdapBaseUrl = "https://rdap.org/domain/";
const atsHosts = new Map([
  ["greenhouse", ["boards.greenhouse.io", "job-boards.greenhouse.io"]],
  ["lever", ["jobs.lever.co"]],
  ["ashby", ["jobs.ashbyhq.com"]],
  ["workable", ["apply.workable.com"]],
  ["smartrecruiters", ["jobs.smartrecruiters.com"]],
]);

function ipv4Number(address) {
  const parts = address.split(".").map(Number);
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function inIpv4Range(address, network, prefix) {
  const shift = 32n - BigInt(prefix);
  return (ipv4Number(address) >> shift) === (ipv4Number(network) >> shift);
}

function ipv6Number(address) {
  let normalized = address.toLowerCase();
  const embeddedIpv4 = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (embeddedIpv4) {
    const parts = embeddedIpv4[1].split(".").map(Number);
    const pair = `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
    normalized = normalized.replace(embeddedIpv4[1], pair);
  }
  const halves = normalized.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const words = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
  return words.reduce((value, part) => (value << 16n) | BigInt(part), 0n);
}

function inIpv6Range(address, network, prefix) {
  const shift = 128n - BigInt(prefix);
  return (ipv6Number(address) >> shift) === (ipv6Number(network) >> shift);
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const blockedRanges = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
      ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
      ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blockedRanges.some(([network, prefix]) => inIpv4Range(address, network, prefix));
  }
  if (family !== 6) return false;
  const mappedPrefix = ipv6Number(address) >> 32n;
  if (mappedPrefix === 0xffffn) {
    const embedded = Number(ipv6Number(address) & 0xffff_ffffn);
    const octets = [24, 16, 8, 0].map((shift) => (embedded >> shift) & 255).join(".");
    return isPublicAddress(octets);
  }
  const globalUnicast = inIpv6Range(address, "2000::", 3);
  const blockedRanges = [
    ["2001::", 23], ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
  ];
  return globalUnicast && !blockedRanges.some(([network, prefix]) => inIpv6Range(address, network, prefix));
}

async function defaultResolveHost(hostname) {
  const family = isIP(hostname);
  if (family) return [{ address: hostname, family }];
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function nodeRequestPinned(url, { signal, resolvedAddresses, maxBytes }) {
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      method: "GET",
      signal,
      headers: { Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1", "Accept-Encoding": "identity" },
      lookup(_hostname, options, callback) {
        const address = resolvedAddresses[0];
        if (!address) {
          callback(new Error("DNS resolution failed."));
          return;
        }
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          response.destroy(new Error("Response exceeded the size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve(new Response(Buffer.concat(chunks, total), {
          status: response.statusCode ?? 502,
          headers: response.headers,
        }));
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

async function resolvePublicHost(hostname, resolveHost) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  if (normalizedHostname === "localhost" || normalizedHostname === "metadata"
    || normalizedHostname.endsWith(".localhost")
    || normalizedHostname.endsWith(".local")
    || normalizedHostname.endsWith(".internal")) {
    throw Object.assign(new Error("Local and metadata hostnames are not allowed."), { code: "blocked_address" });
  }
  let addresses;
  try {
    addresses = await resolveHost(normalizedHostname);
  } catch {
    throw Object.assign(new Error("Domain lookup failed."), { code: "dns_failed" });
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw Object.assign(new Error("Domain lookup returned no addresses."), { code: "dns_failed" });
  }
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw Object.assign(new Error("Domain resolves to a non-public address."), { code: "blocked_address" });
  }
  return addresses;
}

function responseHeader(response, name) {
  if (response.headers?.get) return response.headers.get(name);
  const value = response.headers?.[name] ?? response.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function isAllowedHttpUrl(url) {
  return ["http:", "https:"].includes(url.protocol)
    && !url.username && !url.password
    && (!url.port || url.port === (url.protocol === "https:" ? "443" : "80"));
}

async function readResponseText(response, maxBytes) {
  const declared = Number(responseHeader(response, "content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw Object.assign(new Error("Response exceeded the size limit."), { code: "response_too_large" });
  }
  if (!response.body) {
    const text = typeof response.text === "function" ? await response.text() : "";
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw Object.assign(new Error("Response exceeded the size limit."), { code: "response_too_large" });
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error("Response exceeded the size limit."), { code: "response_too_large" });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function registrationAgeDays(payload, now) {
  if (!payload || !Array.isArray(payload.events)) return null;
  const registration = payload.events.find((event) =>
    ["registration", "registered"].includes(String(event.eventAction ?? "").toLowerCase()));
  const date = registration?.eventDate ? new Date(registration.eventDate) : null;
  if (!date || Number.isNaN(date.getTime()) || date > now) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function atsProvider(hostname) {
  for (const [provider, hosts] of atsHosts) {
    if (hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return provider;
  }
  return null;
}

export async function inspectCareerUrl(value, {
  resolver = defaultResolveHost,
  fetchImpl,
  now = () => new Date(),
  domainAgeDays = null,
  skipRdapLookup = false,
  maxResponseBytes = maximumResponseBytes,
  timeoutMs = requestTimeoutMs,
  signal: externalSignal,
} = {}) {
  let initialUrl;
  try {
    if (typeof value !== "string" || value.length > 2000) throw new Error("URL is too long.");
    initialUrl = new URL(value);
  } catch {
    throw Object.assign(new Error("URL is invalid."), { code: "invalid_url" });
  }
  if (!isAllowedHttpUrl(initialUrl) || !initialUrl.hostname) {
    throw Object.assign(new Error("URL must be HTTP(S) without embedded credentials."), { code: "invalid_url" });
  }

  if (externalSignal?.aborted) {
    throw Object.assign(new Error("URL inspection was cancelled."), { code: "cancelled" });
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("URL inspection timed out."), { code: "timeout" }));
    }, timeoutMs);
  });
  const perform = async () => {
    let target = initialUrl;
    let redirects = 0;
    let response;
    let pageText = "";
    while (true) {
      if (controller.signal.aborted) throw Object.assign(new Error("URL inspection timed out."), { code: "timeout" });
      const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const resolvedAddresses = await resolvePublicHost(hostname, resolver);
      if (controller.signal.aborted) throw Object.assign(new Error("URL inspection was cancelled."), { code: "cancelled" });
      response = fetchImpl
        ? await fetchImpl(target, {
          method: "GET",
          headers: { Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1" },
          redirect: "manual",
          signal: controller.signal,
          resolvedAddresses,
          maxResponseBytes,
        })
        : await nodeRequestPinned(target, {
          signal: controller.signal,
          resolvedAddresses,
          maxBytes: maxResponseBytes,
        });
      if (!redirectStatuses.has(response.status)) break;
      if (redirects >= 3) throw Object.assign(new Error("URL exceeded the redirect limit."), { code: "redirect_limit" });
      const location = responseHeader(response, "location");
      if (!location) throw Object.assign(new Error("Redirect did not include a location."), { code: "invalid_redirect" });
      let redirected;
      try {
        redirected = new URL(location, target);
      } catch {
        throw Object.assign(new Error("Redirect URL is invalid."), { code: "invalid_redirect" });
      }
      if (!isAllowedHttpUrl(redirected)) {
        throw Object.assign(new Error("Redirect URL is unsafe."), { code: "invalid_redirect" });
      }
      target = redirected;
      redirects++;
    }
    const initialHostname = initialUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const finalHostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (response.ok) pageText = stripHtml(await readResponseText(response, maxResponseBytes), maxResponseBytes);
    return {
      ok: Boolean(response.ok),
      error: response.ok ? null : "http_error",
      hostname: initialHostname,
      final_hostname: finalHostname,
      status: Number(response.status),
      redirect_count: redirects,
      redirected_to_different_host: initialHostname !== finalHostname,
      dns_ok: true,
      https_ok: target.protocol === "https:",
      ats_provider: atsProvider(finalHostname),
      rdap_age_days: domainAgeDays,
      page_text: pageText,
    };
  };

  try {
    const targetHostname = initialUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const urlCheck = await Promise.race([perform(), timeout]);
    let rdapAge = domainAgeDays;
    if (rdapAge === null && !skipRdapLookup && !isIP(targetHostname)) {
      const rdapTask = (async () => {
        const domain = targetHostname;
        let rdapTarget = new URL(encodeURIComponent(domain), rdapBaseUrl);
        let rdapResponse;
        let redirects = 0;
        while (true) {
          if (controller.signal.aborted) throw Object.assign(new Error("URL inspection was cancelled."), { code: "cancelled" });
          const rdapAddresses = await resolvePublicHost(
            rdapTarget.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
            resolver,
          );
          if (controller.signal.aborted) throw Object.assign(new Error("URL inspection was cancelled."), { code: "cancelled" });
          rdapResponse = fetchImpl
            ? await fetchImpl(rdapTarget, {
              method: "GET",
              headers: {
                Accept: "application/rdap+json, application/json",
                "Accept-Encoding": "identity",
              },
              redirect: "manual",
              signal: controller.signal,
              resolvedAddresses: rdapAddresses,
              maxResponseBytes,
            })
            : await nodeRequestPinned(rdapTarget, {
              signal: controller.signal,
              resolvedAddresses: rdapAddresses,
              maxBytes: maxResponseBytes,
            });
          if (!redirectStatuses.has(rdapResponse.status)) break;
          if (redirects >= 3) return null;
          const location = responseHeader(rdapResponse, "location");
          if (!location) return null;
          const redirected = new URL(location, rdapTarget);
          if (!isAllowedHttpUrl(redirected) || redirected.protocol !== "https:") return null;
          rdapTarget = redirected;
          redirects++;
        }
        if (!rdapResponse.ok) return null;
        const text = await readResponseText(rdapResponse, maxResponseBytes);
        try {
          return registrationAgeDays(JSON.parse(text), now());
        } catch {
          return null;
        }
      })().catch((error) => {
        if (externalSignal?.aborted) throw error;
        return null;
      });
      rdapAge = await Promise.race([rdapTask, timeout]);
    }
    return { ...urlCheck, rdap_age_days: rdapAge };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function careerUrlHostname(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (!isAllowedHttpUrl(url)) return null;
    return url.hostname.replace(/^\[|\]$/g, "").toLowerCase() || null;
  } catch {
    return null;
  }
}
