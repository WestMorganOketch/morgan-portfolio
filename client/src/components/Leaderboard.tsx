"use client";

import { useEffect, useState } from "react";

type Score = { id: string; nickname: string; score: number; createdAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isScoreList(value: unknown): value is Score[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item)
    && typeof item.id === "string"
    && typeof item.nickname === "string"
    && typeof item.score === "number"
    && typeof item.createdAt === "string",
  );
}

export default function Leaderboard() {
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const wakeTimer = window.setTimeout(() => {
      if (active) setNotice("Waking up the leaderboard service.");
    }, 4000);
    void fetch("/api/leaderboard", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The leaderboard could not be loaded.");
        const data: unknown = await response.json();
        if (!isScoreList(data)) throw new Error("The leaderboard service returned unexpected data.");
        if (active) {
          setScores(data);
          setNotice("");
        }
      })
      .catch((cause: unknown) => {
        if (active) setNotice(cause instanceof Error ? cause.message : "The leaderboard is temporarily unavailable.");
      })
      .finally(() => {
        window.clearTimeout(wakeTimer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(wakeTimer);
    };
  }, []);

  return (
    <section className="leaderboard-content" aria-label="Top alert triage scores">
      {loading && notice ? <p className="inline-note" role="status">{notice}</p> : null}
      {!loading && notice ? <p className="inline-note" role="alert">{notice}</p> : null}
      {!loading && !notice && scores.length === 0 ? <p className="coming-soon-card">No scores yet. Play a round to appear on the board.</p> : null}
      {scores.length ? (
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <caption>Top 20 scores. Only the nickname you choose, your score, and the date are shown.</caption>
            <thead><tr><th scope="col">Rank</th><th scope="col">Nickname</th><th scope="col">Score</th><th scope="col">Date</th></tr></thead>
            <tbody>{scores.map((score, index) => (
              <tr key={score.id}>
                <td>{index + 1}</td>
                <td>{score.nickname}</td>
                <td>{score.score.toLocaleString()}</td>
                <td><time dateTime={score.createdAt}>{new Date(score.createdAt).toLocaleDateString()}</time></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
