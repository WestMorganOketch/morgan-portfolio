"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
};

type Score = { id: string; nickname: string; score: number; createdAt: string };

type DocumentEntry = {
  id: string;
  title: string;
  category: "Resume" | "Certificates" | "Lab Reports";
  description: string;
  issuedDate: string | null;
  verifyUrl: string | null;
  fileAvailable: boolean;
  isPublished: boolean;
};

type DocumentForm = Omit<DocumentEntry, "id" | "fileAvailable">;

const emptyDocument: DocumentForm = {
  title: "",
  category: "Resume",
  description: "",
  issuedDate: null,
  verifyUrl: null,
  isPublished: false,
};

function isDocumentCategory(value: string): value is DocumentForm["category"] {
  return value === "Resume" || value === "Certificates" || value === "Lab Reports";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMessageList(value: unknown): value is ContactMessage[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item) && typeof item.id === "string" && typeof item.name === "string"
    && typeof item.email === "string" && typeof item.subject === "string"
    && typeof item.message === "string" && typeof item.createdAt === "string",
  );
}

function isScoreList(value: unknown): value is Score[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item) && typeof item.id === "string" && typeof item.nickname === "string"
    && typeof item.score === "number" && typeof item.createdAt === "string",
  );
}

function isDocument(value: unknown): value is DocumentEntry {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string"
    && ["Resume", "Certificates", "Lab Reports"].includes(String(value.category))
    && typeof value.description === "string"
    && (value.issuedDate === null || typeof value.issuedDate === "string")
    && (value.verifyUrl === null || typeof value.verifyUrl === "string")
    && typeof value.fileAvailable === "boolean" && typeof value.isPublished === "boolean";
}

function isDocumentList(value: unknown): value is DocumentEntry[] {
  return Array.isArray(value) && value.every(isDocument);
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, credentials: "include", cache: "no-store" });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The admin service returned an unreadable response.");
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

export default function AdminExtensions({ csrfToken }: { csrfToken: string }) {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [documentForm, setDocumentForm] = useState<DocumentForm>(emptyDocument);
  const [editingDocumentId, setEditingDocumentId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadFeatures = useCallback(async () => {
    const [messageData, scoreData, documentData] = await Promise.all([
      request("/api/admin/contact-messages"),
      request("/api/admin/triage/scores"),
      request("/api/admin/documents"),
    ]);
    if (!isMessageList(messageData) || !isScoreList(scoreData) || !isDocumentList(documentData)) {
      throw new Error("The admin service returned unexpected feature data.");
    }
    setMessages(messageData);
    setScores(scoreData);
    setDocuments(documentData);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadFeatures().catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Admin features could not be loaded.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loadFeatures]);

  async function refreshFeatures() {
    setError("");
    await loadFeatures();
  }

  async function deleteItem(path: string, prompt: string, success: string) {
    if (!window.confirm(prompt)) return;
    setError("");
    setMessage("");
    try {
      await request(path, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } });
      await refreshFeatures();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The item could not be deleted.");
    }
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const payload = {
      ...documentForm,
      title: documentForm.title.trim(),
      description: documentForm.description.trim(),
      issuedDate: documentForm.issuedDate || null,
      verifyUrl: documentForm.verifyUrl?.trim() || null,
    };
    try {
      const saved = await request(editingDocumentId ? `/api/admin/documents/${editingDocumentId}` : "/api/admin/documents", {
        method: editingDocumentId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(payload),
      });
      if (!isDocument(saved)) throw new Error("The document service returned an invalid record.");
      await refreshFeatures();
      setEditingDocumentId(saved.id);
      setDocumentForm({
        title: saved.title,
        category: saved.category,
        description: saved.description,
        issuedDate: saved.issuedDate,
        verifyUrl: saved.verifyUrl,
        isPublished: saved.isPublished,
      });
      setMessage(editingDocumentId ? "Document details updated." : "Draft saved. Select a file to upload it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function editDocument(document: DocumentEntry) {
    setEditingDocumentId(document.id);
    setDocumentForm({
      title: document.title,
      category: document.category,
      description: document.description,
      issuedDate: document.issuedDate,
      verifyUrl: document.verifyUrl,
      isPublished: document.isPublished,
    });
    setSelectedFile(null);
    setMessage("");
    setError("");
  }

  function resetDocumentForm() {
    setDocumentForm(emptyDocument);
    setEditingDocumentId("");
    setSelectedFile(null);
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDocumentId || !selectedFile) return;
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("Choose a file that is 10 MB or smaller.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const body = new FormData();
    body.append("file", selectedFile);
    try {
      const response = await request(`/api/admin/documents/${editingDocumentId}/upload`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
        body,
      });
      if (!isRecord(response) || !isDocument(response.document)) {
        throw new Error("The document service returned an invalid upload result.");
      }
      setSelectedFile(null);
      await refreshFeatures();
      setMessage(typeof response.warning === "string" ? response.warning : "File uploaded and verified. Publishing remains a separate choice.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {loading ? <p className="admin-help" role="status">Loading private inbox, scores, and documents…</p> : null}
      {error ? <p className="admin-message admin-error" role="alert">{error}</p> : null}
      {message ? <p className="admin-message" role="status">{message}</p> : null}
      {!loading ? (
        <>
          <section className="admin-panel" aria-labelledby="contact-inbox-title">
            <div className="admin-panel-heading"><div><p className="eyebrow">PRIVATE INBOX · 90-DAY RETENTION</p><h2 id="contact-inbox-title">Contact messages</h2></div></div>
            <p className="admin-help">Only the signed-in administrator can read these messages. Expired messages are removed during API startup and cleanup; messages expire 90 days after receipt.</p>
            {messages.length ? <div className="admin-project-list">{messages.map((entry) => (
              <article className="admin-project inbox-message" key={entry.id}>
                <div>
                  <div className="mission-meta"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></div>
                  <h3>{entry.subject}</h3>
                  <p><strong>{entry.name}</strong> · <a href={`mailto:${entry.email}`}>{entry.email}</a></p>
                  <p className="inbox-body">{entry.message}</p>
                </div>
                <div className="admin-project-actions"><button className="text-link delete-action" type="button" onClick={() => void deleteItem(`/api/admin/contact-messages/${entry.id}`, "Delete this private message? This cannot be undone.", "Message deleted.")}>Delete</button></div>
              </article>
            ))}</div> : <p className="admin-help">No unexpired messages are waiting.</p>}
          </section>

          <section className="admin-panel" aria-labelledby="triage-score-admin-title">
            <div className="admin-panel-heading"><div><p className="eyebrow">PUBLIC GAME SCORES</p><h2 id="triage-score-admin-title">Alert triage entries</h2></div></div>
            {scores.length ? <div className="admin-project-list">{scores.map((score) => (
              <article className="admin-project" key={score.id}>
                <div><div className="mission-meta"><span>{new Date(score.createdAt).toLocaleDateString()}</span></div><h3>{score.nickname}</h3><p>{score.score.toLocaleString()} points</p></div>
                <div className="admin-project-actions"><button className="text-link delete-action" type="button" onClick={() => void deleteItem(`/api/admin/triage/scores/${score.id}`, `Delete the score for "${score.nickname}"?`, "Leaderboard entry deleted.")}>Delete</button></div>
              </article>
            ))}</div> : <p className="admin-help">No player scores have been submitted. No sample players are preloaded.</p>}
          </section>

          <section className="admin-panel" aria-labelledby="document-admin-title">
            <div className="admin-panel-heading"><div><p className="eyebrow">CURATED DOCUMENT VAULT</p><h2 id="document-admin-title">{editingDocumentId ? "Edit a document" : "Add a document draft"}</h2></div></div>
            <p className="admin-help">Only PDF, PNG, and JPG files up to 10 MB are accepted. The API checks file contents, creates a random storage name, and keeps files private until published.</p>
            <form className="project-form" onSubmit={(event) => void saveDocument(event)}>
              <label htmlFor="document-title">Document title</label>
              <input id="document-title" value={documentForm.title} maxLength={120} required onChange={(event) => setDocumentForm({ ...documentForm, title: event.target.value })} />
              <div className="form-row">
                <div>
                  <label htmlFor="document-category">Category</label>
                  <select id="document-category" value={documentForm.category} onChange={(event) => {
                    if (isDocumentCategory(event.target.value)) setDocumentForm({ ...documentForm, category: event.target.value });
                  }}>
                    <option value="Resume">Resume</option><option value="Certificates">Certificates</option><option value="Lab Reports">Lab Reports</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="document-issued-date">Issued date <span>optional; do not guess</span></label>
                  <input id="document-issued-date" type="date" value={documentForm.issuedDate ?? ""} onChange={(event) => setDocumentForm({ ...documentForm, issuedDate: event.target.value || null })} />
                </div>
              </div>
              <label htmlFor="document-description">Description <span>optional · plain text</span></label>
              <textarea id="document-description" rows={3} maxLength={800} value={documentForm.description} onChange={(event) => setDocumentForm({ ...documentForm, description: event.target.value })} />
              <label htmlFor="document-verify-url">Certificate verification URL <span>optional · HTTPS only</span></label>
              <input id="document-verify-url" type="url" maxLength={500} value={documentForm.verifyUrl ?? ""} onChange={(event) => setDocumentForm({ ...documentForm, verifyUrl: event.target.value || null })} />
              <label className="publish-toggle"><input type="checkbox" checked={documentForm.isPublished} disabled={!documents.find((document) => document.id === editingDocumentId)?.fileAvailable} onChange={(event) => setDocumentForm({ ...documentForm, isPublished: event.target.checked })} /> Publish this document publicly</label>
              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editingDocumentId ? "Save document details" : "Create draft"}</button>
                {editingDocumentId ? <button className="button button-quiet" type="button" onClick={resetDocumentForm}>Add a new draft</button> : null}
              </div>
            </form>

            {editingDocumentId ? (
              <form className="project-form document-upload-form" onSubmit={(event) => void uploadDocument(event)}>
                <label htmlFor="document-file">Upload or replace file</label>
                <input id="document-file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
                <p className="form-privacy">10 MB maximum. File content is checked by the server; the original filename is never stored.</p>
                <button className="button button-quiet" type="submit" disabled={busy || !selectedFile}>{busy ? "Uploading…" : "Upload file securely"}</button>
              </form>
            ) : null}

            {documents.length ? <div className="admin-project-list document-admin-list">{documents.map((document) => (
              <article className="admin-project" key={document.id}>
                <div>
                  <div className="mission-meta"><span>{document.category}</span><span className={document.isPublished ? "file-status" : "draft-status"}>{document.isPublished ? "PUBLISHED" : "DRAFT"}</span><span>{document.fileAvailable ? "FILE READY" : "NO FILE"}</span></div>
                  <h3>{document.title}</h3>
                  {document.verifyUrl ? <p>Verification link configured.</p> : null}
                </div>
                <div className="admin-project-actions">
                  <button className="text-link" type="button" onClick={() => editDocument(document)}>Edit</button>
                  <button className="text-link delete-action" type="button" onClick={() => void deleteItem(`/api/admin/documents/${document.id}`, `Delete "${document.title}" and its stored file? This cannot be undone.`, "Document deleted.")}>Delete</button>
                </div>
              </article>
            ))}</div> : <p className="admin-help">No document drafts yet.</p>}
          </section>
        </>
      ) : null}
    </>
  );
}
