"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Alert = {
  id: string;
  title: string;
  source: string;
  severity: string;
  difficulty: string;
  details: string;
};

type Round = { roundToken: string; expiresAt: string; alerts: Alert[] };

type Review = {
  id: string;
  title: string;
  selectedVerdict: "true_positive" | "false_positive";
  correctVerdict: "true_positive" | "false_positive";
  correct: boolean;
  explanation: string;
  mitre: string | null;
  points: number;
};

type Result = {
  score: number;
  correctCount: number;
  speedBonusPerCorrectAnswer: number;
  maximumScore: number;
  reviews: Review[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAlert(value: unknown): value is Alert {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.title === "string"
    && typeof value.source === "string" && typeof value.severity === "string"
    && typeof value.difficulty === "string" && typeof value.details === "string"
    && !("verdict" in value) && !("explanation" in value) && !("mitre" in value);
}

function isRound(value: unknown): value is Round {
  if (!isRecord(value) || !("alerts" in value)) return false;
  const row = value;
  return typeof row.roundToken === "string" && typeof row.expiresAt === "string"
    && Array.isArray(row.alerts) && row.alerts.length === 10 && row.alerts.every(isAlert);
}

function isResult(value: unknown): value is Result {
  if (!isRecord(value)) return false;
  const row = value;
  return typeof row.score === "number" && typeof row.correctCount === "number"
    && typeof row.speedBonusPerCorrectAnswer === "number" && typeof row.maximumScore === "number"
    && Array.isArray(row.reviews) && row.reviews.every((review: unknown) =>
      isRecord(review)
      && typeof review.id === "string" && typeof review.title === "string"
      && (review.selectedVerdict === "true_positive" || review.selectedVerdict === "false_positive")
      && (review.correctVerdict === "true_positive" || review.correctVerdict === "false_positive")
      && typeof review.correct === "boolean" && typeof review.explanation === "string"
      && (review.mitre === null || typeof review.mitre === "string")
      && typeof review.points === "number",
    );
}

async function readApiResponse(response: Response): Promise<unknown> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("The game service returned an unreadable response.");
  }
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "The game service could not complete that request.";
    throw new Error(message);
  }
  return data;
}

export default function AlertTriageGame() {
  const [round, setRound] = useState<Round | null>(null);
  const [answers, setAnswers] = useState<Record<string, "true_positive" | "false_positive">>({});
  const [nickname, setNickname] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!round || result) return;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(round.expiresAt) - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        setRound(null);
        setAnswers({});
        setNotice("This round expired. Start a new round to play again.");
      }
    };
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [round, result]);

  async function startRound() {
    setBusy(true);
    setNotice("");
    try {
      const data = await readApiResponse(await fetch("/api/triage/round", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      }));
      if (!isRound(data)) throw new Error("The game service returned an invalid round.");
      setRound(data);
      setAnswers({});
      setResult(null);
      setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(data.expiresAt) - Date.now()) / 1000)));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "A new round could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRound() {
    if (!round || Object.keys(answers).length !== round.alerts.length) return;
    setBusy(true);
    setNotice("");
    try {
      const data = await readApiResponse(await fetch("/api/triage/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          roundToken: round.roundToken,
          nickname: nickname.trim(),
          answers: round.alerts.map((alert) => ({ alertId: alert.id, verdict: answers[alert.id] })),
        }),
      }));
      if (!isResult(data)) throw new Error("The game service returned an invalid score review.");
      setResult(data);
      setRound(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Your score could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  const complete = round !== null && round.alerts.every((alert) => Boolean(answers[alert.id]));
  return (
    <section className="triage-game" aria-label="SOC alert triage challenge">
      <div className="triage-intro">
        <p>Review ten alerts and classify each as a true positive or false positive. The server selects a balanced set and keeps every answer private until you submit.</p>
        <p className="form-privacy">Use an alias only: never enter your real name, email, or other identifying details. Nicknames and scores are public.</p>
      </div>
      {notice ? <p className="inline-note" role="alert">{notice}</p> : null}
      {!round && !result ? <button className="button button-primary" type="button" onClick={() => void startRound()} disabled={busy}>{busy ? "Starting round…" : "Start a 10-alert round"}</button> : null}

      {round ? (
        <>
          <div className="triage-round-heading">
            <p className="eyebrow">ROUND IN PROGRESS · {round.alerts.length} ALERTS</p>
            <p aria-live="polite">Time remaining: {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</p>
          </div>
          <div className="triage-alert-list">
            {round.alerts.map((alert, index) => (
              <article className="triage-alert" key={alert.id}>
                <p className="card-index">ALERT {String(index + 1).padStart(2, "0")} · {alert.source} · {alert.severity}</p>
                <h2>{alert.title}</h2>
                <p>{alert.details}</p>
                <fieldset>
                  <legend>Your verdict</legend>
                  <label><input type="radio" name={`verdict-${alert.id}`} value="true_positive" checked={answers[alert.id] === "true_positive"} onChange={() => setAnswers({ ...answers, [alert.id]: "true_positive" })} /> True positive</label>
                  <label><input type="radio" name={`verdict-${alert.id}`} value="false_positive" checked={answers[alert.id] === "false_positive"} onChange={() => setAnswers({ ...answers, [alert.id]: "false_positive" })} /> False positive</label>
                </fieldset>
              </article>
            ))}
          </div>
          <div className="triage-submit">
            <label htmlFor="triage-nickname">Public nickname (3–20 characters)</label>
            <input id="triage-nickname" maxLength={20} minLength={3} value={nickname} onChange={(event) => setNickname(event.target.value)} autoComplete="off" />
            <p className="form-privacy">Do not use your real name or contact details. Scores appear on the public <Link href="/leaderboard">leaderboard</Link>.</p>
            <button className="button button-primary" type="button" onClick={() => void submitRound()} disabled={busy || !complete || nickname.trim().length < 3 || remainingSeconds === 0}>
              {busy ? "Scoring on the server…" : `Submit answers · ${Object.keys(answers).length}/10`}
            </button>
          </div>
        </>
      ) : null}

      {result ? (
        <section className="triage-results" aria-live="polite">
          <div className="triage-result-score">
            <p className="eyebrow">ROUND COMPLETE</p>
            <h2>{result.score.toLocaleString()} <span>/ {result.maximumScore.toLocaleString()}</span></h2>
            <p>{result.correctCount} of 10 correct · {result.speedBonusPerCorrectAnswer} speed bonus per correct answer</p>
          </div>
          <h2>Answer review</h2>
          {result.reviews.map((review) => (
            <article className={`triage-review ${review.correct ? "review-correct" : "review-incorrect"}`} key={review.id}>
              <p className="card-index">{review.correct ? "CORRECT" : "REVIEW"} · {review.points} POINTS</p>
              <h3>{review.title}</h3>
              <p>Your answer: {review.selectedVerdict === "true_positive" ? "True positive" : "False positive"} · Correct: {review.correctVerdict === "true_positive" ? "True positive" : "False positive"}</p>
              <p>{review.explanation}</p>
              {review.mitre ? <p className="card-index">MITRE ATT&amp;CK {review.mitre}</p> : null}
            </article>
          ))}
          <button className="button button-primary" type="button" onClick={() => { setResult(null); setAnswers({}); setNotice(""); }}>Play again</button>
          <Link className="button button-quiet" href="/leaderboard">View leaderboard</Link>
        </section>
      ) : null}
    </section>
  );
}
