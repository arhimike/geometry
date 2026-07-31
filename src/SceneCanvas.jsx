import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Cube } from "@phosphor-icons/react";

const COLORS = ["#ff6b2c", "#2f74ff", "#ffd45d", "#f3f0e8", "#1fc8a5", "#a676ff"];

function makeVisual(type, material) {
  const cast = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  if (type === "arch") {
    const group = new THREE.Group();
    const pillarGeo = new THREE.BoxGeometry(0.5, 2.2, 0.72);
    const beamGeo = new THREE.BoxGeometry(2.4, 0.5, 0.72);
    const left = cast(new THREE.Mesh(pillarGeo, material));
    const right = cast(new THREE.Mesh(pillarGeo, material));
    const beam = cast(new THREE.Mesh(beamGeo, material));
    left.position.set(-0.94, 0, 0);
    right.position.set(0.94, 0, 0);
    beam.position.set(0, 0.86, 0);
    group.add(left, right, beam);
    return group;
  }

  const geometries = {
    cube: () => new THREE.BoxGeometry(1.35, 1.35, 1.35, 2, 2, 2),
    sphere: () => new THREE.SphereGeometry(0.76, 36, 24),
    cylinder: () => new THREE.CylinderGeometry(0.72, 0.72, 1.7, 32),
    cone: () => new THREE.ConeGeometry(0.86, 1.75, 32),
    pyramid: () => new THREE.ConeGeometry(0.92, 1.65, 4),
    slab: () => new THREE.BoxGeometry(2.4, 0.36, 1.2, 3, 1, 2),
  };
  return cast(new THREE.Mesh((geometries[type] || geometries.cube)(), material));
}

function addCollisionShapes(body, type, scale = 1) {
  const v = (x, y, z) => new CANNON.Vec3(x * scale, y * scale, z * scale);
  if (type === "sphere") {
    body.addShape(new CANNON.Sphere(0.76 * scale));
  } else if (type === "slab") {
    body.addShape(new CANNON.Box(v(1.2, 0.18, 0.6)));
  } else if (type === "arch") {
    body.addShape(new CANNON.Box(v(0.25, 1.1, 0.36)), v(-0.94, 0, 0));
    body.addShape(new CANNON.Box(v(0.25, 1.1, 0.36)), v(0.94, 0, 0));
    body.addShape(new CANNON.Box(v(1.2, 0.25, 0.36)), v(0, 0.86, 0));
  } else if (type === "cylinder") {
    body.addShape(new CANNON.Cylinder(0.72 * scale, 0.72 * scale, 1.7 * scale, 20));
    const shapeOrientation = new CANNON.Quaternion();
    shapeOrientation.setFromEuler(Math.PI / 2, 0, 0);
    body.shapeOrientations[0].copy(shapeOrientation);
  } else if (type === "cone" || type === "pyramid") {
    body.addShape(new CANNON.Box(v(0.68, 0.82, 0.68)));
  } else {
    body.addShape(new CANNON.Box(v(0.675, 0.675, 0.675)));
  }
}

function findEntryId(object) {
  let current = object;
  while (current) {
    if (current.userData?.entryId) return current.userData.entryId;
    current = current.parent;
  }
  return null;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
  });
}

export const SceneCanvas = forwardRef(function SceneCanvas(
  { theme, gravity, bounce, friction, playing, onSelection, onStats, onNotice },
  forwardedRef,
) {
  const mountRef = useRef(null);
  const apiRef = useRef({});
  const engineRef = useRef(null);
  const [webglError, setWebglError] = useState(false);
  const callbacksRef = useRef({ onSelection, onStats, onNotice });
  const controlsRef = useRef({ gravity, bounce, friction, playing, theme });

  callbacksRef.current = { onSelection, onStats, onNotice };
  controlsRef.current = { gravity, bounce, friction, playing, theme };
  useImperativeHandle(forwardedRef, () => apiRef.current, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let nextId = 1;
    let selectedId = null;
    let linkStartId = null;
    let dragState = null;
    let disposed = false;
    let lastFrame = performance.now();
    let statsTime = 0;
    let statsFrames = 0;
    const entries = new Map();
    const constraints = [];
    const links = [];
    const pickables = [];

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(theme === "dark" ? 0x07090c : 0xe9eeec, theme === "dark" ? 0.018 : 0.012);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 250);
    camera.position.set(9.5, 7.5, 13.5);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setWebglError(true);
      callbacksRef.current.onNotice?.("Этот браузер отключил WebGL; откройте проект в обычном Chrome или VR‑браузере");
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = theme === "dark" ? 1.15 : 1.02;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local-floor");
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.06;
    orbit.minDistance = 4;
    orbit.maxDistance = 34;
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.target.set(0, 2.1, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x465064, theme === "dark" ? 1.7 : 2.1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, theme === "dark" ? 4.2 : 3.3);
    key.position.set(7, 13, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7aa6ff, theme === "dark" ? 3.5 : 1.3);
    rim.position.set(-9, 7, -8);
    scene.add(rim);

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: theme === "dark" ? 0x10141c : 0xd9dfdc,
      roughness: 0.82,
      metalness: 0.02,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(60, 60, theme === "dark" ? 0x42516b : 0xa6b0ac, theme === "dark" ? 0x242b37 : 0xcbd1ce);
    grid.position.y = 0.003;
    grid.material.transparent = true;
    grid.material.opacity = theme === "dark" ? 0.42 : 0.72;
    scene.add(grid);

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -gravity, 0) });
    world.allowSleep = true;
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.defaultContactMaterial.friction = friction;
    world.defaultContactMaterial.restitution = bounce;
    world.defaultContactMaterial.contactEquationStiffness = 1e8;
    world.defaultContactMaterial.contactEquationRelaxation = 4;

    const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane();
    const dragPoint = new THREE.Vector3();

    function emitSelection(entry) {
      callbacksRef.current.onSelection?.(
        entry
          ? {
              id: entry.id,
              type: entry.type,
              color: entry.color,
              scale: entry.scale,
              mass: entry.body.mass,
              locked: entry.locked,
            }
          : null,
      );
    }

    function setSelected(id) {
      if (selectedId && entries.has(selectedId)) {
        const previous = entries.get(selectedId);
        previous.material.emissive.setHex(0x000000);
        previous.material.emissiveIntensity = 0;
      }
      selectedId = entries.has(id) ? id : null;
      const entry = selectedId ? entries.get(selectedId) : null;
      if (entry) {
        entry.material.emissive.set(entry.color);
        entry.material.emissiveIntensity = controlsRef.current.theme === "dark" ? 0.2 : 0.08;
      }
      emitSelection(entry);

      if (entry && linkStartId && linkStartId !== entry.id && entries.has(linkStartId)) {
        const first = entries.get(linkStartId);
        const constraint = new CANNON.DistanceConstraint(first.body, entry.body);
        world.addConstraint(constraint);
        constraints.push(constraint);
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const material = new THREE.LineBasicMaterial({ color: 0xff6b2c, transparent: true, opacity: 0.8 });
        const line = new THREE.Line(geometry, material);
        scene.add(line);
        links.push({ first, second: entry, line });
        linkStartId = null;
        callbacksRef.current.onNotice?.("Объекты связаны физической связью");
      }
    }

    function registerPickables(root, id) {
      root.userData.entryId = id;
      root.traverse((child) => {
        if (child.isMesh) {
          child.userData.entryId = id;
          pickables.push(child);
        }
      });
    }

    function addObject(type = "cube", options = {}) {
      const id = options.id || `body-${nextId++}`;
      const color = options.color || COLORS[(nextId - 2) % COLORS.length];
      const scale = options.scale || 1;
      const locked = Boolean(options.locked);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: controlsRef.current.theme === "dark" ? 0.3 : 0.42,
        metalness: controlsRef.current.theme === "dark" ? 0.16 : 0.05,
      });
      const mesh = makeVisual(type, material);
      mesh.scale.setScalar(scale);
      const defaultHeight = type === "arch" ? 1.12 : type === "slab" ? 0.2 : 0.9;
      const position = options.position || new THREE.Vector3((Math.random() - 0.5) * 4, 5.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      mesh.position.copy(position);
      if (options.quaternion) mesh.quaternion.copy(options.quaternion);
      scene.add(mesh);

      const body = new CANNON.Body({ mass: locked ? 0 : options.mass ?? 1.4, allowSleep: true });
      addCollisionShapes(body, type, scale);
      body.position.set(position.x, options.position ? position.y : Math.max(position.y, defaultHeight * scale), position.z);
      body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
      if (locked) body.type = CANNON.Body.STATIC;
      world.addBody(body);

      const entry = { id, type, color, scale, locked, material, mesh, body, grabbedBy: null };
      entries.set(id, entry);
      registerPickables(mesh, id);
      if (options.select !== false) setSelected(id);
      return entry;
    }

    function removeEntry(id) {
      const entry = entries.get(id);
      if (!entry) return;
      world.removeBody(entry.body);
      scene.remove(entry.mesh);
      entry.mesh.traverse((child) => {
        const index = pickables.indexOf(child);
        if (index >= 0) pickables.splice(index, 1);
      });
      disposeObject(entry.mesh);
      entry.material.dispose();
      entries.delete(id);
      if (selectedId === id) setSelected(null);
    }

    function clearAll() {
      [...entries.keys()].forEach(removeEntry);
      constraints.splice(0).forEach((constraint) => world.removeConstraint(constraint));
      links.splice(0).forEach(({ line }) => {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
      });
      linkStartId = null;
      setSelected(null);
    }

    function seedScene() {
      clearAll();
      addObject("slab", { position: new THREE.Vector3(-2.8, 0.2, 0.8), color: "#f3f0e8", locked: true, select: false });
      addObject("arch", { position: new THREE.Vector3(2.6, 1.12, -0.4), color: "#ffd45d", locked: true, select: false });
      addObject("cylinder", { position: new THREE.Vector3(-1.65, 0.9, -0.3), color: "#ff6b2c", locked: true, select: false });
      addObject("sphere", { position: new THREE.Vector3(1.6, 4.6, 0.2), color: "#1fc8a5", select: false });
      addObject("pyramid", { position: new THREE.Vector3(0.2, 6.1, -0.3), color: "#a676ff", select: false });
      addObject("cube", { position: new THREE.Vector3(0.05, 3.8, 0.25), color: "#2f74ff", select: true });
    }

    function replaceEntry(entry, nextScale) {
      const options = {
        id: entry.id,
        position: new THREE.Vector3(entry.body.position.x, entry.body.position.y, entry.body.position.z),
        quaternion: new THREE.Quaternion(entry.body.quaternion.x, entry.body.quaternion.y, entry.body.quaternion.z, entry.body.quaternion.w),
        color: entry.color,
        scale: nextScale,
        mass: entry.body.mass || 1.4,
        locked: entry.locked,
        select: true,
      };
      removeEntry(entry.id);
      return addObject(entry.type, options);
    }

    function addStack() {
      const types = ["slab", "cube", "cylinder", "sphere", "pyramid"];
      types.forEach((type, index) => addObject(type, {
        position: new THREE.Vector3((index % 2) * 0.18 - 0.1, 1.1 + index * 1.55, (index % 3) * 0.12),
        color: COLORS[index],
        select: index === types.length - 1,
      }));
    }

    function duplicateSelected() {
      const entry = entries.get(selectedId);
      if (!entry) return;
      addObject(entry.type, {
        position: new THREE.Vector3(entry.body.position.x + 1.4, entry.body.position.y + 1.3, entry.body.position.z),
        quaternion: new THREE.Quaternion(entry.body.quaternion.x, entry.body.quaternion.y, entry.body.quaternion.z, entry.body.quaternion.w),
        color: entry.color,
        scale: entry.scale,
        mass: entry.body.mass || 1.4,
      });
    }

    function setPointer(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    }

    function onPointerDown(event) {
      if (renderer.xr.isPresenting || event.button !== 0) return;
      setPointer(event);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit) {
        setSelected(null);
        return;
      }
      const id = findEntryId(hit.object);
      const entry = entries.get(id);
      if (!entry) return;
      setSelected(id);
      if (entry.locked) return;
      dragPlane.set(new THREE.Vector3(0, 1, 0), -entry.body.position.y);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      dragState = {
        id,
        y: entry.body.position.y,
        offset: new THREE.Vector3(entry.body.position.x, entry.body.position.y, entry.body.position.z).sub(dragPoint),
      };
      entry.body.type = CANNON.Body.KINEMATIC;
      entry.body.velocity.setZero();
      entry.body.angularVelocity.setZero();
      orbit.enabled = false;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event) {
      if (!dragState) return;
      const entry = entries.get(dragState.id);
      if (!entry) return;
      setPointer(event);
      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        entry.body.position.set(dragPoint.x + dragState.offset.x, dragState.y, dragPoint.z + dragState.offset.z);
        entry.body.aabbNeedsUpdate = true;
      }
    }

    function onPointerUp(event) {
      if (!dragState) return;
      const entry = entries.get(dragState.id);
      if (entry) {
        entry.body.type = CANNON.Body.DYNAMIC;
        entry.body.mass = Math.max(entry.body.mass, 0.1);
        entry.body.updateMassProperties();
        entry.body.wakeUp();
      }
      dragState = null;
      orbit.enabled = true;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    }

    function onWheel(event) {
      if (!event.shiftKey || !selectedId) return;
      event.preventDefault();
      const entry = entries.get(selectedId);
      if (!entry) return;
      replaceEntry(entry, THREE.MathUtils.clamp(entry.scale + (event.deltaY < 0 ? 0.1 : -0.1), 0.45, 2.5));
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const xrPalette = new THREE.Group();
    xrPalette.visible = false;
    const paletteTypes = ["cube", "sphere", "cylinder", "cone", "pyramid", "slab", "arch"];
    paletteTypes.forEach((type, index) => {
      const material = new THREE.MeshStandardMaterial({ color: COLORS[index % COLORS.length], roughness: 0.35 });
      const item = makeVisual(type, material);
      item.scale.setScalar(type === "arch" || type === "slab" ? 0.18 : 0.27);
      const angle = THREE.MathUtils.lerp(-0.8, 0.8, index / (paletteTypes.length - 1));
      item.position.set(Math.sin(angle) * 1.45, 1.08 + Math.cos(angle) * 0.22, -1.8 - Math.cos(angle) * 0.22);
      item.userData.paletteType = type;
      item.traverse((child) => {
        if (child.isMesh) child.userData.paletteType = type;
      });
      xrPalette.add(item);
    });
    scene.add(xrPalette);

    const controllers = [];
    const hands = [];
    const handStates = [
      { pinching: false, entryId: null },
      { pinching: false, entryId: null },
    ];
    const tempMatrix = new THREE.Matrix4();
    const tempPosition = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const thumbPosition = new THREE.Vector3();
    const indexPosition = new THREE.Vector3();
    const pinchPosition = new THREE.Vector3();

    function xrRay(controller) {
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    }

    function onXRSelectStart(event) {
      const controller = event.target;
      xrRay(controller);
      const paletteHit = raycaster.intersectObjects(xrPalette.children, true)[0];
      if (paletteHit) {
        const type = paletteHit.object.userData.paletteType || paletteHit.object.parent?.userData.paletteType;
        controller.getWorldPosition(tempPosition);
        const spawnPosition = tempPosition.clone().add(raycaster.ray.direction.clone().multiplyScalar(1.8));
        spawnPosition.y = Math.max(spawnPosition.y, 1.2);
        addObject(type, { position: spawnPosition });
        return;
      }
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit) return;
      const entry = entries.get(findEntryId(hit.object));
      if (!entry || entry.locked) return;
      setSelected(entry.id);
      entry.body.type = CANNON.Body.KINEMATIC;
      entry.body.velocity.setZero();
      entry.body.angularVelocity.setZero();
      controller.attach(entry.mesh);
      entry.grabbedBy = controller;
      controller.userData.grabbedId = entry.id;
    }

    function onXRSelectEnd(event) {
      const controller = event.target;
      const entry = entries.get(controller.userData.grabbedId);
      if (!entry) return;
      scene.attach(entry.mesh);
      entry.mesh.matrixWorld.decompose(tempPosition, tempQuaternion, tempScale);
      entry.body.position.set(tempPosition.x, tempPosition.y, tempPosition.z);
      entry.body.quaternion.set(tempQuaternion.x, tempQuaternion.y, tempQuaternion.z, tempQuaternion.w);
      entry.body.type = CANNON.Body.DYNAMIC;
      entry.body.mass = Math.max(entry.body.mass, 0.1);
      entry.body.updateMassProperties();
      entry.body.wakeUp();
      entry.grabbedBy = null;
      delete controller.userData.grabbedId;
    }

    function findClosestEntry(point) {
      let closest = null;
      let closestDistance = Infinity;
      entries.forEach((entry) => {
        if (entry.locked || entry.grabbedBy || entry.grabbedHand !== undefined) return;
        entry.mesh.getWorldPosition(tempPosition);
        const distance = tempPosition.distanceTo(point);
        const grabRadius = Math.max(0.42, entry.scale * 0.82);
        if (distance < grabRadius && distance < closestDistance) {
          closest = entry;
          closestDistance = distance;
        }
      });
      return closest;
    }

    function beginHandGrab(handIndex, point) {
      const state = handStates[handIndex];
      let entry = null;

      for (const paletteItem of xrPalette.children) {
        paletteItem.getWorldPosition(tempPosition);
        if (tempPosition.distanceTo(point) < 0.24) {
          entry = addObject(paletteItem.userData.paletteType, {
            position: point.clone(),
            color: COLORS[xrPalette.children.indexOf(paletteItem) % COLORS.length],
          });
          break;
        }
      }

      if (!entry) entry = findClosestEntry(point);
      if (!entry) return;
      setSelected(entry.id);
      entry.body.type = CANNON.Body.KINEMATIC;
      entry.body.velocity.setZero();
      entry.body.angularVelocity.setZero();
      entry.grabbedHand = handIndex;
      state.entryId = entry.id;
    }

    function releaseHandGrab(handIndex) {
      const state = handStates[handIndex];
      const entry = entries.get(state.entryId);
      if (entry) {
        entry.body.type = CANNON.Body.DYNAMIC;
        entry.body.mass = Math.max(entry.body.mass, 0.1);
        entry.body.updateMassProperties();
        entry.body.wakeUp();
        delete entry.grabbedHand;
      }
      state.entryId = null;
    }

    function updateTrackedHands() {
      hands.forEach((hand, handIndex) => {
        const thumb = hand.joints?.["thumb-tip"];
        const index = hand.joints?.["index-finger-tip"];
        if (!thumb?.visible || !index?.visible) {
          if (handStates[handIndex].pinching) releaseHandGrab(handIndex);
          handStates[handIndex].pinching = false;
          return;
        }

        thumb.getWorldPosition(thumbPosition);
        index.getWorldPosition(indexPosition);
        pinchPosition.copy(thumbPosition).lerp(indexPosition, 0.5);
        const distance = thumbPosition.distanceTo(indexPosition);
        const state = handStates[handIndex];
        const nowPinching = state.pinching ? distance < 0.045 : distance < 0.028;

        if (nowPinching && !state.pinching) beginHandGrab(handIndex, pinchPosition);
        if (!nowPinching && state.pinching) releaseHandGrab(handIndex);
        state.pinching = nowPinching;

        const entry = entries.get(state.entryId);
        if (nowPinching && entry) {
          index.getWorldQuaternion(tempQuaternion);
          entry.body.position.set(pinchPosition.x, pinchPosition.y, pinchPosition.z);
          entry.body.quaternion.set(tempQuaternion.x, tempQuaternion.y, tempQuaternion.z, tempQuaternion.w);
          entry.body.aabbNeedsUpdate = true;
        }
      });
    }

    for (let index = 0; index < 2; index += 1) {
      const controller = renderer.xr.getController(index);
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -4)]);
      const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6b2c, transparent: true, opacity: 0.75 });
      controller.add(new THREE.Line(lineGeometry, lineMaterial));
      controller.addEventListener("selectstart", onXRSelectStart);
      controller.addEventListener("selectend", onXRSelectEnd);
      scene.add(controller);
      controllers.push(controller);

      const hand = renderer.xr.getHand(index);
      hand.userData.handIndex = index;
      scene.add(hand);
      hands.push(hand);
    }

    renderer.xr.addEventListener("sessionstart", () => {
      xrPalette.visible = true;
      callbacksRef.current.onNotice?.("VR‑режим: берите тела щипком пальцев или кнопкой контроллера");
    });
    renderer.xr.addEventListener("sessionend", () => {
      xrPalette.visible = false;
      callbacksRef.current.onNotice?.("Возврат в экранную мастерскую");
    });

    async function startVR() {
      if (!navigator.xr) {
        callbacksRef.current.onNotice?.("На этом устройстве WebXR не поддерживается");
        return false;
      }
      const supported = await navigator.xr.isSessionSupported("immersive-vr");
      if (!supported) {
        callbacksRef.current.onNotice?.("Подключите совместимые VR‑очки и откройте сайт по HTTPS");
        return false;
      }
      const session = await navigator.xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });
      await renderer.xr.setSession(session);
      return true;
    }

    Object.assign(apiRef.current, {
      add: (type) => addObject(type),
      addStack,
      clear: clearAll,
      reset: seedScene,
      duplicate: duplicateSelected,
      remove: () => selectedId && removeEntry(selectedId),
      scale: (amount) => {
        const entry = entries.get(selectedId);
        if (!entry) return;
        replaceEntry(entry, THREE.MathUtils.clamp(entry.scale + amount, 0.45, 2.5));
      },
      setMass: (mass) => {
        const entry = entries.get(selectedId);
        if (!entry || entry.locked) return;
        entry.body.mass = mass;
        entry.body.updateMassProperties();
        emitSelection(entry);
      },
      setColor: (color) => {
        const entry = entries.get(selectedId);
        if (!entry) return;
        entry.color = color;
        entry.material.color.set(color);
        entry.material.emissive.set(color);
        emitSelection(entry);
      },
      toggleLock: () => {
        const entry = entries.get(selectedId);
        if (!entry) return;
        entry.locked = !entry.locked;
        entry.body.type = entry.locked ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
        entry.body.mass = entry.locked ? 0 : 1.4;
        entry.body.updateMassProperties();
        emitSelection(entry);
      },
      armLink: () => {
        if (!selectedId) return;
        linkStartId = selectedId;
        callbacksRef.current.onNotice?.("Выберите второй объект для связи");
      },
      step: () => world.step(1 / 60),
      startVR,
    });

    function resize() {
      const { clientWidth, clientHeight } = mount;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    seedScene();

    renderer.setAnimationLoop((time) => {
      if (disposed) return;
      const delta = Math.min((time - lastFrame) / 1000, 0.05);
      lastFrame = time;
      world.gravity.y = -controlsRef.current.gravity;
      world.defaultContactMaterial.friction = controlsRef.current.friction;
      world.defaultContactMaterial.restitution = controlsRef.current.bounce;
      if (controlsRef.current.playing) world.step(1 / 60, delta, 4);

      if (renderer.xr.isPresenting) updateTrackedHands();

      entries.forEach((entry) => {
        if (entry.grabbedBy) {
          entry.mesh.getWorldPosition(tempPosition);
          entry.mesh.getWorldQuaternion(tempQuaternion);
          entry.body.position.set(tempPosition.x, tempPosition.y, tempPosition.z);
          entry.body.quaternion.set(tempQuaternion.x, tempQuaternion.y, tempQuaternion.z, tempQuaternion.w);
        } else {
          entry.mesh.position.set(entry.body.position.x, entry.body.position.y, entry.body.position.z);
          entry.mesh.quaternion.set(entry.body.quaternion.x, entry.body.quaternion.y, entry.body.quaternion.z, entry.body.quaternion.w);
        }
      });
      links.forEach(({ first, second, line }) => {
        const positions = line.geometry.attributes.position;
        positions.setXYZ(0, first.body.position.x, first.body.position.y, first.body.position.z);
        positions.setXYZ(1, second.body.position.x, second.body.position.y, second.body.position.z);
        positions.needsUpdate = true;
      });
      orbit.update();
      renderer.render(scene, camera);

      statsFrames += 1;
      statsTime += delta;
      if (statsTime > 0.75) {
        callbacksRef.current.onStats?.({ count: entries.size, fps: Math.round(statsFrames / statsTime) });
        statsTime = 0;
        statsFrames = 0;
      }
    });

    engineRef.current = { scene, renderer, floorMaterial, grid, hemi, key, rim };

    navigator.xr?.isSessionSupported?.("immersive-vr").then((supported) => {
      callbacksRef.current.onStats?.({ count: entries.size, fps: 60, xrSupported: supported });
    }).catch(() => {});

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      controllers.forEach((controller) => {
        controller.removeEventListener("selectstart", onXRSelectStart);
        controller.removeEventListener("selectend", onXRSelectEnd);
      });
      orbit.dispose();
      renderer.dispose();
      clearAll();
      floor.geometry.dispose();
      floorMaterial.dispose();
      grid.geometry.dispose();
      mount.replaceChildren();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const dark = theme === "dark";
    engine.renderer.setClearColor(dark ? 0x07090c : 0xe9eeec, 1);
    engine.renderer.toneMappingExposure = dark ? 1.15 : 1.02;
    engine.scene.fog.color.setHex(dark ? 0x07090c : 0xe9eeec);
    engine.scene.fog.density = dark ? 0.018 : 0.012;
    engine.floorMaterial.color.setHex(dark ? 0x10141c : 0xd9dfdc);
    engine.grid.material.opacity = dark ? 0.42 : 0.72;
    engine.hemi.intensity = dark ? 1.7 : 2.1;
    engine.key.intensity = dark ? 4.2 : 3.3;
    engine.rim.intensity = dark ? 3.5 : 1.3;
  }, [theme]);

  return (
    <div ref={mountRef} className="scene-canvas" aria-label="Интерактивная физическая 3D-сцена">
      {webglError && (
        <div className="webgl-fallback">
          <Cube weight="duotone" />
          <strong>3D‑сцена ожидает WebGL</strong>
          <span>Интерфейс доступен для проверки. Физика и VR включатся в обычном Chrome, Quest Browser или другом WebXR‑браузере.</span>
        </div>
      )}
    </div>
  );
});
