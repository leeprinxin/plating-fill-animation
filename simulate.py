"""
多孔結構電鍍填滿模擬。

在一個矩形孔隙床（六角緊密堆疊的圓形顆粒）上方視為電解液本體，
以 Laplace 方程 (∇²φ=0) 描述離子濃度/電位場，φ=1 為電解液本體邊界、
φ=0 為已沉積金屬表面（擴散限制、完美吸收邊界），顆粒表面與容器左右
/底部邊界為零通量邊界。每個巨集步驟重新求解一次 φ 場，並依候選前沿
格點的 φ 值加權隨機挑選一批格點轉為「已沉積」，模擬離子通量較大處
（管道較寬、離電解液較近）優先鍍滿、進而可能提前封閉窄孔道並困住
內部空洞的現象。

輸出：只記錄每個孔隙格點「在第幾影格被沉積」(deposit_time)，網頁端
只需比較 deposit_time <= 目前影格 即可還原任意時間點的畫面，不必逐格
存整張棋盤，也能自由拖曳進度。
"""

import json
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------- 幾何設定
NX = 150                 # 孔隙床寬度（格點數）
BED_ROWS = 220           # 孔隙床高度（格點數）
ELECTROLYTE_ROWS = 60    # 求解用的電解液緩衝區高度（不輸出，只用來給 φ=1 邊界一個過渡空間）
NY = ELECTROLYTE_ROWS + BED_ROWS

PARTICLE_R = 13.0                      # 顆粒晶格半徑（決定顆粒中心排列間距）
PARTICLE_DRAW_R = PARTICLE_R * 0.90    # 實際畫出的顆粒半徑，比晶格半徑小一些，
                                        # 讓相鄰顆粒間留下真正連通的孔隙通道
                                        # （完全相切的圓堆疊在網格上幾乎不連通）
ROW_DX = PARTICLE_R * 2.0              # 同一列顆粒中心水平間距（相切晶格）
ROW_DY = PARTICLE_R * np.sqrt(3.0)     # 相鄰列垂直間距（六角緊密堆疊晶格）

# ---------------------------------------------------------------- 成長參數
ETA = 1.35            # 前沿成長機率對 φ 的加權指數，越大越容易在「暢通」孔道搶先生長
TARGET_FRAMES = 170   # 期望的動畫影格數（實際會依可用孔隙格數微調）
WARM_ITERS = 22       # 每個巨集步驟的 Jacobi 暖啟動迭代次數
COLD_ITERS = 260      # 第一次求解（尚無暖啟動初始值）的迭代次數
MAX_STEPS = 4000       # 安全上限，避免死鎖
SEED = 7

# ---------------------------------------------------------------- 橋接失敗情境參數
# 電流密度分布過高時，孔口（最靠近電解液、φ 最高處）會搶先快速沉積並封閉，
# 使內部孔隙來不及填滿就被永久困住（無法再透過開放孔隙連通回電解液）。
# 比起成功情境需要更陡峭的加權（ETA 更大）與更細的步進（每步成長格數更小），
# 否則孔口會在一步內就整排封死，來不及形成手指狀深入通道。
BRIDGE_ETA = 10.0
BRIDGE_GROWTH_PER_STEP = 6
BRIDGE_MAX_STEPS = 4000


def build_particle_mask():
    """回傳孔隙床區域（含上方緩衝）的顆粒(障礙物) mask，形狀 (NY, NX)，
    以及每顆顆粒的圓心座標列表（給網頁端畫立體光影用的向量圓）。
    """
    yy, xx = np.mgrid[0:NY, 0:NX].astype(np.float64)
    mask = np.zeros((NY, NX), dtype=bool)
    centers = []

    row = 0
    y = ELECTROLYTE_ROWS + PARTICLE_R * 0.55
    while y < NY - PARTICLE_R * 0.15:
        offset = 0.0 if row % 2 == 0 else PARTICLE_R
        x = -PARTICLE_R * 0.5 + offset
        while x < NX + PARTICLE_R:
            mask |= (xx - x) ** 2 + (yy - y) ** 2 <= PARTICLE_DRAW_R ** 2
            centers.append((x, y))
            x += ROW_DX
        y += ROW_DY
        row += 1

    return mask, centers


def laplace_relax(phi, valid, top_fixed, deposited, iters):
    """在 valid(=非顆粒) 區域上做 Jacobi 鬆弛求解 Laplace 方程。

    top_fixed 格點固定 φ=1，deposited 格點固定 φ=0，
    顆粒(非 valid) 格點不參與鄰居平均，達成零通量(Neumann)邊界。
    容器左右/底部邊界以 edge-padding 達成鏡射(零梯度)邊界。
    """
    v = valid.astype(np.float64)
    phi = phi.copy()
    phi[top_fixed] = 1.0
    phi[deposited] = 0.0

    for _ in range(iters):
        p_pad = np.pad(phi, 1, mode="edge")
        v_pad = np.pad(v, 1, mode="edge")

        num = (
            p_pad[:-2, 1:-1] * v_pad[:-2, 1:-1]
            + p_pad[2:, 1:-1] * v_pad[2:, 1:-1]
            + p_pad[1:-1, :-2] * v_pad[1:-1, :-2]
            + p_pad[1:-1, 2:] * v_pad[1:-1, 2:]
        )
        den = (
            v_pad[:-2, 1:-1]
            + v_pad[2:, 1:-1]
            + v_pad[1:-1, :-2]
            + v_pad[1:-1, 2:]
        )
        den_safe = np.where(den > 0, den, 1.0)
        updated = num / den_safe

        phi = np.where(valid, updated, phi)
        phi[top_fixed] = 1.0
        phi[deposited] = 0.0

    return phi


def growth_candidates(valid, deposited):
    """回傳與已沉積區相鄰、且尚未沉積的孔隙格點 mask。"""
    neighbor_deposited = np.zeros_like(deposited)
    neighbor_deposited[1:, :] |= deposited[:-1, :]
    neighbor_deposited[:-1, :] |= deposited[1:, :]
    neighbor_deposited[:, 1:] |= deposited[:, :-1]
    neighbor_deposited[:, :-1] |= deposited[:, 1:]
    return valid & ~deposited & neighbor_deposited


def reachable_open(valid, deposited, electrolyte_rows):
    """回傳目前仍能透過「開放孔隙」連通回電解液本體的格點 mask。

    離子只能在液相（尚未沉積）孔道中擴散，金屬固相不導通，因此一旦某段
    孔隙被沉積層從四面封閉、不再有開放路徑通回電解液本體，就永久成為
    無法再參與生長的空洞。電解液本體與尚未封閉的孔口列（第一列孔隙床）
    視為直接與電解液接觸，其餘格點需靠開放孔隙逐格擴散連通。
    """
    open_mask = valid & ~deposited
    reachable = np.zeros_like(open_mask)
    reachable[: electrolyte_rows + 1, :] = open_mask[: electrolyte_rows + 1, :]
    while True:
        dil = reachable.copy()
        dil[1:, :] |= reachable[:-1, :]
        dil[:-1, :] |= reachable[1:, :]
        dil[:, 1:] |= reachable[:, :-1]
        dil[:, :-1] |= reachable[:, 1:]
        new_reachable = dil & open_mask
        if np.array_equal(new_reachable, reachable):
            break
        reachable = new_reachable
    return reachable


def run_bridging_simulation():
    """模擬「橋接失敗」情境：孔口因電流集中提前封閉，內部孔隙形成永久空洞。

    與 run_simulation() 共用同一套確定性顆粒幾何，差異僅在成長候選集必須
    額外滿足 reachable_open()（仍連通電解液），且用更陡峭的 ETA 與更細的
    每步成長量，讓頂部孔口能在深層孔隙填滿前就搶先封閉。
    """
    rng = np.random.default_rng(SEED)

    particle_mask, particle_centers = build_particle_mask()
    valid = ~particle_mask

    total_pore_cells = int(valid[ELECTROLYTE_ROWS:, :].sum())

    top_fixed = np.zeros((NY, NX), dtype=bool)
    top_fixed[0, :] = True

    deposited = np.zeros((NY, NX), dtype=bool)
    deposited[ELECTROLYTE_ROWS - 1, :] = True

    phi = np.full((NY, NX), 0.5, dtype=np.float64)
    phi = laplace_relax(phi, valid, top_fixed, deposited, COLD_ITERS)

    deposit_time = np.full((NY, NX), -1, dtype=np.int32)
    deposit_time[particle_mask] = -1
    fill_history = []

    frame = 0
    deposited_pore_count = 0
    while True:
        reach = reachable_open(valid, deposited, ELECTROLYTE_ROWS)
        candidates = growth_candidates(reach, deposited)
        candidates[:ELECTROLYTE_ROWS, :] = False
        cand_idx = np.flatnonzero(candidates)
        if cand_idx.size == 0:
            break

        weights = (phi.ravel()[cand_idx] + 1e-3) ** BRIDGE_ETA
        weight_sum = weights.sum()
        if weight_sum <= 0:
            weights = np.ones_like(weights)
            weight_sum = weights.sum()
        probs = weights / weight_sum

        batch = min(BRIDGE_GROWTH_PER_STEP, cand_idx.size)
        chosen = rng.choice(cand_idx, size=batch, replace=False, p=probs)

        deposited.ravel()[chosen] = True
        deposit_time.ravel()[chosen] = frame
        deposited_pore_count += batch
        fill_history.append(deposited_pore_count / total_pore_cells)

        phi = laplace_relax(phi, valid, top_fixed, deposited, WARM_ITERS)

        frame += 1
        if frame >= BRIDGE_MAX_STEPS:
            break

    num_frames = frame

    bed_pore_open = valid[ELECTROLYTE_ROWS:, :] & (deposit_time[ELECTROLYTE_ROWS:, :] < 0)
    void_time = num_frames + 1
    dt_bed = deposit_time[ELECTROLYTE_ROWS:, :].copy()
    dt_bed[bed_pore_open] = void_time

    return {
        "num_frames": num_frames,
        "deposit_time": dt_bed,
        "fill_history": fill_history,
    }


def run_simulation():
    rng = np.random.default_rng(SEED)

    particle_mask, particle_centers = build_particle_mask()
    valid = ~particle_mask  # 非顆粒格點（電解液 + 孔隙），可參與場求解

    total_pore_cells = int(valid[ELECTROLYTE_ROWS:, :].sum())
    growth_per_step = max(1, total_pore_cells // TARGET_FRAMES)

    top_fixed = np.zeros((NY, NX), dtype=bool)
    top_fixed[0, :] = True

    deposited = np.zeros((NY, NX), dtype=bool)
    # 電解液緩衝區最下一列視為「種子層 / 陰極面」，永遠是 φ=0 的沉積邊界，
    # 但不算進輸出資料（只有 ELECTROLYTE_ROWS 之後的孔隙床才輸出）。
    deposited[ELECTROLYTE_ROWS - 1, :] = True

    phi = np.full((NY, NX), 0.5, dtype=np.float64)
    phi = laplace_relax(phi, valid, top_fixed, deposited, COLD_ITERS)

    deposit_time = np.full((NY, NX), -1, dtype=np.int32)
    deposit_time[particle_mask] = -1
    fill_history = []

    frame = 0
    deposited_pore_count = 0
    while True:
        candidates = growth_candidates(valid, deposited)
        # 電解液緩衝區內的格點不算孔隙床，不需要成長（它們本來就已算 valid&open，
        # 但緩衝區只有一列會被種子沉積，其餘緩衝區格點應保持開放供場延伸）
        candidates[:ELECTROLYTE_ROWS, :] = False
        cand_idx = np.flatnonzero(candidates)
        if cand_idx.size == 0:
            break

        weights = (phi.ravel()[cand_idx] + 1e-3) ** ETA
        weight_sum = weights.sum()
        if weight_sum <= 0:
            weights = np.ones_like(weights)
            weight_sum = weights.sum()
        probs = weights / weight_sum

        batch = min(growth_per_step, cand_idx.size)
        chosen = rng.choice(cand_idx, size=batch, replace=False, p=probs)

        deposited.ravel()[chosen] = True
        deposit_time.ravel()[chosen] = frame
        deposited_pore_count += batch
        fill_history.append(deposited_pore_count / total_pore_cells)

        phi = laplace_relax(phi, valid, top_fixed, deposited, WARM_ITERS)

        frame += 1
        if frame >= MAX_STEPS:
            break

    num_frames = frame

    # 模擬結束仍未被沉積的孔隙格點＝被提前封閉困住的內部空洞，
    # 標記成一個 > num_frames 的值，代表「永遠不會被填滿」。
    bed_pore_open = valid[ELECTROLYTE_ROWS:, :] & (deposit_time[ELECTROLYTE_ROWS:, :] < 0)
    void_time = num_frames + 1
    dt_bed = deposit_time[ELECTROLYTE_ROWS:, :].copy()
    dt_bed[bed_pore_open] = void_time

    particle_bed = particle_mask[ELECTROLYTE_ROWS:, :]

    # 只保留與孔隙床區域有交集的顆粒圓心，座標轉成床區域的局部座標（y=0 為床頂）。
    margin = PARTICLE_R * 1.05
    bed_centers = [
        (cx, cy - ELECTROLYTE_ROWS)
        for (cx, cy) in particle_centers
        if -margin <= cx <= NX + margin and -margin <= (cy - ELECTROLYTE_ROWS) <= BED_ROWS + margin
    ]

    return {
        "nx": NX,
        "ny": BED_ROWS,
        "particle_mask": particle_bed,
        "particle_centers": bed_centers,
        "particle_radius": PARTICLE_DRAW_R,
        "deposit_time": dt_bed,
        "num_frames": num_frames,
        "fill_history": fill_history,
    }


def export_web_data(success, failure, out_path: Path):
    data = {
        "nx": success["nx"],
        "ny": success["ny"],
        "particleMask": success["particle_mask"].astype(np.uint8).flatten().tolist(),
        "particleCenters": [[round(cx, 2), round(cy, 2)] for cx, cy in success["particle_centers"]],
        "particleRadius": round(float(success["particle_radius"]), 2),
        "scenarios": {
            "success": {
                "numFrames": success["num_frames"],
                "depositTime": success["deposit_time"].astype(np.int32).flatten().tolist(),
                "fillHistory": [round(float(v), 4) for v in success["fill_history"]],
            },
            "failure": {
                "numFrames": failure["num_frames"],
                "depositTime": failure["deposit_time"].astype(np.int32).flatten().tolist(),
                "fillHistory": [round(float(v), 4) for v in failure["fill_history"]],
            },
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        f.write("window.SIM_DATA = ")
        json.dump(data, f, separators=(",", ":"))
        f.write(";\n")


def main():
    success = run_simulation()
    filled = success["fill_history"][-1] if success["fill_history"] else 0.0
    print(f"[success] frames = {success['num_frames']}, final pore fill = {filled:.2%}")

    failure = run_bridging_simulation()
    f_filled = failure["fill_history"][-1] if failure["fill_history"] else 0.0
    void_frac = 1.0 - f_filled
    print(f"[failure] frames = {failure['num_frames']}, final pore fill = {f_filled:.2%}, void = {void_frac:.2%}")

    out_path = Path(__file__).parent / "web" / "data.js"
    export_web_data(success, failure, out_path)
    print(f"exported -> {out_path}")


if __name__ == "__main__":
    main()
