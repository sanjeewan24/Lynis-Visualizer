/**
 * visualizer.js — Lynis Brutalist Sphere
 * Low-poly rotating wireframe sphere.
 * Each WARNING event displaces a random cluster of vertices inward ("crater").
 */

(function () {
  "use strict";

  /* ── Scene bootstrap ── */
  const wrap   = document.getElementById("canvas-wrap");
  const W      = () => wrap.clientWidth;
  const H      = () => wrap.clientHeight;

  // OrbitControls via CDN (loaded in index.html before this script)
  const OrbitControls = THREE.OrbitControls;

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1); // pixel-perfect, no AA
  renderer.setClearColor(0x0a0a0a, 1);
  renderer.setSize(W(), H());
  wrap.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 100);
  camera.position.set(0, 0, 3.8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.08;
  controls.autoRotate      = false;
  controls.enablePan       = false;
  controls.minDistance     = 2.0;
  controls.maxDistance     = 7.0;

  /* ── Geometry ── */
  const geo = new THREE.IcosahedronGeometry(1.2, 5);

  const posAttr = geo.attributes.position;
  const origPos = new Float32Array(posAttr.array);
  const vCount  = posAttr.count;

  /* Vertex colors (default white) */
  const colors = new Float32Array(vCount * 3).fill(1.0); // RGB all 1 = white
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  /* Wireframe */
  const wireMat  = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, wireframe: true });
  const wireMesh = new THREE.Mesh(geo, wireMat);
  scene.add(wireMesh);

  /* Point cloud with vertex colors */
  const pointGeo = new THREE.BufferGeometry();
  const ptPos    = new Float32Array(origPos);
  const ptColors = new Float32Array(colors);
  pointGeo.setAttribute("position", new THREE.BufferAttribute(ptPos, 3));
  pointGeo.setAttribute("color",    new THREE.BufferAttribute(ptColors, 3));
  const pointMat = new THREE.PointsMaterial({
    size: 0.028,
    sizeAttenuation: true,
    vertexColors: true,
  });
  const points = new THREE.Points(pointGeo, pointMat);
  scene.add(points);

  /* ── Zonal mapping ── */
  // Partition vertex indices into named zones by position on sphere
  const ZONES = {
    network: [],  // upper hemisphere  (y > 0.4)
    kernel:  [],  // lower hemisphere  (y < -0.4)
    auth:    [],  // equatorial band
  };
  for (let i = 0; i < vCount; i++) {
    const y = origPos[i * 3 + 1];
    if      (y >  0.4) ZONES.network.push(i);
    else if (y < -0.4) ZONES.kernel.push(i);
    else               ZONES.auth.push(i);
  }

  function zoneForText(text) {
    const t = (text || "").toLowerCase();
    if (/port|network|ssh|firewall|tcp|udp|bind/.test(t)) return ZONES.network;
    if (/kernel|sysctl|module|grub|boot/.test(t))         return ZONES.kernel;
    return ZONES.auth;
  }

  /* ── Suggestion mark ── */
  const AMBER = new THREE.Color(0xffbf00);

  window.applySuggestionMark = function (text) {
    const zone  = zoneForText(text);
    if (!zone.length) return;
    const pivot = zone[Math.floor(Math.random() * zone.length)];
    const spike = 1.12; // scale factor

    // Color pivot amber and spike outward
    ptColors[pivot * 3]     = AMBER.r;
    ptColors[pivot * 3 + 1] = AMBER.g;
    ptColors[pivot * 3 + 2] = AMBER.b;
    ptPos[pivot * 3]     = origPos[pivot * 3]     * spike;
    ptPos[pivot * 3 + 1] = origPos[pivot * 3 + 1] * spike;
    ptPos[pivot * 3 + 2] = origPos[pivot * 3 + 2] * spike;

    // Spread amber glow to ~6 nearest neighbours
    const cx = origPos[pivot * 3], cy = origPos[pivot * 3 + 1], cz = origPos[pivot * 3 + 2];
    const neighbours = zone
      .map(i => ({
        i,
        d: Math.hypot(origPos[i*3]-cx, origPos[i*3+1]-cy, origPos[i*3+2]-cz)
      }))
      .sort((a, b) => a.d - b.d)
      .slice(1, 7);

    neighbours.forEach(({ i }) => {
      ptColors[i * 3]     = AMBER.r * 0.6;
      ptColors[i * 3 + 1] = AMBER.g * 0.6;
      ptColors[i * 3 + 2] = AMBER.b * 0.0;
    });

    pointGeo.attributes.position.needsUpdate = true;
    pointGeo.attributes.color.needsUpdate    = true;
  };

  /* ── Crater deformation ── */
  let craterCount = 0;
  const craterCountEl = document.getElementById("crater-count");

  function applyWarningCrater() {
    craterCount++;
    if (craterCountEl) craterCountEl.textContent = `CRATERS: ${craterCount}`;

    const count   = posAttr.count;
    const center  = Math.floor(Math.random() * count);
    const radius  = 0.25 + Math.random() * 0.3;  // angular neighbourhood
    const depth   = 0.08 + Math.random() * 0.18; // inward displacement

    const cx = origPos[center * 3];
    const cy = origPos[center * 3 + 1];
    const cz = origPos[center * 3 + 2];
    const cLen = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    const cnx  = cx / cLen;
    const cny  = cy / cLen;
    const cnz  = cz / cLen;

    for (let i = 0; i < count; i++) {
      const ox = origPos[i * 3];
      const oy = origPos[i * 3 + 1];
      const oz = origPos[i * 3 + 2];
      const oLen = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;

      // Dot product → angular distance proxy
      const dot = (ox * cnx + oy * cny + oz * cnz) / oLen;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));

      if (ang < radius) {
        // Smooth cosine falloff
        const falloff = Math.cos((ang / radius) * (Math.PI / 2));
        const disp    = depth * falloff;
        posAttr.setXYZ(
          i,
          ox - cnx * disp,
          oy - cny * disp,
          oz - cnz * disp
        );
      }
    }

    posAttr.needsUpdate = true;

    // Sync crater deformation to point cloud
    for (let i = 0; i < vCount; i++) {
      ptPos[i * 3]     = posAttr.getX(i);
      ptPos[i * 3 + 1] = posAttr.getY(i);
      ptPos[i * 3 + 2] = posAttr.getZ(i);
      // Only recolor vertices actually displaced (within crater radius)
      const ox2 = origPos[i*3], oy2 = origPos[i*3+1], oz2 = origPos[i*3+2];
      const oL2 = Math.sqrt(ox2*ox2+oy2*oy2+oz2*oz2)||1;
      const dot2 = (ox2*(cx/cLen)+oy2*(cy/cLen)+oz2*(cz/cLen))/oL2;
      if (Math.acos(Math.max(-1,Math.min(1,dot2))) < radius) {
        ptColors[i * 3]     = 1.0;
        ptColors[i * 3 + 1] = 0.0;
        ptColors[i * 3 + 2] = 0.0;
      }
    }
    pointGeo.attributes.position.needsUpdate = true;
    pointGeo.attributes.color.needsUpdate    = true;

    geo.computeVertexNormals();
  }

  /* Expose globally so socket handlers can call it */
  window.applyWarningCrater = applyWarningCrater;

  /* ── Spin burst on warning (pulses point brightness instead of rotating) ── */
  let burstFrames = 0;
  window.triggerSpinBurst = function () {
    burstFrames = 18;
  };

  /* ── Resize ── */
  window.addEventListener("resize", () => {
    renderer.setSize(W(), H());
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
  });

  /* ── Render loop ── */
  function animate() {
    requestAnimationFrame(animate);
    controls.update();

    if (burstFrames > 0) {
      const pulse = 0.15 * (burstFrames / 18);
      pointMat.size = 0.028 + pulse * 0.04;
      burstFrames--;
    } else {
      pointMat.size = 0.028;
    }

    renderer.render(scene, camera);
  }

  /* ── Raycaster for suggestion tooltip ── */
  const raycaster  = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.04;
  const mouse      = new THREE.Vector2();
  const tooltip    = document.getElementById("vtx-tooltip");
  const suggLabels = {}; // vertex index → suggestion text

  // Store suggestion text per vertex when applySuggestionMark is called
  const _origApply = window.applySuggestionMark;
  const BLUE = new THREE.Color(0x4488ff);
  window.applyInfoDot = function (text) {
    const zone = zoneForText(text);
    if (!zone.length) return;
    const idx = zone[Math.floor(Math.random() * zone.length)];
    ptColors[idx * 3]     = BLUE.r;
    ptColors[idx * 3 + 1] = BLUE.g;
    ptColors[idx * 3 + 2] = BLUE.b;
    pointGeo.attributes.color.needsUpdate = true;
  };

  const RED_SPIKE = new THREE.Color(0xff2a2a);
  window.applyVulnerabilitySpike = function (text) {
    const zone = zoneForText(text);
    if (!zone.length) return;
    const pivot = zone[Math.floor(Math.random() * zone.length)];
    const boost = 1.22;
    ptPos[pivot*3]   = origPos[pivot*3]   * boost;
    ptPos[pivot*3+1] = origPos[pivot*3+1] * boost;
    ptPos[pivot*3+2] = origPos[pivot*3+2] * boost;
    ptColors[pivot*3]   = RED_SPIKE.r;
    ptColors[pivot*3+1] = RED_SPIKE.g;
    ptColors[pivot*3+2] = RED_SPIKE.b;
    pointGeo.attributes.position.needsUpdate = true;
    pointGeo.attributes.color.needsUpdate    = true;
  };
  window.applySuggestionMark = function (text) {
    const zone  = zoneForText(text);
    if (!zone.length) return;
    const pivot = zone[Math.floor(Math.random() * zone.length)];
    suggLabels[pivot] = text;
    _origApply(text);
  };

  wrap.addEventListener("mousemove", (e) => {
    const rect = wrap.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(points);

    if (hits.length) {
      const idx   = hits[0].index;
      const label = suggLabels[idx];
      if (label) {
        tooltip.style.display = "block";
        tooltip.style.left    = (e.clientX + 14) + "px";
        tooltip.style.top     = (e.clientY - 10) + "px";
        tooltip.textContent   = "[SUGG] " + label;
        return;
      }
    }
    tooltip.style.display = "none";
  });

  wrap.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });

  animate();
})();
