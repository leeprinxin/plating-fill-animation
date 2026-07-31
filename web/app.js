(() => {
  const DATA = window.SIM_DATA;
  const { nx, ny, particleMask, particleCenters, particleRadius } = DATA;

  let activeKey = "success";
  let numFrames, depositTime, fillHistory;

  function applyScenarioData(key) {
    const s = DATA.scenarios[key];
    numFrames = s.numFrames;
    depositTime = s.depositTime;
    fillHistory = s.fillHistory;
  }
  applyScenarioData(activeKey);

  const FADE_FRAMES = 6; // 沉積 / 生長動畫的柔和過渡影格數

  // ---------------------------------------------------------------- 世界座標尺度換算
  const WORLD_SCALE = 10 / nx;               // 世界單位 / 格點
  const bedWorldH = ny * WORLD_SCALE;        // 孔隙床世界高度
  const particleR = particleRadius * WORLD_SCALE;
  const Z_LAYERS = 4;                        // 沿深度方向複製的層數，做出真正的 3D 堆疊
  const zSpacing = particleR * Math.sqrt(3);
  const bedDepth = (Z_LAYERS - 1) * zSpacing + particleR * 2;
  const ELECTROLYTE_H = bedWorldH * 0.34;

  const innerW = nx * WORLD_SCALE + particleR * 1.4;
  const innerD = bedDepth + particleR * 1.0;
  const wallT = 0.12;
  const baseT = 0.3;
  const totalH = ELECTROLYTE_H + bedWorldH;

  function cellIndex(gx, gy) {
    const ix = Math.min(nx - 1, Math.max(0, Math.round(gx)));
    const iy = Math.min(ny - 1, Math.max(0, Math.round(gy)));
    return iy * nx + ix;
  }
  function worldX(gx, offset) { return (gx - nx / 2) * WORLD_SCALE + (offset || 0); }
  function worldY(gy) { return -gy * WORLD_SCALE; }
  function particleWorldZ(k) { return (k - (Z_LAYERS - 1) / 2) * zSpacing; }
  function layerXOffset(k) { return (k % 2 === 1) ? particleR : 0; }

  // ---------------------------------------------------------------- Three.js 基本設置
  const canvas = document.getElementById("simCanvas");
  const DISPLAY_W = 640, DISPLAY_H = 560;
  canvas.style.width = DISPLAY_W + "px";
  canvas.style.height = DISPLAY_H + "px";
  canvas.style.cursor = "grab";

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(DISPLAY_W, DISPLAY_H, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0xeef4fa, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, DISPLAY_W / DISPLAY_H, 0.1, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xbcd6ee, 0.4);
  fillLight.position.set(-5, -2, -4);
  scene.add(fillLight);

  const dummy = new THREE.Object3D();

  // ---------------------------------------------------------------- 容器（玻璃缸）
  const tankGroup = new THREE.Group();
  scene.add(tankGroup);

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe0f5, transparent: true, opacity: 0.16, roughness: 0.15, metalness: 0.05, side: THREE.DoubleSide,
  });
  const wallGeoLR = new THREE.BoxGeometry(wallT, totalH + wallT * 2, innerD + wallT * 2);
  const wallGeoFB = new THREE.BoxGeometry(innerW + wallT * 2, totalH + wallT * 2, wallT);

  const leftWall = new THREE.Mesh(wallGeoLR, glassMat);
  leftWall.position.set(-innerW / 2, ELECTROLYTE_H - totalH / 2, 0);
  const rightWall = leftWall.clone();
  rightWall.position.x = innerW / 2;
  const backWall = new THREE.Mesh(wallGeoFB, glassMat);
  backWall.position.set(0, ELECTROLYTE_H - totalH / 2, -innerD / 2);
  const frontWall = backWall.clone();
  frontWall.position.z = innerD / 2;
  tankGroup.add(leftWall, rightWall, backWall, frontWall);

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x8b939b, roughness: 0.5, metalness: 0.35 });
  const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(innerW + wallT * 2, baseT, innerD + wallT * 2), baseMat);
  baseMesh.position.set(0, -bedWorldH - baseT / 2, 0);
  tankGroup.add(baseMesh);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd7de, roughness: 0.35, metalness: 0.5 });
  const rimMesh = new THREE.Mesh(new THREE.BoxGeometry(innerW + wallT * 3, 0.12, innerD + wallT * 3), rimMat);
  rimMesh.position.set(0, ELECTROLYTE_H + 0.06, 0);
  tankGroup.add(rimMesh);

  // ---------------------------------------------------------------- 電解液 + 離子
  const electrolyteMat = new THREE.MeshStandardMaterial({
    color: 0x8fd0f2, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0,
  });
  const electrolyteMesh = new THREE.Mesh(new THREE.BoxGeometry(innerW, ELECTROLYTE_H, innerD), electrolyteMat);
  electrolyteMesh.position.set(0, ELECTROLYTE_H / 2, 0);
  scene.add(electrolyteMesh);

  const ION_COUNT = 26;
  const ionR = particleR * 0.16;
  const ionMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(ionR, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x6db444, emissive: 0x1f3d0e, roughness: 0.4, metalness: 0.1 }),
    ION_COUNT
  );
  ionMesh.frustumCulled = false;
  const ions = [];
  for (let i = 0; i < ION_COUNT; i++) {
    ions.push({
      x: (Math.random() - 0.5) * innerW * 0.82,
      z: (Math.random() - 0.5) * innerD * 0.82,
      phase: Math.random(),
      speed: 0.5 + Math.random() * 0.3,
    });
  }
  scene.add(ionMesh);

  function updateIons(tSec) {
    for (let i = 0; i < ION_COUNT; i++) {
      const ion = ions[i];
      const localT = (tSec * ion.speed + ion.phase) % 1;
      const y = ELECTROLYTE_H * (0.94 - localT * 0.88);
      dummy.position.set(ion.x, y, ion.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ionMesh.setMatrixAt(i, dummy.matrix);
    }
    ionMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 電場線（虛線）與離子／電流方向箭頭
  const fieldLineColor = 0x4f8fd8;
  const FIELD_COLS = 4, FIELD_ROWS = 3;
  const fieldGroup = new THREE.Group();
  scene.add(fieldGroup);

  const arrowHeadGeo = new THREE.ConeGeometry(particleR * 0.16, particleR * 0.42, 10);
  const arrowHeadMat = new THREE.MeshStandardMaterial({ color: fieldLineColor, roughness: 0.4, metalness: 0.2 });
  const fieldLineMat = new THREE.LineDashedMaterial({
    color: fieldLineColor, dashSize: particleR * 0.35, gapSize: particleR * 0.28, transparent: true, opacity: 0.6,
  });

  for (let ix = 0; ix < FIELD_COLS; ix++) {
    for (let iz = 0; iz < FIELD_ROWS; iz++) {
      const fx = ((ix + 0.5) / FIELD_COLS - 0.5) * innerW * 0.86;
      const fz = ((iz + 0.5) / FIELD_ROWS - 0.5) * innerD * 0.7;
      const yTop = ELECTROLYTE_H * 0.96;
      const yBot = ELECTROLYTE_H * 0.08;

      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(fx, yTop, fz),
        new THREE.Vector3(fx, yBot, fz),
      ]);
      const line = new THREE.Line(geo, fieldLineMat);
      line.computeLineDistances();
      fieldGroup.add(line);

      const arrow = new THREE.Mesh(arrowHeadGeo, arrowHeadMat);
      arrow.position.set(fx, yBot, fz);
      arrow.rotation.x = Math.PI; // 錐尖朝下，代表離子/電流由陰極上方流向孔隙床
      fieldGroup.add(arrow);
    }
  }

  // 孔口弧形電場線：電場線在接近孔隙開口處會彎折匯聚、鑽入顆粒間縫隙，
  // 呼應「電流密度在孔口集中，易造成上層快速沉積」的現象。
  // 用短管狀網格（而非 THREE.Line）畫虛線弧，避免受限於 WebGL 無法自訂線寬、
  // 在灰色顆粒背景上對比度太低而幾乎看不見的問題。
  const MOUTH_ARC_COLS = 5;
  const MOUTH_DASHES = 7;
  const mouthArcMat = new THREE.MeshStandardMaterial({
    color: fieldLineColor, roughness: 0.35, metalness: 0.15, transparent: true, opacity: 0.9,
  });
  const mouthTubeR = particleR * 0.06;
  const mouthArrowGeo = new THREE.ConeGeometry(particleR * 0.15, particleR * 0.4, 10);
  const mouthStartY = -particleR * 2.6;
  const mouthEndY = -particleR * 0.3;
  const mouthZ = (Z_LAYERS - 1) / 2 * zSpacing + particleR * 1.15; // 浮在最前排顆粒表面之外，避免被顆粒遮擋

  for (let ix = 0; ix < MOUTH_ARC_COLS; ix++) {
    const fx = ((ix + 0.5) / MOUTH_ARC_COLS - 0.5) * innerW * 0.82;
    const bend = (ix % 2 === 0 ? 1 : -1) * particleR * 0.55;
    const start = new THREE.Vector3(fx, mouthStartY, mouthZ);
    const ctrl = new THREE.Vector3(fx + bend, mouthStartY + (mouthEndY - mouthStartY) * 0.55, mouthZ);
    const end = new THREE.Vector3(fx, mouthEndY, mouthZ);
    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);

    for (let d = 0; d < MOUTH_DASHES; d++) {
      const t0 = d / MOUTH_DASHES;
      const t1 = t0 + (1 / MOUTH_DASHES) * 0.55;
      const segPts = [];
      for (let s = 0; s <= 4; s++) segPts.push(curve.getPoint(t0 + (t1 - t0) * (s / 4)));
      const segCurve = new THREE.CatmullRomCurve3(segPts);
      const tubeGeo = new THREE.TubeGeometry(segCurve, 8, mouthTubeR, 6, false);
      fieldGroup.add(new THREE.Mesh(tubeGeo, mouthArcMat));
    }

    const tangent = curve.getTangent(1).normalize();
    const arrow = new THREE.Mesh(mouthArrowGeo, arrowHeadMat);
    arrow.position.copy(end);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    fieldGroup.add(arrow);
  }

  // ---------------------------------------------------------------- 顆粒（3D 球體，可隨沉積變色）
  const greyColor = new THREE.Color(0x9aa0a6);
  const copperColor = new THREE.Color(0xc8763c);
  const voidColor = new THREE.Color(0xb85a5a);

  const particleMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 20, 16),
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.55 }),
    particleCenters.length * Z_LAYERS
  );
  particleMesh.frustumCulled = false;
  for (let c = 0; c < particleCenters.length; c++) {
    const [cx, cy] = particleCenters[c];
    for (let k = 0; k < Z_LAYERS; k++) {
      dummy.position.set(worldX(cx, layerXOffset(k)), worldY(cy), particleWorldZ(k));
      dummy.scale.setScalar(particleR);
      dummy.updateMatrix();
      const i = c * Z_LAYERS + k;
      particleMesh.setMatrixAt(i, dummy.matrix);
      particleMesh.setColorAt(i, greyColor);
    }
  }
  particleMesh.instanceMatrix.needsUpdate = true;
  particleMesh.instanceColor.needsUpdate = true;
  scene.add(particleMesh);

  const COAT_SAMPLES = 8;
  const coatR = particleRadius * 1.15;
  function coatFraction(cx, cy, frame) {
    let sum = 0, count = 0;
    for (let i = 0; i < COAT_SAMPLES; i++) {
      const ang = (i / COAT_SAMPLES) * Math.PI * 2;
      const idx = cellIndex(cx + Math.cos(ang) * coatR, cy + Math.sin(ang) * coatR);
      if (particleMask[idx]) continue;
      count++;
      const dt = depositTime[idx];
      if (dt >= 0 && dt <= frame) {
        sum += Math.min(1, (frame - dt) / FADE_FRAMES);
      }
    }
    return count > 0 ? sum / count : 0;
  }

  function updateParticles(frame) {
    for (let c = 0; c < particleCenters.length; c++) {
      const [cx, cy] = particleCenters[c];
      const col = greyColor.clone().lerp(copperColor, coatFraction(cx, cy, frame));
      const base = c * Z_LAYERS;
      for (let k = 0; k < Z_LAYERS; k++) particleMesh.setColorAt(base + k, col);
    }
    particleMesh.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 孔隙填充（沉積金屬本體）
  const STEP = 5;
  const FILLER_LAYERS = 3;
  const fillerCells = [];
  for (let gy = 2; gy < ny; gy += STEP) {
    for (let gx = 2; gx < nx; gx += STEP) {
      const idx = gy * nx + gx;
      if (particleMask[idx]) continue;
      fillerCells.push({ gx, gy, idx });
    }
  }
  const fillerInfo = [];
  for (const c of fillerCells) {
    for (let k = 0; k < FILLER_LAYERS; k++) fillerInfo.push({ gx: c.gx, gy: c.gy, idx: c.idx, k });
  }
  function fillerWorldZ(k) { return (k - (FILLER_LAYERS - 1) / 2) * (bedDepth / FILLER_LAYERS); }

  const fillerR = STEP * WORLD_SCALE * 0.6;
  const fillerMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5 }),
    fillerInfo.length
  );
  fillerMesh.frustumCulled = false;
  scene.add(fillerMesh);

  function updateFiller(frame) {
    const showVoids = frame >= numFrames - 1;
    for (let i = 0; i < fillerInfo.length; i++) {
      const f = fillerInfo[i];
      const dt = depositTime[f.idx];
      let scale = 0.0001;
      let color = copperColor;
      if (dt >= 0 && dt <= frame) {
        scale = Math.max(0.0001, Math.min(1, (frame - dt) / FADE_FRAMES));
      } else if (showVoids && dt >= numFrames) {
        scale = 1.35;
        color = voidColor;
      }
      dummy.position.set(worldX(f.gx), worldY(f.gy), fillerWorldZ(f.k));
      dummy.scale.setScalar(fillerR * scale);
      dummy.updateMatrix();
      fillerMesh.setMatrixAt(i, dummy.matrix);
      fillerMesh.setColorAt(i, color);
    }
    fillerMesh.instanceMatrix.needsUpdate = true;
    fillerMesh.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 手刻拖曳旋轉 + 滾輪縮放相機控制
  const orbit = {
    theta: Math.PI * 0.22,
    phi: Math.PI * 0.38,
    radius: Math.max(innerW, innerD, totalH) * 1.9,
    target: new THREE.Vector3(0, ELECTROLYTE_H * 0.15 - bedWorldH * 0.35, 0),
    dragging: false,
    lastX: 0,
    lastY: 0,
  };
  const MIN_PHI = 0.12 * Math.PI, MAX_PHI = 0.88 * Math.PI;
  const MIN_R = Math.max(innerW, innerD) * 0.9, MAX_R = Math.max(innerW, innerD, totalH) * 4.5;

  function updateCamera() {
    const { theta, phi, radius, target } = orbit;
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  }

  canvas.addEventListener("mousedown", (e) => {
    orbit.dragging = true;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    orbit.dragging = false;
    canvas.style.cursor = "grab";
  });
  window.addEventListener("mousemove", (e) => {
    if (!orbit.dragging) return;
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.theta -= dx * 0.006;
    orbit.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, orbit.phi - dy * 0.006));
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    orbit.radius = Math.min(MAX_R, Math.max(MIN_R, orbit.radius * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  // ---------------------------------------------------------------- 階段文字
  const STAGES_BY_SCENARIO = {
    success: [
      { max: 0.02, label: "① 初始狀態" },
      { max: 0.20, label: "② 上層開始沉積" },
      { max: 0.50, label: "③ 沉積層向下推進" },
      { max: 0.75, label: "④ 中層持續填充" },
      { max: 0.95, label: "⑤ 接近底部" },
      { max: 1.01, label: "⑥ 完全填滿" },
    ],
    failure: [
      { max: 0.01, label: "① 初始狀態" },
      { max: 0.04, label: "② 上層快速沉積" },
      { max: 0.09, label: "③ 孔口即將封閉" },
      { max: 1.01, label: "④ 孔口封閉・內部形成空洞" },
    ],
  };
  let STAGES = STAGES_BY_SCENARIO[activeKey];

  const stageLabelEl = document.getElementById("stageLabel");
  const stagePercentEl = document.getElementById("stagePercent");

  function fillFractionAt(frame) {
    if (frame <= 0) return 0;
    const idx = Math.min(frame, fillHistory.length) - 1;
    return fillHistory[idx] || 0;
  }

  function updateStageText(frame) {
    const frac = fillFractionAt(frame);
    const stage = STAGES.find((s) => frac <= s.max) || STAGES[STAGES.length - 1];
    stageLabelEl.textContent = stage.label;
    stagePercentEl.textContent = Math.round(frac * 100) + "%";
  }

  // ---------------------------------------------------------------- 播放控制
  const playBtn = document.getElementById("playBtn");
  const restartBtn = document.getElementById("restartBtn");
  const slider = document.getElementById("frameSlider");
  const speedSelect = document.getElementById("speedSelect");

  slider.max = String(numFrames - 1);

  const state = {
    frame: 0,
    playing: true,
    baseFps: 26,
    speed: 1,
    lastTime: null,
    acc: 0,
    holdUntil: 0,
    recording: false,
    recordStopAt: 0,
  };

  function setFrame(f) {
    state.frame = Math.max(0, Math.min(numFrames - 1, f));
    slider.value = String(state.frame);
    updateStageText(state.frame);
    updateParticles(state.frame);
    updateFiller(state.frame);
    if (state.recording) {
      downloadBtn.textContent = `錄製中… ${Math.round((state.frame / (numFrames - 1)) * 100)}%`;
    }
  }

  const scenarioSuccessBtn = document.getElementById("scenarioSuccessBtn");
  const scenarioFailureBtn = document.getElementById("scenarioFailureBtn");

  function setScenario(key) {
    if (key === activeKey) return;
    activeKey = key;
    applyScenarioData(activeKey);
    STAGES = STAGES_BY_SCENARIO[activeKey];
    slider.max = String(numFrames - 1);
    scenarioSuccessBtn.classList.toggle("ghost", key !== "success");
    scenarioFailureBtn.classList.toggle("ghost", key !== "failure");
    setFrame(0);
    state.playing = true;
    playBtn.textContent = "暫停";
  }

  scenarioSuccessBtn.addEventListener("click", () => setScenario("success"));
  scenarioFailureBtn.addEventListener("click", () => setScenario("failure"));

  playBtn.addEventListener("click", () => {
    state.playing = !state.playing;
    playBtn.textContent = state.playing ? "暫停" : "播放";
    if (state.playing && state.frame >= numFrames - 1) {
      setFrame(0);
    }
  });

  restartBtn.addEventListener("click", () => {
    setFrame(0);
    state.playing = true;
    playBtn.textContent = "暫停";
  });

  slider.addEventListener("input", () => {
    state.playing = false;
    playBtn.textContent = "播放";
    setFrame(parseInt(slider.value, 10));
  });

  speedSelect.addEventListener("change", () => {
    state.speed = parseFloat(speedSelect.value);
  });

  // ---------------------------------------------------------------- 下載動畫影片（canvas.captureStream + MediaRecorder）
  const downloadBtn = document.getElementById("downloadBtn");
  let mediaRecorder = null;
  let recordChunks = [];
  let preRecordState = null;

  function pickRecordingMimeType() {
    const candidates = [
      "video/mp4;codecs=avc1",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  function setControlsDisabled(disabled) {
    playBtn.disabled = disabled;
    restartBtn.disabled = disabled;
    slider.disabled = disabled;
    speedSelect.disabled = disabled;
    scenarioSuccessBtn.disabled = disabled;
    scenarioFailureBtn.disabled = disabled;
  }

  function startRecording() {
    if (state.recording) return;
    const mimeType = pickRecordingMimeType();
    if (!mimeType || !canvas.captureStream) {
      alert("此瀏覽器不支援錄製動畫影片下載，請改用 Chrome 或 Edge 等桌面瀏覽器。");
      return;
    }

    preRecordState = { playing: state.playing, frame: state.frame, speed: state.speed };
    downloadBtn.disabled = true;
    downloadBtn.textContent = "錄製中… 0%";
    setControlsDisabled(true);

    state.recording = true;
    state.speed = 1;
    state.acc = 0;
    state.holdUntil = 0;
    state.recordStopAt = 0;
    setFrame(0);
    state.playing = true;
    state.lastTime = null;

    recordChunks = [];
    const stream = canvas.captureStream(30);
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) recordChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: mimeType });
      const ext = mimeType.indexOf("mp4") >= 0 ? "mp4" : "webm";
      const scenarioLabel = activeKey === "success" ? "成功填滿" : "橋接失敗";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `多孔結構電鍍填滿動畫_${scenarioLabel}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      state.recording = false;
      downloadBtn.disabled = false;
      downloadBtn.textContent = "⬇ 下載動畫影片";
      setControlsDisabled(false);
      state.speed = preRecordState.speed;
      state.playing = preRecordState.playing;
      setFrame(preRecordState.frame);
      playBtn.textContent = state.playing ? "暫停" : "播放";
    };
    mediaRecorder.start();
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  }

  downloadBtn.addEventListener("click", startRecording);

  function tick(timestamp) {
    if (state.lastTime === null) state.lastTime = timestamp;
    const dt = (timestamp - state.lastTime) / 1000;
    state.lastTime = timestamp;
    const tSec = timestamp / 1000;

    if (state.playing) {
      if (state.frame >= numFrames - 1) {
        if (state.recording) {
          state.recordStopAt = state.recordStopAt || timestamp + 300;
          if (timestamp >= state.recordStopAt) {
            state.recordStopAt = 0;
            state.playing = false;
            stopRecording();
          }
        } else {
          state.holdUntil = state.holdUntil || timestamp + 1400;
          if (timestamp >= state.holdUntil) {
            state.holdUntil = 0;
            setFrame(0);
          }
        }
      } else {
        state.acc += dt * state.baseFps * state.speed;
        while (state.acc >= 1) {
          state.acc -= 1;
          setFrame(state.frame + 1);
          if (state.frame >= numFrames - 1) break;
        }
      }
    }

    updateIons(tSec);
    updateCamera();
    renderer.render(scene, camera);

    requestAnimationFrame(tick);
  }

  setFrame(0);
  requestAnimationFrame(tick);
})();
