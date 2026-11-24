"use client";

import { useEffect, useRef } from "react";

type Meteor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hue: number;
  life: number;
  maxLife: number;
  length: number;
  width: number;
};

const PINWHEEL_GALAXY_SOURCES = [
  "https://cdn.esahubble.org/archives/images/wallpaper_fhd/heic0602a.jpg",
  "https://apod.nasa.gov/apod/fap/image/2505/M101_hst1280.jpg",
  "https://www.star.ucl.ac.uk/~apod/apod/image/2505/M101_hst1280.jpg",
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function GalaxyBackdrop() {
  const galaxyRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const galaxy = galaxyRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!galaxy || !canvas || !context) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let isVisible = !document.hidden;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let frame = 0;
    let targetScroll = 0;
    let smoothScroll = 0;
    let targetPointerX = 0;
    let targetPointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;
    let lastFrameTime = 0;
    let nextMeteorAt = 2200 + Math.random() * 3000;
    let meteors: Meteor[] = [];

    const readScroll = () => {
      const scrollableHeight = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      targetScroll = clamp(window.scrollY / scrollableHeight, 0, 1);
    };

    const readPointer = (event: PointerEvent | MouseEvent) => {
      if ("pointerType" in event && event.pointerType === "touch") return;

      const viewportWidth = Math.max(window.innerWidth, 1);
      const viewportHeight = Math.max(window.innerHeight, 1);
      targetPointerX = clamp((event.clientX / viewportWidth - 0.5) * 2, -1, 1);
      targetPointerY = clamp((event.clientY / viewportHeight - 0.5) * 2, -1, 1);
    };

    const resetPointer = () => {
      targetPointerX = 0;
      targetPointerY = 0;
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      readScroll();
    };

    const spawnMeteor = () => {
      const movesRight = Math.random() > 0.35;
      const angle = movesRight
        ? 0.16 + Math.random() * 0.34
        : Math.PI - 0.16 - Math.random() * 0.34;
      const speed = 0.72 + Math.random() * 0.78;
      const life = 620 + Math.random() * 650;

      meteors.push({
        x: movesRight ? -90 : width + 90,
        y: 20 + Math.random() * height * 0.72,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        angle,
        hue: Math.random() > 0.3 ? 202 : 226,
        life,
        maxLife: life,
        length: 180 + Math.random() * 260,
        width: 1.0 + Math.random() * 1.15,
      });
    };

    const drawMeteor = (meteor: Meteor) => {
      const lifeRatio = clamp(meteor.life / meteor.maxLife, 0, 1);
      const fadeIn = clamp((meteor.maxLife - meteor.life) / 100, 0, 1);
      const alpha = Math.min(lifeRatio * 1.7, fadeIn);
      const tailX = meteor.x - Math.cos(meteor.angle) * meteor.length;
      const tailY = meteor.y - Math.sin(meteor.angle) * meteor.length;

      context.save();
      context.globalCompositeOperation = "lighter";

      // A broad, tapered atmospheric trail with a cooler outer glow.
      const outerTrail = context.createLinearGradient(tailX, tailY, meteor.x, meteor.y);
      outerTrail.addColorStop(0, "hsla(" + meteor.hue + ", 100%, 82%, 0)");
      outerTrail.addColorStop(0.48, "hsla(" + meteor.hue + ", 100%, 78%, " + (0.035 * alpha) + ")");
      outerTrail.addColorStop(0.82, "hsla(" + meteor.hue + ", 100%, 84%, " + (0.34 * alpha) + ")");
      outerTrail.addColorStop(1, "rgba(255, 255, 255, " + (0.96 * alpha) + ")");

      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(meteor.x, meteor.y);
      context.strokeStyle = outerTrail;
      context.lineWidth = meteor.width * 5.5;
      context.lineCap = "round";
      context.shadowColor = "hsl(" + meteor.hue + ", 100%, 78%)";
      context.shadowBlur = 24;
      context.stroke();

      // The narrow hot core makes the streak read as a meteor rather than a
      // uniform decorative line.
      const coreTrail = context.createLinearGradient(tailX, tailY, meteor.x, meteor.y);
      coreTrail.addColorStop(0, "rgba(255, 255, 255, 0)");
      coreTrail.addColorStop(0.74, "hsla(" + meteor.hue + ", 100%, 90%, " + (0.08 * alpha) + ")");
      coreTrail.addColorStop(1, "rgba(255, 255, 255, " + (0.98 * alpha) + ")");
      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(meteor.x, meteor.y);
      context.strokeStyle = coreTrail;
      context.lineWidth = Math.max(0.65, meteor.width * 0.85);
      context.shadowBlur = 8;
      context.stroke();

      // Bright, compact head with a soft blue-white bloom.
      const headRadius = 8 + meteor.width * 2;
      const headGlow = context.createRadialGradient(
        meteor.x, meteor.y, 0,
        meteor.x, meteor.y, headRadius,
      );
      headGlow.addColorStop(0, "rgba(255, 255, 255, " + alpha + ")");
      headGlow.addColorStop(0.16, "rgba(224, 246, 255, " + (0.9 * alpha) + ")");
      headGlow.addColorStop(0.44, "hsla(" + meteor.hue + ", 100%, 78%, " + (0.36 * alpha) + ")");
      headGlow.addColorStop(1, "hsla(" + meteor.hue + ", 100%, 70%, 0)");
      context.fillStyle = headGlow;
      context.beginPath();
      context.arc(meteor.x, meteor.y, headRadius, 0, Math.PI * 2);
      context.fill();

      context.restore();
    };

    const updateGalaxyTransform = (time: number) => {
      // Scroll controls the scale and the repeated left-right path. The galaxy
      // remains one real telescope photograph; only the camera-like transform
      // changes as the visitor travels down the page.
      const scroll = smoothScroll;
      const zigzagX = Math.sin(scroll * Math.PI * 5) * Math.min(width * 0.22, 320);
      const zigzagY = Math.cos(scroll * Math.PI * 5) * Math.min(height * 0.065, 68);
      const pointerX = -smoothPointerX * Math.min(width * 0.095, 145);
      const pointerY = -smoothPointerY * Math.min(height * 0.075, 92);
      const scale = 0.78 + scroll * 1.95;
      const scrollRotation = scroll * 78;
      const pointerRotation = smoothPointerX * 11 + smoothPointerY * 6;
      const slowRotation = reducedMotion ? 0 : time * 0.0000022;
      const rotation = scrollRotation + pointerRotation + slowRotation;

      galaxy.style.transform =
        "translate3d(calc(-50% + " + (zigzagX + pointerX) + "px), calc(-50% + "
        + (zigzagY + pointerY) + "px), 0) scale(" + scale + ") rotate(" + rotation + "deg)";
    };

    const animate = (time: number) => {
      if (!isVisible) return;

      const delta = lastFrameTime > 0 ? Math.min(time - lastFrameTime, 40) : 16.7;
      lastFrameTime = time;

      smoothScroll += (targetScroll - smoothScroll) * 0.075;
      smoothPointerX += (targetPointerX - smoothPointerX) * 0.12;
      smoothPointerY += (targetPointerY - smoothPointerY) * 0.12;

      updateGalaxyTransform(time);

      context.clearRect(0, 0, width, height);

      if (!reducedMotion && time >= nextMeteorAt) {
        if (meteors.length < 2) spawnMeteor();
        nextMeteorAt = time + 2800 + Math.random() * 6200;
      }

      for (const meteor of meteors) {
        meteor.x += meteor.vx * delta;
        meteor.y += meteor.vy * delta;
        meteor.life -= delta;
      }

      meteors = meteors.filter((meteor) =>
        meteor.life > 0
        && meteor.x > -meteor.length - 140
        && meteor.x < width + meteor.length + 140
        && meteor.y > -meteor.length - 140
        && meteor.y < height + meteor.length + 140,
      );

      for (const meteor of meteors) drawMeteor(meteor);

      frame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      if (isVisible) frame = window.requestAnimationFrame(animate);
    };

    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (!isVisible) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else {
        lastFrameTime = 0;
        start();
      }
    };

    const onReducedMotionChange = () => {
      reducedMotion = reducedMotionQuery.matches;
      if (reducedMotion) meteors = [];
      start();
    };

    window.addEventListener("resize", resize);
    window.addEventListener("scroll", readScroll, { passive: true });
    document.addEventListener("pointermove", readPointer, { passive: true, capture: true });
    document.addEventListener("mousemove", readPointer, { passive: true, capture: true });
    window.addEventListener("blur", resetPointer);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);

    resize();
    start();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", readScroll);
      document.removeEventListener("pointermove", readPointer, true);
      document.removeEventListener("mousemove", readPointer, true);
      window.removeEventListener("blur", resetPointer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
    };
  }, []);

  return (
    <div className="home-galaxy-backdrop" aria-hidden="true">
      <div className="home-galaxy-photo" ref={galaxyRef}>
        <img
          className="home-galaxy-photo-image"
          src={PINWHEEL_GALAXY_SOURCES[0]}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          loading="eager"
          fetchPriority="high"
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            event.currentTarget.dataset.loaded = "true";
          }}
          onError={(event) => {
            const image = event.currentTarget;
            const currentIndex = Number(image.dataset.sourceIndex ?? "0");
            const nextIndex = currentIndex + 1;
            if (nextIndex < PINWHEEL_GALAXY_SOURCES.length) {
              image.dataset.sourceIndex = String(nextIndex);
              image.src = PINWHEEL_GALAXY_SOURCES[nextIndex];
            }
          }}
        />
      </div>
      <canvas className="home-galaxy-meteors" ref={canvasRef} />
    </div>
  );
}
