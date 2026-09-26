/* ============================================================
   MONSTER WAR - BATTLE FX (技のエフェクト)

   battle.js から「技で何が起きたか」(fxデータ)を受け取り、
   画面上の演出だけを担当する。ゲームの状態には一切触れない。

   演出の種類
   ・シェイク       画面全体を揺らす(強さ3段階)
   ・ネガポジ       画面の色を一瞬反転させる(重い一撃・爆発・撃破)
   ・ズームパンチ   盤面が一瞬ぐっと寄る
   ・集中線         命中したマスに向かって漫画の集中線
   ・擬音           「ドカッ!!」などの文字(SHOW_DECORATION_TEXT で切り替え。現在OFF)
   ・ダメージ数字   -32 / +20 / MISS / 無効!! など(SHOW_DAMAGE_NUMBERS で切り替え)
   ・ビーム/斬撃/衝撃波/粒子/光の柱/シールド …技の種類ごとの演出
   ・ノックバック   押し出されたコマが滑って移動する
   ・効果音         ブラウザで合成する簡単な打撃音(素材ファイル不要)

   演出の強さはヘッダーの「FX」ボタンで 派手 / 控えめ / OFF を切り替えられる。
   (控えめ: ネガポジ・強いシェイクなし。OSの「視差効果を減らす」設定でも控えめになる)
============================================================ */

(function (root) {
"use strict";

/* ---------- 設定 ---------- */

/*
 * 擬音(ドカッ!!等)や「REVIVE!!」「撃破!!」などの飾り文字を出すか。
 * エフェクトだけにするため false。
 */
const SHOW_DECORATION_TEXT = false;

/*
 * ダメージ・回復の数字、MISS/無効 の表示を出すか。
 * 数字も要らなければ false にする。
 */
const SHOW_DAMAGE_NUMBERS = true;

// 重い一撃の判定: 威力がこれ以上の技 / 最大HPに対してこの割合以上のダメージ
const HEAVY_POWER = 500;
const HEAVY_DAMAGE_RATIO = 0.5;

/*
 * 光の強さ。眩しすぎる場合はここを下げる。
 *   NEGAPOSI_TIMES      … ネガポジ(色反転)の回数。0でネガポジなし
 *   NEGAPOSI_ONLY_ON_KILL … trueなら撃破・自爆のときだけネガポジ
 *   FLASH_OPACITY       … 白/金色の全画面フラッシュの濃さ(0〜1)
 */
const NEGAPOSI_TIMES = 1;
const NEGAPOSI_ONLY_ON_KILL = true;
const FLASH_OPACITY = 0.3;

const FX_LEVEL_KEY = "monster_war_fx_level";
const FX_LEVELS = ["full", "mild", "off"];
const FX_LEVEL_LABELS = { full: "FX 派手", mild: "FX 控えめ", off: "FX OFF" };

function loadFxLevel() {
    try {
        const saved = localStorage.getItem(FX_LEVEL_KEY);

        if (FX_LEVELS.includes(saved)) {
            return saved;
        }
    } catch {
        // 保存できない環境では既定値
    }

    const reduced =
        root.matchMedia &&
        root.matchMedia("(prefers-reduced-motion: reduce)").matches;

    return reduced ? "mild" : "full";
}

let fxLevel = loadFxLevel();

function setFxLevel(level) {
    fxLevel = FX_LEVELS.includes(level) ? level : "full";

    try {
        localStorage.setItem(FX_LEVEL_KEY, fxLevel);
    } catch {
        // 無視
    }
}

const isFull = () => fxLevel === "full";
const isOff = () => fxLevel === "off";

/* ---------- 技の種類 → 演出の型 ---------- */

/*
 * skill.effect ごとの演出の型。新しいeffectを追加したらここに1行足す。
 * 無いものは power > 0 なら "strike"、0 なら "buff" になる。
 */
const EFFECT_STYLES = {
    damage: "strike",
    damage_scale_with_move_distance: "strike",
    damage_falloff_by_target_count: "strike",
    damage_ignore_defense: "pierce",
    damage_plus_true_damage: "pierce",
    equalize_hp_damage: "curse",
    kamikaze_damage: "explosion",
    revive: "holy",
    remove_dead: "dark",
    heal_single_ally: "heal",
    double_power_next_turn: "charge",
    move_buff_all_allies: "speed",
    guard_next_turn: "guard"
};

/*
 * 技ごとに個別の演出を指定したい場合は skillDatabase の技に
 *   fx: "explosion"
 * のように書けば、EFFECT_STYLES より優先される。
 */
function pickStyle(fx) {
    if (fx.fxStyle) return fx.fxStyle;
    if (EFFECT_STYLES[fx.effect]) return EFFECT_STYLES[fx.effect];
    return Number(fx.power) > 0 ? "strike" : "buff";
}

const ONOMATOPOEIA = {
    strike: ["ドカッ!!", "バキッ!!", "ズバッ!!", "ドゴッ!!"],
    pierce: ["ズドン!!", "ブスッ!!", "貫通!!"],
    curse: ["ゴゴゴ…", "ズズン…"],
    explosion: ["ドゴォォン!!!", "ボガァン!!!"],
    heavy: ["ドゴォッ!!!", "ズガァン!!!", "メキャッ!!!"]
};

const BUFF_TEXT = {
    holy: "REVIVE!!",
    dark: "消滅…",
    heal: "HEAL!!",
    charge: "POWER UP!!",
    speed: "SPEED UP!!",
    guard: "GUARD!!",
    buff: "UP!!"
};

const pick = list => list[Math.floor(Math.random() * list.length)];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ---------- レイヤーと座標 ---------- */

function getLayer(ctx) {
    const wrapper = ctx.wrapper;

    if (!wrapper) {
        return null;
    }

    let layer = wrapper.querySelector(".fx-layer");

    if (!layer) {
        layer = document.createElement("div");
        layer.className = "fx-layer";
        wrapper.appendChild(layer);
    }

    return layer;
}

/*
 * マス(row, column)の中心座標と大きさを、fxレイヤー基準で返す。
 * 盤面の反転表示はマス要素の実際の位置を見るので自動的に反映される。
 */
function cellBox(ctx, row, column) {
    const cell = ctx.getCell(row, column);
    const wrapper = ctx.wrapper;

    if (!cell || !wrapper) {
        return null;
    }

    const cellRect = cell.getBoundingClientRect();
    const baseRect = wrapper.getBoundingClientRect();

    return {
        x: cellRect.left - baseRect.left + cellRect.width / 2,
        y: cellRect.top - baseRect.top + cellRect.height / 2,
        size: cellRect.width
    };
}

function spawn(layer, className, box, styles = {}, lifetime = 900) {
    const el = document.createElement("div");
    el.className = `fx ${className}`;

    if (box) {
        el.style.left = `${box.x}px`;
        el.style.top = `${box.y}px`;
        el.style.setProperty("--cell", `${box.size}px`);
    }

    Object.entries(styles).forEach(([key, value]) => {
        if (key.startsWith("--")) {
            el.style.setProperty(key, value);
        } else {
            el.style[key] = value;
        }
    });

    layer.appendChild(el);
    setTimeout(() => el.remove(), lifetime);

    return el;
}

/* ---------- 画面全体の演出 ---------- */

function screenEl() {
    return document.querySelector(".battle-screen") || document.body;
}

function restartClass(el, className, duration) {
    el.classList.remove(className);
    // 同じアニメーションを連続で再生できるようにリフローを挟む
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), duration);
}

function shake(level = 1) {
    if (isOff()) return;

    const strength = isFull() ? level : Math.min(level, 1);
    const el = screenEl();

    el.style.setProperty("--shake", `${[0, 4, 9, 16][strength] || 4}px`);
    restartClass(el, "fx-shake", 420);
}

function negaPosi(times = NEGAPOSI_TIMES) {
    if (!isFull() || times <= 0) return;

    const count = Math.max(1, Math.min(3, times));
    const el = screenEl();
    restartClass(el, `fx-negaposi-${count}`, 130 * count + 40);
}

function whiteFlash(color = "#ffffff") {
    if (isOff()) return;

    const flash = document.createElement("div");
    flash.className = "fx-screen-flash";
    flash.style.background = color;
    flash.style.setProperty("--flash-opacity", String(FLASH_OPACITY));
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 260);
}

function zoomPunch(ctx) {
    if (!isFull() || !ctx.wrapper) return;
    restartClass(ctx.wrapper, "fx-zoom-punch", 260);
}

/* ---------- 効果音(合成) ---------- */

let audioContext = null;

function getAudio() {
    if (isOff()) return null;

    try {
        if (!audioContext) {
            const AudioCtx = root.AudioContext || root.webkitAudioContext;
            if (!AudioCtx) return null;
            audioContext = new AudioCtx();
        }

        if (audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }

        return audioContext;
    } catch {
        return null;
    }
}

function playSound(kind) {
    const ac = getAudio();
    if (!ac) return;

    const now = ac.currentTime;
    const master = ac.createGain();
    master.gain.value = 0.35;
    master.connect(ac.destination);

    // ノイズ(打撃のザラつき)
    const noise = (duration, volume, filterFreq) => {
        const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * duration), ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        }
        const src = ac.createBufferSource();
        src.buffer = buffer;
        const filter = ac.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = filterFreq;
        const gain = ac.createGain();
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        src.connect(filter).connect(gain).connect(master);
        src.start(now);
    };

    // 音程が下がる/上がる単音
    const tone = (type, from, to, duration, volume, delay = 0) => {
        const osc = ac.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(from, now + delay);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + delay + duration);
        const gain = ac.createGain();
        gain.gain.setValueAtTime(volume, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
        osc.connect(gain).connect(master);
        osc.start(now + delay);
        osc.stop(now + delay + duration + 0.02);
    };

    switch (kind) {
        case "heavy":
            noise(0.35, 0.9, 1800);
            tone("sine", 140, 35, 0.4, 0.9);
            break;
        case "explosion":
            noise(0.8, 1, 900);
            tone("sawtooth", 90, 25, 0.7, 0.6);
            break;
        case "heal":
        case "holy":
            tone("sine", 660, 990, 0.25, 0.25);
            tone("sine", 990, 1320, 0.3, 0.2, 0.12);
            break;
        case "buff":
            tone("square", 440, 880, 0.18, 0.12);
            tone("square", 660, 1320, 0.18, 0.1, 0.09);
            break;
        case "guard":
            tone("triangle", 880, 700, 0.25, 0.3);
            break;
        case "miss":
            noise(0.15, 0.25, 4000);
            break;
        case "dark":
            tone("sawtooth", 220, 55, 0.6, 0.25);
            break;
        default: // strike
            noise(0.18, 0.7, 2600);
            tone("sine", 180, 60, 0.18, 0.6);
    }
}

/* ---------- 部品 ---------- */

function popText(layer, box, text, className = "", delay = 0) {
    if (!SHOW_DECORATION_TEXT) return;
    setTimeout(() => {
        spawn(layer, `fx-onomatopoeia ${className}`, box, {
            "--rot": `${Math.round(Math.random() * 16 - 8)}deg`
        }, 1100).textContent = text;
    }, delay);
}

function popNumber(layer, box, text, className, delay = 0) {
    if (!SHOW_DAMAGE_NUMBERS) return;
    setTimeout(() => {
        spawn(layer, `fx-number ${className}`, box, {
            "--dx": `${Math.round(Math.random() * 20 - 10)}px`
        }, 1200).textContent = text;
    }, delay);
}

function sparks(layer, box, color, count = 10) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const distance = box.size * (0.7 + Math.random() * 0.9);

        spawn(layer, "fx-spark", box, {
            "--tx": `${Math.cos(angle) * distance}px`,
            "--ty": `${Math.sin(angle) * distance}px`,
            "--color": color
        }, 600);
    }
}

function impact(layer, box, color, heavy) {
    spawn(layer, "fx-burst", box, { "--color": color }, 500);
    spawn(layer, "fx-slash", box, {
        "--rot": `${Math.round(Math.random() * 60 - 30)}deg`,
        "--color": color
    }, 420);

    if (heavy) {
        spawn(layer, "fx-slash", box, {
            "--rot": `${Math.round(Math.random() * 60 + 60)}deg`,
            "--color": "#ffffff"
        }, 420);
        spawn(layer, "fx-ring", box, { "--color": color }, 600);
    }

    sparks(layer, box, color, heavy ? 16 : 9);
}

function concentrationLines(layer, box) {
    if (!isFull()) return;
    spawn(layer, "fx-speedlines", box, {}, 520);
}

function beam(layer, from, to, color) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);

    if (length < 1) return;

    spawn(layer, "fx-beam", from, {
        width: `${length}px`,
        "--rot": `${Math.atan2(dy, dx)}rad`,
        "--color": color
    }, 480);
}

/* ---------- ノックバックの移動アニメーション ---------- */

function animateKnockback(ctx, event) {
    if (isOff()) return;

    const toCell = ctx.getCell(event.to.row, event.to.column);
    const from = cellBox(ctx, event.from.row, event.from.column);
    const to = cellBox(ctx, event.to.row, event.to.column);

    // 生きているコマのアイコン(死体の枠divではなくimg)
    const icon = toCell?.querySelector("img.board-unit-icon:not(.dead)");

    if (!icon || !from || !to) return;

    icon.animate(
        [
            { transform: `translate(calc(-50% + ${from.x - to.x}px), calc(-50% + ${from.y - to.y}px)) scale(1.15)` },
            { transform: "translate(-50%, -50%) scale(0.92)", offset: 0.75 },
            { transform: "translate(-50%, -50%) scale(1)" }
        ],
        { duration: 380, easing: "cubic-bezier(.2,.9,.3,1.2)" }
    );

    const layer = getLayer(ctx);
    if (layer) {
        spawn(layer, "fx-dust", to, {}, 600);
        popText(layer, to, "ぶっ飛び!!", "is-small", 60);
    }
}

/* ---------- メイン ---------- */

async function playSkill(fx, ctx) {
    if (!fx || isOff()) return;

    const layer = getLayer(ctx);
    if (!layer) return;

    const style = pickStyle(fx);
    const color = ctx.colorOf(fx.attackerPlayer) || "#ffffff";
    const attackerBox = fx.attacker ? cellBox(ctx, fx.attacker.row, fx.attacker.column) : null;

    const damageEvents = fx.events.filter(e => e.type === "damage");
    const killed = fx.events.some(e => e.type === "damage" && e.killed);
    /*
     * 「重い一撃」(ネガポジ・最大シェイク・集中線)になる条件。
     * 通常攻撃のたびに画面が反転すると疲れるので、決定的な場面だけに絞る。
     *   ・自爆(explosion) ・撃破した ・一撃必殺級の技(威力500以上。デスカンチョー等)
     *   ・相手の最大HPの半分以上を一度に削った
     */
    const bigHit = damageEvents.some(
        e => e.maxHp > 0 && (e.amount || 0) / e.maxHp >= HEAVY_DAMAGE_RATIO
    );
    const heavy =
        style === "explosion" ||
        killed ||
        Number(fx.power) >= HEAVY_POWER ||
        bigHit;

    // 1) 溜め: 使用者が光る
    if (attackerBox) {
        spawn(layer, "fx-charge", attackerBox, { "--color": color }, 500);
    }

    // 2) 方向指定の技は射線を走らせる
    const firstHit = fx.events.find(e => e.row != null);
    if (attackerBox && fx.targeting === "direction" && fx.targetCells?.length) {
        const last = fx.targetCells[fx.targetCells.length - 1];
        const endBox = cellBox(ctx, last.row, last.column);
        if (endBox) beam(layer, attackerBox, endBox, color);
    }

    await wait(fx.targeting === "direction" ? 140 : 110);

    // 3) 技の型ごとの演出
    if (["strike", "pierce", "curse", "explosion"].includes(style)) {
        if (heavy) {
            if (!NEGAPOSI_ONLY_ON_KILL || style === "explosion" || killed) {
                negaPosi();
            }
            zoomPunch(ctx);
            shake(3);
            playSound(style === "explosion" ? "explosion" : "heavy");
        } else {
            shake(style === "curse" ? 1 : 2);
            playSound("strike");
        }

        if (style === "explosion" && attackerBox) {
            spawn(layer, "fx-explosion", attackerBox, {}, 900);
            whiteFlash("#ffdd88");
        }

        const firstBox = firstHit ? cellBox(ctx, firstHit.row, firstHit.column) : null;

        if (firstBox) {
            if (heavy) concentrationLines(layer, firstBox);
            popText(
                layer,
                firstBox,
                pick(heavy && style !== "explosion" ? ONOMATOPOEIA.heavy : ONOMATOPOEIA[style] || ONOMATOPOEIA.strike),
                heavy ? "is-heavy" : ""
            );
        }
    } else {
        const buffTargets = fx.events.filter(e => e.row != null);
        const boxes = (buffTargets.length ? buffTargets : [fx.attacker])
            .filter(Boolean)
            .map(e => cellBox(ctx, e.row, e.column))
            .filter(Boolean);

        playSound(style === "holy" || style === "heal" ? style : style === "guard" ? "guard" : style === "dark" ? "dark" : "buff");

        boxes.forEach((box, index) => {
            const cls = {
                holy: "fx-pillar",
                heal: "fx-heal",
                dark: "fx-implode",
                guard: "fx-shield",
                speed: "fx-speed",
                charge: "fx-aura"
            }[style] || "fx-aura";

            setTimeout(() => spawn(layer, cls, box, { "--color": color }, 1000), index * 70);
        });

        if (style === "holy") whiteFlash("#fff3c4");
        if (style === "dark") shake(1);

        if (boxes[0] && style !== "heal") {
            popText(layer, boxes[0], BUFF_TEXT[style] || BUFF_TEXT.buff, `is-${style}`);
        }
    }

    // 4) 命中ごとの数字・エフェクト
    fx.events.forEach((event, index) => {
        const delay = index * 70;

        if (event.type === "knockback") {
            setTimeout(() => animateKnockback(ctx, event), 180);
            return;
        }

        if (event.row == null) return;

        const box = cellBox(ctx, event.row, event.column);
        if (!box) return;

        switch (event.type) {
            case "damage":
                setTimeout(() => impact(layer, box, color, heavy), delay);
                popNumber(layer, box, `-${event.amount}`, event.amount >= 40 ? "is-big" : "", delay + 40);
                if (event.killed) popText(layer, box, "撃破!!", "is-kill", delay + 200);
                break;
            case "heal":
                popNumber(layer, box, `+${event.amount}`, "is-heal", delay);
                spawn(layer, "fx-heal", box, {}, 1000);
                break;
            case "revive":
                // 「REVIVE!!」は技の型(holy)側で出すので、ここでは光の柱だけ
                if (style !== "holy") {
                    popText(layer, box, "REVIVE!!", "is-holy", delay);
                }
                spawn(layer, "fx-pillar", box, {}, 1000);
                break;
            case "miss":
                popNumber(layer, box, "MISS", "is-miss", delay);
                playSound("miss");
                break;
            case "nullify":
                spawn(layer, "fx-shield", box, { "--color": "#6fa8ff" }, 900);
                popNumber(layer, box, "無効!!", "is-guard", delay);
                break;
            case "reflect":
                setTimeout(() => impact(layer, box, "#a0ff60", true), delay);
                popNumber(layer, box, `-${event.amount}`, "is-big", delay + 40);
                popText(layer, box, "反射!!", "is-heavy", delay + 60);
                shake(2);
                break;
            default:
                break;
        }
    });
}

/* ---------- FXボタン(ヘッダー) ---------- */

function mountToggle(container) {
    if (!container || container.querySelector(".fx-toggle")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "fx-toggle";

    const refresh = () => {
        button.textContent = FX_LEVEL_LABELS[fxLevel];
        button.dataset.level = fxLevel;
    };

    button.addEventListener("click", () => {
        const next = FX_LEVELS[(FX_LEVELS.indexOf(fxLevel) + 1) % FX_LEVELS.length];
        setFxLevel(next);
        refresh();
        if (next === "full") shake(1);
    });

    refresh();
    container.appendChild(button);
}

root.MonsterWarFX = {
    playSkill,
    shake,
    negaPosi,
    whiteFlash,
    playSound,
    mountToggle,
    getLevel: () => fxLevel,
    setLevel: setFxLevel,
    EFFECT_STYLES
};

})(window);
