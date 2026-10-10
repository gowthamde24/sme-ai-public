/**
 * The 3D agent office. With character.ts, geo.ts and anatomy.ts this is the ONLY code that imports three / react-three-fiber / drei, and it is loaded with
 * `next/dynamic` only when the person is shown the 3D view (OfficeRoom.tsx), so no other screen ships three.js (a build check, scripts/audit-3d.mjs, keeps it that way).
 * Everything is built from code primitives: no models, no textures, no licence risk. Ported from the design lab (design-lab/src/office); what is NOT ported: the simulated event
 * stream, the speech bubbles it drove, the paper handed from desk to desk and the debug close-up cameras. The room shows only the state `getAgentsStatus()` gave.
 */
/* eslint-disable react-hooks/immutability -- three.js objects (the rig, the scene graph, the camera) are imperative and are meant to be mutated inside useFrame; none of it is React state. */
import * as React from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { Character } from "./character";
import type { Detail } from "./geo";
import { PEOPLE } from "./people";
import { SEATS, TABLE_HEIGHT, TABLE_RADIUS, angleDiff, type Seat } from "./seats";
import { ALL_AGENT_IDS, type AgentId, type Pose, type RoomState } from "./ids";
import { LAPTOP } from "./anatomy";
import type { LabelPositions } from "./SceneLabels";

const BRAND = "#ff773c";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------- soft contact shadows */
let blobTexture: THREE.CanvasTexture | null = null;
/** A soft radial falloff, drawn once. Used for contact shadows under chairs, laptops and the table. */
function getBlob(): THREE.CanvasTexture {
  if (blobTexture) return blobTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.85)");
  g.addColorStop(0.45, "rgba(0,0,0,0.42)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  blobTexture = new THREE.CanvasTexture(c);
  blobTexture.colorSpace = THREE.SRGBColorSpace;
  return blobTexture;
}
function Blob({ position, size, opacity }: { position: [number, number, number]; size: [number, number]; opacity: number }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={getBlob()} transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ Person */
interface PersonProps {
  id: AgentId;
  index: number;
  seat: Seat;
  detail: Detail;
  pose: Pose;
  selected: boolean;
  reduced: boolean;
  positions: React.MutableRefObject<LabelPositions>;
  onSelect: (id: AgentId) => void;
}

/** Draws a helper that is not there (not built, or switched off) faded; the original opacity of every material is kept so it can come back. */
function fade(root: THREE.Object3D, k: number) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) {
      const d = x.userData as { transparent?: boolean; opacity?: number };
      if (d.transparent === undefined) {
        d.transparent = x.transparent;
        d.opacity = x.opacity;
      }
      x.transparent = k < 1 || d.transparent;
      x.opacity = (d.opacity ?? 1) * k;
      x.needsUpdate = true;
    }
  });
}
const OFF_OPACITY = 0.3;

function Person({ id, index, seat, detail, pose: poseNow, selected, reduced, positions, onSelect }: PersonProps) {
  const isMain = id === "main";
  const size = PEOPLE[id].size ?? 1;
  const rig = React.useMemo(() => new Character(PEOPLE[id], detail, index + 1), [id, detail, index]);
  React.useEffect(() => () => rig.dispose(), [rig]);
  const invalidate = useThree((s) => s.invalidate);
  const marker = React.useRef<THREE.Object3D>(null);
  const hovered = React.useRef(false);
  const tmp = React.useMemo(() => new THREE.Vector3(), []);

  const off = poseNow === "off";
  const pose = React.useRef({ poseNow, reduced });
  React.useEffect(() => {
    pose.current = { poseNow, reduced };
  });

  // a helper that is not there is faded; a still pose is drawn once, and again whenever something about it changes
  React.useEffect(() => {
    fade(rig.root, off ? OFF_OPACITY : 1);
    if (reduced || off) {
      rig.update(0, 0, { typing: 0, speaking: false, headYaw: 0, reduced: true });
    }
    invalidate();
  }, [reduced, off, rig, invalidate, selected]);

  useFrame((state, dt) => {
    const p = pose.current;
    if (!p.reduced && p.poseNow !== "off") {
      // drift a little toward the camera (more for the two swivelled seats)
      const cam = state.camera.position;
      const toCam = Math.atan2(cam.x - seat.x, cam.z - seat.z);
      const headYaw = clamp(angleDiff(toCam, seat.yaw) * seat.glance, -1.0, 1.0);
      rig.update(state.clock.elapsedTime, dt, { typing: p.poseNow === "working" ? 1 : 0.06, speaking: false, headYaw, reduced: false });
    }
    // where this person's label belongs on screen
    const m = marker.current;
    if (m) {
      m.getWorldPosition(tmp).project(state.camera);
      positions.current[id] = {
        x: (tmp.x * 0.5 + 0.5) * state.size.width,
        y: (-tmp.y * 0.5 + 0.5) * state.size.height,
        on: tmp.z < 1,
      };
    }
    // hovering nudges the person a few percent larger
    const g = rig.root;
    const target = (hovered.current ? 1.03 : 1) * size;
    g.scale.x += (target - g.scale.x) * Math.min(1, dt * 10);
    g.scale.y = g.scale.z = g.scale.x;
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return; // that was a drag, not a tap
    e.stopPropagation();
    onSelect(id);
  };

  return (
    <group
      position={[seat.x, 0, seat.z]}
      rotation={[0, seat.yaw, 0]}
      onClick={click}
      onPointerOver={(e) => {
        e.stopPropagation();
        hovered.current = true;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hovered.current = false;
        document.body.style.cursor = "";
      }}
    >
      <primitive object={rig.root} />
      <Blob position={[0, 0.004, 0.05]} size={[1.3, 1.3]} opacity={0.5} />
      <Blob position={[0, TABLE_HEIGHT + 0.0035, LAPTOP.z]} size={[0.5, 0.4]} opacity={0.35} />
      {(isMain || selected) && (
        <mesh position={[0, 0.02, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.72, 0.035, 10, 56]} />
          <meshStandardMaterial color={BRAND} emissive={BRAND} emissiveIntensity={isMain ? 0.75 : 0.5} />
        </mesh>
      )}
      <object3D ref={marker} position={[0, 1.62 * size, 0.03]} />
    </group>
  );
}

/* --------------------------------------------------------------------- room */
function Room({ dark, shadows }: { dark: boolean; shadows: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <circleGeometry args={[6.5, 64]} />
        <meshStandardMaterial color={dark ? "#2a252d" : "#eadbc8"} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow={shadows}>
        <circleGeometry args={[3.5, 64]} />
        <meshStandardMaterial color={dark ? "#3a2b27" : "#ffd9c2"} roughness={1} />
      </mesh>
      <Blob position={[0, 0.008, 0]} size={[4.6, 4.6]} opacity={dark ? 0.55 : 0.32} />
      {/* table: top, edge accent, pedestal, base */}
      <mesh position={[0, TABLE_HEIGHT - 0.04, 0]} castShadow={shadows} receiveShadow={shadows}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.08, 72]} />
        <meshStandardMaterial color={dark ? "#a9805c" : "#e3c6a2"} roughness={0.55} />
      </mesh>
      <mesh position={[0, TABLE_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TABLE_RADIUS, 0.02, 8, 96]} />
        <meshStandardMaterial color={BRAND} emissive={BRAND} emissiveIntensity={dark ? 0.6 : 0.25} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.24, 0.3, 0.8, 24]} />
        <meshStandardMaterial color="#4a4646" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.8, 0.8, 0.04, 40]} />
        <meshStandardMaterial color="#4a4646" roughness={0.6} />
      </mesh>
      {/* a lamp in the middle */}
      <mesh position={[0, TABLE_HEIGHT + 0.12, 0]}>
        <sphereGeometry args={[0.1, 20, 14]} />
        <meshStandardMaterial color={BRAND} emissive={BRAND} emissiveIntensity={dark ? 1.4 : 0.5} />
      </mesh>
      {/* a few papers on the table */}
      {[
        [0.3, 0.2, 0.3],
        [-0.25, -0.1, -0.6],
        [0.05, -0.33, 0.1],
      ].map(([x, z, r], i) => (
        <mesh key={i} position={[x, TABLE_HEIGHT + 0.006, z]} rotation={[0, r, 0]}>
          <boxGeometry args={[0.26, 0.008, 0.19]} />
          <meshStandardMaterial color={dark ? "#d8cfc4" : "#fffaf2"} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/** Key + fill + rim, soft: warm daylight in light mode, evening with the lamp in dark mode. */
function Lights({ dark, shadows, coarse }: { dark: boolean; shadows: boolean; coarse: boolean }) {
  const key = React.useRef<THREE.DirectionalLight>(null);
  React.useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.shadow.radius = 5;
  }, []);
  const map = coarse ? 1024 : 2048;
  return dark ? (
    <>
      <hemisphereLight args={["#4b4d8f", "#1b1620", 0.5]} />
      <directionalLight ref={key} color="#9db0ff" intensity={0.8} position={[-4, 6.5, 4.5]} castShadow={shadows} shadow-mapSize={[map, map]}
        shadow-camera-left={-4.5} shadow-camera-right={4.5} shadow-camera-top={4.5} shadow-camera-bottom={-4.5} />
      <directionalLight color="#ffb27a" intensity={0.9} position={[3, 4, -6]} />
      <directionalLight color="#7d8fe0" intensity={0.35} position={[5, 3, 5]} />
      <pointLight color="#ff9a5c" intensity={42} distance={10} decay={2} position={[0, 2.5, 0]} />
    </>
  ) : (
    <>
      <hemisphereLight args={["#fff1e0", "#e6d0b8", 0.7]} />
      <directionalLight ref={key} color="#ffd6a8" intensity={2.3} position={[3.5, 7, 5]} castShadow={shadows} shadow-mapSize={[map, map]}
        shadow-camera-left={-4.5} shadow-camera-right={4.5} shadow-camera-top={4.5} shadow-camera-bottom={-4.5} />
      <directionalLight color="#cfdcff" intensity={0.65} position={[-5, 3.5, 4]} />
      <directionalLight color="#ffc592" intensity={1.0} position={[0, 4.5, -7]} />
    </>
  );
}

/** Keeps a real loss of the WebGL context from going unnoticed, and nothing else (see OfficeRoom). */
function ContextGuard({ onLost }: { onLost: () => void }) {
  const gl = useThree((s) => s.gl);
  const latest = React.useRef(onLost);
  React.useEffect(() => {
    latest.current = onLost;
  });
  React.useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      latest.current();
    };
    // Removed on cleanup: when this canvas is unmounted on purpose (List view), React Three Fiber forces a
    // context loss on its way out, and that expected event must never look like a failure.
    el.addEventListener("webglcontextlost", lost);
    return () => el.removeEventListener("webglcontextlost", lost);
  }, [gl]);
  return null;
}

/* ------------------------------------------------------------- camera rig */
function Rig() {
  const { camera, size } = useThree();
  const touched = React.useRef(false);
  const controls = React.useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const aspect = size.width / Math.max(1, size.height);
  const dist = Math.max(6.2, 7.4 / aspect);
  const el = (29 * Math.PI) / 180;

  React.useLayoutEffect(() => {
    if (touched.current) return;
    camera.position.set(0, 0.75 + dist * Math.sin(el), dist * Math.cos(el));
    camera.lookAt(0, 0.75, 0);
    controls.current?.update?.();
  }, [camera, dist, el]);

  return (
    <OrbitControls
      ref={controls}
      target={[0, 0.75, 0]}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={dist * 0.36}
      maxDistance={dist * 1.2}
      minPolarAngle={0.5}
      maxPolarAngle={1.4}
      minAzimuthAngle={-1.0}
      maxAzimuthAngle={1.0}
      rotateSpeed={0.7}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      onStart={() => {
        touched.current = true; // stop re-framing the camera once the person has taken over
      }}
    />
  );
}

/* ------------------------------------------------------------------ scene */
export interface Office3DProps {
  dark: boolean;
  reduced: boolean;
  coarse: boolean;
  phone: boolean;
  /** False while the tab is hidden or the canvas is off-screen: rendering stops. */
  active: boolean;
  /** How much detail to draw. The frame-rate monitor asks for less via onDecline. */
  detail: Detail;
  state: RoomState;
  selected: AgentId | null;
  positions: React.MutableRefObject<LabelPositions>;
  onSelect: (id: AgentId | null) => void;
  onReady: () => void;
  /** The GPU really lost the context (not a normal unmount). */
  onContextLost: () => void;
  /** The frame rate is too low for this much detail. */
  onDecline: () => void;
}

function Scene(p: Office3DProps & { shadows: boolean }) {
  const world = React.useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  // In the still (reduced-motion) pose nothing animates, so redraw only when something changed.
  React.useEffect(() => {
    if (p.reduced) invalidate();
  }, [p.reduced, p.selected, p.dark, p.state, p.detail, invalidate]);

  useFrame((s) => {
    if (p.reduced || !world.current) return;
    world.current.rotation.y = Math.sin(s.clock.elapsedTime * 0.3) * 0.045; // gentle sway
  });

  return (
    <group ref={world}>
      <Lights dark={p.dark} shadows={p.shadows} coarse={p.coarse} />
      <Room dark={p.dark} shadows={p.shadows} />
      {ALL_AGENT_IDS.map((id, i) => {
        const seat = SEATS[id];
        return (
          <Person
            key={id}
            id={id}
            index={i}
            seat={seat}
            detail={p.detail}
            pose={p.state[id]}
            selected={p.selected === id}
            reduced={p.reduced}
            positions={p.positions}
            onSelect={(sid) => p.onSelect(p.selected === sid ? null : sid)}
          />
        );
      })}
    </group>
  );
}

export default function Office3D(props: Office3DProps) {
  const shadows = !props.phone && !props.coarse && props.detail !== "low";
  const dprMax = props.detail === "low" ? 1 : props.coarse ? 1.5 : 2;
  return (
    <Canvas
      className="!touch-none"
      frameloop={props.reduced ? "demand" : props.active ? "always" : "never"}
      dpr={[1, dprMax]}
      shadows={shadows ? "percentage" : false}
      gl={{ antialias: !props.coarse, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 40, near: 0.1, far: 60, position: [0, 5, 10] }}
      onCreated={() => props.onReady()}
    >
      <ContextGuard onLost={props.onContextLost} />
      {!props.reduced && <PerformanceMonitor flipflops={2} onDecline={props.onDecline} />}
      <Rig />
      <Scene {...props} shadows={shadows} />
    </Canvas>
  );
}

