window.VIA_DATA = {
  trenchWidth: 3.2,      // 溝槽開口內部寬度（含 liner 前的原始腔體寬度）
  trenchDepth: 9.0,      // 溝槽深度（含 liner 前的原始腔體深度）
  linerThickness: 0.32,  // 阻障層(Ta/TaN) liner 厚度
  shoulderWidth: 2.6,    // 溝槽兩側「肩部」基板寬度
  substrateBelow: 2.0,   // 溝槽底部以下的基板厚度

  scenarios: {
    success: {
      numFrames: 150,        // 動畫總影格數
      fillPhaseFrames: 128,  // 前 fillPhaseFrames 影格為「填滿溝槽」階段，之後為「過鍍層增厚」階段
    },
    failure: {
      numFrames: 60,         // 動畫總影格數（封閉後持續保持顯示空洞）
      sealFrame: 14,         // 孔口（開口附近）完全橋接封閉的影格
      mouthFrac: 0.22,       // 孔口區佔溝槽深度的比例，此區側壁增厚速度遠快於下方本體
      bodySideMaxFrac: 0.35, // 封閉當下，本體區側壁只增厚到此比例（相對於半寬）
      bottomMaxFrac: 0.12,   // 封閉當下，底部只往上長到此比例（相對於腔體深度）
    },
  },
};
