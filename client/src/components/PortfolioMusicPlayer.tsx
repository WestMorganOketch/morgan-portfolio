"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AudioLines,
  LoaderCircle,
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
  const [loading, setLoading] = useState(false);
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
    // Fetch only the small metadata range on page load. The full track is
    // prepared when a visitor focuses or moves onto the Play control.
    audio.preload = "metadata";
  }, []);

  const prepareAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.preload === "auto") return;
    audio.preload = "auto";
    audio.load();
  }, []);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (loading || !audio.paused) {
      audio.pause();
      setLoading(false);
      return;
    }

    setMessage("");
    setFailed(false);
    setLoading(true);
    audio.preload = "auto";
    try {
      await audio.play();
    } catch (error: unknown) {
      setPlaying(false);
      if (error instanceof Error && error.name === "AbortError") return;
      setFailed(true);
      setMessage("The soundtrack could not be loaded. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, [loading]);

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
    if (audio.muted || volume === 0) {
      const restoredVolume = volume > 0 ? volume : DEFAULT_VOLUME;
      audio.volume = restoredVolume;
      audio.muted = false;
      setVolume(restoredVolume);
      setMuted(false);
      return;
    }
    audio.muted = true;
    setMuted(true);
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
    <section className="portfolio-music" aria-label="Portfolio music player" aria-busy={loading}>
      <audio
        ref={audioRef}
        src={TRACK_SOURCE}
        preload="metadata"
        playsInline
        onPlay={() => {
          setPlaying(true);
          setMessage("");
          setFailed(false);
        }}
        onPlaying={() => {
          setLoading(false);
          setPlaying(true);
          setMessage("");
        }}
        onWaiting={() => setLoading(true)}
        onPause={() => {
          setPlaying(false);
          setLoading(false);
        }}
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
          setLoading(false);
          setFailed(false);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => {
          setReady(false);
          setPlaying(false);
          setLoading(false);
          setFailed(true);
          setMessage("The soundtrack is temporarily unavailable.");
        }}
      />

      <div className="portfolio-music-heading">
        <span className="portfolio-music-kicker"><span aria-hidden="true" /> PERSONAL SOUNDTRACK</span>
        <span className="portfolio-music-live-label">{loading ? "BUFFERING" : playing ? "NOW PLAYING" : "PRESS PLAY"}</span>
      </div>

      <div className="portfolio-music-track">
        <div className="portfolio-music-art" aria-hidden="true">
          <AudioLines size={22} strokeWidth={1.7} />
          <span className="portfolio-music-art-bars"><i /><i /><i /><i /><i /></span>
        </div>
        <div className="portfolio-music-track-copy">
          <p className="portfolio-music-title">West's professional Anthem</p>
          <p className="portfolio-music-subtitle">{loading ? "Preparing your soundtrack…" : playing ? "Music is playing" : "A little music while you explore"}</p>
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
          onPointerEnter={prepareAudio}
          onFocus={prepareAudio}
          aria-label={loading ? "Buffering soundtrack" : playing ? "Pause soundtrack" : "Play soundtrack"}
          title={loading ? "Loading…" : playing ? "Pause" : "Play"}
        >
          {loading
            ? <LoaderCircle className="portfolio-music-loading-icon" size={16} aria-hidden="true" />
            : playing
              ? <Pause size={16} fill="currentColor" aria-hidden="true" />
              : <Play size={16} fill="currentColor" aria-hidden="true" />}
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
          style={{ "--music-volume": (muted ? 0 : volume) * 100 + "%" } as React.CSSProperties}
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
