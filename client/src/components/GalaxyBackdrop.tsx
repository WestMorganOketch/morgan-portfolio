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

type ShootingStar = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hue: number;
  life: number;
  length: number;
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
  return Array.from({ length: 420 }, () => ({
    x: random(),
    y: random(),
    radius: 0.35 + random() * 1.2,
    phase: random() * Math.PI * 2,
    twinkleSpeed: 0.00024 + random() * 0.00072,
    depth: 0.12 + random() * 0.88,
  }));
}

/**
 * Build four actual spiral arms. Each particle is assigned to one arm and
 * receives a small angular spread around that arm, rather than a random
 * full-circle angle that would dissolve the galaxy into a uniform disk.
 */
function makeGalaxyParticles(): GalaxyParticle[] {
  const random = seededRandom(204811);
  const armCount = 4;
  return Array.from({ length: 1450 }, () => {
    const arm = Math.floor(random() * armCount);
    const inBulge = random() < 0.24;
    const radius = inBulge
      ? Math.pow(random(), 1.8) * 0.36
      : 0.09 + Math.pow(random(), 0.82) * 0.88;
    const armSpread = (random() - 0.5) * (0.12 + radius * 0.25);
    const angle = (arm * Math.PI * 2) / armCount + radius * 6.25 + armSpread;

    return {
      radius,
      angle,
      depth: (random() - 0.5) * 2,
      size: 0.5 + random() * 1.65,
      opacity: 0.32 + random() * 0.62,
      tone: Math.floor(random() * 5),
    };
  });
}

const STAR_TONES = [
  "rgba(224, 242, 255, 0.96)",
  "rgba(126, 219, 255, 0.94)",
  "rgba(157, 151, 255, 0.95)",
  "rgba(255, 207, 169, 0.94)",
  "rgba(181, 255, 229, 0.94)",
];

const GALAXY_ROTATION_RATE = 0.000026;
const POINTER_EASE = 0.11;

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
    const parallaxLayers = backdrop?.querySelectorAll<HTMLElement>(".home-galaxy-halo");

    let reducedMotion = reducedMotionQuery.matches;
    let isVisible = !document.hidden;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let frame = 0;
    let reducedMotionPointerFrame = 0;
    let targetPointerX = 0;
    let targetPointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;
    let shootingStars: ShootingStar[] = [];
    let nextShootingStarAt = 1600 + Math.random() * 2400;
    let previousFrameTime = 0;

    // Reduced-motion mode pauses ambient animation, but must not disable
    // direct, user-controlled cursor interaction on desktop browsers.
    const animateReducedMotionPointer = () => {
      if (!reducedMotion || !isVisible || reducedMotionPointerFrame) return;

      const tick = () => {
        reducedMotionPointerFrame = 0;
        const deltaX = targetPointerX - smoothPointerX;
        const deltaY = targetPointerY - smoothPointerY;

        smoothPointerX += deltaX * 0.22;
        smoothPointerY += deltaY * 0.22;
        applyLayerParallax();
        paint(0);

        if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
          reducedMotionPointerFrame = window.requestAnimationFrame(tick);
        } else {
          smoothPointerX = targetPointerX;
          smoothPointerY = targetPointerY;
          applyLayerParallax();
          paint(0);
        }
      };

      reducedMotionPointerFrame = window.requestAnimationFrame(tick);
    };

    const updatePointerTarget = (event: PointerEvent | MouseEvent) => {
      const pointerType = "pointerType" in event ? event.pointerType : "mouse";
      if (pointerType !== "mouse" && pointerType !== "pen") return;

      // Use viewport coordinates rather than the canvas bounds. This keeps
      // tracking reliable even when an ancestor creates a fixed-position
      // containing block or a browser reports fractional canvas dimensions.
      const viewportWidth = Math.max(window.innerWidth, 1);
      const viewportHeight = Math.max(window.innerHeight, 1);

      targetPointerX = Math.max(-1, Math.min(
        1,
        (event.clientX / viewportWidth - 0.5) * 2,
      ));
      targetPointerY = Math.max(-1, Math.min(
        1,
        (event.clientY / viewportHeight - 0.5) * 2,
      ));

      animateReducedMotionPointer();
    };

    const resetPointerTarget = () => {
      targetPointerX = 0;
      targetPointerY = 0;
      animateReducedMotionPointer();
    };

    const onPointerOut = (event: PointerEvent | MouseEvent) => {
      if (event.relatedTarget === null) resetPointerTarget();
    };

    const applyLayerParallax = () => {
      parallaxLayers?.forEach((layer) => {
        layer.style.setProperty("--galaxy-shift-x", `${-smoothPointerX * 190}px`);
        layer.style.setProperty("--galaxy-shift-y", `${-smoothPointerY * 140}px`);
        layer.style.setProperty("--galaxy-rotate", `${smoothPointerX * 22}deg`);
        layer.style.setProperty("--galaxy-tilt", `${-smoothPointerY * 16}deg`);
      });
    };

    const drawSpiralArms = (outerRadius: number, rotation: number) => {
      if (!context) return;

      for (let arm = 0; arm < 4; arm += 1) {
        context.beginPath();
        for (let step = 0; step <= 120; step += 1) {
          const progress = step / 120;
          const radius = outerRadius * (0.075 + progress * 0.91);
          const angle = (arm * Math.PI * 2) / 4 + progress * 6.25 + rotation * 0.65;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;

          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        context.globalAlpha = 0.34;
        context.lineWidth = outerRadius * 0.075;
        context.lineCap = "round";
        context.strokeStyle = "rgba(101, 119, 255, 0.13)";
        context.shadowColor = "rgba(121, 137, 255, 0.34)";
        context.shadowBlur = outerRadius * 0.075;
        context.stroke();

        context.globalAlpha = 0.4;
        context.lineWidth = outerRadius * 0.022;
        context.strokeStyle = "rgba(139, 231, 255, 0.18)";
        context.shadowColor = "rgba(139, 231, 255, 0.32)";
        context.shadowBlur = outerRadius * 0.025;
        context.stroke();
      }

      context.shadowBlur = 0;
      context.globalAlpha = 1;
    };

    const paint = (time: number) => {
      if (!context || width <= 0 || height <= 0) return;
      context.clearRect(0, 0, width, height);

      const isCompact = width < 720;
      // Larger parallax travel makes movement clearly visible on desktop.
      const centerX = width * 0.5 - smoothPointerX * width * 0.2;
      const centerY = height * 0.5 - smoothPointerY * height * 0.17;
      const outerRadius = Math.min(
        width * (isCompact ? 0.54 : 0.47),
        height * (isCompact ? 0.31 : 0.45),
      );
      const motionScale = reducedMotion ? 0 : 1;
      const rotation = time * GALAXY_ROTATION_RATE * motionScale
        + smoothPointerX * 0.44
        + smoothPointerY * 0.16;
      const verticalPerspective = 0.48 + smoothPointerY * 0.14;

      // Background nebula: a soft glow large enough to remain visible between
      // the portfolio cards without washing out foreground text.
      const nebula = context.createRadialGradient(
        centerX, centerY, outerRadius * 0.04,
        centerX, centerY, outerRadius * 1.5,
      );
      nebula.addColorStop(0, "rgba(132, 139, 255, 0.15)");
      nebula.addColorStop(0.24, "rgba(74, 163, 235, 0.12)");
      nebula.addColorStop(0.52, "rgba(105, 87, 206, 0.075)");
      nebula.addColorStop(0.82, "rgba(80, 106, 190, 0.025)");
      nebula.addColorStop(1, "rgba(80, 106, 190, 0)");
      context.fillStyle = nebula;
      context.fillRect(
        Math.max(0, centerX - outerRadius * 1.5),
        Math.max(0, centerY - outerRadius * 1.5),
        Math.min(width, outerRadius * 3),
        Math.min(height, outerRadius * 3),
      );

      // Distant stars shift subtly against the foreground galaxy, creating
      // separate depth planes as the pointer moves horizontally and vertically.
      for (const star of stars) {
        const drift = time * star.twinkleSpeed * star.depth * motionScale;
        const x = (star.x * width + drift - smoothPointerX * (22 + star.depth * 48) + width * 2) % width;
        const y = star.y * height - smoothPointerY * (16 + star.depth * 32);
        const twinklePhase = Math.sin(time * star.twinkleSpeed * motionScale + star.phase);
        const twinkle = reducedMotion
          ? 0.58
          : 0.5 + ((twinklePhase + 1) / 2) * 0.48;

        context.globalAlpha = twinkle * (0.36 + star.depth * 0.62);
        context.fillStyle = star.depth > 0.78
          ? "rgba(246, 251, 255, 0.98)"
          : "rgba(173, 203, 232, 0.9)";
        context.beginPath();
        context.arc(x, y, star.radius * (0.56 + star.depth * 0.7), 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      // Render the galaxy as a single rotating, cursor-steered scene.
      context.save();
      context.translate(centerX, centerY);
      context.rotate(rotation);
      context.scale(1, verticalPerspective);
      context.globalCompositeOperation = "lighter";

      // Broad dusty disk underneath the spiral arms.
      const disk = context.createRadialGradient(
        0, 0, outerRadius * 0.025,
        0, 0, outerRadius,
      );
      disk.addColorStop(0, "rgba(235, 246, 255, 0.22)");
      disk.addColorStop(0.18, "rgba(117, 190, 255, 0.14)");
      disk.addColorStop(0.46, "rgba(113, 111, 239, 0.075)");
      disk.addColorStop(0.78, "rgba(154, 105, 224, 0.025)");
      disk.addColorStop(1, "rgba(154, 105, 224, 0)");
      context.fillStyle = disk;
      context.beginPath();
      context.ellipse(0, 0, outerRadius * 0.98, outerRadius * 0.98, 0, 0, Math.PI * 2);
      context.fill();

      drawSpiralArms(outerRadius, rotation);

      // Stars and gas clouds follow four visible logarithmic spiral arms.
      for (const particle of particles) {
        const angle = particle.angle + rotation * (0.72 + particle.radius * 0.28);
        const radialDistance = particle.radius * outerRadius * 0.96;
        const x = Math.cos(angle) * radialDistance;
        const y = Math.sin(angle) * radialDistance + particle.depth * radialDistance * 0.025;
        const perspectiveScale = 0.78 + (Math.sin(angle) + 1) * 0.16;
        const particleSize = particle.size * perspectiveScale;

        context.globalAlpha = particle.opacity * (0.52 + perspectiveScale * 0.36);
        context.fillStyle = STAR_TONES[particle.tone] ?? STAR_TONES[0];
        context.beginPath();
        context.arc(x, y, particleSize, 0, Math.PI * 2);
        context.fill();

        if (particle.size > 1.72 && particle.radius > 0.28) {
          context.globalAlpha *= 0.2;
          context.shadowBlur = particleSize * 5;
          context.shadowColor = STAR_TONES[particle.tone] ?? STAR_TONES[0];
          context.beginPath();
          context.arc(x, y, particleSize * 1.9, 0, Math.PI * 2);
          context.fill();
          context.shadowBlur = 0;
        }
      }

      // Luminous galactic bulge.
      const coreRadius = outerRadius * 0.235;
      const core = context.createRadialGradient(
        0, 0, outerRadius * 0.006,
        0, 0, coreRadius,
      );
      core.addColorStop(0, "rgba(255, 255, 255, 0.9)");
      core.addColorStop(0.1, "rgba(218, 238, 255, 0.72)");
      core.addColorStop(0.29, "rgba(145, 197, 255, 0.32)");
      core.addColorStop(0.56, "rgba(155, 135, 255, 0.15)");
      core.addColorStop(1, "rgba(155, 135, 255, 0)");
      context.globalAlpha = 1;
      context.fillStyle = core;
      context.beginPath();
      context.arc(0, 0, coreRadius, 0, Math.PI * 2);
      context.fill();

      context.globalCompositeOperation = "source-over";
      context.restore();
      context.globalAlpha = 1;

      // Random meteors cross the full viewport, independent of the cursor.
      const frameDelta = previousFrameTime > 0 ? Math.min(time - previousFrameTime, 40) : 16.7;
      previousFrameTime = time;

      if (time >= nextShootingStarAt) {
        if (!reducedMotion && shootingStars.length < 2) {
          const towardRight = Math.random() < 0.5;
          const angle = (Math.random() * 0.48 - 0.24) + (towardRight ? 0 : Math.PI);
          const speed = 0.85 + Math.random() * 0.7;
          const life = 520 + Math.random() * 620;
          shootingStars.push({
            x: towardRight ? -70 : width + 70,
            y: Math.random() * height * 0.76,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            angle,
            hue: Math.random() < 0.72 ? 192 : 257,
            life,
            length: 110 + Math.random() * 180,
          });
        }
        nextShootingStarAt = time + 2300 + Math.random() * 6200;
      }

      for (const meteor of shootingStars) {
        meteor.x += meteor.vx * frameDelta;
        meteor.y += meteor.vy * frameDelta;
        meteor.life -= frameDelta;
      }
      shootingStars = shootingStars.filter((meteor) =>
        meteor.life > 0
        && meteor.x > -meteor.length - 120
        && meteor.x < width + meteor.length + 120
        && meteor.y > -meteor.length - 120
        && meteor.y < height + meteor.length + 120,
      );

      for (const meteor of shootingStars) {
        const lifeFade = Math.min(1, meteor.life / 170);
        const tailX = meteor.x - Math.cos(meteor.angle) * meteor.length;
        const tailY = meteor.y - Math.sin(meteor.angle) * meteor.length;
        const trail = context.createLinearGradient(tailX, tailY, meteor.x, meteor.y);
        trail.addColorStop(0, "hsla(" + meteor.hue + ", 100%, 82%, 0)");
        trail.addColorStop(0.68, "hsla(" + meteor.hue + ", 100%, 82%, " + (0.64 * lifeFade) + ")");
        trail.addColorStop(1, "rgba(255, 255, 255, " + (0.98 * lifeFade) + ")");
        context.globalAlpha = 1;
        context.strokeStyle = trail;
        context.lineWidth = 1.35;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(meteor.x, meteor.y);
        context.stroke();
        context.shadowBlur = 13 * lifeFade;
        context.shadowColor = "hsl(" + meteor.hue + ", 100%, 82%)";
        context.fillStyle = "rgba(255, 255, 255, " + lifeFade + ")";
        context.beginPath();
        context.arc(meteor.x, meteor.y, 1.45, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      }
      context.globalAlpha = 1;
    };

    const animate = (time: number) => {
      if (!isVisible || reducedMotion) return;

      // Smooth cursor tracking, with enough travel to be clearly perceptible.
      smoothPointerX += (targetPointerX - smoothPointerX) * POINTER_EASE;
      smoothPointerY += (targetPointerY - smoothPointerY) * POINTER_EASE;
      applyLayerParallax();
      paint(time);
      frame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(reducedMotionPointerFrame);
      frame = 0;
      reducedMotionPointerFrame = 0;
      if (!isVisible) return;

      if (reducedMotion) {
        smoothPointerX = 0;
        smoothPointerY = 0;
        targetPointerX = 0;
        targetPointerY = 0;
        shootingStars = [];
        applyLayerParallax();
        paint(0);
        return;
      }

      frame = window.requestAnimationFrame(animate);
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      start();
    };

    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (!isVisible) {
        window.cancelAnimationFrame(frame);
        window.cancelAnimationFrame(reducedMotionPointerFrame);
        reducedMotionPointerFrame = 0;
      } else {
        start();
      }
    };

    const onReducedMotionChange = () => {
      reducedMotion = reducedMotionQuery.matches;
      start();
    };

    window.addEventListener("resize", resize);

    // Listen in the document capture phase so menus, cards, and other
    // components cannot stop the movement event before the galaxy sees it.
    // Subscribe to both event families: modern browsers dispatch Pointer
    // Events, while mousemove keeps desktop tracking dependable as a fallback.
    document.addEventListener("pointermove", updatePointerTarget, { passive: true, capture: true });
    document.addEventListener("mousemove", updatePointerTarget, { passive: true, capture: true });
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("mouseout", onPointerOut, true);
    window.addEventListener("blur", resetPointerTarget);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    resize();

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(reducedMotionPointerFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("pointermove", updatePointerTarget, true);
      document.removeEventListener("mousemove", updatePointerTarget, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("mouseout", onPointerOut, true);
      window.removeEventListener("blur", resetPointerTarget);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
    };
  }, []);

  return (
    <div className="home-galaxy-backdrop" aria-hidden="true">
      <canvas className="home-galaxy-canvas" ref={canvasRef} />
      <span className="home-galaxy-halo" />
    </div>
  );
}
