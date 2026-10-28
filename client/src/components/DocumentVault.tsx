"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, FileText } from "lucide-react";

type PublicDocument = {
  id: string;
  title: string;
  category: "Resume" | "Certificates" | "Lab Reports";
  description: string;
  issuedDate: string | null;
  verifyUrl: string | null;
  fileAvailable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDocumentList(value: unknown): value is PublicDocument[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item)
    && typeof item.id === "string"
    && typeof item.title === "string"
    && ["Resume", "Certificates", "Lab Reports"].includes(String(item.category))
    && typeof item.description === "string"
    && (item.issuedDate === null || typeof item.issuedDate === "string")
    && (item.verifyUrl === null || (typeof item.verifyUrl === "string" && item.verifyUrl.startsWith("https://")))
    && typeof item.fileAvailable === "boolean",
  );
}

export default function DocumentVault() {
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const wakeTimer = window.setTimeout(() => {
      if (active) setNotice("Waking up the document service. Your search will continue automatically.");
    }, 4000);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    const search = params.toString();
    void fetch(`/api/documents${search ? `?${search}` : ""}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Published documents could not be loaded.");
        const data: unknown = await response.json();
        if (!isDocumentList(data)) throw new Error("The document service returned an unexpected response.");
        if (active) setDocuments(data);
      })
      .catch((cause: unknown) => {
        if (active) setNotice(cause instanceof Error ? cause.message : "The document service is temporarily unavailable.");
      })
      .finally(() => {
        window.clearTimeout(wakeTimer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(wakeTimer);
    };
  }, [category, query]);

  return (
    <section className="vault-content" aria-label="Published documents">
      <div className="vault-filters">
        <div><label htmlFor="document-search">Search by title</label><input id="document-search" type="search" maxLength={100} value={query} onChange={(event) => { setNotice(""); setLoading(true); setQuery(event.target.value); }} placeholder="Search published documents" /></div>
        <div><label htmlFor="document-category">Category</label><select id="document-category" value={category} onChange={(event) => { setNotice(""); setLoading(true); setCategory(event.target.value); }}>
          <option value="">All categories</option><option value="Resume">Resume</option><option value="Certificates">Certificates</option><option value="Lab Reports">Lab Reports</option>
        </select></div>
      </div>
      {loading && notice ? <p className="inline-note" role="status">{notice}</p> : null}
      {!loading && notice ? <p className="inline-note" role="alert">{notice}</p> : null}
      {!loading && !notice && documents.length === 0 ? (
        <div className="coming-soon-card vault-empty">
          <FileText size={24} aria-hidden="true" />
          <h2>No published documents yet.</h2>
          <p>Documents appear here only after Morgan uploads and publishes them from the private admin dashboard.</p>
        </div>
      ) : null}
      <div className="vault-grid">
        {documents.map((document) => (
          <article className="vault-card" key={document.id}>
            <p className="card-index">{document.category.toUpperCase()}{document.issuedDate ? ` · ${document.issuedDate}` : ""}</p>
            <h2>{document.title}</h2>
            {document.description ? <p>{document.description}</p> : null}
            <div className="vault-actions">
              {document.fileAvailable ? <>
                <a className="text-link" href={`/api/documents/${document.id}/file`} target="_blank" rel="noreferrer">View file <ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>
                <a className="text-link" href={`/api/documents/${document.id}/file?download=1`}><ArrowDownToLine size={14} aria-hidden="true" /> Download</a>
              </> : <span className="draft-status">FILE NOT AVAILABLE</span>}
              {document.verifyUrl ? <a className="text-link" href={document.verifyUrl} target="_blank" rel="noreferrer">Verify this certificate <ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
