/**
 * visualizer.js — Lynis Dashboard Sphere
 * Fixed: warnings always render red, all toggle layers work,
 * vtxRegistry type keys match layerVisible keys exactly.
 */
(function () {
  "use strict";

  const wrap = document.getElementById("canvas-wrap");
  const W = () => wrap.clientWidth;
  const H = () => wrap.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x0a0a0a, 1);
  renderer.setSize(W(), H());
  wrap.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 100);
  camera.position.set(0, 0, 4.2);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.06;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.25;
  controls.enablePan       = false;
  controls.minDistance     = 2.5;
  controls.maxDistance     = 8.0;

  // ── Geometry ──
  const geo     = new THREE.IcosahedronGeometry(1.4, 4);
  const posAttr = geo.attributes.position;
  const vCount  = posAttr.count;
  const origPos = new Float32Array(posAttr.array);

  // Wireframe uses a *separate* geometry so it never gets deformed
  const wireGeo  = new THREE.IcosahedronGeometry(1.4, 4);
  const wireMat  = new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true });
  const wireMesh = new THREE.Mesh(wireGeo, wireMat);
  scene.add(wireMesh);

  // Point cloud — deformable, vertex-colored
  const ptGeo    = new THREE.BufferGeometry();
  const ptPos    = new Float32Array(origPos);
  const ptColors = new Float32Array(vCount * 3);
  // Default: very dim gray
  for (let i = 0; i < vCount * 3; i += 3) {
    ptColors[i] = 0.14; ptColors[i+1] = 0.14; ptColors[i+2] = 0.14;
  }
  ptGeo.setAttribute("position", new THREE.BufferAttribute(ptPos,    3));
  ptGeo.setAttribute("color",    new THREE.BufferAttribute(ptColors, 3));
  const ptMat = new THREE.PointsMaterial({ size: 0.025, sizeAttenuation: true, vertexColors: true });
  const points = new THREE.Points(ptGeo, ptMat);
  scene.add(points);

  // ── Color palette ──
  // Keys here MUST match layerVisible keys exactly
  const C = {
    warning:          new THREE.Color(0xff2a2a),  // red
    suggestion:       new THREE.Color(0xffbf00),  // amber
    vulnerability:    new THREE.Color(0xff0055),  // hot pink
    unsafe_service:   new THREE.Color(0xff6600),  // orange
    exposed_service:  new THREE.Color(0xffdd00),  // yellow
    disabled:         new THREE.Color(0x4455aa),  // blue-gray
    ok:               new THREE.Color(0x44ff88),  // green
    info:             new THREE.Color(0x4488ff),  // blue
  };

  // ── Zonal mapping ──
  const ZONES = { network:[], kernel:[], auth:[], file:[], general:[] };
  for (let i = 0; i < vCount; i++) {
    const x = origPos[i*3], y = origPos[i*3+1];
    if      (y >  0.7)  ZONES.network.push(i);
    else if (y < -0.7)  ZONES.kernel.push(i);
    else if (x >  0.5)  ZONES.auth.push(i);
    else if (x < -0.5)  ZONES.file.push(i);
    else                ZONES.general.push(i);
  }

  function zoneFor(text) {
    const t = (text || "").toUpperCase();
    if (/PORT|NETWORK|SSH|FIREWALL|TCP|UDP|BIND|NETW/.test(t)) return ZONES.network;
    if (/KERNEL|SYSCTL|MODULE|GRUB|BOOT|KRNL/.test(t))        return ZONES.kernel;
    if (/AUTH|PAM|PASS|LOGIN|USER|ACCOUNT/.test(t))            return ZONES.auth;
    if (/FILE|PERM|CHMOD|MOUNT|DISK|FS/.test(t))               return ZONES.file;
    return ZONES.general;
  }

  // ── Toggle state — keys MUST match C keys above ──
  const layerVisible = {
    warning: true, suggestion: true, vulnerability: true,
    unsafe_service: true, exposed_service: true, disabled: true, ok: true, info: true,
  };

  // Registry: every placed vertex → {idx, layerKey, color}
  const vtxRegistry = [];
  const vtxLabels   = {};  // idx → tooltip text

  function writeColor(idx, color, visible) {
    const v = visible ? 1.0 : 0.0;
    ptColors[idx*3]   = color.r * v;
    ptColors[idx*3+1] = color.g * v;
    ptColors[idx*3+2] = color.b * v;
  }

  function refreshToggles() {
    // First dim everything that's not in registry
    // (registry handles its own entries)
    vtxRegistry.forEach(({idx, layerKey, color}) => {
      writeColor(idx, color, layerVisible[layerKey] !== false);
    });
    ptGeo.attributes.color.needsUpdate = true;
  }

  window.applyToggles = function () {
    layerVisible.warning         = document.getElementById("tog-warning")?.checked    ?? true;
    layerVisible.suggestion      = document.getElementById("tog-suggestion")?.checked  ?? true;
    layerVisible.unsafe_service  = document.getElementById("tog-unsafe")?.checked      ?? true;
    layerVisible.exposed_service = document.getElementById("tog-exposed")?.checked     ?? true;
    layerVisible.disabled        = document.getElementById("tog-disabled")?.checked    ?? true;
    layerVisible.ok              = document.getElementById("tog-ok")?.checked          ?? true;
    // vulnerability & info follow the warning/suggestion toggle
    layerVisible.vulnerability   = layerVisible.warning;
    layerVisible.info            = layerVisible.ok;
    refreshToggles();
  };

  // ── Place a colored mark at a specific vertex index ──
  function registerMark(idx, layerKey, text, color, spike) {
    const vis = layerVisible[layerKey] !== false;

    if (spike && spike !== 1.0) {
      ptPos[idx*3]   = origPos[idx*3]   * spike;
      ptPos[idx*3+1] = origPos[idx*3+1] * spike;
      ptPos[idx*3+2] = origPos[idx*3+2] * spike;
      ptGeo.attributes.position.needsUpdate = true;
    }

    writeColor(idx, color, vis);
    ptGeo.attributes.color.needsUpdate = true;

    vtxRegistry.push({ idx, layerKey, color });
    vtxLabels[idx] = `[${layerKey.toUpperCase()}] ${text}`;
  }

  // Pick a random vertex from a zone
  function pickVertex(text) {
    const zone = zoneFor(text);
    return zone[Math.floor(Math.random() * zone.length)];
  }

  // ── Crater: deforms positions AND colors the center vertex red ──
  let craterCount = 0;

  function applyCrater(text) {
    craterCount++;
    const el = document.getElementById("crater-count");
    if (el) el.textContent = `CRATERS: ${craterCount}`;

    const zone   = zoneFor(text);
    const center = zone.length ? zone[Math.floor(Math.random() * zone.length)]
                               : Math.floor(Math.random() * vCount);

    const cr    = 0.22 + Math.random() * 0.2;
    const depth = 0.07 + Math.random() * 0.12;

    const cx = origPos[center*3], cy = origPos[center*3+1], cz = origPos[center*3+2];
    const cl = Math.sqrt(cx*cx + cy*cy + cz*cz) || 1;
    const nx = cx/cl, ny = cy/cl, nz = cz/cl;

    const affectedIndices = [];

    for (let i = 0; i < vCount; i++) {
      const ox = origPos[i*3], oy = origPos[i*3+1], oz = origPos[i*3+2];
      const ol = Math.sqrt(ox*ox + oy*oy + oz*oz) || 1;
      const dot = Math.max(-1, Math.min(1, (ox*nx + oy*ny + oz*nz) / ol));
      const ang = Math.acos(dot);
      if (ang < cr) {
        const f = Math.cos((ang / cr) * (Math.PI / 2));
        ptPos[i*3]   = ox - nx * depth * f;
        ptPos[i*3+1] = oy - ny * depth * f;
        ptPos[i*3+2] = oz - nz * depth * f;
        affectedIndices.push(i);
      }
    }
    ptGeo.attributes.position.needsUpdate = true;

    // Color every crater vertex red (respects toggle)
    affectedIndices.forEach(i => {
      writeColor(i, C.warning, layerVisible.warning !== false);
      // Add to registry if not already tracked
      if (!vtxLabels[i]) {
        vtxRegistry.push({ idx: i, layerKey: "warning", color: C.warning });
        vtxLabels[i] = `[WARNING] ${text}`;
      }
    });
    ptGeo.attributes.color.needsUpdate = true;
  }

  // ── Public API ──
  window.sphereMark = function (type, text) {
    switch (type) {
      case "warning":
        applyCrater(text);
        break;

      case "suggestion":
        registerMark(pickVertex(text), "suggestion", text, C.suggestion, 1.10);
        break;

      case "vulnerability":
        registerMark(pickVertex(text), "vulnerability", text, C.vulnerability, 1.18);
        // also crater it
        applyCrater(text);
        break;

      case "unsafe_service":
        registerMark(pickVertex(text), "unsafe_service", text, C.unsafe_service, 1.08);
        break;

      case "exposed_service":
        registerMark(pickVertex(text), "exposed_service", text, C.exposed_service, 1.06);
        break;

      case "disabled":
        registerMark(pickVertex(text), "disabled", text, C.disabled, 1.0);
        break;

      case "ok":
        registerMark(pickVertex(text), "ok", text, C.ok, 1.0);
        break;

      case "info":
        registerMark(pickVertex(text), "info", text, C.info, 1.0);
        break;
    }
  };

  window.sphereReset = function () {
    craterCount = 0;
    const el = document.getElementById("crater-count");
    if (el) el.textContent = "CRATERS: 0";

    vtxRegistry.length = 0;
    Object.keys(vtxLabels).forEach(k => delete vtxLabels[k]);

    for (let i = 0; i < vCount; i++) {
      ptPos[i*3]     = origPos[i*3];
      ptPos[i*3+1]   = origPos[i*3+1];
      ptPos[i*3+2]   = origPos[i*3+2];
      ptColors[i*3]   = 0.14;
      ptColors[i*3+1] = 0.14;
      ptColors[i*3+2] = 0.14;
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
      const lbl = vtxLabels[hits[0].index];
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

  // ── Render loop ──
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Restore persisted toggle state on load
  window.applyToggles();

})();
