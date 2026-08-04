(() => {
  const D = window.VIA_DATA;
  const {
    trenchWidth: W, trenchDepth: DEPTH, linerThickness,
    shoulderWidth: SW, substrateBelow,
  } = D;

  const EPS = 0.0001;

  const cavityW = W - 2 * linerThickness;
  const cavityD = DEPTH;
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

  // ---------------------------------------------------------------- Canvas2D 基本設置
  const canvas = document.getElementById("simCanvas");
  const DISPLAY_W = 640, DISPLAY_H = 560;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(DISPLAY_W * dpr);
  canvas.height = Math.round(DISPLAY_H * dpr);
  canvas.style.width = DISPLAY_W + "px";
  canvas.style.height = DISPLAY_H + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // ---------------------------------------------------------------- 顏色（沿用圖例色彩）
  const siColor = 0x6b7178;
  const barrierColor = 0x5c7290;
  const copperColor = 0xc8763c;
  const overburdenColor = 0xc8763c;
  const ionColor = 0xe0925a;
  const fieldLineColor = 0x4f8fd8;
  const voidColor = 0xb85a5a;

  function toRgb(hex) {
    return `rgb(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255})`;
  }
  function darken(hex, amt) {
    const r = Math.round(((hex >> 16) & 255) * (1 - amt));
    const g = Math.round(((hex >> 8) & 255) * (1 - amt));
    const b = Math.round((hex & 255) * (1 - amt));
    return `rgb(${r},${g},${b})`;
  }
  function lighten(hex, amt) {
    const r = Math.round(((hex >> 16) & 255) * (1 - amt) + 255 * amt);
    const g = Math.round(((hex >> 8) & 255) * (1 - amt) + 255 * amt);
    const b = Math.round((hex & 255) * (1 - amt) + 255 * amt);
    return `rgb(${r},${g},${b})`;
  }

  // ---------------------------------------------------------------- 場景整體尺寸（模型座標，單位與 via-data.js 一致）
  const structBottomY = -(DEPTH + substrateBelow);
  const ELECTROLYTE_H = (DEPTH + substrateBelow) * 0.33;
  const electrolyteTopY = ELECTROLYTE_H;

  const innerW = (W + 2 * SW) + 1.0;
  const baseT = 0.3;
  const glassTop = electrolyteTopY + 0.3;
  const glassBottom = structBottomY - baseT;
  const glassW = innerW + 0.4;
  const totalH = glassTop - glassBottom;

  // ---------------------------------------------------------------- 模型座標 → 畫面像素座標
  const PAD = 24;
  const scale = Math.min((DISPLAY_W - PAD * 2) / glassW, (DISPLAY_H - PAD * 2) / totalH);
  const vPad = (DISPLAY_H - totalH * scale) / 2;
  const originX = DISPLAY_W / 2;

  function worldToPx(x, y) {
    return { x: originX + x * scale, y: vPad + (glassTop - y) * scale };
  }

  function fillWorldRect(cx, cy, w, h, fillColor, strokeColor) {
    const p = worldToPx(cx - w / 2, cy + h / 2);
    const pw = w * scale, ph = h * scale;
    ctx.fillStyle = fillColor;
    ctx.fillRect(p.x, p.y, pw, ph);
    if (strokeColor) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, pw, ph);
    }
  }

  // 材質色塊繪製：圓角矩形 + 由亮到暗的縱向漸層，corners 只在「確定完全暴露在外」的角落傳入非 0
  // 半徑（世界座標單位），彼此貼合的內部邊界一律維持直角，避免出現縫隙。
  const CORNER_R = 0.34;
  function fillWorldRoundRect(cx, cy, w, h, colorHex, corners, noStroke, sharedFill) {
    corners = corners || {};
    const p = worldToPx(cx - w / 2, cy + h / 2);
    const pw = w * scale, ph = h * scale;
    const maxR = Math.min(pw, ph) / 2;
    const rTL = Math.min((corners.tl || 0) * scale, maxR);
    const rTR = Math.min((corners.tr || 0) * scale, maxR);
    const rBR = Math.min((corners.br || 0) * scale, maxR);
    const rBL = Math.min((corners.bl || 0) * scale, maxR);
    const x = p.x, y = p.y;

    ctx.beginPath();
    ctx.moveTo(x + rTL, y);
    ctx.lineTo(x + pw - rTR, y);
    if (rTR) ctx.arcTo(x + pw, y, x + pw, y + rTR, rTR);
    ctx.lineTo(x + pw, y + ph - rBR);
    if (rBR) ctx.arcTo(x + pw, y + ph, x + pw - rBR, y + ph, rBR);
    ctx.lineTo(x + rBL, y + ph);
    if (rBL) ctx.arcTo(x, y + ph, x, y + ph - rBL, rBL);
    ctx.lineTo(x, y + rTL);
    if (rTL) ctx.arcTo(x, y, x + rTL, y, rTL);
    ctx.closePath();

    let g = sharedFill;
    if (!g) {
      g = ctx.createLinearGradient(x, y, x, y + ph);
      g.addColorStop(0, lighten(colorHex, 0.2));
      g.addColorStop(0.5, toRgb(colorHex));
      g.addColorStop(1, darken(colorHex, 0.2));
    }
    ctx.fillStyle = g;
    ctx.fill();

    if (!noStroke) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = darken(colorHex, 0.25);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- 電解液 + 離子
  const ION_COUNT = 16;
  const ionR = Hc * 0.14;
  const ions = [];
  for (let i = 0; i < ION_COUNT; i++) {
    ions.push({
      x: (Math.random() - 0.5) * innerW * 0.78,
      y: electrolyteTopY,
      phase: Math.random(),
      speed: 0.5 + Math.random() * 0.3,
    });
  }

  // 目前銅填充前緣的 y 座標（離子若要繼續往下流，最深只能流到這裡，象徵撞上已沉積的銅面）
  function currentFillFrontY() {
    return -cavityD + lastFrontY;
  }

  // 目前孔口仍然開放（尚未被側壁銅層填滿）的半寬，隨側壁增厚而收窄，收窄到 0 代表已封閉
  function currentOpenHalfW() {
    return Math.max(Hc - Math.max(lastBodySideT, lastMouthSideT), 0);
  }

  function updateIons(tSec) {
    const openHalfW = currentOpenHalfW();
    const floorY = currentFillFrontY();
    for (const ion of ions) {
      const localT = (tSec * ion.speed + ion.phase) % 1;
      const inChannel = openHalfW > ionR * 1.4 && Math.abs(ion.x) < openHalfW - ionR * 0.6;
      const topY = electrolyteTopY * 0.94;
      const bottomY = inChannel ? Math.max(floorY + Hc * 0.12, floorY) : ELECTROLYTE_H * 0.06;
      ion.y = topY - localT * (topY - bottomY);
    }
  }

  function drawIons() {
    ctx.fillStyle = toRgb(ionColor);
    for (const ion of ions) {
      const p = worldToPx(ion.x, ion.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ionR * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- 電場線（虛線）與電流方向箭頭
  const FIELD_XS = [-Hc * 0.85, 0, Hc * 0.85];
  const fieldYTop = electrolyteTopY * 0.96;
  const fieldYBot = 0.45;

  function drawFieldLines() {
    ctx.save();
    ctx.strokeStyle = toRgb(fieldLineColor);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    for (const fx of FIELD_XS) {
      const top = worldToPx(fx, fieldYTop);
      const bot = worldToPx(fx, fieldYBot);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = toRgb(fieldLineColor);
    ctx.globalAlpha = 0.9;
    const aw = Hc * 0.18 * scale, ah = Hc * 0.32 * scale;
    for (const fx of FIELD_XS) {
      const tip = worldToPx(fx, fieldYBot);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y + ah * 0.5);
      ctx.lineTo(tip.x - aw, tip.y - ah * 0.5);
      ctx.lineTo(tip.x + aw, tip.y - ah * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 玻璃缸 + 電解液
  function drawTank() {
    fillWorldRect(0, (glassTop + glassBottom) / 2, glassW, glassTop - glassBottom, "rgba(191,224,245,0.14)", "rgba(140,182,214,0.55)");
  }
  function drawElectrolyte() {
    fillWorldRect(0, electrolyteTopY / 2, innerW, ELECTROLYTE_H, "rgba(143,208,242,0.34)", null);
  }

  // ---------------------------------------------------------------- 基板（矽，U 形溝槽）
  const totalBelowH = DEPTH + substrateBelow;
  const shoulderRects = [
    { cx: -(W / 2 + SW / 2), cy: -totalBelowH / 2, w: SW, h: totalBelowH },
    { cx: W / 2 + SW / 2, cy: -totalBelowH / 2, w: SW, h: totalBelowH },
  ];
  const rightShoulderPos = { x: W / 2 + SW / 2, y: -totalBelowH / 2 };
  const bottomFloorRect = { cx: 0, cy: -(DEPTH + substrateBelow / 2) + linerThickness / 2, w: W, h: substrateBelow + linerThickness };

  // ---------------------------------------------------------------- Liner：阻障層(Ta/TaN)，直接鋪滿整個 liner 厚度
  const linerRects = [
    { cx: -W / 2 + linerThickness / 2, cy: -DEPTH / 2, w: linerThickness, h: DEPTH },
    { cx: W / 2 - linerThickness / 2, cy: -DEPTH / 2, w: linerThickness, h: DEPTH },
    { cx: 0, cy: -DEPTH + linerThickness / 2, w: W, h: linerThickness },
  ];
  const rightLinerX = W / 2 - linerThickness / 2; // 右側牆 x 座標，作為指引線標籤錨點

  // ---------------------------------------------------------------- 銅填充（解析式生長模型）
  //
  // 溝槽垂直方向分成「孔口區」（開口附近，y ∈ [-mouthH, 0]）與「本體區」（y ∈ [-cavityD, -mouthH]）。
  // 成功情境：孔口區與本體區側壁以相同速率增厚，視覺上無縫銜接，等同於單一連續側壁生長。
  // 失敗情境（橋接）：孔口區側壁增厚速率遠快於本體區，於 sealFrame 搶先在開口處會合封閉，
  // 之後（本體區與底部因電解液已無法進入而停止生長）永久困住一段未填滿的空洞。
  const MAX_OVERBURDEN = 1.1;
  const TOP_FILM_MAX = 0.26; // 肩部頂面薄銅層在「填孔階段」內能長到的最大厚度，之後由過鍍層接手繼續增厚
  const mouthH = cavityD * MOUTH_FRAC;
  const mouthY0 = -mouthH; // 孔口區下邊界（= 本體區上邊界）

  let lastFrontY = 0, lastBodySideT = 0, lastMouthSideT = 0; // 供「銅 Cu」指引線標籤錨點與離子流動判斷使用

  // 銅填充的成長參數（單一多邊形外框，見 buildCopperOutline，取代舊版逐一矩形拼接的 fillState）
  const copperParams = {
    frontY: 0, bodySideT: 0, mouthSideT: 0, filmH: 0, overH: null,
    revealVoid: false, voidW: 0, voidH: 0, voidCenterY: 0,
  };

  function updateViaFill(frame) {
    let frontY, mouthSideT, bodySideT, revealVoid, topFrac;

    if (!isFailure()) {
      const t = Math.min(1, frame / fillPhaseFrames);
      const fF = Math.pow(smoothstep(t), 0.55); // 底部往上：前段快速推進
      const fS = Math.pow(smoothstep(t), 1.6);  // 側壁向內：起步較慢，逐漸追上
      frontY = cavityD * fF;
      mouthSideT = Hc * fS;
      bodySideT = Hc * fS; // 孔口區與本體區同速率，視覺上無縫銜接
      revealVoid = false;
      // 頂面（肩部）直接暴露在電解液中，鍍覆幾乎與底部同時開始，走比孔口側壁快得多的曲線，
      // 不等側壁追上才出現，一開始就能看到一層銅沿著整個頂面與孔口邊緣同步變厚、連成一體。
      topFrac = Math.pow(smoothstep(t), 0.4);
    } else {
      const effFrame = Math.min(frame, sealFrame);
      const tSeal = sealFrame > 0 ? effFrame / sealFrame : 1;
      const ease = smoothstep(tSeal);
      frontY = cavityD * bottomMaxFrac * ease;         // 底部：遠離電解液，幾乎不動
      mouthSideT = Hc * ease;                           // 孔口區：快速增厚，於 sealFrame 剛好封閉
      bodySideT = Hc * bodySideMaxFrac * ease;          // 本體區：慢很多，留下大片未填空間
      revealVoid = frame >= sealFrame;
      topFrac = ease;
    }

    lastFrontY = frontY;
    lastBodySideT = bodySideT;
    lastMouthSideT = mouthSideT;

    copperParams.frontY = frontY;
    copperParams.bodySideT = bodySideT;
    copperParams.mouthSideT = mouthSideT;
    copperParams.filmH = Math.max(TOP_FILM_MAX * topFrac, 0);

    // 過鍍層（僅成功情境會抵達此階段）：孔口實際封閉的瞬間，直接接續肩部薄銅層已長到的厚度
    // （TOP_FILM_MAX）繼續往上增厚並橫跨整個開口，銜接處厚度連續、不會有突然冒出的落差。
    if (!isFailure() && frame > fillPhaseFrames && numFrames > fillPhaseFrames) {
      const tOver = Math.max(0, Math.min(1, (frame - fillPhaseFrames) / (numFrames - fillPhaseFrames)));
      const bulkH = (MAX_OVERBURDEN - TOP_FILM_MAX) * smoothstep(tOver);
      copperParams.overH = TOP_FILM_MAX + bulkH;
    } else {
      copperParams.overH = null;
    }

    // 空洞揭露（僅失敗情境，孔口封閉後永久困住的未填滿空間）
    copperParams.revealVoid = revealVoid;
    if (revealVoid) {
      const bodyYLow = -cavityD + frontY;
      const bodyYHigh = mouthY0;
      copperParams.voidW = Math.max(2 * (Hc - bodySideT), EPS);
      copperParams.voidH = Math.max(bodyYHigh - bodyYLow, EPS);
      copperParams.voidCenterY = (bodyYLow + bodyYHigh) / 2;
    }
  }

  function isFailure() {
    return activeKey === "failure";
  }

  function buildBaseCopperGradient() {
    const topY = (copperParams.overH != null && copperParams.overH > TOP_FILM_MAX) ? copperParams.overH : TOP_FILM_MAX;
    const pTop = worldToPx(0, topY);
    const pBottom = worldToPx(0, -cavityD);
    const g = ctx.createLinearGradient(0, pTop.y, 0, pBottom.y);
    g.addColorStop(0, lighten(copperColor, 0.1));
    g.addColorStop(0.5, toRgb(copperColor));
    g.addColorStop(1, darken(copperColor, 0.2));
    return g;
  }

  function buildBaseCopperOutline(p) {
    const yFloor = -cavityD;
    
    if (p.overH != null) {
      const currentTopY = Math.max(TOP_FILM_MAX, p.overH);
      return [[
        { x: 0, y: yFloor },
        { x: Hc, y: yFloor },
        { x: Hc, y: 0 },
        { x: W / 2 + SW, y: 0 },
        { x: W / 2 + SW, y: currentTopY },
        { x: -(W / 2 + SW), y: currentTopY },
        { x: -(W / 2 + SW), y: 0 },
        { x: -Hc, y: 0 },
        { x: -Hc, y: yFloor }
      ]];
    }

    const yBodyLow = Math.min(yFloor + p.frontY, 0);
    const yBodyHigh = Math.max(yBodyLow, mouthY0);
    const xBody = Hc - p.bodySideT;
    const xMouth = Hc - p.mouthSideT;
    const filmH = p.filmH;

    const right = [
      { x: 0, y: yFloor },
      { x: Hc, y: yFloor },
      { x: Hc, y: 0 },
      { x: W / 2 + SW, y: 0 },
      { x: W / 2 + SW, y: filmH },
      { x: xMouth, y: filmH },
      { x: xMouth, y: yBodyHigh },
      { x: xBody, y: yBodyHigh },
      { x: xBody, y: yBodyLow },
      { x: 0, y: yBodyLow },
    ];
    const left = right.slice(1).reverse().map((pt) => ({ x: -pt.x, y: pt.y }));
    return [right.concat(left)];
  }


  function paintCopperMass(outlinePts, sharedFill, strokeColor) {
    if (!outlinePts || outlinePts.length === 0) return;
    const polys = Array.isArray(outlinePts[0]) ? outlinePts : [outlinePts];
    
    ctx.beginPath();
    for (const poly of polys) {
      if (poly.length === 0) continue;
      const first = worldToPx(poly[0].x, poly[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < poly.length; i++) {
        const p = worldToPx(poly[i].x, poly[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = sharedFill;
    ctx.fill();
    if (strokeColor) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- 主要繪圖函式
  function paintSubstrate() {
    const yTop = 0;
    const yBot = -(DEPTH + substrateBelow);
    const xLOut = -(W / 2 + SW);
    const xROut = W / 2 + SW;
    const xLIn = -W / 2;
    const xRIn = W / 2;
    const yTrenchBot = -DEPTH;
    const r = CORNER_R * scale;

    const ptTL = worldToPx(xLOut, yTop);
    const ptTR = worldToPx(xROut, yTop);
    const ptBR = worldToPx(xROut, yBot);
    const ptBL = worldToPx(xLOut, yBot);
    
    const ptTLin = worldToPx(xLIn, yTop);
    const ptTRin = worldToPx(xRIn, yTop);
    const ptBLin = worldToPx(xLIn, yTrenchBot);
    const ptBRin = worldToPx(xRIn, yTrenchBot);

    ctx.beginPath();
    ctx.moveTo(ptTL.x + r, ptTL.y);
    ctx.lineTo(ptTLin.x, ptTLin.y);
    ctx.lineTo(ptBLin.x, ptBLin.y);
    ctx.lineTo(ptBRin.x, ptBRin.y);
    ctx.lineTo(ptTRin.x, ptTRin.y);
    ctx.lineTo(ptTR.x - r, ptTR.y);
    ctx.arcTo(ptTR.x, ptTR.y, ptTR.x, ptTR.y + r, r);
    ctx.lineTo(ptBR.x, ptBR.y - r);
    ctx.arcTo(ptBR.x, ptBR.y, ptBR.x - r, ptBR.y, r);
    ctx.lineTo(ptBL.x + r, ptBL.y);
    ctx.arcTo(ptBL.x, ptBL.y, ptBL.x, ptBL.y - r, r);
    ctx.lineTo(ptTL.x, ptTL.y + r);
    ctx.arcTo(ptTL.x, ptTL.y, ptTL.x + r, ptTL.y, r);
    ctx.closePath();

    const g = ctx.createLinearGradient(0, ptTL.y, 0, ptBL.y);
    g.addColorStop(0, lighten(siColor, 0.2));
    g.addColorStop(0.5, toRgb(siColor));
    g.addColorStop(1, darken(siColor, 0.2));

    ctx.fillStyle = g;
    ctx.fill();

    ctx.lineWidth = 1;
    ctx.strokeStyle = darken(siColor, 0.25);
    
    // Draw stroke for all borders EXCEPT the bottom of the trench (ptBLin to ptBRin)
    ctx.beginPath();
    ctx.moveTo(ptBRin.x, ptBRin.y);
    ctx.lineTo(ptTRin.x, ptTRin.y);
    ctx.lineTo(ptTR.x - r, ptTR.y);
    ctx.arcTo(ptTR.x, ptTR.y, ptTR.x, ptTR.y + r, r);
    ctx.lineTo(ptBR.x, ptBR.y - r);
    ctx.arcTo(ptBR.x, ptBR.y, ptBR.x - r, ptBR.y, r);
    ctx.lineTo(ptBL.x + r, ptBL.y);
    ctx.arcTo(ptBL.x, ptBL.y, ptBL.x, ptBL.y - r, r);
    ctx.lineTo(ptTL.x, ptTL.y + r);
    ctx.arcTo(ptTL.x, ptTL.y, ptTL.x + r, ptTL.y, r);
    ctx.lineTo(ptTLin.x, ptTLin.y);
    ctx.lineTo(ptBLin.x, ptBLin.y);
    ctx.stroke();
  }

  function paintBarrierLayer() {
    const yTop = 0;
    const yBotOut = -DEPTH;
    const xLOut = -W / 2;
    const xLIn = -W / 2 + linerThickness;
    const xRIn = W / 2 - linerThickness;
    const xROut = W / 2;
    
    const g = ctx.createLinearGradient(0, worldToPx(0, yTop).y, 0, worldToPx(0, yBotOut).y);
    g.addColorStop(0, lighten(barrierColor, 0.2));
    g.addColorStop(0.5, toRgb(barrierColor));
    g.addColorStop(1, darken(barrierColor, 0.2));

    ctx.fillStyle = g;
    ctx.lineWidth = 1;
    ctx.strokeStyle = darken(barrierColor, 0.25);

    // Left barrier
    ctx.beginPath();
    let p = worldToPx(xLOut, yTop); ctx.moveTo(p.x, p.y);
    p = worldToPx(xLIn, yTop); ctx.lineTo(p.x, p.y);
    p = worldToPx(xLIn, yBotOut); ctx.lineTo(p.x, p.y);
    p = worldToPx(xLOut, yBotOut); ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Right barrier
    ctx.beginPath();
    p = worldToPx(xRIn, yTop); ctx.moveTo(p.x, p.y);
    p = worldToPx(xROut, yTop); ctx.lineTo(p.x, p.y);
    p = worldToPx(xROut, yBotOut); ctx.lineTo(p.x, p.y);
    p = worldToPx(xRIn, yBotOut); ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function render() {
    ctx.clearRect(0, 0, DISPLAY_W, DISPLAY_H);

    drawTank();
    drawElectrolyte();
    drawFieldLines();
    drawIons();

    paintSubstrate();
    paintBarrierLayer();

    if (copperParams.frontY > EPS || copperParams.bodySideT > EPS || copperParams.mouthSideT > EPS || copperParams.overH != null) {
      const baseOutline = buildBaseCopperOutline(copperParams);
      paintCopperMass(baseOutline, buildBaseCopperGradient(), darken(copperColor, 0.25));
    }

    if (copperParams.revealVoid) {
      fillWorldRoundRect(0, copperParams.voidCenterY, copperParams.voidW, copperParams.voidH, voidColor, {});
    }
  }

  // ---------------------------------------------------------------- 指引線標籤（比照參考圖，標示各層材質）
  const labelLayer = document.getElementById("viaLabelLayer");

  const LABEL_OFFSETS = {
    si: { dx: 96, dy: 74 },
    barrier: { dx: 118, dy: 0 },
    cu: { dx: -78, dy: 60 },
    overburden: { dx: -14, dy: -96 },
  };

  function cuFillAnchor() {
    const y = -cavityD + Math.max(lastFrontY, Hc * 0.15) * 0.6;
    return { x: 0, y: Math.min(y, -EPS) };
  }
  function cuFillHasVisibleMass() {
    return lastFrontY > cavityD * 0.03 || lastBodySideT > Hc * 0.03;
  }

  const LABELS = [
    { key: "si", text: "SiO2", anchor: () => rightShoulderPos, visible: () => true },
    { key: "barrier", text: "阻障層 Ta/TaN", anchor: () => ({ x: rightLinerX, y: -DEPTH * 0.45 }), visible: () => true },
    { key: "cu", text: "銅 Cu", anchor: cuFillAnchor, visible: cuFillHasVisibleMass },
    { key: "overburden", text: "過鍍層 Overburden", anchor: () => ({ x: 0, y: copperParams.overH != null ? (TOP_FILM_MAX + copperParams.overH) / 2 : copperParams.filmH / 2 }), visible: () => !isFailure() && copperParams.overH != null && copperParams.overH > TOP_FILM_MAX + EPS },
  ];

  for (const lb of LABELS) {
    const el = document.createElement("div");
    el.className = "via-label";
    el.innerHTML =
      '<div class="via-label-dot"></div>' +
      '<div class="via-label-line"></div>' +
      `<div class="via-label-badge">${lb.text}</div>`;
    labelLayer.appendChild(el);
    lb.dotEl = el.querySelector(".via-label-dot");
    lb.lineEl = el.querySelector(".via-label-line");
    lb.badgeEl = el.querySelector(".via-label-badge");
  }

  const toggleLabelsBtn = document.getElementById("toggleLabelsBtn");

  function updateLabels() {
    const showLabels = toggleLabelsBtn ? toggleLabelsBtn.checked : false;
    for (const lb of LABELS) {
      if (!showLabels || !lb.visible()) {
        lb.dotEl.style.display = "none";
        lb.lineEl.style.display = "none";
        lb.badgeEl.style.display = "none";
        continue;
      }
      lb.dotEl.style.display = "";
      lb.lineEl.style.display = "";
      lb.badgeEl.style.display = "";

      const p = lb.anchor();
      const { x: px, y: py } = worldToPx(p.x, p.y);

      const off = LABEL_OFFSETS[lb.key];
      const bx = px + off.dx;
      const by = py + off.dy;

      lb.dotEl.style.transform = `translate(${px}px, ${py}px)`;
      lb.badgeEl.style.transform = `translate(${bx}px, ${by}px) translate(-50%, -50%)`;

      const dx = bx - px, dy = by - py;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      lb.lineEl.style.width = `${len}px`;
      lb.lineEl.style.transform = `translate(${px}px, ${py}px) rotate(${ang}rad)`;
    }
  }

  // ---------------------------------------------------------------- 階段文字
  const STAGE_BADGE_CHARS = ["①", "②", "③", "④", "⑤"];
  const STAGES_BY_SCENARIO = {
    success: [
      { max: 0.04, n: 1, label: "初始結構" },
      { max: 0.35, n: 2, label: "開始電鍍" },
      { max: 0.75, n: 3, label: "持續成長" },
      { max: 0.97, n: 4, label: "接近填滿" },
      { max: 1.01, n: 5, label: "完全填滿（過鍍層）" },
    ],
    failure: [
      { max: 0.15, n: 1, label: "初始結構" },
      { max: 0.55, n: 2, label: "孔口快速沉積" },
      { max: 0.9, n: 3, label: "孔口即將封閉" },
      { max: 1.01, n: 4, label: "孔口封閉・內部形成空洞" },
    ],
  };
  let STAGES = STAGES_BY_SCENARIO[activeKey];

  const stageBadgeEl = document.getElementById("stageBadge");
  const stageLabelEl = document.getElementById("stageLabel");
  const stagePercentEl = document.getElementById("stagePercent");

  function updateStageText(frame) {
    const denom = isFailure() ? (sealFrame || 1) : fillPhaseFrames;
    const frac = Math.min(1, frame / denom);
    const stage = STAGES.find((s) => frac <= s.max) || STAGES[STAGES.length - 1];
    stageBadgeEl.textContent = STAGE_BADGE_CHARS[stage.n - 1] || String(stage.n);
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

  if (toggleLabelsBtn) {
    toggleLabelsBtn.addEventListener("change", () => {
      updateLabels();
    });
  }

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
    render();
    updateLabels();

    requestAnimationFrame(tick);
  }

  setFrame(0);
  requestAnimationFrame(tick);
})();
