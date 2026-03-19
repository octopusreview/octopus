"use client";

import { useRef, useEffect, useState, useCallback, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

/* ------------------------------------------------------------------ */
/* 3D Octopus model                                                    */
/* ------------------------------------------------------------------ */

// All smooth state lives here — survives tab switches
const state = {
  mouse: { x: 0, y: 0 },
  pos: { x: -4, y: 0.5 },
  scroll: 0,        // smoothed
  scrollRaw: 0,     // actual
  rotX: 0,
  rotY: 0,
  scrollDir: 0,
  prevScroll: 0,
  lastTime: 0,
};

function OctopusModel() {
  const { scene, animations } = useGLTF("/octo4.glb");
  const groupRef = useRef<THREE.Group>(null!);
  const { actions, mixer } = useAnimations(animations, groupRef);
  const { viewport } = useThree();
  const currentAction = useRef<string | null>(null);

  // Start animation
  useEffect(() => {
    const names = Object.keys(actions);
    if (names.length === 0) return;

    const first = actions[names[0]];
    if (first) {
      first.reset().fadeIn(0.5).play();
      first.setLoop(THREE.LoopPingPong, Infinity);
      first.timeScale = 2;
      currentAction.current = names[0];
    }

    if (names.length > 1) {
      const interval = setInterval(() => {
        const curName = currentAction.current;
        const curIdx = curName ? names.indexOf(curName) : 0;
        const nextIdx = (curIdx + 1) % names.length;
        const nextName = names[nextIdx];
        const cur = curName ? actions[curName] : null;
        const next = actions[nextName];
        if (next) {
          next.reset();
          next.setLoop(THREE.LoopPingPong, Infinity);
          next.timeScale = 2;
          next.play();
          next.crossFadeFrom(cur!, 2, true);
          currentAction.current = nextName;
        }
      }, 6000);
      return () => clearInterval(interval);
    }
  }, [actions]);

  // Switch to first anim on scroll up
  useEffect(() => {
    const names = Object.keys(actions);
    if (names.length < 2) return;
    const check = setInterval(() => {
      if (state.scrollDir < 0 && currentAction.current !== names[0]) {
        const cur = currentAction.current ? actions[currentAction.current] : null;
        const first = actions[names[0]];
        if (first && cur) {
          first.reset();
          first.setLoop(THREE.LoopPingPong, Infinity);
          first.timeScale = 2;
          first.play();
          first.crossFadeFrom(cur, 1.5, true);
          currentAction.current = names[0];
        }
      }
    }, 500);
    return () => clearInterval(check);
  }, [actions]);

  // Handle tab visibility — pause/resume mixer
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        mixer?.stopAllAction();
      } else {
        // Restart current animation cleanly
        const names = Object.keys(actions);
        const name = currentAction.current || names[0];
        const action = name ? actions[name] : null;
        if (action) {
          action.reset().fadeIn(0.3).play();
          action.setLoop(THREE.LoopPingPong, Infinity);
          action.timeScale = 2;
        }
        // Reset timing to avoid delta spike
        state.lastTime = performance.now() * 0.001;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [actions, mixer]);

  useFrame(() => {
    if (!groupRef.current) return;

    const now = performance.now() * 0.001;
    // Clamp delta to avoid huge jumps after tab switch
    const delta = Math.min(now - (state.lastTime || now), 0.05);
    state.lastTime = now;

    const t = now;

    // Smooth scroll — very slow lerp for heavy feel
    state.scroll += (state.scrollRaw - state.scroll) * delta * 2;
    const sp = state.scroll;

    // Scroll direction
    state.scrollDir = state.scrollRaw > state.prevScroll + 0.001 ? 1 :
                      state.scrollRaw < state.prevScroll - 0.001 ? -1 : 0;
    state.prevScroll = state.scrollRaw;

    // X position: start left, go right in middle, back to left at bottom
    // Uses a curve that goes: left → right → left
    const baseX = -viewport.width * 0.22;
    const swayX = Math.sin(sp * Math.PI) * viewport.width * 0.6;
    const scrollY = sp * -1.5;

    let targetX = baseX + swayX + Math.sin(t * 0.15) * 0.1;
    let targetY = 0.5 + scrollY + Math.cos(t * 0.2) * 0.1;

    // Flee from mouse
    const mx = state.mouse.x * viewport.width * 0.5;
    const my = state.mouse.y * viewport.height * 0.5;
    const dx = state.pos.x - mx;
    const dy = state.pos.y - my;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 3 && dist > 0) {
      const power = (1 - dist / 3) * 2.5;
      const angle = Math.atan2(dy, dx);
      targetX += Math.cos(angle) * power;
      targetY += Math.sin(angle) * power;
    }

    // Clamp
    const hw = viewport.width * 0.45;
    const hh = viewport.height * 0.4;
    targetX = Math.max(-hw, Math.min(hw, targetX));
    targetY = Math.max(-hh, Math.min(hh, targetY));

    // Very slow lerp — sluggish underwater feel
    state.pos.x += (targetX - state.pos.x) * delta * 0.8;
    state.pos.y += (targetY - state.pos.y) * delta * 0.8;

    groupRef.current.position.x = state.pos.x;
    groupRef.current.position.y = state.pos.y + Math.sin(t * 0.8) * 0.15;

    // Rotation: tilt with scroll direction
    const tiltX = state.scrollDir > 0 ? 0.25 : state.scrollDir < 0 ? -0.2 : 0;
    state.rotX += (tiltX - state.rotX) * delta * 1.5;

    // Turn toward movement direction
    const moveDir = targetX - state.pos.x;
    const turnY = -moveDir * 0.6;
    state.rotY += (turnY - state.rotY) * delta * 1.5;

    groupRef.current.rotation.x = state.rotX;
    groupRef.current.rotation.y = state.rotY;
    groupRef.current.rotation.z = THREE.MathUtils.lerp(
      groupRef.current.rotation.z,
      -moveDir * 0.1,
      delta * 1.5
    );
  });

  // Scale & center
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    scene.scale.setScalar(0.05);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.set(-center.x * 0.05, -center.y * 0.05, -center.z * 0.05);
  }, [scene]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

function Scene() {
  const { size } = useThree();

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      state.mouse.x = (e.clientX / size.width) * 2 - 1;
      state.mouse.y = -(e.clientY / size.height) * 2 + 1;
    };
    const onScroll = () => {
      const pageH = document.documentElement.scrollHeight - window.innerHeight;
      state.scrollRaw = pageH > 0 ? window.scrollY / pageH : 0;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, [size]);

  return (
    <>
      <ambientLight intensity={1} />
      <directionalLight position={[5, 5, 5]} intensity={1.5} />
      <directionalLight position={[-3, 3, -2]} intensity={0.5} color="#88ddcc" />
      <pointLight position={[0, -3, 3]} intensity={0.8} color="#6666ff" />
      <pointLight position={[0, 2, 4]} intensity={0.6} color="#00ffcc" />
      <Suspense fallback={null}>
        <OctopusModel />
      </Suspense>
    </>
  );
}

export function FloatingOctopus() {
  const [mounted, setMounted] = useState(false);
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const TEXT_TAGS = new Set([
      "P", "H1", "H2", "H3", "H4", "H5", "H6",
      "SPAN", "A", "LI", "LABEL", "BUTTON",
    ]);

    let isOverText = false;
    let undimTimer = 0;

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const hasText = el != null && (
        TEXT_TAGS.has(el.tagName) ||
        Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      );

      if (hasText === isOverText) return; // no change, skip
      isOverText = hasText;

      if (hasText) {
        // Entering text — dim immediately, cancel any pending undim
        window.clearTimeout(undimTimer);
        setDimmed(true);
      } else {
        // Leaving text — debounce the undim
        window.clearTimeout(undimTimer);
        undimTimer = window.setTimeout(() => setDimmed(false), 500);
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(undimTimer);
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 hidden md:block"
      style={{ opacity: dimmed ? 0.15 : 1, transition: "opacity 0.4s ease" }}
    >
      <Canvas
        camera={{ position: [0, 0, 14], fov: 40 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent", pointerEvents: "none" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
