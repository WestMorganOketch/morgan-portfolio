"use client";

import { useEffect, useRef } from "react";
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

type Comet = {
  active: boolean;
  age: number;
  life: number;
  speed: number;
  position: THREE.Vector3;
  direction: THREE.Vector3;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function GalaxyBackdrop({
  count = 90000,
  radius = 6,
  branches = 4,
  spin = 1.25,
  randomness = 0.42,
  insideColor = "#ffad76",
  outsideColor = "#557dff",
  shootingStars = true,
}: GalaxyProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = reduceMotionQuery.matches;
    const isMobile = window.matchMedia("(max-width: 700px)").matches;
    const particleCount = isMobile ? Math.floor(count * 0.48) : count;

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

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.65));
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

    // Shooting stars are shader-rendered points along a fading comet trail.
    // Keep the meteor field to one comet so each trail has its own quiet moment.
    const cometPool = 1;
    const trailCount = 40;
    const trailSpacing = 0.085;
    const trailPositions = new Float32Array(cometPool * trailCount * 3);
    const trailFades = new Float32Array(cometPool * trailCount);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute("aFade", new THREE.BufferAttribute(trailFades, 1));
    const trailMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 80 } },
      vertexShader: [
        "uniform float uSize;",
        "attribute float aFade;",
        "varying float vFade;",
        "void main() {",
        "  vec4 vp = viewMatrix * vec4(position, 1.0);",
        "  gl_Position = projectionMatrix * vp;",
        "  gl_PointSize = clamp(uSize * (0.25 + aFade) / max(-vp.z, 0.1), 0.5, 7.0);",
        "  vFade = aFade;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "varying float vFade;",
        "void main() {",
        "  float d = length(gl_PointCoord - 0.5);",
        "  float glow = pow(1.0 - clamp(d * 2.0, 0.0, 1.0), 2.0);",
        "  vec3 col = mix(vec3(0.35, 0.6, 1.0), vec3(1.0), vFade);",
        "  gl_FragColor = vec4(col, glow * vFade);",
        "}",
      ].join("\n"),
    });
    const trailPoints = new THREE.Points(trailGeometry, trailMaterial);
    trailPoints.frustumCulled = false;
    scene.add(trailPoints);

    const comets: Comet[] = Array.from({ length: cometPool }, () => ({
      active: false,
      age: 0,
      life: 1,
      speed: 10,
      position: new THREE.Vector3(),
      direction: new THREE.Vector3(),
    }));

    const spawnComet = (comet: Comet) => {
      comet.active = true;
      comet.age = 0;
      // A longer, slower passage with a gentle downward arc.
      comet.life = 2.25 + Math.random() * 0.55;
      comet.speed = 4.8 + Math.random() * 1.35;
      const fromRight = Math.random() < 0.5;
      const slope = 0.16 + Math.random() * 0.18;
      const depth = -2 + Math.random() * 4;
      if (fromRight) {
        comet.position.set(7.0 + Math.random() * 1.2, 4.1 + Math.random() * 2.0, depth);
        comet.direction.set(-1, -slope, (Math.random() - 0.5) * 0.08).normalize();
      } else {
        comet.position.set(-7.0 - Math.random() * 1.2, 6.1 - Math.random() * 2.0, depth);
        comet.direction.set(1, -slope, (Math.random() - 0.5) * 0.08).normalize();
      }
    };

    const targetPointer = { x: 0, y: 0 };
    const smoothPointer = { x: 0, y: 0 };
    let targetScroll = 0;
    let smoothScroll = 0;
    // First meteor appears after a calm pause; later meteors wait until the
    // previous one has fully faded before the next begins.
    let nextCometAt = 3.0 + Math.random() * 2.0;
    let lastTime = 0;
    let elapsed = 0;
    let animationFrame = 0;
    let visible = !document.hidden;
    let width = 1;
    let height = 1;

    const readScroll = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      targetScroll = clamp(window.scrollY / maxScroll, 0, 1);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
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
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      const ratio = renderer.getPixelRatio();
      const k = (height / 900) * ratio;
      galaxyMaterial.uniforms.uSize.value = 36 * k;
      starMaterial.uniforms.uSize.value = 140 * k;
      trailMaterial.uniforms.uSize.value = 80 * k;
      readScroll();
    };

    const animate = (time: number) => {
      if (!visible) return;
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
      lastTime = time;
      if (!reduceMotion) elapsed += delta;

      const damping = 1 - Math.pow(0.001, delta);
      smoothPointer.x += (targetPointer.x - smoothPointer.x) * damping * 0.82;
      smoothPointer.y += (targetPointer.y - smoothPointer.y) * damping * 0.82;
      smoothScroll += (targetScroll - smoothScroll) * 0.075;

      galaxyMaterial.uniforms.uTime.value = elapsed;
      const zigzagX = Math.sin(smoothScroll * Math.PI * 5) * (isMobile ? 0.75 : 1.55);
      const zigzagY = Math.cos(smoothScroll * Math.PI * 5) * 0.35;
      const scrollScale = 0.86 + smoothScroll * 1.85;
      galaxyGroup.position.set(
        zigzagX - smoothPointer.x * 0.72,
        zigzagY + smoothPointer.y * 0.48,
        0,
      );
      galaxyGroup.scale.setScalar(scrollScale);
      galaxyGroup.rotation.x = smoothPointer.y * 0.12;
      galaxyGroup.rotation.y = elapsed * 0.025 + smoothPointer.x * 0.16;
      stars.rotation.y = elapsed * 0.004 + smoothPointer.x * 0.025;
      stars.rotation.x = smoothPointer.y * 0.018;

      if (shootingStars && !reduceMotion) {
        const comet = comets[0];
        nextCometAt -= delta;

        if (!comet.active && nextCometAt <= 0) {
          spawnComet(comet);
        }

        if (comet.active) {
          comet.age += delta;
          comet.position.addScaledVector(comet.direction, comet.speed * delta);
          if (comet.age >= comet.life) {
            comet.active = false;
            // Let the last trail disappear before the next comet enters.
            nextCometAt = 3.2 + Math.random() * 2.5;
          }
        }

        const fade = comet.active
          ? Math.sin(Math.PI * clamp(comet.age / comet.life, 0, 1))
          : 0;
        for (let k = 0; k < trailCount; k++) {
          const idx = k;
          trailPositions[idx * 3] = comet.position.x - comet.direction.x * k * trailSpacing;
          trailPositions[idx * 3 + 1] = comet.position.y - comet.direction.y * k * trailSpacing;
          trailPositions[idx * 3 + 2] = comet.position.z - comet.direction.z * k * trailSpacing;
          trailFades[idx] = fade * Math.pow(1 - k / trailCount, 1.8);
        }
        trailGeometry.attributes.position.needsUpdate = true;
        trailGeometry.attributes.aFade.needsUpdate = true;
      }

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
        startAnimation();
      }
    };
    const onReducedMotionChange = () => {
      reduceMotion = reduceMotionQuery.matches;
      startAnimation();
    };

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
      document.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("blur", resetPointer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reduceMotionQuery.removeEventListener("change", onReducedMotionChange);
      galaxyGeometry.dispose();
      galaxyMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      core.geometry.dispose();
      (core.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [count, radius, branches, spin, randomness, insideColor, outsideColor, shootingStars]);

  return <div ref={mountRef} className="home-galaxy-backdrop" aria-hidden="true" />;
}
