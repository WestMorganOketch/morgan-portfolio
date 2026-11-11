"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  radius: number;
  phase: number;
  twinkleSpeed: number;
  depth: number;
};

type GalaxyParticle = {
  radius: number;
  angle: number;
  depth: number;
  size: number;
  opacity: number;
  tone: number;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(): Star[] {
  const random = seededRandom(73129);
  return Array.from({ length: 260 }, () => ({
    x: random(),
    y: random(),
    radius: 0.35 + random() * 1.15,
    phase: random() * Math.PI * 2,
    twinkleSpeed: 0.00024 + random() * 0.00072,
    depth: 0.15 + random() * 0.85,
  }));
}

function makeGalaxyParticles(): GalaxyParticle[] {
  const random = seededRandom(204811);
  const armCount = 4;
  return Array.from({ length: 780 }, () => {
    const radius = Math.pow(random(), 0.78);
    const arm = Math.floor(random() * armCount);
    const angle = random() * Math.PI * 2
      + radius * 8.5
      + (arm * Math.PI * 2) / armCount
      + (random() - 0.5) * 0.92;
    return {
      radius,
      angle,
      depth: (random() - 0.5) * 2,
      size: 0.35 + random() * 1.3,
      opacity: 0.18 + random() * 0.68,
      tone: Math.floor(random() * 4),
    };
  });
}

const STAR_TONES = [
  "rgba(230, 248, 255, 0.94)",
  "rgba(135, 224, 199, 0.92)",
  "rgba(166, 151, 255, 0.92)",
  "rgba(255, 218, 166, 0.92)",
];

const GALAXY_ROTATION_RATE = 0.000014;
const POINTER_EASE = 0.035;

export default function GalaxyBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stars = makeStars();
    const particles = makeGalaxyParticles();
    const backdrop = canvas.parentElement;
    const parallaxLayers = backdrop?.querySelectorAll<HTMLElement>(
      ".home-galaxy-halo, .home-galaxy-ring-outer, .home-galaxy-ring-middle, .home-galaxy-ring-inner",
    );
    let reducedMotion = reducedMotionQuery.matches;
    let isVisible = !document.hidden;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let frame = 0;
    let targetPointerX = 0;
    let targetPointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;

    const updatePointerTarget = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const bounds = canvas.getBoundingClientRect();
      const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      if (!inside) {
        targetPointerX = 0;
        targetPointerY = 0;
        return;
      }
      targetPointerX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5) * 2;
      targetPointerY = ((event.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5) * 2;
    };

    const resetPointerTarget = () => {
      targetPointerX = 0;
      targetPointerY = 0;
    };

    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) resetPointerTarget();
    };

    const applyLayerParallax = () => {
      if (!parallaxLayers) return;
      parallaxLayers.forEach((layer) => {
        const isHalo = layer.classList.contains("home-galaxy-halo");
        const isMiddle = layer.classList.contains("home-galaxy-ring-middle");
        const isInner = layer.classList.contains("home-galaxy-ring-inner");
        const depth = isHalo ? 0.5 : isInner ? 1.15 : isMiddle ? 0.9 : 0.65;
        layer.style.setProperty("--galaxy-shift-x", `${smoothPointerX * 36 * depth}px`);
        layer.style.setProperty("--galaxy-shift-y", `${smoothPointerY * 25 * depth}px`);
        layer.style.setProperty("--galaxy-rotate", `${smoothPointerX * 8 * depth}deg`);
        layer.style.setProperty("--galaxy-tilt", `${-smoothPointerY * 6 * depth}deg`);
      });
    };

    const paint = (time: number) => {
      if (!context || width <= 0 || height <= 0) return;
      context.clearRect(0, 0, width, height);

      const isCompact = width < 720;
      const centerX = width * (isCompact ? 0.64 : 0.72) - smoothPointerX * 36;
      const centerY = height * (isCompact ? 0.66 : 0.5) - smoothPointerY * 24;
      const outerRadius = Math.min(width * (isCompact ? 0.48 : 0.45), height * 0.49);
      // Roughly 11.6 minutes per full rotation, with smooth cursor-driven yaw.
      const motionScale = reducedMotion ? 0.62 : 1;
      const rotation = time * GALAXY_ROTATION_RATE * motionScale + smoothPointerX * (reducedMotion ? 0.10 : 0.15);

      const nebula = context.createRadialGradient(
        centerX, centerY, 0, centerX, centerY, outerRadius * 1.28,
      );
      nebula.addColorStop(0, "rgba(109, 106, 211, 0.12)");
      nebula.addColorStop(0.28, "rgba(49, 184, 150, 0.105)");
      nebula.addColorStop(0.66, "rgba(86, 95, 184, 0.045)");
      nebula.addColorStop(1, "rgba(86, 95, 184, 0)");
      context.fillStyle = nebula;
      context.fillRect(
        Math.max(0, centerX - outerRadius * 1.3),
        Math.max(0, centerY - outerRadius * 1.3),
        Math.min(width, outerRadius * 2.6),
        Math.min(height, outerRadius * 2.6),
      );

      for (const star of stars) {
        const drift = time * star.twinkleSpeed * star.depth * motionScale;
        const x = (star.x * width + drift + smoothPointerX * (6 + star.depth * 18) + width) % width;
        const y = star.y * height + smoothPointerY * (5 + star.depth * 12);
        const twinklePhase = Math.sin(time * star.twinkleSpeed * motionScale + star.phase);
        const twinkle = reducedMotion
          ? 0.48 + ((twinklePhase + 1) / 2) * 0.18
          : 0.45 + ((twinklePhase + 1) / 2) * 0.48;
        context.globalAlpha = twinkle * (0.35 + star.depth * 0.55);
        context.fillStyle = star.depth > 0.76
          ? "rgba(241, 250, 255, 0.96)"
          : "rgba(169, 196, 220, 0.88)";
        context.beginPath();
        context.arc(x, y, star.radius * (0.55 + star.depth * 0.65), 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      for (const particle of particles) {
        const angle = particle.angle + rotation * (0.7 + particle.radius * 0.3);
        const radialDistance = particle.radius * outerRadius;
        const x = centerX + Math.cos(angle) * radialDistance;
        const y = centerY
          + Math.sin(angle) * radialDistance * 0.34
          + particle.depth * radialDistance * 0.065;
        const perspectiveScale = 0.72 + (Math.sin(angle) + 1) * 0.18;
        const particleSize = particle.size * perspectiveScale;
        context.globalAlpha = particle.opacity * (0.55 + perspectiveScale * 0.34);
        context.fillStyle = STAR_TONES[particle.tone] ?? STAR_TONES[0];
        context.beginPath();
        context.arc(x, y, particleSize, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      const coreRadius = Math.max(outerRadius * 0.18, 1);
      const core = context.createRadialGradient(
        centerX, centerY, 0, centerX, centerY, coreRadius,
      );
      core.addColorStop(0, "rgba(245, 255, 247, 0.76)");
      core.addColorStop(0.12, "rgba(166, 255, 221, 0.45)");
      core.addColorStop(0.42, "rgba(133, 139, 255, 0.17)");
      core.addColorStop(1, "rgba(133, 139, 255, 0)");
      context.fillStyle = core;
      context.beginPath();
      context.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
      context.fill();

      context.save();
      context.translate(centerX, centerY);
      context.rotate(-0.18 + rotation * 0.18);
      context.scale(1, 0.24);
      const disk = context.createRadialGradient(0, 0, outerRadius * 0.012, 0, 0, outerRadius * 0.2);
      disk.addColorStop(0, "rgba(245, 255, 251, 0.72)");
      disk.addColorStop(0.18, "rgba(128, 255, 219, 0.32)");
      disk.addColorStop(0.5, "rgba(140, 153, 255, 0.1)");
      disk.addColorStop(1, "rgba(140, 153, 255, 0)");
      context.fillStyle = disk;
      context.beginPath();
      context.ellipse(0, 0, outerRadius * 0.2, outerRadius * 0.2, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
      context.globalAlpha = 1;
    };

    const animate = (time: number) => {
      if (!isVisible) return;
      // Ease toward the pointer rather than moving the scene abruptly.
      smoothPointerX += (targetPointerX - smoothPointerX) * POINTER_EASE;
      smoothPointerY += (targetPointerY - smoothPointerY) * POINTER_EASE;
      applyLayerParallax();
      paint(time);
      frame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      if (isVisible) frame = window.requestAnimationFrame(animate);
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      start();
    };

    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (!isVisible) window.cancelAnimationFrame(frame);
      else start();
    };

    const onReducedMotionChange = () => {
      reducedMotion = reducedMotionQuery.matches;
      start();
    };

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", updatePointerTarget, { passive: true });
    window.addEventListener("pointerout", onPointerOut);
    window.addEventListener("blur", resetPointerTarget);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    resize();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", updatePointerTarget);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("blur", resetPointerTarget);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
    };
  }, []);

  return (
    <div className="home-galaxy-backdrop" aria-hidden="true">
      <canvas className="home-galaxy-canvas" ref={canvasRef} />
      <span className="home-galaxy-ring home-galaxy-ring-outer" />
      <span className="home-galaxy-ring home-galaxy-ring-middle" />
      <span className="home-galaxy-ring home-galaxy-ring-inner" />
      <span className="home-galaxy-halo" />
    </div>
  );
}
