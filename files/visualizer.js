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

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1); // pixel-perfect, no AA
  renderer.setClearColor(0x0a0a0a, 1);
  renderer.setSize(W(), H());
  wrap.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 100);
  camera.position.set(0, 0, 3.8);

  /* ── Geometry ── */
  const SEGS = 32; // low-poly but enough for visible craters
  const geo  = new THREE.SphereGeometry(1.2, SEGS, SEGS);

  // Store original positions for reference
  const posAttr    = geo.attributes.position;
  const origPos    = new Float32Array(posAttr.array.length);
  origPos.set(posAttr.array);

  /* Wireframe layer */
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xe8e8e8,
    wireframe: true,
  });
  const wireMesh = new THREE.Mesh(geo, wireMat);
  scene.add(wireMesh);

  /* Point cloud overlay for brutalist pixel feel */
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(origPos), 3));
  const pointMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.025,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(pointGeo, pointMat);
  scene.add(points);

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

    // Also push to point cloud
    pointGeo.attributes.position.array.set(posAttr.array);
    pointGeo.attributes.position.needsUpdate = true;

    geo.computeVertexNormals();
  }

  /* Expose globally so socket handlers can call it */
  window.applyWarningCrater = applyWarningCrater;

  /* ── Rotation state ── */
  let baseSpeed   = 0.003;
  let burstSpeed  = 0;

  /* On warning, briefly spin faster */
  window.triggerSpinBurst = function () {
    burstSpeed = 0.04;
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

    if (burstSpeed > 0) {
      burstSpeed *= 0.92;
      if (burstSpeed < 0.0001) burstSpeed = 0;
    }

    wireMesh.rotation.y += baseSpeed + burstSpeed;
    wireMesh.rotation.x += (baseSpeed + burstSpeed) * 0.3;
    points.rotation.copy(wireMesh.rotation);

    renderer.render(scene, camera);
  }

  animate();
})();
