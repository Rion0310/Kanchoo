/* ============================================================
   MONSTER WAR - BATTLE MAPS (フィールド形状)

   ROOM(マップ選択)・BATTLE(盤面)・server.js(マップIDの検証)の
   3か所から共通で読み込む。マップの追加・変更はこのファイルだけでよい。

   盤面の形は文字の地図で定義する。1文字 = 1マス、1行目が盤面の一番上。
   文字とマスの種類/画像の対応は MAP_LEGEND で決める。

   ルール
   ・縦横の数が違う地図も書ける。大きいほうの辺に合わせた正方形の
     中央に自動で置かれ、余りは存在しないマスになる。
   ・城は 1=左下 / 2=右上 / 3=左上 / 4=右下 の付近に置く。
     (各プレイヤーの画面で「自分の城が左下」に見えるよう盤面を反転表示するため)
   ・初期配置は城から歩いて近いマスへ自動で並ぶ。
     城の周りに通常マスを6つ以上用意しておくこと。
   ・players は「何人対戦で選べるか」。3人対戦では4つ目の城は普通のマスになる。
   ・新しいマップは BATTLE_MAPS に1件追加するだけで、ROOMの選択肢に自動で並ぶ。
============================================================ */

(function (root) {
"use strict";

/*
 * 地図の文字 → マスの種類（と画像） の対応表。
 *
 * 書き方は2通り。
 *   "X": "wall"                                   … 種類だけ
 *   "a": { type: "floor", image: "../images/tiles/grass.png" }
 *                                                 … 種類 + そのマスに敷く画像
 *
 * type は次のどれか。
 *   "floor"   通常のマス
 *   "wall"    壁（移動も技も通さない）
 *   "void"    存在しないマス（表示されず、移動も技も通さない）
 *   "castle1"〜"castle4"  そのプレイヤーの城（通常のマスとして扱う）
 *   "center"  中央の城（誰の物でもない。複数マス並べると、その範囲全体で1つの城になる。
 *             範囲内を自分のコマだけで一定ターン守ると勝ち。
 *             攻撃を受けると範囲の外へ押し出される。通常のマスとして扱う）
 *
 * 同じ「通常のマス」でも文字ごとに別の画像を割り当てられる
 * (例: a=草原, d=石畳, e=砂地 … すべて type:"floor")。
 * 画像を指定しなければ今までどおりの市松模様のマスになる。
 * 対応表に無い文字は「存在しないマス」扱い。
 */
const MAP_LEGEND = {
    "#": "floor",
    "X": "wall",
    ".": "void",
    " ": "void",
    "1": "castle1",
    "2": "castle2",
    "3": "castle3",
    "4": "castle4",
    "C": "center"

    // 画像付きの例（画像ファイルを用意したらコメントを外す）:
    // , "a": { type: "floor", image: "../images/tiles/grass.png" }
    // , "b": { type: "wall",  image: "../images/tiles/rock.png" }
    // , "c": { type: "floor", image: "../images/tiles/sand.png" }
};

function getLegendEntry(char) {
    const entry = MAP_LEGEND[char];

    if (!entry) {
        return { type: "void", image: "" };
    }

    if (typeof entry === "string") {
        return { type: entry, image: "" };
    }

    return {
        type: String(entry.type || "void"),
        image: String(entry.image || "")
    };
}

/*
 * 地図を「正方形のマス目」に整える。
 * 行ごとの長さがバラバラ・縦横の数が違う地図でも、
 * 大きいほうの辺に合わせた正方形の中央に置き、余りは存在しないマスで埋める。
 * (盤面の表示・自分視点への反転は正方形の枠を前提にしているため)
 */
const normalizedMapCache = new WeakMap();

function getNormalizedMap(map) {
    if (!map) {
        return null;
    }

    if (normalizedMapCache.has(map)) {
        return normalizedMapCache.get(map);
    }

    const height = map.rows.length;
    const width = Math.max(...map.rows.map(line => [...line].length));
    const size = Math.max(height, width);

    const rowOffset = Math.floor((size - height) / 2);
    const columnOffset = Math.floor((size - width) / 2);

    const grid = Array.from({ length: size }, () => Array(size).fill("."));

    map.rows.forEach((line, rowIndex) => {
        [...line].forEach((char, columnIndex) => {
            grid[rowIndex + rowOffset][columnIndex + columnOffset] = char;
        });
    });

    const normalized = { size, grid };
    normalizedMapCache.set(map, normalized);

    return normalized;
}

const BATTLE_MAPS = {
    classic_2: {
        name: "クラシック",
        description: "何もない正方形。基本の戦場。",
        players: [2],
        rows: [
            "###########2",
            "############",
            "############",
            "############",
            "############",
            "############",
            "############",
            "############",
            "############",
            "############",
            "############",
            "1###########"
        ]
    },

    diagonal_2: {
        name: "斜めの回廊",
        description: "左上と右下が欠けた斜めの戦場。正面衝突が起きやすい。",
        players: [2],
        rows: [
            ".....######2",
            "....########",
            "...#########",
            "..##########",
            ".###########",
            "############",
            "############",
            "###########.",
            "##########..",
            "#########...",
            "########....",
            "1######....."
        ]
    },

    pillars_2: {
        name: "柱の森",
        description: "壁が点在する盤面。技の射線を切って戦える。",
        players: [2],
        rows: [
            "###########2",
            "######X#####",
            "###X##X#####",
            "###X########",
            "########XXX#",
            "#####XX#####",
            "#####XX#####",
            "#XXX########",
            "########X###",
            "#####X##X###",
            "#####X######",
            "1###########"
        ]
    },

    river_2: {
        name: "二本橋",
        description: "中央を壁が横切り、通れるのは左右の橋だけ。",
        players: [2],
        rows: [
            "###########2",
            "############",
            "############",
            "############",
            "############",
            "X##XXXXXX##X",
            "X##XXXXXX##X",
            "############",
            "############",
            "############",
            "############",
            "1###########"
        ]
    },

    classic_4: {
        name: "クラシック",
        description: "何もない正方形。基本の戦場。",
        players: [3, 4],
        rows: [
            "3##############2",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "################",
            "1##############4"
        ]
    },

    lake_4: {
        name: "中央の湖",
        description: "盤面の中央がぽっかり空いた形。外周を回って攻める。",
        players: [3, 4],
        rows: [
            "3##############2",
            "################",
            "################",
            "################",
            "################",
            "######....######",
            "#####......#####",
            "#####......#####",
            "#####......#####",
            "#####......#####",
            "######....######",
            "################",
            "################",
            "################",
            "################",
            "1##############4"
        ]
    },

    cross_4: {
        name: "十字の城壁",
        description: "十字の壁で4区画に分かれ、門を通って隣へ攻め込む。",
        players: [3, 4],
        rows: [
            "3######XX######2",
            "#######XX#######",
            "#######XX#######",
            "################",
            "################",
            "#######XX#######",
            "#######XX#######",
            "XXX##XXXXXX##XXX",
            "XXX##XXXXXX##XXX",
            "#######XX#######",
            "#######XX#######",
            "################",
            "################",
            "#######XX#######",
            "#######XX#######",
            "1######XX######4"
        ]
    },

    fortress_4: {
        name: "四つの砦",
        description: "各辺の中央がえぐれ、四隅の砦がくっきり分かれた形。",
        players: [3, 4],
        rows: [
            "3####......####2",
            "#####......#####",
            "################",
            "################",
            "################",
            "..############..",
            "..############..",
            "..############..",
            "..############..",
            "..############..",
            "..############..",
            "################",
            "################",
            "################",
            "#####......#####",
            "1####......####4"
        ]
    },

    /*
     * 中央の城(C)があるマップ。Cを並べた範囲(ここでは2×2)がまるごと中央の城になる。
     * centerHoldTurns … 中央の城に何ターン居座れば勝ちか(省略すると5)
     */
    throne_2: {
        name: "王座の間",
        description: "中央の城に5ターン居座れば勝ち。攻撃されると押し出される。",
        players: [2],
        centerHoldTurns: 5,
        rows: [
            "XXXXX######2",
            "XXXX########",
            "XXX#########",
            "XX##X##X####",
            "X##X####X###",
            "#####CC#####",
            "#####CC#####",
            "###X####X##X",
            "####X##X##XX",
            "#########XXX",
            "########XXXX",
            "1######XXXXX"
        ]
    },

    throne_4: {
        name: "王座の間",
        description: "中央の城に5ターン居座れば勝ち。攻撃されると押し出される。",
        players: [3, 4],
        centerHoldTurns: 5,
        rows: [
            "3##############2",
            "################",
            "#######XX#######",
            "################",
            "######X##X######",
            "#####X####X#####",
            "####X######X####",
            "##X####CC####X##",
            "##X####CC####X##",
            "####X######X####",
            "#####X####X#####",
            "######X##X######",
            "################",
            "#######XX#######",
            "################",
            "1##############4"
        ]
    }
};

function getMapsForPlayerCount(playerCount) {
    const count = Number(playerCount) || 2;

    return Object.entries(BATTLE_MAPS)
        .filter(([, map]) => map.players.includes(count))
        .map(([id, map]) => ({ id, ...map }));
}

function isMapAvailableFor(mapId, playerCount) {
    return !!BATTLE_MAPS[mapId] &&
        BATTLE_MAPS[mapId].players.includes(Number(playerCount) || 2);
}

function getDefaultMapId(playerCount) {
    return getMapsForPlayerCount(playerCount)[0]?.id || null;
}


/*
 * ROOMのマップ選択肢に並べるミニプレビュー(HTML文字列)。
 * playerColors は { 1: "#3b82f6", ... } (城の色付け用)。
 */
function escapeMapHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildMapPreviewHtml(map, playerColors = {}) {
    const { size, grid } = getNormalizedMap(map);
    const cells = [];

    grid.forEach(line => {
        line.forEach(char => {
            const { type, image } = getLegendEntry(char);
            let className = "map-preview-cell";
            const styles = [];

            if (type === "wall") {
                className += " is-wall";
            } else if (type === "center") {
                className += " is-center";
                styles.push("background-color:#e7c86a");
            } else if (type.startsWith("castle")) {
                className += " is-castle";
                styles.push(`background-color:${playerColors[Number(type.slice(6))] || "#e7c86a"}`);
            } else if (type !== "floor") {
                className += " is-void";
            }

            if (image && type !== "void" && !type.startsWith("castle")) {
                styles.push(`background-image:url(&quot;${escapeMapHtml(encodeURI(image))}&quot;)`);
            }

            cells.push(
                `<i class="${className}"${styles.length ? ` style="${styles.join(";")}"` : ""}></i>`
            );
        });
    });

    return `<div class="map-preview" style="--preview-size:${size}">${cells.join("")}</div>`;
}

/*
 * 人数に対して実際に使うマップID。
 * 選んだマップがその人数で使えなければ、その人数の既定マップにする。
 */
function resolveMapId(mapId, playerCount) {
    return isMapAvailableFor(mapId, playerCount)
        ? mapId
        : getDefaultMapId(playerCount);
}

const api = {
    MAP_LEGEND,
    BATTLE_MAPS,
    getLegendEntry,
    getNormalizedMap,
    getMapsForPlayerCount,
    isMapAvailableFor,
    getDefaultMapId,
    resolveMapId,
    buildMapPreviewHtml
};

if (typeof module === "object" && module.exports) {
    module.exports = api;
}

root.MONSTER_WAR_MAPS = api;

})(typeof window !== "undefined" ? window : globalThis);
