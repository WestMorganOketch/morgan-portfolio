"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useMotionPreference } from "@/components/MotionPreference";

export const SNOW_SCOPE = "hero" as const;

export const SNOW_CONFIG = {
  AREA_PER_FLAKE: 22_000,
  MIN_FLAKES: 24,
  MAX_FLAKES: 70,
  MOBILE_BREAKPOINT: 768,
  MOBILE_COUNT_DIVISOR: 2,
  LOW_CORE_COUNT_DIVISOR: 2,
  DELTA_CAP_MS: 50,
  MAX_DPR: 2,
  MIN_SIZE_PX: 1,
  MAX_SIZE_PX: 3,
  MIN_SPEED_PX_PER_SECOND: 14,
  MAX_SPEED_PX_PER_SECOND: 42,
  MIN_OPACITY: 0.12,
  MAX_OPACITY: 0.38,
  MIN_DRIFT_PX: 8,
  MAX_DRIFT_PX: 22,
  GUST_MULTIPLIER: 1.35,
  GUST_WIND_PX: 8,
  REDUCED_FLAKE_COUNT: 18,
  SPRITE_SIZE_PX: 16,
} as const;

type Flake = {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  amplitude: number;
  phase: number;
  phaseSpeed: number;
  sprite: number;
};

type SpriteSet = {
  sprites: HTMLCanvasElement[];
  color: string;
  opacity: number;
};

type SnowController = {
  start: () => void;
  stop: () => void;
  drawStatic: (reduced?: boolean) => void;
  refreshTheme: () => void;
};

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseColor(color: string): [number, number, number] {
  const value = color.trim();
  const shortHex = /^#([\da-f]{3})$/i.exec(value);
  if (shortHex) {
    const chars = shortHex[1].split("");
    return chars.map((char) => Number.parseInt(char + char, 16)) as [number, number, number];
  }
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16),
    ];
  }
  const rgb = value.match(/[\d.]+/g);
  if (rgb && rgb.length >= 3) {
    return [Number(rgb[0]), Number(rgb[1]), Number(rgb[2])];
  }
  return [185, 220, 205];
}

export default function SnowLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<SnowController | null>(null);
  const { preference, isSpinning } = useMotionPreference();
  const prefersReducedMotion = Boolean(useReducedMotion());
  const settingsRef = useRef({ preference, isSpinning, reduced: prefersReducedMotion });

  useEffect(() => {
    settingsRef.current = { preference, isSpinning, reduced: prefersReducedMotion };
    const controller = controllerRef.current;
    if (!controller) return;
    if (preference === "paused" || prefersReducedMotion) {
      controller.stop();
      controller.drawStatic(prefersReducedMotion);
    } else {
      controller.start();
    }
  }, [preference, isSpinning, prefersReducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;

    const flakes: Flake[] = [];
    const sprites: HTMLCanvasElement[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId: number | null = null;
    let lastTimestamp = 0;
    let elapsedTime = 0;
    let intersecting = true;
    let disposed = false;
    let themeOpacity = 0.8;
    let spriteColor = "";
    let spriteOpacity = -1;
    let spritePixels: [number, number, number] = [212, 230, 216];

    const clear = () => context.clearRect(0, 0, width, height);

    const rebuildSprites = () => {
      const computed = window.getComputedStyle(document.documentElement);
      const nextColor = computed.getPropertyValue("--snow-color").trim() || "#d4e6d8";
      const parsedOpacity = Number.parseFloat(computed.getPropertyValue("--snow-opacity"));
      const nextOpacity = Number.isFinite(parsedOpacity) ? clamp(parsedOpacity, 0, 1) : 0.8;
      if (nextColor === spriteColor && nextOpacity === spriteOpacity && sprites.length === 3) return;
      themeOpacity = nextOpacity;
      spriteColor = nextColor;
      spriteOpacity = nextOpacity;
      spritePixels = parseColor(nextColor);
      sprites.length = 0;

      for (let layer = 0; layer < 3; layer += 1) {
        const sprite = document.createElement("canvas");
        sprite.width = SNOW_CONFIG.SPRITE_SIZE_PX;
        sprite.height = SNOW_CONFIG.SPRITE_SIZE_PX;
        const spriteContext = sprite.getContext("2d");
        if (!spriteContext) continue;
        const center = SNOW_CONFIG.SPRITE_SIZE_PX / 2;
        const radius = center * (layer === 0 ? 0.43 : layer === 1 ? 0.34 : 0.27);
        const gradient = spriteContext.createRadialGradient(center, center, 0, center, center, radius);
        gradient.addColorStop(0, `rgba(${spritePixels[0]}, ${spritePixels[1]}, ${spritePixels[2]}, 0.92)`);
        gradient.addColorStop(0.45, `rgba(${spritePixels[0]}, ${spritePixels[1]}, ${spritePixels[2]}, 0.48)`);
        gradient.addColorStop(1, `rgba(${spritePixels[0]}, ${spritePixels[1]}, ${spritePixels[2]}, 0)`);
        spriteContext.fillStyle = gradient;
        spriteContext.fillRect(0, 0, sprite.width, sprite.height);
        sprites.push(sprite);
      }
    };

    const makeFlake = (index: number, y?: number): Flake => {
      const layer = index % 3;
      const sizeScale = layer === 0 ? 1 : layer === 1 ? 0.78 : 0.58;
      const speedScale = layer === 0 ? 1 : layer === 1 ? 0.76 : 0.55;
      return {
        x: randomBetween(0, Math.max(width, 1)),
        y: y ?? randomBetween(0, Math.max(height, 1)),
        size: randomBetween(SNOW_CONFIG.MIN_SIZE_PX, SNOW_CONFIG.MAX_SIZE_PX) * sizeScale,
        speed: randomBetween(SNOW_CONFIG.MIN_SPEED_PX_PER_SECOND, SNOW_CONFIG.MAX_SPEED_PX_PER_SECOND) * speedScale,
        opacity: randomBetween(SNOW_CONFIG.MIN_OPACITY, SNOW_CONFIG.MAX_OPACITY) * (layer === 0 ? 1 : layer === 1 ? 0.8 : 0.62),
        amplitude: randomBetween(SNOW_CONFIG.MIN_DRIFT_PX, SNOW_CONFIG.MAX_DRIFT_PX),
        phase: randomBetween(0, Math.PI * 2),
        phaseSpeed: randomBetween(0.22, 0.65),
        sprite: layer,
      };
    };

    const targetCount = () => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (connection?.saveData) return 0;
      let count = clamp(Math.round((width * height) / SNOW_CONFIG.AREA_PER_FLAKE), SNOW_CONFIG.MIN_FLAKES, SNOW_CONFIG.MAX_FLAKES);
      if (width <= SNOW_CONFIG.MOBILE_BREAKPOINT) count = Math.max(1, Math.round(count / SNOW_CONFIG.MOBILE_COUNT_DIVISOR));
      if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4) {
        count = Math.max(1, Math.round(count / SNOW_CONFIG.LOW_CORE_COUNT_DIVISOR));
      }
      return count;
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(window.devicePixelRatio || 1, SNOW_CONFIG.MAX_DPR);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = targetCount();
      while (flakes.length > count) flakes.pop();
      while (flakes.length < count) flakes.push(makeFlake(flakes.length));
      clear();
      drawFlakes(false);
    };

    const drawFlakes = (reduced: boolean) => {
      if (!context || width <= 0 || height <= 0) return;
      clear();
      if (sprites.length !== 3) rebuildSprites();
      if (reduced) {
        const count = Math.min(SNOW_CONFIG.REDUCED_FLAKE_COUNT, flakes.length);
        for (let i = 0; i < count; i += 1) {
          const flake = flakes[i] ?? makeFlake(i);
          const x = flakes[i] ? flake.x : randomBetween(0, width);
          const y = flakes[i] ? flake.y : randomBetween(0, height);
          context.globalAlpha = Math.min(0.12, flake.opacity * 0.28);
          const sprite = sprites[flake.sprite];
          if (sprite) context.drawImage(sprite, x, y, flake.size * 3.5, flake.size * 3.5);
        }
      } else {
        for (let i = 0; i < flakes.length; i += 1) {
          const flake = flakes[i];
          const x = flake.x + Math.sin(elapsedTime * flake.phaseSpeed + flake.phase) * flake.amplitude;
          context.globalAlpha = Math.min(SNOW_CONFIG.MAX_OPACITY, flake.opacity * themeOpacity);
          const sprite = sprites[flake.sprite];
          if (sprite) context.drawImage(sprite, x, flake.y, flake.size * 3.5, flake.size * 3.5);
        }
      }
      context.globalAlpha = 1;
    };

    const canAnimate = () =>
      !disposed
      && intersecting
      && !document.hidden
      && settingsRef.current.preference === "auto"
      && !settingsRef.current.reduced
      && targetCount() > 0;

    const stop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastTimestamp = 0;
    };

    const tick = (timestamp: number) => {
      rafId = null;
      if (!canAnimate()) {
        drawFlakes(settingsRef.current.reduced);
        return;
      }
      const delta = lastTimestamp === 0 ? 0 : Math.min(timestamp - lastTimestamp, SNOW_CONFIG.DELTA_CAP_MS);
      lastTimestamp = timestamp;
      const dt = delta / 1000;
      elapsedTime += dt;
      const spinning = settingsRef.current.isSpinning;
      const gust = spinning ? SNOW_CONFIG.GUST_MULTIPLIER : 1;
      const wind = spinning ? SNOW_CONFIG.GUST_WIND_PX : 0;
      for (let i = 0; i < flakes.length; i += 1) {
        const flake = flakes[i];
        flake.y += flake.speed * gust * dt;
        flake.x += Math.sin(elapsedTime * flake.phaseSpeed + flake.phase) * flake.amplitude * dt * 0.25
          + wind * dt * (flake.sprite === 0 ? 1 : 0.6);
        if (flake.y > height + SNOW_CONFIG.MAX_SIZE_PX * 4) {
          const layer = i % 3;
          const sizeScale = layer === 0 ? 1 : layer === 1 ? 0.78 : 0.58;
          const speedScale = layer === 0 ? 1 : layer === 1 ? 0.76 : 0.55;
          flake.x = randomBetween(0, Math.max(width, 1));
          flake.y = randomBetween(-height * 0.18, -SNOW_CONFIG.MAX_SIZE_PX);
          flake.size = randomBetween(SNOW_CONFIG.MIN_SIZE_PX, SNOW_CONFIG.MAX_SIZE_PX) * sizeScale;
          flake.speed = randomBetween(SNOW_CONFIG.MIN_SPEED_PX_PER_SECOND, SNOW_CONFIG.MAX_SPEED_PX_PER_SECOND) * speedScale;
          flake.opacity = randomBetween(SNOW_CONFIG.MIN_OPACITY, SNOW_CONFIG.MAX_OPACITY) * (layer === 0 ? 1 : layer === 1 ? 0.8 : 0.62);
          flake.amplitude = randomBetween(SNOW_CONFIG.MIN_DRIFT_PX, SNOW_CONFIG.MAX_DRIFT_PX);
          flake.phase = randomBetween(0, Math.PI * 2);
          flake.phaseSpeed = randomBetween(0.22, 0.65);
          flake.sprite = layer;
        }
        if (flake.x > width + 24) flake.x = -12;
        if (flake.x < -24) flake.x = width + 12;
      }
      drawFlakes(false);
      if (canAnimate()) rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (rafId !== null || !canAnimate()) return;
      lastTimestamp = 0;
      rafId = requestAnimationFrame(tick);
    };

    const drawStatic = (reduced = settingsRef.current.reduced) => {
      stop();
      drawFlakes(reduced);
    };

    const refreshTheme = () => {
      rebuildSprites();
      drawFlakes(settingsRef.current.reduced);
    };

    const controller: SnowController = { start, stop, drawStatic, refreshTheme };
    controllerRef.current = controller;
    rebuildSprites();
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.05);
      if (canAnimate()) start();
      else drawStatic(settingsRef.current.reduced);
    }, { threshold: 0.05 });
    intersectionObserver.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      refreshTheme();
      if (canAnimate()) start();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else if (canAnimate()) start();
      else drawStatic(settingsRef.current.reduced);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const onMotionPreferenceChange = () => {
      if (settingsRef.current.preference === "paused" || settingsRef.current.reduced) drawStatic(settingsRef.current.reduced);
      else start();
    };
    window.addEventListener("morgan-motion-preference", onMotionPreferenceChange);
    if (canAnimate()) start();
    else drawStatic(settingsRef.current.reduced);

    return () => {
      disposed = true;
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("morgan-motion-preference", onMotionPreferenceChange);
      controllerRef.current = null;
      clear();
    };
  }, []);

  return (
    <div className="snow-layer" aria-hidden="true" data-snow-scope={SNOW_SCOPE}>
      <canvas ref={canvasRef} className="snow-layer-canvas" aria-hidden="true" />
    </div>
  );
}
