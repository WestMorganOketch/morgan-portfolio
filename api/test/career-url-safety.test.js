import assert from "node:assert/strict";
import test from "node:test";
import { inspectCareerUrl, isPublicAddress } from "../src/careerUrlSafety.js";

const publicAddress = { address: "8.8.8.8", family: 4 };

function response(body = "listing", { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

test("public-address checks reject private, reserved, mapped, and metadata ranges", () => {
  for (const address of [
    "0.1.2.3", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1",
    "203.0.113.1", "224.0.0.1", "240.0.0.1", "::", "::1", "::ffff:127.0.0.1",
    "fc00::1", "fe80::1", "2001:20::1", "2001:db8::1", "2002::1", "3fff::1",
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} is not public`);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
});

test("rejects embedded credentials and private initial targets before fetching", async () => {
  let fetchCalls = 0;
  let resolutionCalls = 0;
  await assert.rejects(
    inspectCareerUrl("https://user:pass@example.com/jobs", {
      resolver: async () => [publicAddress],
      fetchImpl: async () => { fetchCalls++; return response(); },
    }),
    { code: "invalid_url" },
  );
  await assert.rejects(
    inspectCareerUrl("http://metadata.example/latest", {
      resolver: async () => {
        resolutionCalls++;
        return [{ address: "169.254.169.254", family: 4 }];
      },
      fetchImpl: async () => { fetchCalls++; return response(); },
    }),
    { code: "blocked_address" },
  );
  await assert.rejects(
    inspectCareerUrl("http://localhost/jobs", {
      resolver: async () => { resolutionCalls++; return [publicAddress]; },
      fetchImpl: async () => { fetchCalls++; return response(); },
    }),
    { code: "blocked_address" },
  );
  assert.equal(fetchCalls, 0);
  assert.equal(resolutionCalls, 1);
});

test("rejects nonstandard ports before any request", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    inspectCareerUrl("https://jobs.example:8443/careers", {
      resolver: async () => [publicAddress],
      fetchImpl: async () => { fetchCalls++; return response(); },
    }),
    { code: "invalid_url" },
  );
  assert.equal(fetchCalls, 0);
});

test("re-resolves redirect targets and blocks a private redirect destination", async () => {
  const fetchCalls = [];
  await assert.rejects(
    inspectCareerUrl("https://jobs.example/jobs", {
      resolver: async (hostname) => hostname === "internal.example"
        ? [{ address: "10.0.0.4", family: 4 }]
        : [publicAddress],
      fetchImpl: async (url) => {
        fetchCalls.push(url.hostname);
        return response("", { status: 302, headers: { location: "https://internal.example/" } });
      },
    }),
    { code: "blocked_address" },
  );
  assert.deepEqual(fetchCalls, ["jobs.example"]);
});

test("rejects a DNS-rebinding redirect before the second request", async () => {
  let resolutions = 0;
  const fetchCalls = [];
  await assert.rejects(
    inspectCareerUrl("https://rebind.example/start", {
      resolver: async () => {
        resolutions++;
        return resolutions === 1 ? [publicAddress] : [{ address: "127.0.0.1", family: 4 }];
      },
      fetchImpl: async (url) => {
        fetchCalls.push(url.pathname);
        return response("", { status: 302, headers: { location: "/next" } });
      },
    }),
    { code: "blocked_address" },
  );
  assert.equal(resolutions, 2);
  assert.deepEqual(fetchCalls, ["/start"]);
});

test("pins only validated public addresses into the HTTP transport contract", async () => {
  let requestOptions;
  const result = await inspectCareerUrl("https://jobs.lever.co/acme", {
    resolver: async () => [publicAddress],
    domainAgeDays: 220,
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return response("<h1>Acme roles</h1>");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ats_provider, "lever");
  assert.deepEqual(requestOptions.resolvedAddresses, [publicAddress]);
  assert.equal(result.page_text, "Acme roles");
  assert.equal(result.rdap_age_days, 220);
});

test("follows RDAP redirects only after public-address validation", async () => {
  const calls = [];
  const now = new Date("2025-01-01T00:00:00.000Z");
  const result = await inspectCareerUrl("https://jobs.acme.example/careers", {
    now: () => now,
    resolver: async () => [publicAddress],
    fetchImpl: async (url) => {
      calls.push(url.hostname);
      if (url.hostname === "jobs.acme.example") return response("careers");
      if (url.hostname === "rdap.org") {
        return response("", { status: 302, headers: { location: "https://rdap.registry.example/domain/acme.example" } });
      }
      return response(JSON.stringify({
        events: [{ eventAction: "registration", eventDate: "2024-01-01T00:00:00.000Z" }],
      }));
    },
  });
  assert.deepEqual(calls, ["jobs.acme.example", "rdap.org", "rdap.registry.example"]);
  assert.equal(result.rdap_age_days, 366);
});

test("can honor a cached unknown RDAP result without issuing another RDAP request", async () => {
  const calls = [];
  const result = await inspectCareerUrl("https://jobs.example/careers", {
    resolver: async () => [publicAddress],
    skipRdapLookup: true,
    fetchImpl: async (url) => {
      calls.push(url.hostname);
      return response("careers");
    },
  });
  assert.deepEqual(calls, ["jobs.example"]);
  assert.equal(result.rdap_age_days, null);
});

test("enforces response cap for declared and streamed bodies", async () => {
  await assert.rejects(
    inspectCareerUrl("https://jobs.example/", {
      resolver: async () => [publicAddress],
      domainAgeDays: 200,
      maxResponseBytes: 16,
      fetchImpl: async () => response("oversized", { headers: { "content-length": "17" } }),
    }),
    { code: "response_too_large" },
  );

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123456789"));
      controller.enqueue(new TextEncoder().encode("abcdefgh"));
      controller.close();
    },
  });
  await assert.rejects(
    inspectCareerUrl("https://jobs.example/", {
      resolver: async () => [publicAddress],
      domainAgeDays: 200,
      maxResponseBytes: 16,
      fetchImpl: async () => new Response(stream),
    }),
    { code: "response_too_large" },
  );
});

test("enforces the inspection timeout and supports caller cancellation", async () => {
  await assert.rejects(
    inspectCareerUrl("https://jobs.example/", {
      resolver: async () => [publicAddress],
      domainAgeDays: 200,
      timeoutMs: 10,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }),
    }),
    { code: "timeout" },
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inspectCareerUrl("https://jobs.example/", {
      signal: controller.signal,
      resolver: async () => [publicAddress],
      fetchImpl: async () => response(),
    }),
    { code: "cancelled" },
  );
});
