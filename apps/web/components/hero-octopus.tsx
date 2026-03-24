"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/* ------------------------------------------------------------------ */
/* Shared state — mouse position & click target                        */
/* ------------------------------------------------------------------ */

const mouseNDC = new THREE.Vector2(0, 0);
const clickTarget = new THREE.Vector3(0, 0, 0);
let hasClickTarget = false;

/* ------------------------------------------------------------------ */
/* Input handler — runs inside Canvas                                  */
/* ------------------------------------------------------------------ */

function InputHandler() {
  const { size, camera } = useThree();

  useEffect(() => {
    function onMove(e: MouseEvent) {
      mouseNDC.x = (e.clientX / size.width) * 2 - 1;
      mouseNDC.y = -(e.clientY / size.height) * 2 + 1;
    }
    function onClick(e: MouseEvent) {
      const ndcX = (e.clientX / size.width) * 2 - 1;
      const ndcY = -(e.clientY / size.height) * 2 + 1;
      // Project click onto a plane at z=0 in world space
      const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
      vec.unproject(camera);
      const dir = vec.sub(camera.position).normalize();
      const dist = -camera.position.z / dir.z;
      const pos = camera.position.clone().add(dir.multiplyScalar(dist));
      // Clamp to reasonable bounds
      clickTarget.set(
        THREE.MathUtils.clamp(pos.x, -4, 4),
        THREE.MathUtils.clamp(pos.y, -2.5, 2.5),
        0
      );
      hasClickTarget = true;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("click", onClick);
    };
  }, [size, camera]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Tentacle                                                            */
/* ------------------------------------------------------------------ */

function Tentacle({
  baseAngle,
  length = 2.2,
  color,
  phaseOffset = 0,
  speedMultiplier = 1,
}: {
  baseAngle: number;
  length?: number;
  color: string;
  phaseOffset?: number;
  speedMultiplier?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const tubeSegments = 32;
  const radiusSegments = 6;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();

    const points: THREE.Vector3[] = [];
    const segments = 12;

    for (let i = 0; i <= segments; i++) {
      const frac = i / segments;
      const dx = Math.cos(baseAngle);
      const dz = Math.sin(baseAngle);

      // Faster waving when moving (speedMultiplier changes)
      const wave = Math.sin(t * 1.5 * speedMultiplier + frac * 4 + phaseOffset) * frac * 0.5;
      const wave2 = Math.cos(t * 1.2 * speedMultiplier + frac * 3 + phaseOffset * 1.3) * frac * 0.3;

      const x = dx * frac * length + wave * -dz;
      const y = -frac * length * 0.7 - Math.pow(frac, 2) * 0.5;
      const z = dz * frac * length + wave2 * dx;

      points.push(new THREE.Vector3(x, y, z));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const newGeometry = new THREE.TubeGeometry(curve, tubeSegments, 0.15, radiusSegments, false);

    // Taper
    const pos = newGeometry.attributes.position;
    const ringSize = radiusSegments + 1;
    const rings = Math.floor(pos.count / ringSize);
    for (let ring = 0; ring < rings; ring++) {
      const f = ring / (rings - 1);
      const scale = 1 - f * 0.85;
      const cp = curve.getPointAt(Math.min(f, 1));
      for (let j = 0; j < ringSize; j++) {
        const idx = ring * ringSize + j;
        pos.setXYZ(
          idx,
          cp.x + (pos.getX(idx) - cp.x) * scale,
          cp.y + (pos.getY(idx) - cp.y) * scale,
          cp.z + (pos.getZ(idx) - cp.z) * scale
        );
      }
    }

    newGeometry.computeVertexNormals();
    meshRef.current.geometry.dispose();
    meshRef.current.geometry = newGeometry;
  });

  const initialGeometry = useMemo(() => {
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const frac = i / 12;
      const dx = Math.cos(baseAngle);
      const dz = Math.sin(baseAngle);
      points.push(new THREE.Vector3(dx * frac * length, -frac * length * 0.7 - Math.pow(frac, 2) * 0.5, dz * frac * length));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), tubeSegments, 0.15, radiusSegments, false);
  }, [baseAngle, length]);

  return (
    <mesh ref={meshRef} geometry={initialGeometry}>
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Octopus — walks toward click, looks at mouse                        */
/* ------------------------------------------------------------------ */

function Octopus() {
  const groupRef = useRef<THREE.Group>(null!);
  const currentPos = useRef(new THREE.Vector3(0, 0, 0));
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const isMoving = useRef(false);
  const speedMul = useRef(1);

  const bodyColor = "#2a8a7a";
  const bodyLight = "#3db8a5";
  const tentacleColor = "#247a6c";

  const tentacles = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      angle: (i / 8) * Math.PI * 2,
      phase: i * 0.8,
      length: 1.8 + Math.random() * 0.6,
    }));
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // --- Movement toward click target ---
    if (hasClickTarget) {
      const target = clickTarget.clone();
      const current = currentPos.current;
      const diff = target.clone().sub(current);
      const dist = diff.length();

      if (dist > 0.05) {
        isMoving.current = true;
        // Bobbing motion while walking
        const moveSpeed = Math.min(dist, 2.5) * delta * 2;
        const direction = diff.normalize();
        velocity.current.lerp(direction.multiplyScalar(moveSpeed), delta * 5);
        current.add(velocity.current);

        // Lean into movement direction
        groupRef.current.rotation.z = THREE.MathUtils.lerp(
          groupRef.current.rotation.z,
          -velocity.current.x * 0.3,
          delta * 4
        );

        // Bobbing
        const bob = Math.sin(Date.now() * 0.008) * 0.1;
        groupRef.current.position.set(current.x, current.y + bob, current.z);

        speedMul.current = THREE.MathUtils.lerp(speedMul.current, 2.5, delta * 3);
      } else {
        isMoving.current = false;
        hasClickTarget = false;
        velocity.current.set(0, 0, 0);
        groupRef.current.position.set(current.x, current.y, current.z);
        speedMul.current = THREE.MathUtils.lerp(speedMul.current, 1, delta * 3);
        // Settle lean
        groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0, delta * 4);
      }
    } else {
      // Idle floating
      const idleBob = Math.sin(Date.now() * 0.002) * 0.08;
      const pos = currentPos.current;
      groupRef.current.position.set(pos.x, pos.y + idleBob, pos.z);
      speedMul.current = THREE.MathUtils.lerp(speedMul.current, 1, delta * 3);
      groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0, delta * 3);
    }

    // --- Look at mouse ---
    const lookX = mouseNDC.y * 0.3;
    const lookY = mouseNDC.x * 0.4;
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, lookX, delta * 2);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, lookY, delta * 2);
  });

  return (
    <group ref={groupRef}>
      {/* Head */}
      <mesh position={[0, 0.6, 0]}>
        <sphereGeometry args={[1, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.7]} />
        <meshStandardMaterial color={bodyColor} roughness={0.4} metalness={0.15} />
      </mesh>

      {/* Head top dome */}
      <mesh position={[0, 1.05, 0]} scale={[1, 0.7, 1]}>
        <sphereGeometry args={[0.75, 32, 16]} />
        <meshStandardMaterial color={bodyLight} roughness={0.35} metalness={0.1} />
      </mesh>

      {/* Lower body */}
      <mesh position={[0, -0.1, 0]}>
        <sphereGeometry args={[0.85, 32, 16]} />
        <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={0.1} />
      </mesh>

      {/* Left eye */}
      <group position={[-0.42, 0.55, 0.78]}>
        <mesh>
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.15]}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.2} />
        </mesh>
        <mesh position={[0.05, 0.05, 0.2]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
        </mesh>
      </group>

      {/* Right eye */}
      <group position={[0.42, 0.55, 0.78]}>
        <mesh>
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.15]}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.2} />
        </mesh>
        <mesh position={[0.05, 0.05, 0.2]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
        </mesh>
      </group>

      {/* Tentacles */}
      <group position={[0, -0.3, 0]}>
        {tentacles.map((t, i) => (
          <Tentacle
            key={i}
            baseAngle={t.angle}
            length={t.length}
            color={i % 2 === 0 ? tentacleColor : bodyColor}
            phaseOffset={t.phase}
            speedMultiplier={speedMul.current}
          />
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function Scene() {
  return (
    <>
      <InputHandler />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-3, 3, -2]} intensity={0.3} color="#88ddcc" />
      <pointLight position={[0, -3, 2]} intensity={0.4} color="#44aa88" />
      <Octopus />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Exported component                                                  */
/* ------------------------------------------------------------------ */

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext;
  } catch {
    return false;
  }
}

export function HeroOctopus({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [webglSupported, setWebglSupported] = useState(true);

  useEffect(() => {
    setMounted(true);
    setWebglSupported(isWebGLAvailable());
    const onToggle = () => setWebglSupported((v) => !v);
    window.addEventListener("webgl-toggle", onToggle);
    return () => window.removeEventListener("webgl-toggle", onToggle);
  }, []);

  if (!mounted || !webglSupported) return null;

  return (
    <div className={className ?? "pointer-events-auto absolute inset-0 z-0 opacity-30 dark:opacity-20"}>
      <Canvas
        camera={{ position: [0, 0.5, 6], fov: 40 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
        onCreated={({ gl }) => {
          // If context is lost (e.g. blocked by extension), hide gracefully
          gl.domElement.addEventListener("webglcontextlost", () => {
            setWebglSupported(false);
          });
        }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
