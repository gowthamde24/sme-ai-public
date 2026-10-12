/**
 * The 3D agent office. With the owl code in components/v2/app/owl/ (owl-model.ts) this is the ONLY code that imports three / react-three-fiber / drei, and it is loaded with
 * `next/dynamic` only when the person is shown the 3D view (OfficeRoom.tsx), so no other screen ships three.js (a build check, scripts/audit-3d.mjs, keeps it that way).
 * Everything is built from code primitives: no models, no textures, no licence risk. Each helper is an owl (the same bird as Agent OWL, a colour of its own from owl-colors.ts); there are
 * no human figures. What is NOT ported from the design lab: the simulated event stream, the speech bubbles it drove, the paper handed from desk to desk and the debug close-up cameras.
 * The room shows only the state `getAgentsStatus()` gave.
 */
/* eslint-disable react-hooks/immutability -- three.js objects (the rig, the scene graph, the camera) are imperative and are meant to be mutated inside useFrame; none of it is React state. */
import * as React from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { OWL_PALETTE } from "../../owl/owl-colors";
import type { OwlMood } from "../../owl/owl-mood";
import { createOwl, type Detail } from "../../owl/owl-model";
import { quietThreeClockWarning } from "./quiet-three";
import { SEATS, TABLE_HEIGHT, TABLE_RADIUS, owlYaw, type Seat } from "./seats";
import { ALL_AGENT_IDS, type AgentId, type Pose, type RoomState } from "./ids";
import type { LabelPositions } from "./SceneLabels";

const BRAND = "#ff773c";
/** How far in front of the stool the laptop stands, measured from the stool centre toward the table centre. */
const LAPTOP_Z = 0.52;

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

/* ------------------------------------------------------------------- Owl */
interface OwlSeatProps {
  id: AgentId;
  seat: Seat;
  detail: Detail;
  pose: Pose;
  selected: boolean;
  reduced: boolean;
  shadows: boolean;
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
quietThreeClockWarning(); // before the first Canvas is made (see quiet-three.ts)

const OFF_OPACITY = 0.3;
/** The owl is about 3.4 units tall in its own frame; these scales make a seated helper (Agent OWL a little larger) a little taller than the table. */
const OWL_SCALE = 0.25;
const MAIN_OWL_SCALE = 0.28;
const SEAT_HEIGHT = 0.47;
/** The owl sits a little behind the chair centre so its round body clears the table edge. */
const OWL_BACK = 0.2;

/** What an owl does for the state the API reported: `working` thinks (tilts its head, three dots), `idle` sits still, and `off` (not built, or switched off) is a faded, sleepy, still owl. */
const moodOf = (p: Pose): OwlMood => (p === "working" ? "thinking" : p === "off" ? "resting" : "idle");

function OwlSeat({ id, seat, detail, pose: poseNow, selected, reduced, shadows, positions, onSelect }: OwlSeatProps) {
  const isMain = id === "main";
  const size = isMain ? MAIN_OWL_SCALE : OWL_SCALE;
  const rig = React.useMemo(() => createOwl(OWL_PALETTE[id], { detail, extras: true, shadow: false }), [id, detail]);
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
    rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = shadows;
    });
    if (reduced || poseNow !== "working") rig.snap(moodOf(poseNow));
    invalidate();
  }, [reduced, off, poseNow, rig, invalidate, selected, shadows]);

  useFrame((state, dt) => {
    const p = pose.current;
    if (!p.reduced && p.poseNow === "working") rig.update("thinking", state.clock.elapsedTime, dt);
    // where this owl's label belongs on screen
    const m = marker.current;
    if (m) {
      m.getWorldPosition(tmp).project(state.camera);
      positions.current[id] = {
        x: (tmp.x * 0.5 + 0.5) * state.size.width,
        y: (-tmp.y * 0.5 + 0.5) * state.size.height,
        on: tmp.z < 1,
      };
    }
    // hovering nudges the owl a few percent larger
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

  const working = poseNow === "working";
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
      {/* a round stool: seat, post, base */}
      <mesh position={[0, SEAT_HEIGHT - 0.04, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.32, 0.32, 0.08, 28]} />
        <meshStandardMaterial color="#37353a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.4, 12]} />
        <meshStandardMaterial color="#37353a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.04, 24]} />
        <meshStandardMaterial color="#37353a" roughness={0.7} />
      </mesh>
      {/* the owl, turned a little toward the viewer so every face shows from the default camera */}
      <group position={[0, SEAT_HEIGHT, -OWL_BACK]} rotation={[0, owlYaw(seat), 0]}>
        <primitive object={rig.root} />
      </group>
      {/* a laptop on the table in front of it; its screen is lit only while the helper works */}
      <group position={[0, TABLE_HEIGHT, LAPTOP_Z]}>
        <mesh position={[0, 0.009, 0]}>
          <boxGeometry args={[0.3, 0.018, 0.21]} />
          <meshStandardMaterial color="#4a4646" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.018 + 0.1 * Math.cos(0.42), 0.105 + 0.1 * Math.sin(0.42)]} rotation={[0.42, 0, 0]}>
          <boxGeometry args={[0.3, 0.2, 0.01]} />
          <meshStandardMaterial color="#26242b" roughness={0.5} emissive={BRAND} emissiveIntensity={working ? 0.55 : 0} />
        </mesh>
      </group>
      <Blob position={[0, 0.004, 0.0]} size={[1.2, 1.2]} opacity={0.5} />
      <Blob position={[0, TABLE_HEIGHT + 0.0035, LAPTOP_Z]} size={[0.5, 0.4]} opacity={0.35} />
      {(isMain || selected) && (
        <mesh position={[0, 0.02, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.72, 0.035, 10, 56]} />
          <meshStandardMaterial color={BRAND} emissive={BRAND} emissiveIntensity={isMain ? 0.75 : 0.5} />
        </mesh>
      )}
      <object3D ref={marker} position={[0, SEAT_HEIGHT + 3.45 * size + 0.1, -OWL_BACK]} />
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
      {ALL_AGENT_IDS.map((id) => {
        const seat = SEATS[id];
        return (
          <OwlSeat
            key={id}
            id={id}
            seat={seat}
            detail={p.detail}
            pose={p.state[id]}
            selected={p.selected === id}
            reduced={p.reduced}
            shadows={p.shadows}
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

