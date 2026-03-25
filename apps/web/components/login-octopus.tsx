"use client";

import { useRef, useEffect, useState, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

const mouse = { x: 0, y: 0 };

function OctopusModel() {
  const { scene, animations } = useGLTF("/octo4.glb");
  const groupRef = useRef<THREE.Group>(null!);
  const { actions } = useAnimations(animations, groupRef);

  useEffect(() => {
    const names = Object.keys(actions);
    if (names.length === 0) return;
    const first = actions[names[0]];
    if (first) {
      first.reset().fadeIn(0.5).play();
      first.setLoop(THREE.LoopPingPong, Infinity);
      first.timeScale = 1.5;
    }
  }, [actions]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    scene.scale.setScalar(0.05);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.set(-center.x * 0.05, -center.y * 0.05, -center.z * 0.05);
  }, [scene]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();

    // Gentle idle float
    groupRef.current.position.y = Math.sin(t * 0.8) * 0.15;
    groupRef.current.position.x = Math.sin(t * 0.3) * 0.1;

    // Look toward mouse
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      mouse.x * 0.4,
      0.02
    );
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      -mouse.y * 0.2,
      0.02
    );
  });

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
      mouse.x = (e.clientX / size.width) * 2 - 1;
      mouse.y = -(e.clientY / size.height) * 2 + 1;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
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

export function LoginOctopus() {
  const [mounted, setMounted] = useState(false);
  const [webglSupported, setWebglSupported] = useState(true);

  useEffect(() => {
    setMounted(true);
    setWebglSupported(isWebGLAvailable() && localStorage.getItem("octopus-3d-hidden") !== "true");
    const onToggle = () => setWebglSupported((v) => !v);
    window.addEventListener("webgl-toggle", onToggle);
    return () => window.removeEventListener("webgl-toggle", onToggle);
  }, []);

  if (!mounted) return null;

  if (!webglSupported) {
    return (
      <div className="flex h-full items-center justify-center">
        <img
          src="/octor-tp.png"
          alt="Octopus"
          className="size-80 animate-float object-contain opacity-80"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <Canvas
      camera={{ position: [0, 0.5, 10], fov: 40 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", () => {
          setWebglSupported(false);
        });
      }}
    >
      <Scene />
    </Canvas>
  );
}
