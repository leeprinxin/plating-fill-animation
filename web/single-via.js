(() => {
  const D = window.VIA_DATA;
  const {
    trenchWidth: W, trenchDepth: DEPTH, linerThickness, linerSplit,
    shoulderWidth: SW, topCapThickness, substrateBelow,
  } = D;

  const L = 5.0; // 沿 z 方向擠出深度，做出可旋轉觀察的 3D 立體溝槽
  const EPS = 0.0001;

  const cavityW = W - 2 * linerThickness;
  const cavityD = DEPTH - linerThickness;
  const Hc = cavityW / 2;
  const MOUTH_FRAC = 0.22; // 孔口區（開口附近）佔溝槽深度的比例，此區側壁增厚速度與本體區可能不同

  function smoothstep(x) {
    x = Math.min(1, Math.max(0, x));
    return x * x * (3 - 2 * x);
  }

  let activeKey = "success";
  let numFrames, fillPhaseFrames, sealFrame, bodySideMaxFrac, bottomMaxFrac;

  function applyScenarioData(key) {
    const s = D.scenarios[key];
    numFrames = s.numFrames;
    fillPhaseFrames = s.fillPhaseFrames || numFrames;
    sealFrame = s.sealFrame || 0;
    bodySideMaxFrac = s.bodySideMaxFrac || 0;
    bottomMaxFrac = s.bottomMaxFrac || 0;
  }
  applyScenarioData(activeKey);

  // ---------------------------------------------------------------- Three.js 基本設置（沿用 app.js 慣例）
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

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xbcd6ee, 0.4);
  fillLight.position.set(-5, -2, -4);
  scene.add(fillLight);

  const dummy = new THREE.Object3D();

  // ---------------------------------------------------------------- 顏色
  const siColor = 0x6b7178;
  const sioColor = 0xd7dbe0;
  const barrierColor = 0x5c7290;
  const seedColor = 0xd9b35c;
  const copperColor = 0xc8763c;
  const ionColor = 0xe0925a;
  const fieldLineColor = 0x4f8fd8;
  const voidColor = 0xb85a5a;

  // ---------------------------------------------------------------- 場景整體尺寸
  const structBottomY = -(DEPTH + substrateBelow);
  const capTopY = topCapThickness;
  const ELECTROLYTE_H = (DEPTH + substrateBelow) * 0.33;
  const electrolyteTopY = capTopY + ELECTROLYTE_H;
  const totalH = electrolyteTopY - structBottomY;

  const innerW = (W + 2 * SW) + 1.0;
  const innerD = L + 1.0;
  const wallT = 0.12;
  const baseT = 0.3;
  const tankCenterY = (structBottomY + electrolyteTopY) / 2;

  // ---------------------------------------------------------------- 容器（玻璃缸）
  const tankGroup = new THREE.Group();
  scene.add(tankGroup);

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe0f5, transparent: true, opacity: 0.16, roughness: 0.15, metalness: 0.05, side: THREE.DoubleSide,
  });
  const wallGeoLR = new THREE.BoxGeometry(wallT, totalH + wallT * 2, innerD + wallT * 2);
  const wallGeoFB = new THREE.BoxGeometry(innerW + wallT * 2, totalH + wallT * 2, wallT);

  const leftWall = new THREE.Mesh(wallGeoLR, glassMat);
  leftWall.position.set(-innerW / 2, tankCenterY, 0);
  const rightWall = leftWall.clone();
  rightWall.position.x = innerW / 2;
  const backWall = new THREE.Mesh(wallGeoFB, glassMat);
  backWall.position.set(0, tankCenterY, -innerD / 2);
  const frontWall = backWall.clone();
  frontWall.position.z = innerD / 2;
  tankGroup.add(leftWall, rightWall, backWall, frontWall);

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x8b939b, roughness: 0.5, metalness: 0.35 });
  const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(innerW + wallT * 2, baseT, innerD + wallT * 2), baseMat);
  baseMesh.position.set(0, structBottomY - baseT / 2, 0);
  tankGroup.add(baseMesh);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd7de, roughness: 0.35, metalness: 0.5 });
  const rimMesh = new THREE.Mesh(new THREE.BoxGeometry(innerW + wallT * 3, 0.12, innerD + wallT * 3), rimMat);
  rimMesh.position.set(0, electrolyteTopY + 0.06, 0);
  tankGroup.add(rimMesh);

  // ---------------------------------------------------------------- 電解液 + 離子
  const electrolyteMat = new THREE.MeshStandardMaterial({
    color: 0x8fd0f2, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0,
  });
  const electrolyteMesh = new THREE.Mesh(new THREE.BoxGeometry(innerW, ELECTROLYTE_H, innerD), electrolyteMat);
  electrolyteMesh.position.set(0, capTopY + ELECTROLYTE_H / 2, 0);
  scene.add(electrolyteMesh);

  const ION_COUNT = 16;
  const ionR = Hc * 0.14;
  const ionMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(ionR, 8, 8),
    new THREE.MeshStandardMaterial({ color: ionColor, emissive: 0x3a1c08, roughness: 0.4, metalness: 0.1 }),
    ION_COUNT
  );
  ionMesh.frustumCulled = false;
  const ions = [];
  for (let i = 0; i < ION_COUNT; i++) {
    ions.push({
      x: (Math.random() - 0.5) * innerW * 0.78,
      z: (Math.random() - 0.5) * innerD * 0.78,
      phase: Math.random(),
      speed: 0.5 + Math.random() * 0.3,
    });
  }
  scene.add(ionMesh);

  function updateIons(tSec) {
    for (let i = 0; i < ION_COUNT; i++) {
      const ion = ions[i];
      const localT = (tSec * ion.speed + ion.phase) % 1;
      const y = capTopY + ELECTROLYTE_H * (0.94 - localT * 0.88);
      dummy.position.set(ion.x, y, ion.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ionMesh.setMatrixAt(i, dummy.matrix);
    }
    ionMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 電場線（虛線）與電流方向箭頭
  const fieldGroup = new THREE.Group();
  scene.add(fieldGroup);

  const arrowHeadGeo = new THREE.ConeGeometry(Hc * 0.18, Hc * 0.46, 10);
  const arrowHeadMat = new THREE.MeshStandardMaterial({ color: fieldLineColor, roughness: 0.4, metalness: 0.2 });
  const fieldLineMat = new THREE.LineDashedMaterial({
    color: fieldLineColor, dashSize: Hc * 0.3, gapSize: Hc * 0.24, transparent: true, opacity: 0.6,
  });

  const FIELD_XS = [-Hc * 0.85, 0, Hc * 0.85];
  for (const fx of FIELD_XS) {
    const yTop = electrolyteTopY * 0.96;
    const yBot = capTopY + 0.15;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fx, yTop, 0),
      new THREE.Vector3(fx, yBot, 0),
    ]);
    const line = new THREE.Line(geo, fieldLineMat);
    line.computeLineDistances();
    fieldGroup.add(line);

    const arrow = new THREE.Mesh(arrowHeadGeo, arrowHeadMat);
    arrow.position.set(fx, yBot, 0);
    arrow.rotation.x = Math.PI; // 錐尖朝下，代表離子/電流由電解液上方流向溝槽
    fieldGroup.add(arrow);
  }

  // ---------------------------------------------------------------- 基板（矽，U 形溝槽）
  const siMat = new THREE.MeshStandardMaterial({ color: siColor, roughness: 0.75, metalness: 0.1 });
  const totalBelowH = DEPTH + substrateBelow;

  const leftShoulder = new THREE.Mesh(new THREE.BoxGeometry(SW, totalBelowH, L), siMat);
  leftShoulder.position.set(-(W / 2 + SW / 2), -totalBelowH / 2, 0);
  const rightShoulder = new THREE.Mesh(new THREE.BoxGeometry(SW, totalBelowH, L), siMat);
  rightShoulder.position.set(W / 2 + SW / 2, -totalBelowH / 2, 0);
  const bottomFloor = new THREE.Mesh(new THREE.BoxGeometry(W, substrateBelow, L), siMat);
  bottomFloor.position.set(0, -(DEPTH + substrateBelow / 2), 0);
  scene.add(leftShoulder, rightShoulder, bottomFloor);

  // ---------------------------------------------------------------- Liner 三層：介電層(SiO2)／阻障層(Ta/TaN)／種子層(Cu Seed)
  const linerColors = [sioColor, barrierColor, seedColor];
  const linerMats = linerColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.3 }));

  let insetPrev = 0;
  const seedStripMeshes = [];
  for (let k = 0; k < 3; k++) {
    const thisT = linerThickness * linerSplit[k];
    const mat = linerMats[k];

    const leftStrip = new THREE.Mesh(new THREE.BoxGeometry(thisT, DEPTH, L), mat);
    leftStrip.position.set(-W / 2 + insetPrev + thisT / 2, -DEPTH / 2, 0);
    const rightStrip = new THREE.Mesh(new THREE.BoxGeometry(thisT, DEPTH, L), mat);
    rightStrip.position.set(W / 2 - insetPrev - thisT / 2, -DEPTH / 2, 0);
    const bottomStrip = new THREE.Mesh(new THREE.BoxGeometry(W, thisT, L), mat);
    bottomStrip.position.set(0, -DEPTH + insetPrev + thisT / 2, 0);
    scene.add(leftStrip, rightStrip, bottomStrip);

    if (k === 2) seedStripMeshes.push(leftStrip, rightStrip, bottomStrip);

    insetPrev += thisT;
  }

  // 種子層（Cu Seed）：凹槽一開始只有阻障層，種子層在銅開始電鍍生長的瞬間才完整出現
  function updateSeedLayer(frame) {
    const visible = frame > 0;
    for (const m of seedStripMeshes) m.visible = visible;
  }

  // 肩部頂面介電層(SiO2)蓋層
  const sioCapMat = linerMats[0];
  const leftCap = new THREE.Mesh(new THREE.BoxGeometry(SW, topCapThickness, L), sioCapMat);
  leftCap.position.set(-(W / 2 + SW / 2), topCapThickness / 2, 0);
  const rightCap = new THREE.Mesh(new THREE.BoxGeometry(SW, topCapThickness, L), sioCapMat);
  rightCap.position.set(W / 2 + SW / 2, topCapThickness / 2, 0);
  scene.add(leftCap, rightCap);

  // ---------------------------------------------------------------- 銅填充（解析式生長模型，動態調整數個 Mesh）
  //
  // 溝槽垂直方向分成「孔口區」（開口附近，y ∈ [-mouthH, 0]）與「本體區」（y ∈ [-cavityD, -mouthH]）。
  // 成功情境：孔口區與本體區側壁以相同速率增厚，視覺上無縫銜接，等同於單一連續側壁生長。
  // 失敗情境（橋接）：孔口區側壁增厚速率遠快於本體區，於 sealFrame 搶先在開口處會合封閉，
  // 之後（本體區與底部因電解液已無法進入而停止生長）永久困住一段未填滿的空洞。
  const cuMat = new THREE.MeshStandardMaterial({ color: copperColor, roughness: 0.35, metalness: 0.55 });
  const voidMat = new THREE.MeshStandardMaterial({ color: voidColor, roughness: 0.55, metalness: 0.1 });
  const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);

  const bottomFillMesh = new THREE.Mesh(unitBoxGeo, cuMat);
  const leftBodySideFillMesh = new THREE.Mesh(unitBoxGeo, cuMat);
  const rightBodySideFillMesh = new THREE.Mesh(unitBoxGeo, cuMat);
  const leftMouthSideFillMesh = new THREE.Mesh(unitBoxGeo, cuMat);
  const rightMouthSideFillMesh = new THREE.Mesh(unitBoxGeo, cuMat);
  const overburdenMesh = new THREE.Mesh(unitBoxGeo, cuMat);
  const voidMesh = new THREE.Mesh(unitBoxGeo, voidMat);
  scene.add(
    bottomFillMesh, leftBodySideFillMesh, rightBodySideFillMesh,
    leftMouthSideFillMesh, rightMouthSideFillMesh, overburdenMesh, voidMesh
  );

  const MAX_OVERBURDEN = 1.1;
  const mouthH = cavityD * MOUTH_FRAC;
  const mouthY0 = -mouthH; // 孔口區下邊界（= 本體區上邊界）

  function updateViaFill(frame) {
    let frontY, mouthSideT, bodySideT, revealVoid;

    if (!isFailure()) {
      const t = Math.min(1, frame / fillPhaseFrames);
      const fF = Math.pow(smoothstep(t), 0.55); // 底部往上：前段快速推進
      const fS = Math.pow(smoothstep(t), 1.6);  // 側壁向內：起步較慢，逐漸追上
      frontY = cavityD * fF;
      mouthSideT = Hc * fS;
      bodySideT = Hc * fS; // 孔口區與本體區同速率，視覺上無縫銜接
      revealVoid = false;
    } else {
      const effFrame = Math.min(frame, sealFrame);
      const tSeal = sealFrame > 0 ? effFrame / sealFrame : 1;
      const ease = smoothstep(tSeal);
      frontY = cavityD * bottomMaxFrac * ease;         // 底部：遠離電解液，幾乎不動
      mouthSideT = Hc * ease;                           // 孔口區：快速增厚，於 sealFrame 剛好封閉
      bodySideT = Hc * bodySideMaxFrac * ease;          // 本體區：慢很多，留下大片未填空間
      revealVoid = frame >= sealFrame;
    }

    // 底部前緣（跨滿整個腔體寬度，由底部往上推進）
    // 注意：即使某方向 scale 收斂到 EPS，該 mesh 在另外兩個方向仍是全尺寸的平面，
    // 從特定視角（幾乎平行於收斂軸看過去）仍會露出整片實心色塊，因此還沒開始生長時
    // 必須額外用 visible=false 徹底隱藏，不能只靠極薄的 scale。
    const bottomH = Math.max(frontY, EPS);
    bottomFillMesh.visible = frontY > 1e-6;
    bottomFillMesh.scale.set(cavityW, bottomH, L);
    bottomFillMesh.position.set(0, -cavityD + frontY / 2, 0);

    // 本體區側壁（介於底部前緣頂面與孔口區下邊界之間，若已被底部前緣吃掉則收斂為極小值）
    const bodyYLow = -cavityD + frontY;
    const bodyYHigh = mouthY0;
    const bodySideH = Math.max(bodyYHigh - bodyYLow, EPS);
    const bodySideW = Math.max(bodySideT, EPS);
    const bodySideCenterY = (bodyYLow + bodyYHigh) / 2;
    const bodySideVisible = bodySideT > 1e-6;
    leftBodySideFillMesh.visible = bodySideVisible;
    leftBodySideFillMesh.scale.set(bodySideW, bodySideH, L);
    leftBodySideFillMesh.position.set(-Hc + bodySideT / 2, bodySideCenterY, 0);
    rightBodySideFillMesh.visible = bodySideVisible;
    rightBodySideFillMesh.scale.set(bodySideW, bodySideH, L);
    rightBodySideFillMesh.position.set(Hc - bodySideT / 2, bodySideCenterY, 0);

    // 孔口區側壁（介於本體區上邊界與開口之間，若底部前緣已推進到此區則同樣收斂）
    const mouthYLow = Math.max(mouthY0, bodyYLow);
    const mouthYHigh = 0;
    const mouthSideH = Math.max(mouthYHigh - mouthYLow, EPS);
    const mouthSideW = Math.max(mouthSideT, EPS);
    const mouthSideCenterY = (mouthYLow + mouthYHigh) / 2;
    const mouthSideVisible = mouthSideT > 1e-6;
    leftMouthSideFillMesh.visible = mouthSideVisible;
    leftMouthSideFillMesh.scale.set(mouthSideW, mouthSideH, L);
    leftMouthSideFillMesh.position.set(-Hc + mouthSideT / 2, mouthSideCenterY, 0);
    rightMouthSideFillMesh.visible = mouthSideVisible;
    rightMouthSideFillMesh.scale.set(mouthSideW, mouthSideH, L);
    rightMouthSideFillMesh.position.set(Hc - mouthSideT / 2, mouthSideCenterY, 0);

    // 過鍍層（僅成功情境會抵達此階段）
    if (!isFailure() && numFrames > fillPhaseFrames) {
      const tOver = Math.max(0, Math.min(1, (frame - fillPhaseFrames) / (numFrames - fillPhaseFrames)));
      const overH = MAX_OVERBURDEN * smoothstep(tOver);
      overburdenMesh.visible = overH > 1e-6;
      overburdenMesh.scale.set(W + 2 * SW, Math.max(overH, EPS), L);
      overburdenMesh.position.set(0, overH / 2, 0);
    } else {
      overburdenMesh.scale.set(EPS, EPS, EPS);
      overburdenMesh.position.set(0, -1000, 0);
    }

    // 空洞揭露（僅失敗情境，孔口封閉後永久困住的未填滿空間）
    if (revealVoid) {
      const voidW = Math.max(2 * (Hc - bodySideT), EPS);
      const voidH = Math.max(bodyYHigh - bodyYLow, EPS);
      const voidCenterY = (bodyYLow + bodyYHigh) / 2;
      voidMesh.scale.set(voidW, voidH, L);
      voidMesh.position.set(0, voidCenterY, 0);
    } else {
      voidMesh.scale.set(EPS, EPS, EPS);
      voidMesh.position.set(0, -1000, 0);
    }
  }

  function isFailure() {
    return activeKey === "failure";
  }

  // ---------------------------------------------------------------- 手刻拖曳旋轉 + 滾輪縮放相機控制
  const orbit = {
    theta: Math.PI * 0.22,
    phi: Math.PI * 0.38,
    radius: Math.max(innerW, innerD, totalH) * 1.9,
    target: new THREE.Vector3(0, ELECTROLYTE_H * 0.15 - totalBelowH * 0.32, 0),
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
      { max: 0.04, label: "① 初始結構" },
      { max: 0.35, label: "② 開始電鍍" },
      { max: 0.75, label: "③ 持續成長" },
      { max: 0.97, label: "④ 接近填滿" },
      { max: 1.01, label: "⑤ 完全填滿（過鍍層）" },
    ],
    failure: [
      { max: 0.15, label: "① 初始結構" },
      { max: 0.55, label: "② 孔口快速沉積" },
      { max: 0.9, label: "③ 孔口即將封閉" },
      { max: 1.01, label: "④ 孔口封閉・內部形成空洞" },
    ],
  };
  let STAGES = STAGES_BY_SCENARIO[activeKey];

  const stageLabelEl = document.getElementById("stageLabel");
  const stagePercentEl = document.getElementById("stagePercent");

  function updateStageText(frame) {
    const denom = isFailure() ? (sealFrame || 1) : fillPhaseFrames;
    const frac = Math.min(1, frame / denom);
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
    startHoldUntil: 0,
    recording: false,
    recordStopAt: 0,
  };

  function setFrame(f) {
    state.frame = Math.max(0, Math.min(numFrames - 1, f));
    slider.value = String(state.frame);
    updateStageText(state.frame);
    updateViaFill(state.frame);
    updateSeedLayer(state.frame);
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
      const scenarioLabel = activeKey === "success" ? "完全填滿" : "橋接失敗";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `單一孔洞電鍍填滿動畫_${scenarioLabel}.${ext}`;
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
      if (state.frame === 0 && !state.recording) {
        state.startHoldUntil = state.startHoldUntil || timestamp + 900;
      }

      if (state.frame === 0 && !state.recording && timestamp < state.startHoldUntil) {
        // 停留在空腔體的初始畫面，尚未開始沉積
      } else if (state.frame >= numFrames - 1) {
        state.startHoldUntil = 0;
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
        state.startHoldUntil = 0;
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
