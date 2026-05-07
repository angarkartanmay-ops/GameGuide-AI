import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* ----------------------------------------------------------------
   HoloCanvas — isolated R3F bundle, dynamically imported by the
   landing page so Three.js is only paid for when desktop + motion.
   ---------------------------------------------------------------- */

function Crystal({ tiltRef }) {
  const ref = useRef();
  // Subtle vertex displacement → faceted-crystal silhouette
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1.55, 4); // ~1280 tris
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const noise = 0.04 * Math.sin(v.x * 4.2) * Math.cos(v.y * 3.7) * Math.sin(v.z * 5.1);
      v.multiplyScalar(1 + noise);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += 0.005 + delta * 0.05;
    const t = tiltRef.current;
    const targetX = t.y * 0.21;
    const targetZ = -t.x * 0.21;
    ref.current.rotation.x += (targetX - ref.current.rotation.x) * 0.06;
    ref.current.rotation.z += (targetZ - ref.current.rotation.z) * 0.06;
  });

  return (
    <mesh ref={ref} geometry={geo} castShadow>
      <meshPhysicalMaterial
        color="#e8e6ff"
        roughness={0.12}
        metalness={0.65}
        iridescence={1}
        iridescenceIOR={1.45}
        iridescenceThicknessRange={[100, 800]}
        clearcoat={1}
        clearcoatRoughness={0.05}
        envMapIntensity={0.6}
      />
    </mesh>
  );
}

function CameraRig({ dollyState, initialZ = 4 }) {
  useFrame((state) => {
    const target = dollyState.current ? -2 : initialZ;
    const cam = state.camera;
    cam.position.z += (target - cam.position.z) * 0.18;
    cam.lookAt(0, 0, 0);
  });
  return null;
}

export default function HoloCanvas({ tiltRef, dollyRef }) {
  return (
    <Canvas
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 4], fov: 45 }}
      aria-hidden="true"
    >
      {/* Iridescent rim lights — cyan / violet / rose */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 3, 5]} intensity={2.4} color="#67E8F9" />
      <directionalLight position={[-5, -2, 2]} intensity={1.8} color="#C084FC" />
      <directionalLight position={[2, -4, -3]} intensity={1.6} color="#FB7185" />
      <pointLight position={[0, 0, 5]} intensity={0.4} color="#ffffff" />
      <Crystal tiltRef={tiltRef} />
      <CameraRig dollyState={dollyRef} />
    </Canvas>
  );
}
