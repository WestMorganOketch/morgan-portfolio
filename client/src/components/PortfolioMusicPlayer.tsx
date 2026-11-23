"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AudioLines,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

const TRACK_SOURCE = "/audio/videoplayback.m4a";
const DEFAULT_VOLUME = 0.72;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes + ":" + String(remainder).padStart(2, "0");
}

export default function PortfolioMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = DEFAULT_VOLUME;
    audio.preload = "none";
  }, []);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    setMessage("");
    setFailed(false);
    try {
      await audio.play();
    } catch {
      setPlaying(false);
      setFailed(true);
      setMessage("The soundtrack could not be loaded. Please try again later.");
    }
  }, []);

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.currentTarget.value);
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTime)) return;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Number(event.currentTarget.value);
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextVolume)) return;
    audio.volume = nextVolume;
    audio.muted = false;
    setVolume(nextVolume);
    setMuted(false);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextMuted = !audio.muted;
    audio.muted = nextMuted;
    setMuted(nextMuted);
  };

  const retry = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setFailed(false);
    setMessage("");
    audio.load();
    void togglePlayback();
  };

  return (
    <section className="portfolio-music" aria-label="Portfolio music player">
      <audio
        ref={audioRef}
        src={TRACK_SOURCE}
        preload="none"
        playsInline
        onPlay={() => {
          setPlaying(true);
          setMessage("");
          setFailed(false);
        }}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
          setReady(true);
          setFailed(false);
        }}
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration)) setDuration(nextDuration);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onCanPlay={() => {
          setReady(true);
          setFailed(false);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => {
          setReady(false);
          setPlaying(false);
          setFailed(true);
          setMessage("The soundtrack is temporarily unavailable.");
        }}
      />

      <div className="portfolio-music-heading">
        <span className="portfolio-music-kicker"><span aria-hidden="true" /> PERSONAL SOUNDTRACK</span>
        <span className="portfolio-music-live-label">{playing ? "NOW PLAYING" : "PRESS PLAY"}</span>
      </div>

      <div className="portfolio-music-track">
        <div className="portfolio-music-art" aria-hidden="true">
          <AudioLines size={22} strokeWidth={1.7} />
          <span className="portfolio-music-art-bars"><i /><i /><i /><i /><i /></span>
        </div>
        <div className="portfolio-music-track-copy">
          <p className="portfolio-music-title">Portfolio soundtrack</p>
          <p className="portfolio-music-subtitle">{playing ? "Music is playing" : "A little music while you explore"}</p>
        </div>
        <span className={playing ? "portfolio-music-playing is-active" : "portfolio-music-playing"} aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      </div>

      <div className="portfolio-music-controls">
        <button
          className="portfolio-music-play"
          type="button"
          onClick={() => void togglePlayback()}
          aria-label={playing ? "Pause soundtrack" : "Play soundtrack"}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
        </button>
        <div className="portfolio-music-progress">
          <input
            className="portfolio-music-seek"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(currentTime, duration || currentTime)}
            onChange={handleSeek}
            disabled={!ready || duration <= 0 || failed}
            aria-label="Seek through soundtrack"
            style={{ "--music-progress": duration > 0 ? (currentTime / duration) * 100 + "%" : "0%" } as React.CSSProperties}
          />
          <div className="portfolio-music-times" aria-live="off">
            <time>{formatTime(currentTime)}</time>
            <time>{duration > 0 ? formatTime(duration) : "--:--"}</time>
          </div>
        </div>
        <button
          className="portfolio-music-volume-button"
          type="button"
          onClick={toggleMute}
          aria-label={muted || volume === 0 ? "Unmute soundtrack" : "Mute soundtrack"}
          title={muted || volume === 0 ? "Unmute" : "Mute"}
        >
          {muted || volume === 0 ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
        </button>
      </div>

      <div className="portfolio-music-volume-row">
        <span>VOLUME</span>
        <input
          className="portfolio-music-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={handleVolumeChange}
          aria-label="Music volume"
        />
        <span>{Math.round((muted ? 0 : volume) * 100)}%</span>
      </div>

      {message && (
        <div className="portfolio-music-message" role="status">
          <span>{message}</span>
          {failed && (
            <button type="button" onClick={retry} aria-label="Retry loading soundtrack" title="Retry">
              <RotateCcw size={13} aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      )}
    </section>
  );
}
