/*
 * ========================================
 * MONSTER WAR 共有定数
 * ========================================
 *
 * サーバー(server.js からrequire)とブラウザ(<script>タグで読み込み)の
 * 両方から同じ値を参照するための定数ファイルです。
 *
 * 以前は「プレイヤー名の最大文字数」がクライアント側は12文字、
 * サーバー側は30文字と別々にハードコードされているなど、
 * 同じ概念の値が複数箇所に散らばって不整合を起こしていました。
 * 今後、上限値やルール系の定数を変える場合は、必ずこのファイルだけを直してください。
 */
(function (root) {
    "use strict";

    const MONSTER_WAR_CONSTANTS = {
        // ROOM関連
        FIXED_ROOM_ID: "MONSTER_WAR",
        ROOM_ID_MAX_LENGTH: 12,

        // プレイヤー名関連
        // （クライアント入力・サーバー受信どちらもこの値を使う）
        PLAYER_NAME_MAX_LENGTH: 12,
        DEFAULT_PLAYER_NAME: "PLAYER",

        // パーティ関連
        PARTY_MAX_SIZE: 6,

        // BATTLEルーム解放までの待機時間(ミリ秒)
        // 対戦終了後、両プレイヤーの接続が完全になくなってから
        // このミリ秒だけ待ってから卓を解放する。
        BATTLE_ROOM_RESET_DELAY_MS: 5000,

        /*
         * ========================================
         * マルチプレイヤー対戦関連
         * ========================================
         *
         * 対戦卓の最大人数。以前は2人固定でしたが、
         * 4人までの対戦卓に対応するためこの値だけを増やせば
         * room.js / server.js / battle.js すべてに反映されるようにしてあります。
         */
        BATTLE_MAX_PLAYERS: 4,

        // 対戦開始に必要な最低人数。
        // 「卓についている全員がREADYになったら、その人数のまま開始する」
        // というルールなので、開始そのものに必要なのは最低2人。
        BATTLE_MIN_PLAYERS_TO_START: 2,

        /*
         * プレイヤー番号(1〜4)ごとの表示色。
         * 盤面のユニット枠・ステータスパネル・ルーム画面の卓表示など、
         * 「誰が何色か」を判定する箇所は必ずここを参照する。
         *
         * PLAYER1=青・PLAYER2=赤は、4人対戦に対応する以前から
         * battle.css/battle.jsで使われていた配色をそのまま踏襲している
         * （盤面のユニット枠、ステータスパネルの色など）。
         * 3人目・4人目として黄・緑を追加した。
         */
        PLAYER_COLORS: {
            1: "#3b82f6", // 青
            2: "#ef4444", // 赤
            3: "#eab308", // 黄
            4: "#22c55e"  // 緑
        },

        // sessionStorage / localStorage キー
        STORAGE_KEYS: {
            PLAYER_NAME: "monsterWarPlayerName",
            SESSION_ID: "monsterWarSessionId",
            PARTY: "monsterWarParty"
        }
    };

    if (typeof module !== "undefined" && module.exports) {
        // Node.js (server.js から require)
        module.exports = MONSTER_WAR_CONSTANTS;
    } else if (root) {
        // ブラウザ (<script src="shared/constants.js">)
        root.MONSTER_WAR_CONSTANTS = MONSTER_WAR_CONSTANTS;
    }
})(typeof window !== "undefined" ? window : this);