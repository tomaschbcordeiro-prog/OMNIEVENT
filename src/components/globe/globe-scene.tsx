"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars, useTexture, Html } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { latLngToVec3, subsolarPoint, vec3ToLatLng } from "@/lib/geo";
import { GROUP_HEX, GROUP_SHAPE } from "@/lib/categories";
import type { Cluster } from "@/lib/types";

export interface GlobeView {
  lat: number;
  lng: number;
  /** Altitude above the surface in globe radii. */
  alt: number;
}

export interface FlyTarget extends GlobeView {
  key: number;
}

export interface GlobeSceneProps {
  clusters: Cluster[];
  selectedId?: string;
  density: boolean;
  autoRotate: boolean;
  reducedMotion: boolean;
  flyTo?: FlyTarget;
  initialView: GlobeView;
  onViewChange: (v: GlobeView) => void;
  onClusterClick: (c: Cluster) => void;
  onReady?: () => void;
}

const MIN_DIST = 1.06;
const MAX_DIST = 4.2;

// ------------------------------------------------------------------ Earth

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D waterMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float d = dot(n, sunDir);
    float dayMix = smoothstep(-0.10, 0.22, d);

    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;

    // Lit side: soft Lambert with a floor so the day side never looks flat-black.
    vec3 lit = day * (0.18 + 1.05 * max(d, 0.0));
    // Night side: city lights, warm-tinted, plus a trace of the surface.
    vec3 lights = pow(night, vec3(1.35)) * vec3(1.0, 0.82, 0.55) * 2.2 + day * 0.03;
    vec3 col = mix(lights, lit, dayMix);

    // Sun glint over water.
    vec3 h = normalize(sunDir + v);
    float spec = pow(max(dot(n, h), 0.0), 60.0) * water * 0.55 * dayMix;
    col += vec3(1.0, 0.95, 0.85) * spec;

    // Terminator warmth.
    float term = exp(-pow(d * 7.0, 2.0)) * 0.08;
    col += vec3(1.0, 0.45, 0.2) * term;

    // Atmospheric rim.
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += vec3(0.26, 0.62, 1.0) * fres * (0.18 + 0.45 * dayMix);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const atmoVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const atmoFragment = /* glsl */ `
  uniform vec3 sunDir;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float rim = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 4.0);
    float sun = smoothstep(-0.35, 0.4, dot(n, sunDir));
    vec3 c = mix(vec3(0.16, 0.30, 0.75), vec3(0.35, 0.78, 1.0), sun);
    gl_FragColor = vec4(c, rim * (0.25 + 0.75 * sun));
  }
`;

function useSunDir(): THREE.Vector3 {
  const [dir, setDir] = useState(() => {
    const s = subsolarPoint(new Date());
    return new THREE.Vector3(...latLngToVec3(s.lat, s.lng)).normalize();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const s = subsolarPoint(new Date());
      setDir(new THREE.Vector3(...latLngToVec3(s.lat, s.lng)).normalize());
    }, 60000);
    return () => clearInterval(id);
  }, []);
  return dir;
}

function Earth({ onReady }: { onReady?: () => void }) {
  const [day, night, water] = useTexture(["/textures/earth-blue-marble.jpg", "/textures/earth-night.jpg", "/textures/earth-water.png"]);
  const gl = useThree((s) => s.gl);
  const sun = useSunDir();
  const mat = useRef<THREE.ShaderMaterial>(null);

  useMemo(() => {
    for (const t of [day, night]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    }
  }, [day, night, gl]);

  const uniforms = useMemo(
    () => ({ dayMap: { value: day }, nightMap: { value: night }, waterMap: { value: water }, sunDir: { value: sun.clone() } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day, night, water],
  );
  useEffect(() => {
    if (mat.current) mat.current.uniforms.sunDir.value.copy(sun);
  }, [sun]);
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  const atmoUniforms = useMemo(() => ({ sunDir: { value: sun.clone() } }), [sun]);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[1, 160, 80]} />
        <shaderMaterial ref={mat} vertexShader={earthVertex} fragmentShader={earthFragment} uniforms={uniforms} />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[1, 96, 48]} />
        <shaderMaterial vertexShader={atmoVertex} fragmentShader={atmoFragment} uniforms={atmoUniforms} transparent side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ Markers

function shapeGeometry(shape: string): THREE.BufferGeometry {
  switch (shape) {
    case "square":
      return new THREE.PlaneGeometry(1.5, 1.5);
    case "diamond": {
      const g = new THREE.PlaneGeometry(1.45, 1.45);
      g.rotateZ(Math.PI / 4);
      return g;
    }
    case "triangle":
      return new THREE.CircleGeometry(1.05, 3);
    case "hex":
      return new THREE.CircleGeometry(0.95, 6);
    default:
      return new THREE.CircleGeometry(0.85, 24);
  }
}

const Z = new THREE.Vector3(0, 0, 1);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

function markerScale(count: number, alt: number) {
  const base = 0.0032 + Math.min(0.011, Math.log2(count + 1) * 0.0016);
  return base * THREE.MathUtils.clamp(alt / 1.4, 0.05, 1.5);
}

function MarkerLayer({
  shape, items, alt, density, onClick, onHover, selectedId,
}: {
  shape: string;
  items: Cluster[];
  alt: number;
  density: boolean;
  selectedId?: string;
  onClick: (c: Cluster) => void;
  onHover: (c: Cluster | null) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const bars = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => shapeGeometry(shape), [shape]);
  const barGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.5);
    return g;
  }, []);
  const max = Math.max(1, ...items.map((c) => c.count));

  useEffect(() => {
    const m = mesh.current, h = halo.current, b = bars.current;
    if (!m || !h || !b) return;
    items.forEach((c, i) => {
      const [x, y, z] = latLngToVec3(c.lat, c.lng, 1.0015);
      tmpP.set(x, y, z);
      tmpQ.setFromUnitVectors(Z, tmpP.clone().normalize());
      const s = markerScale(c.count, alt) * (c.id === selectedId ? 1.5 : 1);
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(i, tmpM);
      tmpS.set(s * 2.2, s * 2.2, s * 2.2);
      tmpM.compose(tmpP, tmpQ, tmpS);
      h.setMatrixAt(i, tmpM);
      const height = density ? 0.02 + 0.32 * Math.sqrt(c.count / max) : 0.00001;
      tmpS.set(s * 0.55, s * 0.55, height);
      tmpM.compose(tmpP, tmpQ, tmpS);
      b.setMatrixAt(i, tmpM);
      tmpC.set(GROUP_HEX[c.dominant] ?? GROUP_HEX.other);
      m.setColorAt(i, tmpC);
      h.setColorAt(i, tmpC);
      b.setColorAt(i, tmpC);
    });
    for (const x of [m, h, b]) {
      x.count = items.length;
      x.instanceMatrix.needsUpdate = true;
      if (x.instanceColor) x.instanceColor.needsUpdate = true;
      x.computeBoundingSphere();
    }
  }, [items, alt, density, max, selectedId]);

  const cap = Math.max(1, items.length);
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? items[e.instanceId] : undefined);

  return (
    <group>
      <instancedMesh ref={halo} args={[geo, undefined, cap]} raycast={() => null} frustumCulled={false}>
        <meshBasicMaterial transparent opacity={0.12} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      <instancedMesh ref={bars} args={[barGeo, undefined, cap]} raycast={() => null} visible={density} frustumCulled={false}>
        <meshBasicMaterial transparent opacity={0.55} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh
        ref={mesh}
        args={[geo, undefined, cap]}
        frustumCulled={false}
        onPointerMove={(e) => {
          e.stopPropagation();
          const c = pick(e);
          onHover(c ?? null);
          document.body.style.cursor = c ? "pointer" : "";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          const c = pick(e);
          if (c) onClick(c);
        }}
      >
        <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}

// ------------------------------------------------------------------ Camera

function CameraRig({
  flyTo, initialView, autoRotate, reducedMotion, onViewChange, onAlt,
}: {
  flyTo?: FlyTarget;
  initialView: GlobeView;
  autoRotate: boolean;
  reducedMotion: boolean;
  onViewChange: (v: GlobeView) => void;
  onAlt: (alt: number) => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; fromD: number; toD: number; t: number; dur: number } | null>(null);
  const lastAlt = useRef(0);
  const interacting = useRef(false);

  useEffect(() => {
    const [x, y, z] = latLngToVec3(initialView.lat, initialView.lng, 1 + initialView.alt);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!flyTo) return;
    const to = new THREE.Vector3(...latLngToVec3(flyTo.lat, flyTo.lng)).normalize();
    const from = camera.position.clone().normalize();
    const toD = THREE.MathUtils.clamp(1 + flyTo.alt, MIN_DIST, MAX_DIST);
    if (reducedMotion) {
      camera.position.copy(to.multiplyScalar(toD));
      controls.current?.update();
      emit();
      return;
    }
    const angle = from.angleTo(to);
    anim.current = { from, to, fromD: camera.position.length(), toD, t: 0, dur: 0.9 + angle * 0.45 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.key]);

  const emit = () => {
    const p = camera.position;
    const { lat, lng } = vec3ToLatLng(p.x, p.y, p.z);
    onViewChange({ lat, lng, alt: p.length() - 1 });
  };

  useFrame((_, dt) => {
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - Math.pow(-2 * a.t + 2, 3) / 2; // easeInOutCubic
      const dir = new THREE.Vector3().copy(a.from).lerp(a.to, e);
      if (dir.lengthSq() < 1e-6) dir.copy(a.to);
      dir.normalize();
      // Lift the camera mid-flight on long hops for a sense of travel.
      const hop = Math.sin(Math.PI * e) * Math.min(1.2, a.from.angleTo(a.to) * 0.6);
      const d = THREE.MathUtils.lerp(a.fromD, a.toD, e) + hop;
      camera.position.copy(dir.multiplyScalar(d));
      camera.lookAt(0, 0, 0);
      controls.current?.update();
      if (a.t >= 1) {
        anim.current = null;
        emit();
      }
    }
    const c = controls.current;
    if (c) {
      const dist = camera.position.length();
      // Slow rotation down as you get closer so the ground moves at a sane pace.
      c.rotateSpeed = THREE.MathUtils.clamp((dist - 1) * 0.55, 0.035, 0.9);
      c.zoomSpeed = THREE.MathUtils.clamp((dist - 1) * 0.9, 0.25, 1.1);
      c.autoRotate = autoRotate && !reducedMotion && !interacting.current && !anim.current;
      const alt = dist - 1;
      if (Math.abs(alt - lastAlt.current) / Math.max(alt, 0.01) > 0.04) {
        lastAlt.current = alt;
        onAlt(alt);
      }
    }
  });

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      autoRotateSpeed={0.35}
      onStart={() => {
        interacting.current = true;
        anim.current = null;
      }}
      onEnd={() => {
        interacting.current = false;
        emit();
      }}
    />
  );
}

// ------------------------------------------------------------------ Scene

export default function GlobeScene(props: GlobeSceneProps) {
  const [alt, setAlt] = useState(props.initialView.alt);
  const [hover, setHover] = useState<Cluster | null>(null);
  const byShape = useMemo(() => {
    const m = new Map<string, Cluster[]>();
    for (const c of props.clusters) {
      const s = GROUP_SHAPE[c.dominant] ?? "circle";
      const list = m.get(s) ?? [];
      list.push(c);
      m.set(s, list);
    }
    return m;
  }, [props.clusters]);
  // Quantise altitude so marker matrices don't rebuild on every tiny zoom step.
  const qAlt = useMemo(() => Math.round(alt * 40) / 40, [alt]);

  return (
    <Canvas
      flat
      dpr={[1, 2]}
      camera={{ fov: 42, near: 0.01, far: 100, position: [0, 0, 1 + props.initialView.alt] }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl }) => gl.setClearColor("#05070B")}
      onPointerMissed={() => setHover(null)}
    >
      <Stars radius={60} depth={30} count={2500} factor={2.2} saturation={0} fade speed={0} />
      <Suspense fallback={null}>
        <Earth onReady={props.onReady} />
      </Suspense>
      {[...byShape.entries()].map(([shape, items]) => (
        <MarkerLayer key={shape} shape={shape} items={items} alt={qAlt} density={props.density} selectedId={props.selectedId} onClick={props.onClusterClick} onHover={setHover} />
      ))}
      {hover && (
        <Html position={latLngToVec3(hover.lat, hover.lng, 1.01)} style={{ pointerEvents: "none" }} zIndexRange={[30, 0]}>
          <div className="translate-x-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-line-strong bg-panel/95 px-2.5 py-1.5 text-[12px] shadow-xl">
            <span className="font-semibold text-text">{hover.label}</span>
            <span className="text-text-2 tnum">, {hover.count} {hover.count === 1 ? "event" : "events"}</span>
          </div>
        </Html>
      )}
      <CameraRig flyTo={props.flyTo} initialView={props.initialView} autoRotate={props.autoRotate} reducedMotion={props.reducedMotion} onViewChange={props.onViewChange} onAlt={setAlt} />
    </Canvas>
  );
}
