/**
 * visualizer.js — Lynis Dashboard Sphere
 * Comfortable, slow-rotating icosahedron with toggle-able layers.
 * Color codes: RED=warning, AMBER=suggestion, ORANGE=unsafe,
 *              YELLOW=exposed, GRAY=disabled, WHITE=ok, BLUE=info
 */
(function () {
  "use strict";

  const wrap = document.getElementById("canvas-wrap");
  const W = () => wrap.clientWidth;
  const H = () => wrap.clientHeight;

  // ── Renderer — no antialiasing for pixel aesthetic ──
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x0a0a0a, 1);
  renderer.setSize(W(), H());
  wrap.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 100);
  camera.position.set(0, 0, 4.2);

  // ── OrbitControls: slow, comfortable, no auto-spin ──
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.06;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.25;   // Very slow — comfortable
  controls.enablePan       = false;
  controls.minDistance     = 2.5;
  controls.maxDistance     = 8.0;
  controls.enableZoom      = true;

  // ── Geometry: IcosahedronGeometry for organic distribution ──
  const geo     = new THREE.IcosahedronGeometry(1.4, 4);
  const posAttr = geo.attributes.position;
  const vCount  = posAttr.count;
  const origPos = new Float32Array(posAttr.array);

  // ── Vertex colors — default dim white ──
  const colors = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount * 3; i += 3) {
    colors[i] = 0.18; colors[i+1] = 0.18; colors[i+2] = 0.18;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  // ── Wireframe ──
  const wireMat  = new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true });
  const wireMesh = new THREE.Mesh(geo, wireMat);
  scene.add(wireMesh);

  // ── Point cloud ──
  const ptGeo    = new THREE.BufferGeometry();
  const ptPos    = new Float32Array(origPos);
  const ptColors = new Float32Array(colors);
  ptGeo.setAttribute("position", new THREE.BufferAttribute(ptPos,    3));
  ptGeo.setAttribute("color",    new THREE.BufferAttribute(ptColors, 3));
  const ptMat = new THREE.PointsMaterial({
    size: 0.022, sizeAttenuation: true, vertexColors: true,
  });
  const points = new THREE.Points(ptGeo, ptMat);
  scene.add(points);

  // ── Color palette ──
  const C = {
    warning:  new THREE.Color(0xff2a2a),   // red
    suggestion:new THREE.Color(0xffbf00),  // amber
    vuln:     new THREE.Color(0xff0055),   // hot pink / critical
    unsafe:   new THREE.Color(0xff6600),   // orange
    exposed:  new THREE.Color(0xffdd00),   // yellow
    disabled: new THREE.Color(0x555566),   // blue-gray
    ok:       new THREE.Color(0x44ff88),   // green
    info:     new THREE.Color(0x4488ff),   // blue
    dim:      new THREE.Color(0x181818),   // near-black baseline
  };

  // ── Zonal mapping by position ──
  const ZONES = { network:[], kernel:[], auth:[], file:[], general:[] };
  for (let i = 0; i < vCount; i++) {
    const x = origPos[i*3], y = origPos[i*3+1], z = origPos[i*3+2];
    if      (y >  0.7)                    ZONES.network.push(i);
    else if (y < -0.7)                    ZONES.kernel.push(i);
    else if (x >  0.5)                    ZONES.auth.push(i);
    else if (x < -0.5)                    ZONES.file.push(i);
    else                                  ZONES.general.push(i);
  }

  function zoneFor(text) {
    const t = (text||"").toUpperCase();
    if (/PORT|NETWORK|SSH|FIREWALL|TCP|UDP|BIND|NETW/.test(t)) return ZONES.network;
    if (/KERNEL|SYSCTL|MODULE|GRUB|BOOT|KRNL/.test(t))        return ZONES.kernel;
    if (/AUTH|PAM|PASS|LOGIN|USER|ACCOUNT/.test(t))            return ZONES.auth;
    if (/FILE|PERM|CHMOD|MOUNT|DISK|FS/.test(t))               return ZONES.file;
    return ZONES.general;
  }

  // ── Layer toggle state ──
  const layerVisible = {
    warning: true, suggestion: true, unsafe_service: true,
    exposed_service: true, disabled: true, ok: true,
  };

  // Vertex → {type, text, color} registry
  const vtxRegistry = [];  // array of {idx, type, text, color}

  function setVtxColor(idx, color, visible) {
    const r = visible ? color.r : 0.04;
    const g = visible ? color.g : 0.04;
    const b = visible ? color.b : 0.04;
    ptColors[idx*3]   = r;
    ptColors[idx*3+1] = g;
    ptColors[idx*3+2] = b;
  }

  function refreshLayerVisibility() {
    vtxRegistry.forEach(({idx, type, color}) => {
      const vis = layerVisible[type] !== false;
      setVtxColor(idx, color, vis);
    });
    ptGeo.attributes.color.needsUpdate = true;
  }

  window.applyToggles = function () {
    layerVisible.warning          = document.getElementById("tog-warning")?.checked    ?? true;
    layerVisible.suggestion       = document.getElementById("tog-suggestion")?.checked  ?? true;
    layerVisible.unsafe_service   = document.getElementById("tog-unsafe")?.checked      ?? true;
    layerVisible.exposed_service  = document.getElementById("tog-exposed")?.checked     ?? true;
    layerVisible.disabled         = document.getElementById("tog-disabled")?.checked    ?? true;
    layerVisible.ok               = document.getElementById("tog-ok")?.checked          ?? true;
    refreshLayerVisibility();
  };

  // ── Place a mark on the sphere ──
  const suggLabels = {};   // idx → text (for tooltip)

  function placeMark(type, text, color, spikeScale) {
    const zone  = zoneFor(text);
    if (!zone.length) return;
    const idx   = zone[Math.floor(Math.random() * zone.length)];
    const vis   = layerVisible[type] !== false;

    // Spike outward
    if (spikeScale && spikeScale !== 1.0) {
      ptPos[idx*3]   = origPos[idx*3]   * spikeScale;
      ptPos[idx*3+1] = origPos[idx*3+1] * spikeScale;
      ptPos[idx*3+2] = origPos[idx*3+2] * spikeScale;
      ptGeo.attributes.position.needsUpdate = true;
    }

    setVtxColor(idx, color, vis);
    ptGeo.attributes.color.needsUpdate = true;

    vtxRegistry.push({idx, type, color});
    suggLabels[idx] = text;
  }

  // ── Crater deformation for warnings ──
  let craterCount = 0;
  function applyCrater(text) {
    craterCount++;
    const el = document.getElementById("crater-count");
    if (el) el.textContent = `CRATERS: ${craterCount}`;

    const zone   = zoneFor(text);
    const center = zone.length ? zone[Math.floor(Math.random()*zone.length)]
                               : Math.floor(Math.random()*vCount);
    const cr     = 0.22 + Math.random() * 0.2;
    const depth  = 0.06 + Math.random() * 0.12;

    const cx = origPos[center*3], cy = origPos[center*3+1], cz = origPos[center*3+2];
    const cl = Math.sqrt(cx*cx+cy*cy+cz*cz)||1;
    const nx = cx/cl, ny = cy/cl, nz = cz/cl;

    for (let i = 0; i < vCount; i++) {
      const ox=origPos[i*3], oy=origPos[i*3+1], oz=origPos[i*3+2];
      const ol=Math.sqrt(ox*ox+oy*oy+oz*oz)||1;
      const dot=Math.max(-1,Math.min(1,(ox*nx+oy*ny+oz*nz)/ol));
      const ang=Math.acos(dot);
      if (ang < cr) {
        const f = Math.cos((ang/cr)*(Math.PI/2));
        ptPos[i*3]   = ox - nx*depth*f;
        ptPos[i*3+1] = oy - ny*depth*f;
        ptPos[i*3+2] = oz - nz*depth*f;
      }
    }
    ptGeo.attributes.position.needsUpdate = true;
  }

  // ── Public API called from index.html ──
  window.sphereMark = function (type, text) {
    switch(type) {
      case "warning":
        applyCrater(text);
        placeMark("warning",  text, C.warning,  1.0);
        break;
      case "suggestion":
        placeMark("suggestion", text, C.suggestion, 1.10);
        break;
      case "vulnerability":
        placeMark("warning",  text, C.vuln,    1.18);
        break;
      case "unsafe_service":
        placeMark("unsafe_service", text, C.unsafe, 1.08);
        break;
      case "exposed_service":
        placeMark("exposed_service", text, C.exposed, 1.06);
        break;
      case "disabled":
        placeMark("disabled", text, C.disabled, 1.0);
        break;
      case "ok":
        placeMark("ok", text, C.ok, 1.0);
        break;
      case "info":
        placeMark("ok", text, C.info, 1.0);
        break;
    }
  };

  window.sphereReset = function () {
    craterCount = 0;
    const el = document.getElementById("crater-count");
    if (el) el.textContent = "CRATERS: 0";
    vtxRegistry.length = 0;
    Object.keys(suggLabels).forEach(k => delete suggLabels[k]);

    // Reset positions and colors
    for (let i = 0; i < vCount; i++) {
      ptPos[i*3]   = origPos[i*3];
      ptPos[i*3+1] = origPos[i*3+1];
      ptPos[i*3+2] = origPos[i*3+2];
      ptColors[i*3] = 0.18; ptColors[i*3+1] = 0.18; ptColors[i*3+2] = 0.18;
    }
    ptGeo.attributes.position.needsUpdate = true;
    ptGeo.attributes.color.needsUpdate    = true;
  };

  // ── Raycaster tooltip ──
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.07;
  const mouse   = new THREE.Vector2();
  const tooltip = document.getElementById("vtx-tooltip");

  wrap.addEventListener("mousemove", (e) => {
    const rect = wrap.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(points);
    if (hits.length) {
      const lbl = suggLabels[hits[0].index];
      if (lbl) {
        tooltip.textContent   = lbl;
        tooltip.style.display = "block";
        tooltip.style.left    = (e.clientX + 16) + "px";
        tooltip.style.top     = (e.clientY - 8)  + "px";
        return;
      }
    }
    tooltip.style.display = "none";
  });
  wrap.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });

  // ── Resize ──
  window.addEventListener("resize", () => {
    renderer.setSize(W(), H());
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
  });

  // ── Animate ──
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    // Keep wireframe in sync with point cloud rotation
    wireMesh.quaternion.copy(camera.quaternion).invert();
    wireMesh.quaternion.identity(); // wireframe stays static relative to world
    renderer.render(scene, camera);
  }
  animate();

  // Apply persisted toggles on load
  window.applyToggles();

})();
