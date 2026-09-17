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
