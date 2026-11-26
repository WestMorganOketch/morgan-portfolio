"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type GalaxyProps = {
  count?: number;
  radius?: number;
  branches?: number;
  spin?: number;
  randomness?: number;
  insideColor?: string;
  outsideColor?: string;
  shootingStars?: boolean;
};

type Meteor = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
  duration: number;
  trailLength: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function GalaxyBackdrop({
  count = 70000,
  radius = 6,
  branches = 4,
  spin = 1.25,
  randomness = 0.42,
  insideColor = "#ffad76",
  outsideColor = "#557dff",
  shootingStars = true,
}: GalaxyProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [deviceProfileRevision, setDeviceProfileRevision] = useState(0);

  // Rebuild the quality profile only when a viewport or pointer category
  // actually changes (for example, rotating a tablet), not on every resize.
  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 700px)");
    const compactQuery = window.matchMedia("(max-width: 900px)");
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
    const readProfile = () => [
      mobileQuery.matches,
      compactQuery.matches,
      coarsePointerQuery.matches,
    ].join(":");
    let currentProfile = readProfile();
    const onProfileChange = () => {
      const nextProfile = readProfile();
      if (nextProfile === currentProfile) return;
      currentProfile = nextProfile;
      setDeviceProfileRevision((revision) => revision + 1);
    };

    mobileQuery.addEventListener("change", onProfileChange);
    compactQuery.addEventListener("change", onProfileChange);
    coarsePointerQuery.addEventListener("change", onProfileChange);
    return () => {
      mobileQuery.removeEventListener("change", onProfileChange);
      compactQuery.removeEventListener("change", onProfileChange);
      coarsePointerQuery.removeEventListener("change", onProfileChange);
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 700px)");
    const compactQuery = window.matchMedia("(max-width: 900px)");
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
    const device = navigator as Navigator & { deviceMemory?: number };
    const lowPowerDevice = (navigator.hardwareConcurrency || 8) <= 4
      || (device.deviceMemory !== undefined && device.deviceMemory <= 4);
    let reduceMotion = reduceMotionQuery.matches;
    let isMobile = mobileQuery.matches;
    let isCompact = compactQuery.matches || coarsePointerQuery.matches;

    // Keep the same galaxy character but choose a sensible render budget for
    // phones, tablets, and lower-memory devices.
    const particleBudget = lowPowerDevice ? 0.38 : isMobile ? 0.48 : isCompact ? 0.68 : 1;
    const particleCount = Math.max(18000, Math.floor(count * particleBudget));
    const pixelRatioLimit = () => lowPowerDevice ? 1 : isMobile ? 1.15 : isCompact ? 1.35 : 1.5;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      console.error("WebGL is unavailable; procedural galaxy could not start.", error);
      mount.dataset.galaxyStatus = "webgl-unavailable";
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioLimit()));
    renderer.setClearColor(0x03040a, 0);
    renderer.domElement.className = "home-galaxy-webgl-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
    const baseCamera = new THREE.Vector3(0, 3.1, 9.2);
    camera.position.copy(baseCamera);
    camera.lookAt(0, 0, 0);

    const galaxyGroup = new THREE.Group();
    galaxyGroup.rotation.z = -0.22;
    scene.add(galaxyGroup);

    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const scales = new Float32Array(particleCount);
    const inner = new THREE.Color(insideColor);
    const outer = new THREE.Color(outsideColor);
    const color = new THREE.Color();

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const r = Math.pow(Math.random(), 1.55) * radius;
      const arm = ((i % branches) / branches) * Math.PI * 2;
      const angle = arm + r * spin;
      const spread = () =>
        Math.pow(Math.random(), 3) *
        (Math.random() < 0.5 ? -1 : 1) *
        randomness * r;
      positions[i3] = Math.cos(angle) * r + spread();
      positions[i3 + 1] = spread() * 0.34;
      positions[i3 + 2] = Math.sin(angle) * r + spread();
      color.copy(inner).lerp(outer, Math.min(r / radius, 1));
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      scales[i] = 0.35 + Math.random() * 0.9;
    }

    const galaxyGeometry = new THREE.BufferGeometry();
    galaxyGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    galaxyGeometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    galaxyGeometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));

    const galaxyMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 36 }, uTime: { value: 0 } },
      vertexShader: [
        "uniform float uSize;",
        "uniform float uTime;",
        "attribute float aScale;",
        "attribute vec3 aColor;",
        "varying vec3 vColor;",
        "void main() {",
        "  vec3 p = position;",
        "  float dist = max(length(p.xz), 0.35);",
        "  float angle = atan(p.x, p.z) + (1.0 / dist) * uTime * 0.35;",
        "  p.x = sin(angle) * dist;",
        "  p.z = cos(angle) * dist;",
        "  vec4 vp = viewMatrix * modelMatrix * vec4(p, 1.0);",
        "  gl_Position = projectionMatrix * vp;",
        "  gl_PointSize = clamp(uSize * aScale * (1.0 / max(-vp.z, 0.1)), 0.6, 9.0);",
        "  vColor = aColor;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vColor;",
        "void main() {",
        "  float d = length(gl_PointCoord - 0.5);",
        "  float a = pow(1.0 - clamp(d * 2.0, 0.0, 1.0), 3.0);",
        "  if (a < 0.015) discard;",
        "  gl_FragColor = vec4(vColor, a);",
        "}",
      ].join("\n"),
    });
    galaxyGroup.add(new THREE.Points(galaxyGeometry, galaxyMaterial));

    // A dense luminous core gives the procedural arms a bright central nucleus.
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 24),
      new THREE.MeshBasicMaterial({
        color: insideColor,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    galaxyGroup.add(core);

    const starCount = isMobile ? 700 : 1600;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    const starScales = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const direction = new THREE.Vector3().randomDirection().multiplyScalar(25 + Math.random() * 30);
      starPositions.set([direction.x, direction.y, direction.z], i * 3);
      starScales[i] = 0.4 + Math.random() * 1.1;
      const warm = Math.random();
      starColors.set([0.75 + warm * 0.25, 0.8 + warm * 0.1, 1 - warm * 0.22], i * 3);
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute("aColor", new THREE.BufferAttribute(starColors, 3));
    starGeometry.setAttribute("aScale", new THREE.BufferAttribute(starScales, 1));
    const starMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 140 } },
      vertexShader: [
        "uniform float uSize;",
        "attribute float aScale;",
        "attribute vec3 aColor;",
        "varying vec3 vColor;",
        "void main() {",
        "  vec4 vp = viewMatrix * vec4(position, 1.0);",
        "  gl_Position = projectionMatrix * vp;",
        "  gl_PointSize = clamp(uSize * aScale / max(-vp.z, 0.1), 0.45, 3.2);",
        "  vColor = aColor;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vColor;",
        "void main() {",
        "  float d = length(gl_PointCoord - 0.5);",
        "  float a = pow(1.0 - clamp(d * 2.0, 0.0, 1.0), 2.0);",
        "  if (a < 0.02) discard;",
        "  gl_FragColor = vec4(vColor, a * 0.85);",
        "}",
      ].join("\n"),
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Screen-space meteors stay visible regardless of galaxy camera perspective.
    const meteorCanvas = document.createElement("canvas");
    meteorCanvas.className = "home-galaxy-meteors";
    meteorCanvas.setAttribute("aria-hidden", "true");
    mount.appendChild(meteorCanvas);
    const meteorContext = meteorCanvas.getContext("2d");

    const targetPointer = { x: 0, y: 0 };
    const smoothPointer = { x: 0, y: 0 };
    let targetScroll = 0;
    let smoothScroll = 0;
    let meteor: Meteor | null = null;
    let nextMeteorIn = 0.75;
    let nextMeteorDirection = 1;
    let lastTime = 0;
    let lastFrameTime = 0;
    let frameAccumulator = 0;
    const targetFrameInterval = 1000 / 60;
    let elapsed = 0;
    let animationFrame = 0;
    let visible = !document.hidden;
    let width = 1;
    let height = 1;

    const spawnMeteor = () => {
      const direction = nextMeteorDirection;
      nextMeteorDirection *= -1;
      const fromX = direction > 0 ? -48 : width + 48;
      const toX = direction > 0 ? width + 48 : -48;
      const fromY = height * (0.10 + Math.random() * 0.25);
      const toY = fromY + height * (0.20 + Math.random() * 0.16);
      const distance = Math.hypot(toX - fromX, toY - fromY);

      meteor = {
        fromX,
        fromY,
        toX,
        toY,
        progress: 0,
        duration: clamp(distance / 820, 1.35, 2.65),
        trailLength: clamp(width * 0.18, 180, 340),
      };
    };

    const drawMeteor = (delta: number) => {
      if (!meteorContext) return;
      meteorContext.clearRect(0, 0, width, height);

      if (!shootingStars || reduceMotion) {
        meteor = null;
        nextMeteorIn = 0.9;
        return;
      }

      if (!meteor) {
        nextMeteorIn -= delta;
        if (nextMeteorIn > 0) return;
        spawnMeteor();
      }
      if (!meteor) return;

      meteor.progress = Math.min(1, meteor.progress + delta / meteor.duration);
      const progress = meteor.progress;
      const headX = meteor.fromX + (meteor.toX - meteor.fromX) * progress;
      const headY = meteor.fromY + (meteor.toY - meteor.fromY) * progress;
      const dx = meteor.toX - meteor.fromX;
      const dy = meteor.toY - meteor.fromY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const tailX = headX - (dx / distance) * meteor.trailLength;
      const tailY = headY - (dy / distance) * meteor.trailLength;
      const edgeFade = Math.max(0, Math.min(1, progress / 0.055, (1 - progress) / 0.12));

      const ctx = meteorContext;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      const trail = ctx.createLinearGradient(tailX, tailY, headX, headY);
      trail.addColorStop(0, "rgba(93, 151, 255, 0)");
      trail.addColorStop(0.48, `rgba(112, 166, 255, ${0.16 * edgeFade})`);
      trail.addColorStop(0.84, `rgba(190, 220, 255, ${0.62 * edgeFade})`);
      trail.addColorStop(1, `rgba(255, 255, 255, ${0.96 * edgeFade})`);
      ctx.strokeStyle = trail;
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 19;
      ctx.shadowColor = `rgba(137, 185, 255, ${0.88 * edgeFade})`;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(headX, headY);
      ctx.stroke();

      // A fine white core gives the streak a crisp leading edge.
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(244, 250, 255, ${0.78 * edgeFade})`;
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(tailX + (headX - tailX) * 0.64, tailY + (headY - tailY) * 0.64);
      ctx.lineTo(headX, headY);
      ctx.stroke();

      const headGlow = ctx.createRadialGradient(headX, headY, 0, headX, headY, 15);
      headGlow.addColorStop(0, `rgba(255, 255, 255, ${0.95 * edgeFade})`);
      headGlow.addColorStop(0.18, `rgba(205, 228, 255, ${0.58 * edgeFade})`);
      headGlow.addColorStop(1, "rgba(125, 177, 255, 0)");
      ctx.fillStyle = headGlow;
      ctx.beginPath();
      ctx.arc(headX, headY, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (progress >= 1) {
        meteor = null;
        nextMeteorIn = 1.05 + Math.random() * 0.65;
      }
    };

    const readScroll = () => {
      if (reduceMotion) {
        targetScroll = 0;
        smoothScroll = 0;
        return;
      }
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      targetScroll = clamp(window.scrollY / maxScroll, 0, 1);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (reduceMotion || event.pointerType === "touch") return;
      targetPointer.x = clamp((event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2, -1, 1);
      targetPointer.y = clamp((event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2, -1, 1);
    };
    const resetPointer = () => {
      targetPointer.x = 0;
      targetPointer.y = 0;
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      isMobile = mobileQuery.matches;
      isCompact = compactQuery.matches || coarsePointerQuery.matches;

      const nextPixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioLimit());
      if (Math.abs(renderer.getPixelRatio() - nextPixelRatio) > 0.01) {
        renderer.setPixelRatio(nextPixelRatio);
      }
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      const ratio = renderer.getPixelRatio();
      meteorCanvas.width = Math.max(1, Math.round(width * ratio));
      meteorCanvas.height = Math.max(1, Math.round(height * ratio));
      meteorContext?.setTransform(ratio, 0, 0, ratio, 0, 0);
      meteor = null;
      nextMeteorIn = 0.65;
      const k = (height / 900) * ratio;
      galaxyMaterial.uniforms.uSize.value = 36 * k;
      starMaterial.uniforms.uSize.value = 140 * k;
      readScroll();
    };

    const animate = (time: number) => {
      if (!visible) return;

      // Pace rendering at roughly 60 Hz with an accumulator. This keeps
      // animation smooth on 90/120/144 Hz screens instead of blindly skipping
      // every other frame and accidentally dropping to 30–45 FPS.
      if (!reduceMotion) {
        const frameElapsed = lastFrameTime
          ? Math.min(time - lastFrameTime, 50)
          : targetFrameInterval;
        lastFrameTime = time;
        frameAccumulator += frameElapsed;
        if (frameAccumulator < targetFrameInterval) {
          animationFrame = window.requestAnimationFrame(animate);
          return;
        }
        frameAccumulator %= targetFrameInterval;
      }

      // Reduced-motion users get one stable render instead of a perpetual
      // animation loop. Pointer and scroll parallax are disabled as well.
      if (reduceMotion) {
        lastTime = 0;
        elapsed = 0;
        targetPointer.x = 0;
        targetPointer.y = 0;
        smoothPointer.x = 0;
        smoothPointer.y = 0;
        targetScroll = 0;
        smoothScroll = 0;
        galaxyMaterial.uniforms.uTime.value = 0;
        galaxyGroup.position.set(0, 0, 0);
        galaxyGroup.scale.setScalar(0.86);
        galaxyGroup.rotation.x = 0;
        galaxyGroup.rotation.y = 0;
        stars.rotation.set(0, 0, 0);
        drawMeteor(0);
        renderer.render(scene, camera);
        animationFrame = 0;
        return;
      }

      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
      lastTime = time;
      elapsed += delta;

      const damping = 1 - Math.pow(0.001, delta);
      smoothPointer.x += (targetPointer.x - smoothPointer.x) * damping * 0.82;
      smoothPointer.y += (targetPointer.y - smoothPointer.y) * damping * 0.82;
      smoothScroll += (targetScroll - smoothScroll) * 0.075;

      galaxyMaterial.uniforms.uTime.value = elapsed;
      // Use one calm parallax curve on every viewport. Compact/touch devices
      // receive a slightly smaller amplitude, not a different movement style.
      const scrollPhase = smoothScroll * Math.PI * 2;
      const zigzagX = Math.sin(scrollPhase) * (isMobile ? 0.34 : isCompact ? 0.48 : 0.72);
      const zigzagY = Math.cos(scrollPhase) * (isMobile ? 0.12 : 0.22);
      const scrollScale = 0.88 + smoothScroll * (isMobile ? 0.75 : isCompact ? 1 : 1.25);
      const pointerStrength = isCompact ? 0.42 : 0.62;
      galaxyGroup.position.set(
        zigzagX - smoothPointer.x * pointerStrength,
        zigzagY + smoothPointer.y * (isCompact ? 0.3 : 0.42),
        0,
      );
      galaxyGroup.scale.setScalar(scrollScale);
      galaxyGroup.rotation.x = smoothPointer.y * (isCompact ? 0.07 : 0.1);
      galaxyGroup.rotation.y = elapsed * 0.022 + smoothPointer.x * (isCompact ? 0.1 : 0.14);
      stars.rotation.y = elapsed * 0.0035 + smoothPointer.x * 0.02;
      stars.rotation.x = smoothPointer.y * (isCompact ? 0.012 : 0.016);

      drawMeteor(delta);

      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (visible) animationFrame = window.requestAnimationFrame(animate);
    };
    const onVisibilityChange = () => {
      visible = !document.hidden;
      if (!visible) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else {
        lastTime = 0;
        lastFrameTime = 0;
        frameAccumulator = 0;
        startAnimation();
      }
    };
    const onReducedMotionChange = () => {
      reduceMotion = reduceMotionQuery.matches;
      lastTime = 0;
      lastFrameTime = 0;
      frameAccumulator = 0;
      startAnimation();
    };
    const onWebGLContextLost = (event: Event) => {
      // Allow the browser/Three.js to restore the context, while showing the
      // CSS galaxy fallback instead of leaving a blank or frozen canvas.
      event.preventDefault();
      mount.dataset.galaxyStatus = "webgl-lost";
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const onWebGLContextRestored = () => {
      mount.dataset.galaxyStatus = "running";
      lastTime = 0;
      lastFrameTime = 0;
      frameAccumulator = 0;
      startAnimation();
    };

    renderer.domElement.addEventListener("webglcontextlost", onWebGLContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onWebGLContextRestored);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", readScroll, { passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
    window.addEventListener("blur", resetPointer);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reduceMotionQuery.addEventListener("change", onReducedMotionChange);
    resize();
    startAnimation();

    mount.dataset.galaxyStatus = "running";

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", readScroll);
      renderer.domElement.removeEventListener("webglcontextlost", onWebGLContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onWebGLContextRestored);
      document.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("blur", resetPointer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reduceMotionQuery.removeEventListener("change", onReducedMotionChange);
      galaxyGeometry.dispose();
      galaxyMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      meteorCanvas.remove();
      core.geometry.dispose();
      (core.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [count, radius, branches, spin, randomness, insideColor, outsideColor, shootingStars, deviceProfileRevision]);

  return <div ref={mountRef} className="home-galaxy-backdrop" aria-hidden="true" />;
}
