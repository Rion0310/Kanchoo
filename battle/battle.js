(() => {

/* ========================================
   MONSTER WAR
   BATTLE FIELD
   キャラアイコン表示版
======================================== */

/*
 * [1vs1限定サイズ変更]
 * 2人対戦(1対1)の時だけ盤面を12×12に縮小し、3〜4人対戦では
 * 従来通り16×16のままにする。何人で対戦するかは
 * ・オフライン(ホットシート): initialize()時点で判明(常に2人)
 * ・オンライン: battle_start受信時点で判明(2〜4人)
 * というように後から確定するため、BOARD_SIZEはconstではなくletにし、
 * 人数が確定したタイミングで値を更新してからcreateBoard()を
 * 呼び直すことで両方のケースに追従させる。
 */
let BOARD_SIZE = 16;

/*
 * [FIELD SIZE / 保守性]
 * 盤面のマス数はこの BOARD_SIZE 一つだけを変更すれば、
 * ・盤面のマス数(createBoard)
 * ・移動範囲や技の射程判定(BOARD_SIZEを参照する各関数)
 * ・初期配置(getFormationPositions)
 * ・城の位置(getSiegeCastles)
 * ・盤面のCSS(grid-template-columns/rows)
 * ・右下の「N × N」ラベル
 * が全て自動的に追従する。
 *
 * CSS側は :root の --board-size というカスタムプロパティを
 * 参照しているため、BOARD_SIZEが変わるたびに
 * applyBoardSizeCssVariable()でdocumentElementへ書き込み、
 * CSSとJSの数値を一致させている。
 */
function getBoardSizeForPlayerCount(playerCount) {
    return Number(playerCount) <= 2 ? 12 : 16;
}

function applyBoardSizeCssVariable() {
    document.documentElement.style.setProperty(
        "--board-size",
        String(BOARD_SIZE)
    );
}

const DATA =
    window.MONSTER_WAR_DATA;

if (!DATA) {

    throw new Error(
        "MONSTER_WAR_DATA が読み込まれていません。game-data.js を先に読み込んでください。"
    );

}


const {
    characterDatabase,
    skillDatabase,
    characterSkillsDatabase,
    characterSongDatabase
} = DATA;


const battleField =
    document.getElementById(
        "battle-field"
    );


const fieldArea =
    battleField ? battleField.closest(".field-area") : null;


/*
 * [4人対戦対応]
 * 以前はplayer1Status/player2Statusの2つの定数だけだったが、
 * スロット1〜4(自分を左下に固定した視点上の位置)を
 * まとめて参照できるようにした。
 * どの「実プレイヤー番号」をどのスロットに表示するかは
 * getVisualSlotAssignments()が対戦のたびに動的に決める。
 */
const PLAYER_PANEL_SLOTS = {
    1: {
        panel: document.querySelector(".player-status-1"),
        name: document.getElementById("player-1-name"),
        list: document.getElementById("player-1-status")
    },
    2: {
        panel: document.querySelector(".player-status-2"),
        name: document.getElementById("player-2-name"),
        list: document.getElementById("player-2-status")
    },
    3: {
        panel: document.querySelector(".player-status-3"),
        name: document.getElementById("player-3-name"),
        list: document.getElementById("player-3-status")
    },
    4: {
        panel: document.querySelector(".player-status-4"),
        name: document.getElementById("player-4-name"),
        list: document.getElementById("player-4-status")
    }
};


/* ========================================
   ONLINE BATTLE
======================================== */

const battleUrlParams =
    new URLSearchParams(window.location.search);

const ONLINE_ROOM_ID =
    battleUrlParams.get("room") || "";

const IS_SPECTATOR =
    battleUrlParams.get("spectator") === "true" ||
    battleUrlParams.get("mode") === "spectator" ||
    battleUrlParams.get("player") === "spectator";

/*
 * [4人対戦対応]
 * room.jsの ../battle/battle.html?player=N のNは1〜4になり得るので、
 * 以前の「2以外は全部1」という決め打ちをやめ、1〜4の範囲だけ受け付ける。
 */
const REQUESTED_PLAYER_NUMBER = Number(battleUrlParams.get("player"));

let MY_PLAYER_NUMBER = IS_SPECTATOR
    ? 0
    : (
        Number.isInteger(REQUESTED_PLAYER_NUMBER) &&
        REQUESTED_PLAYER_NUMBER >= 1 &&
        REQUESTED_PLAYER_NUMBER <= 4
            ? REQUESTED_PLAYER_NUMBER
            : 1
    );

const ONLINE_PLAYER_NAME =
    battleUrlParams.get("name") ||
    (IS_SPECTATOR ? "SPECTATOR" : `PLAYER${MY_PLAYER_NUMBER}`);

/*
 * [IDENTITY FIX]
 * ROOM側で発行済みのsessionIdをURL経由で引き継ぎます。
 * これにより、名前が他人と重複していてもサーバー側で
 * 正しい本人の対戦卓に復元できます。
 * URLに無い場合（直接battle.htmlを開いた等）はこの場で発行します。
 */
function generateSessionId() {
    if (
        window.crypto &&
        typeof window.crypto.randomUUID === "function"
    ) {
        try {
            return window.crypto.randomUUID();
        } catch (error) {
            // フォールバックへ続行
        }
    }

    return (
        "sid-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 12)
    );
}

const SESSION_ID_STORAGE_KEY = window.MONSTER_WAR_CONSTANTS.STORAGE_KEYS.SESSION_ID;

let ONLINE_SESSION_ID =
    battleUrlParams.get("session") ||
    sessionStorage.getItem(SESSION_ID_STORAGE_KEY) ||
    generateSessionId();

sessionStorage.setItem(SESSION_ID_STORAGE_KEY, ONLINE_SESSION_ID);

function isSpectatorMode() {
    return IS_SPECTATOR || MY_PLAYER_NUMBER === 0;
}

let onlineSocket = null;
let onlineApplyingState = false;

/*
 * [4人対戦対応]
 * 以前はonlineParty1/onlineParty2という2つの変数だったが、
 * プレイヤー番号(1〜4)をキーにしたオブジェクトへ一本化した。
 * 3人目・4人目が増えても、ここを増やす必要がない。
 */
let onlinePartyByPlayer = {};

let onlinePlayerNames = {
    1: "PLAYER1",
    2: "PLAYER2",
    3: "PLAYER3",
    4: "PLAYER4"
};
let onlineBattleStarted = false;

function getOnlineWebSocketUrl() {
    const protocol =
        window.location.protocol === "https:"
            ? "wss:"
            : "ws:";
    const host =
        window.location.host || "localhost:8080";
    return `${protocol}//${host}`;
}

function serializeBattleState() {
    return {
        turn: battleState.turn,
        currentPlayer: battleState.currentPlayer,
        // [4人対戦対応] 参加人数・脱落者も同期する。
        activePlayers: battleState.activePlayers,
        eliminatedPlayers: battleState.eliminatedPlayers,
        selectedUnitId: battleState.selectedUnitId,
        movableCells: battleState.movableCells,
        units: battleState.units,
        movedUnits: [...battleState.movedUnits],
        actionPhase: battleState.actionPhase,
        skillPhase: battleState.skillPhase,
        skillDirection: battleState.skillDirection,
        skillTargetCells: battleState.skillTargetCells,
        skillSelectedTargetCells: battleState.skillSelectedTargetCells,
        selectedSkillId: battleState.selectedSkillId,
        skillStep: battleState.skillStep,
        gameOver: battleState.gameOver,
        winner: battleState.winner,
        gameOverReason: battleState.gameOverReason,
        playerNames: onlinePlayerNames,
        battleLogs: battleState.battleLogs,
        bluffUnits: [...battleState.bluffUnits],
        bluffUses: battleState.bluffUses,
        // [キャラソン復元] 現在流れているべき曲(null=デフォルトBGM)。
        currentTrackCharacterId: battleState.currentTrackCharacterId ?? null
    };
}

function onlineSendState() {
    if (
        onlineApplyingState ||
        !ONLINE_ROOM_ID ||
        !onlineSocket ||
        onlineSocket.readyState !== WebSocket.OPEN
    ) {
        return;
    }

    onlineSocket.send(JSON.stringify({
        type: "battle_state",
        state: serializeBattleState()
    }));
}


/*
 * [BATTLE EVENT]
 * 一度きりの演出を対戦相手にも同期します。
 * battle_stateには演出イベントを含めません。
 */
function onlineSendBattleEvent(event, data = null) {
    if (
        !ONLINE_ROOM_ID ||
        !onlineSocket ||
        onlineSocket.readyState !== WebSocket.OPEN
    ) {
        return;
    }

    onlineSocket.send(JSON.stringify({
        type: "battle_event",
        event,
        data
    }));
}

function applyOnlineState(state) {
    if (!state || typeof state !== "object") return;

    onlineApplyingState = true;

    const previousTurn = battleState.turn;
    const previousPlayer = battleState.currentPlayer;
    const previousGameOver = battleState.gameOver;
    const previousActivePlayersKey = battleState.activePlayers.join(",");
    const previousTrackCharacterId = battleState.currentTrackCharacterId ?? null;

    battleState.turn = Number(state.turn || 1);
    battleState.currentPlayer = Number(state.currentPlayer || 1);

    // [4人対戦対応] 参加人数・脱落者を同期する。
    battleState.activePlayers =
        Array.isArray(state.activePlayers) && state.activePlayers.length > 0
            ? state.activePlayers.map(Number).filter(Number.isInteger)
            : battleState.activePlayers;
    battleState.eliminatedPlayers =
        Array.isArray(state.eliminatedPlayers)
            ? state.eliminatedPlayers.map(Number).filter(Number.isInteger)
            : battleState.eliminatedPlayers;

    battleState.selectedUnitId = state.selectedUnitId ?? null;
    battleState.movableCells =
        Array.isArray(state.movableCells) ? state.movableCells : [];
    battleState.units =
        Array.isArray(state.units) ? state.units : [];
    battleState.movedUnits =
        new Set(Array.isArray(state.movedUnits) ? state.movedUnits : []);
    battleState.actionPhase = state.actionPhase ?? null;
    battleState.skillPhase = state.skillPhase ?? null;
    battleState.skillDirection = state.skillDirection ?? null;
    battleState.skillTargetCells =
        Array.isArray(state.skillTargetCells)
            ? state.skillTargetCells
            : [];
    battleState.skillSelectedTargetCells =
        Array.isArray(state.skillSelectedTargetCells)
            ? state.skillSelectedTargetCells
            : [];
    battleState.selectedSkillId = state.selectedSkillId ?? null;
    battleState.gameOver = !!state.gameOver;
    battleState.winner = Number(state.winner) || null;
    battleState.gameOverReason = state.gameOverReason || "";
    if (state.playerNames && typeof state.playerNames === "object") {
        onlinePlayerNames = {
            1: String(state.playerNames[1] || "PLAYER1"),
            2: String(state.playerNames[2] || "PLAYER2"),
            3: String(state.playerNames[3] || "PLAYER3"),
            4: String(state.playerNames[4] || "PLAYER4")
        };
        updatePlayerNameHeaders();
    }
    battleState.battleLogs =
        Array.isArray(state.battleLogs) ? state.battleLogs : [];
    battleState.bluffUnits =
        new Set(Array.isArray(state.bluffUnits) ? state.bluffUnits : []);
    battleState.bluffUses =
        state.bluffUses || battleState.bluffUses;
    battleState.currentTrackCharacterId =
        state.currentTrackCharacterId != null
            ? state.currentTrackCharacterId
            : null;

    // 参加人数が変わっていれば(=試合開始直後やスペクテーター参加時など)
    // 城の配置も現在のactivePlayersに合わせて描き直す。
    if (battleState.activePlayers.join(",") !== previousActivePlayersKey) {
        renderCastles();
    }

    clearCellStates();
    renderUnitIcons();
    renderPlayerPanels();
    updateControlPanel();

    if (
        !previousGameOver && battleState.gameOver &&
        battleState.winner &&
        !isSpectatorMode() &&
        battleState.winner !== Number(MY_PLAYER_NUMBER)
    ) {
        showYouLoseCutIn();
    }

    if (
        (battleState.turn !== previousTurn ||
            battleState.currentPlayer !== previousPlayer) &&
        !isSpectatorMode() &&
        battleState.currentPlayer === Number(MY_PLAYER_NUMBER)
    ) {
        showYourTurnCutIn();
    }

    /*
     * [BUGFIX / タブを閉じて再度開くとキャラソンが消える件]
     * サーバーから受け取った「今流れているべき曲」が
     * ローカルで今鳴っている曲と違う場合だけ切り替える。
     * (同じなら毎回playCharacterSong()し直してcurrentTimeが
     *  0に戻ってしまうのを防ぐ)
     * これにより、キャラソン再生中に別のクライアントが参加/再接続
     * してきた場合や、タブを閉じて再度開いた場合でも、
     * 正しい曲へ復元される。
     */
    if (battleState.currentTrackCharacterId !== previousTrackCharacterId) {
        if (battleState.currentTrackCharacterId != null) {
            playCharacterSong(battleState.currentTrackCharacterId);
        } else {
            startBattleBgm();
        }
    }

    onlineApplyingState = false;
}


/*
 * [4人対戦対応]
 * 以前はPLAYER1/PLAYER2の名前欄へ固定で書き込むだけだったが、
 * 今は「どの実プレイヤーがどのスロット(自分を左下に固定した視点)に
 * 表示されるか」が対戦のたびに変わるため、名前の書き込みは
 * renderPlayerPanels()に一本化した。
 * (renderPlayerPanels()はbattleStateの初期化が終わってから
 * 呼ばれる必要があるため、スクリプト読み込み直後には呼び出さない)
 */
function updatePlayerNameHeaders() {
    renderPlayerPanels();
}

function getPlayerDisplayName(playerNumber) {
    if (playerNumber === null || playerNumber === undefined) {
        return "―";
    }

    const number = Number(playerNumber);

    // [4人対戦対応] 1〜4番すべてで名前を引けるようにする。
    if (number >= 1 && number <= 4) {
        return onlinePlayerNames[number] || `PLAYER${number}`;
    }

    return `PLAYER${number}`;
}

function connectOnlineBattle() {
    if (!ONLINE_ROOM_ID) return;

    try {
        onlineSocket =
            new WebSocket(getOnlineWebSocketUrl());
    } catch (error) {
        console.error("オンライン対戦サーバーへの接続に失敗しました。", error);
        return;
    }

    onlineSocket.addEventListener("open", () => {
        // BATTLE側でも同じWebSocket接続をROOMへ登録してから
        // battle_joinを送ります。
        onlineSocket.send(JSON.stringify({
            type: "room_join",
            roomId: ONLINE_ROOM_ID,
            playerName: ONLINE_PLAYER_NAME,
            reconnectBattle: true,
            sessionId: ONLINE_SESSION_ID
        }));
    });

    onlineSocket.addEventListener("message", event => {
        let message;

        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }

        if (message.type === "room_connected") {
            if (
                typeof message.sessionId === "string" &&
                message.sessionId
            ) {
                ONLINE_SESSION_ID = message.sessionId;

                sessionStorage.setItem(
                    SESSION_ID_STORAGE_KEY,
                    ONLINE_SESSION_ID
                );
            }

            const assignedPlayerNumber = Number(message.playerNumber);

            /*
             * [BUGFIX / 4人対戦対応漏れ]
             * サーバー(room_connected)が返してくる自分の本当のプレイヤー番号は
             * 1〜4のどれでもあり得るのに、以前は「1か2ならMY_PLAYER_NUMBERを
             * 上書きする」処理しかなく、3・4番の場合はここで一切補正されず
             * URLパラメータ由来の値がそのまま残っていた。
             * 通常はROOM側が正しい?player=の値を付けて遷移させるため
             * 表面化しにくいが、念のためサーバー側の判定を必ず信用するように
             * 1〜4すべてで補正する。
             */
            if (
                Number.isInteger(assignedPlayerNumber) &&
                assignedPlayerNumber >= 1 &&
                assignedPlayerNumber <= 4
            ) {
                MY_PLAYER_NUMBER = assignedPlayerNumber;
                updateBoardPerspective();
            } else if (assignedPlayerNumber === 0) {
                MY_PLAYER_NUMBER = 0;
            }

            /*
             * [PARTY FIX 1: バトル接続時にパーティを上書きしない]
             *
             * ROOM側でREADYした時点でサーバーには
             * PLAYER 1 / PLAYER 2それぞれのpartyが保存されています。
             *
             * ここでbattle側からpartyを送り直すと、
             * PLAYER 2の接続でもPLAYER 1用のpartyを送る等の
             * 上書きが起きるため、partyは送信しません。
             */
            onlineSocket.send(JSON.stringify({
                type: "room_select_table",
                table: isSpectatorMode() ? "spectator" : "battle"
            }));

            onlineSocket.send(JSON.stringify({
                type: "battle_join",
                roomId: ONLINE_ROOM_ID,
                player: MY_PLAYER_NUMBER,
                spectator: isSpectatorMode()
            }));

            return;
        }

        if (message.type === "battle_start") {
            if (onlineBattleStarted) {
                return;
            }

            const players = message.players || [];

            /*
             * [4人対戦対応 / 自動FIT]
             * サーバー(server.js)は「実際に着席してREADYになった人数分」の
             * players配列(2〜4件、プレイヤー番号は1〜4のいずれか)を送ってくる。
             * その番号の並びをそのままactivePlayersとして採用することで、
             * 手番のローテーション・城の配置・パネル表示すべてが
             * この対戦の実際の参加人数に自動でFITする。
             */
            const activePlayers = players
                .map(player => Number(player.player))
                .filter(Number.isInteger)
                .sort((a, b) => a - b);

            battleState.activePlayers =
                activePlayers.length > 0 ? activePlayers : [1, 2];
            battleState.eliminatedPlayers = [];
            battleState.currentPlayer = battleState.activePlayers[0];
            battleState.turn = 1;

            /*
             * [1vs1限定サイズ変更]
             * 接続直後(initialize())の時点ではまだ何人で対戦するか
             * 分からず、暫定的に2人対戦(12×12)として盤面を作っていた。
             * ここで実際の参加人数が確定するので、必要ならBOARD_SIZEを
             * 16に更新し、下のcreateBoard()で盤面ごと作り直す。
             */
            BOARD_SIZE = getBoardSizeForPlayerCount(battleState.activePlayers.length);

            /*
             * [PARTY FIX 4: battle_startのpartyを唯一の初期値にする]
             *
             * サーバーのroom_readyで確定したpartyを受け取り、
             * createUnits()より前に反映します。
             */
            onlinePartyByPlayer = {};
            const nextPlayerNames = { 1: "PLAYER1", 2: "PLAYER2", 3: "PLAYER3", 4: "PLAYER4" };

            players.forEach(entry => {
                const playerNumber = Number(entry.player);

                if (!Number.isInteger(playerNumber)) {
                    return;
                }

                if (Array.isArray(entry.party)) {
                    onlinePartyByPlayer[playerNumber] =
                        entry.party
                            .map(Number)
                            .filter(Number.isFinite)
                            .slice(0, window.MONSTER_WAR_CONSTANTS.PARTY_MAX_SIZE);
                }

                nextPlayerNames[playerNumber] = String(entry.name || `PLAYER${playerNumber}`);
            });

            onlinePlayerNames = nextPlayerNames;
            updatePlayerNameHeaders();

            onlineBattleStarted = true;

            createUnits();
            // BOARD_SIZEが変わっていてもいなくても、createBoard()が
            // 盤面の再構築・CSS変数の同期・城の再配置(renderCastles())
            // まで一括で行う。
            createBoard();
            renderUnitIcons();
            renderPlayerPanels();
            updateControlPanel();

            // 参加者の中で一番若い番号の人が最初の状態を送信する。
            if (
                !isSpectatorMode() &&
                Number(MY_PLAYER_NUMBER) === battleState.activePlayers[0]
            ) {
                onlineSendState();
            }
            return;
        }

        if (message.type === "battle_state") {
            applyOnlineState(message.state);
            return;
        }

        if (message.type === "battle_event") {
            if (message.event === "kill_cut_in") {
                const attacker = message.data;

                if (attacker) {
                    showKillCutIn(attacker);

                    if (attacker.characterId != null) {
                        playCharacterSong(attacker.characterId);
                    }
                }
            }

            if (message.event === "battle_log") {
                const logData = message.data;
                const logMessage =
                    typeof logData?.message === "string"
                        ? logData.message
                        : "";

                if (logMessage) {
                    // 送信元ではすでに追加済みなので、
                    // サーバーから受信した相手側だけがここを通ります。
                    addBattleLogFromOnline(logMessage);
                }
            }

            return;
        }
    });

    onlineSocket.addEventListener("close", () => {
        console.warn("オンライン対戦サーバーとの接続が切断されました。");
    });

    onlineSocket.addEventListener("error", error => {
        console.error("オンライン対戦通信エラー", error);
    });
}


/* ========================================
   BATTLE BGM
======================================== */

/*
 * [新しい音楽を流す時は、それまで鳴っていた音楽をすべて止める]
 *
 * BATTLE BGM(#battle-bgm)とキャラソン(characterSongAudio)は
 * それぞれ独立に再生されていたため、キル時にキャラソンが鳴り始めても
 * BGMは止まらず、両方が同時に鳴り続けてしまっていた。
 * 「何か新しい曲を再生する直前に、必ずこの関数を呼んで
 * 今鳴っている音楽をすべて止める」というルールに統一する。
 * BGM側・キャラソン側どちらの再生開始処理からも、
 * play()を呼ぶ直前に必ずこれを呼ぶ。
 */
function stopAllBattleAudio() {

    const bgm = document.getElementById("battle-bgm");

    if (bgm && !bgm.paused) {
        bgm.pause();
    }

    if (characterSongAudio && !characterSongAudio.paused) {
        characterSongAudio.pause();
        characterSongAudio.currentTime = 0;
    }

}

/*
 * [BATTLE中はCanChokeInst.mp3を再生]
 * battle.html側の<audio id="battle-bgm">を対戦中ずっとループ再生する。
 *
 * ブラウザの自動再生ポリシーにより、ユーザー操作を伴わないページ読み込み
 * 直後の音声再生は失敗することがある（ROOM→BATTLEの画面遷移は
 * ページ全体の再読み込みを伴うため、遷移前のクリックは
 * 「このページ上の操作」としては引き継がれない場合がある）。
 * そのため、まず即座に再生を試み、失敗した場合は最初のクリック/
 * キー入力/タップを待ってから再度再生を試みるようにしてある。
 */
function startBattleBgm() {

    const bgm = document.getElementById("battle-bgm");

    if (!bgm) {
        return;
    }

    bgm.volume = 0.6;
    bgm.loop = true;

    // [キャラソン復元] デフォルトBGMに戻すので「今流れているべき曲」もnullにする。
    battleState.currentTrackCharacterId = null;

    const tryPlay = () => {
        stopAllBattleAudio();
        return bgm.play().catch(error => {
            console.warn("BGMの自動再生がブロックされました。操作待ちします。", error);
        });
    };

    tryPlay();

    /*
     * [BUGFIX / キャラソン再生中に何か操作するとデフォルトBGMに戻る件]
     * このリスナーは「読み込み直後の自動再生がブロックされたときのため」の
     * ものだが、以前は成功・失敗にかかわらず常に登録され、しかも
     * 「一番最初のクリック/キー入力/タップ」で無条件にデフォルトBGMへ
     * 戻していた。そのため、キルカットインでキャラソンに切り替わった後に
     * 何か操作すると、このリスナーが（ずっと前に登録されたまま）発火して
     * キャラソンを止めデフォルトBGMに戻してしまっていた
     * （特にタブを再読み込みした直後はinitialize()がここを再実行するため
     * 顕在化しやすい）。
     * すでに別の曲(キャラソン)へ切り替わっている場合は何もしないようにする。
     */
    const resumeOnInteraction = () => {
        if (battleState.currentTrackCharacterId != null) {
            return;
        }

        stopAllBattleAudio();
        bgm.play().catch(() => {});
    };

    ["click", "keydown", "touchstart"].forEach(eventName => {
        document.addEventListener(
            eventName,
            resumeOnInteraction,
            { once: true }
        );
    });
}


/* ========================================
   CHARACTER SONG
======================================== */


let characterSongAudio = null;

/*
 * [BUGFIX / タブを閉じて再度開くとキャラソンが消える件]
 * 再接続直後などユーザー操作がまだ発生していないタイミングでは
 * 自動再生がブロックされることがある。以前はここで再生に失敗すると
 * そのまま諦めて無音になっていた（startBattleBgm()側にだけ
 * 「最初の操作を待って再試行する」仕組みがあった）。
 * ここにも同様の再試行を用意し、かつ「その後さらに別のキルが起きて
 * 曲が変わっていたら何もしない」ようにcharacterIdを見て確認する。
 */
function playCharacterSong(characterId) {

    /*
     * [DB統合 / 保守性]
     * characterSongDatabaseは「id → 曲パス(文字列)」だけを持つ
     * 形になった(以前は{path, title}のオブジェクトだったが、
     * titleはほぼcharacter.nameの複製でしかなかったため廃止)。
     * ログ表示用のラベルは、都度getCharacter()でキャラ名を引いて作る。
     */
    const songPath = characterSongDatabase?.[characterId];

    // [キャラソン復元] 「今流れているべき曲」をこのキャラのものにする。
    battleState.currentTrackCharacterId = characterId;

    /*
     * [新しい音楽を流す時は、それまで鳴っていた音楽をすべて止める]
     * 以前はここで前回のキャラソンだけを止めていたが、
     * BGM(#battle-bgm)が鳴っていた場合はそちらが止まらず、
     * キャラソンと同時に鳴り続けてしまっていた。
     * stopAllBattleAudio()でBGM・前回のキャラソンの両方を止めてから
     * 新しい曲の再生を始める。
     */
    stopAllBattleAudio();

    const audio = new Audio(songPath || "../audio/CanChoke.mp3");

    audio.volume = 1.0;

    // [LOOP再生] キャラソン(フォールバックの通常曲含む)も
    // 終わったら最初から繰り返す。
    audio.loop = true;

    characterSongAudio = audio;

    const label =
        songPath
            ? `${getCharacter(characterId)?.name || "?"}のテーマ`
            : "通常曲";

    const tryPlay = () => {
        return audio.play().catch(error => {
            console.warn(`${label}の再生がブロックされました。操作待ちします。`, error);
        });
    };

    tryPlay();

    const resumeOnInteraction = () => {
        // すでに別の曲に切り替わっていたら(このaudioが差し替えられていたら)何もしない。
        if (
            characterSongAudio !== audio ||
            battleState.currentTrackCharacterId !== characterId
        ) {
            return;
        }

        audio.play().catch(() => {});
    };

    ["click", "keydown", "touchstart"].forEach(eventName => {
        document.addEventListener(
            eventName,
            resumeOnInteraction,
            { once: true }
        );
    });

    console.log(`${label} を再生します。`);
}


/* ========================================
   KILL CUT-IN
======================================== */

let killCutInTimer = null;
let yourTurnCutInTimer = null;
let lastYourTurnKey = null;

function showYourTurnCutIn() {

    /*
     * [BUGFIX / 4人対戦対応漏れ]
     * 以前は2人対戦専用に「MY_PLAYER_NUMBERが1か2以外なら何もしない」
     * という早期returnが残っており、P3・P4には「YOUR TURN」演出が
     * 一切表示されなかった。1〜4番すべてで表示されるようにする。
     */
    if (
        !Number.isInteger(Number(MY_PLAYER_NUMBER)) ||
        Number(MY_PLAYER_NUMBER) < 1 ||
        Number(MY_PLAYER_NUMBER) > 4
    ) {
        return;
    }

    const key = `${battleState.turn}-${battleState.currentPlayer}`;

    if (lastYourTurnKey === key) {
        return;
    }

    lastYourTurnKey = key;

    const existing = document.getElementById("your-turn-cut-in");
    if (existing) {
        existing.remove();
    }

    if (yourTurnCutInTimer) {
        clearTimeout(yourTurnCutInTimer);
        yourTurnCutInTimer = null;
    }

    const cutIn = document.createElement("div");
    cutIn.id = "your-turn-cut-in";
    cutIn.innerHTML = `<strong>YOUR TURN</strong>`;

    Object.assign(cutIn.style, {
        position: "fixed",
        inset: "0",
        zIndex: "99999",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        background: "rgba(0,0,0,0.18)",
        opacity: "0",
        transition: "opacity 120ms ease"
    });

    const text = cutIn.querySelector("strong");
    Object.assign(text.style, {
        display: "block",
        padding: "18px 48px",
        border: "5px solid #ffffff",
        background: "rgba(0,0,0,0.82)",
        color: "#ffffff",
        fontSize: "clamp(42px, 8vw, 110px)",
        fontWeight: "900",
        letterSpacing: "0.08em",
        transform: "skew(-8deg) scale(0.82)",
        textShadow: "0 0 18px rgba(255,255,255,0.8)",
        transition: "transform 160ms ease"
    });

    document.body.appendChild(cutIn);

    requestAnimationFrame(() => {
        cutIn.style.opacity = "1";
        text.style.transform = "skew(-8deg) scale(1)";
    });

    yourTurnCutInTimer = setTimeout(() => {
        cutIn.style.opacity = "0";
        text.style.transform = "skew(-8deg) scale(1.08)";

        setTimeout(() => {
            cutIn.remove();
        }, 160);
    }, 760);
}

function showKillCutIn(attacker) {
    if (!attacker) {
        return;
    }

    const existing =
        document.getElementById("kill-cut-in");

    if (existing) {
        existing.remove();
    }

    if (killCutInTimer) {
        clearTimeout(killCutInTimer);
        killCutInTimer = null;
    }

    const cutIn =
        document.createElement("div");

    cutIn.id = "kill-cut-in";
    cutIn.className =
        `kill-cut-in player-${attacker.player}`;

    const characterName =
        String(attacker.name || "");

    const imagePath =
        String(attacker.image || "");

    cutIn.innerHTML = `
        <div class="kill-cut-in-flash">
        
        </div>
        <div class="kill-cut-in-content">
            <div class="kill-cut-in-character">
                <img
                    src="${imagePath}"
                    alt=""
                >
            </div>
            <div class="kill-cut-in-text">
                <span class="kill-cut-in-label">
                    CHARACTER
                </span>
                <strong>
                    ${characterName}
                </strong>
                <span class="kill-cut-in-kill">
                    KILL!!
                </span>
            </div>
        </div>
    `;

    document.body.appendChild(cutIn);

    // 1秒程度で自動的に消す
    killCutInTimer =
        setTimeout(() => {
            cutIn.classList.add("is-hidden");

            setTimeout(() => {
                cutIn.remove();
            }, 180);
        }, 820);
}




function showYouLoseCutIn() {
    const existing = document.getElementById("you-lose-cut-in");
    if (existing) existing.remove();

    const cutIn = document.createElement("div");
    cutIn.id = "you-lose-cut-in";
    cutIn.innerHTML = `<strong>YOU LOSE</strong>`;

    Object.assign(cutIn.style, {
        position: "fixed",
        inset: "0",
        zIndex: "100000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        background: "rgba(0,0,0,0.30)",
        opacity: "0",
        transition: "opacity 140ms ease"
    });

    const text = cutIn.querySelector("strong");
    Object.assign(text.style, {
        display: "block",
        padding: "18px 48px",
        border: "5px solid #ffffff",
        background: "rgba(0,0,0,0.88)",
        color: "#ffffff",
        fontSize: "clamp(42px, 8vw, 110px)",
        fontWeight: "900",
        letterSpacing: "0.08em",
        transform: "skew(-8deg) scale(0.82)",
        textShadow: "0 0 18px rgba(255,255,255,0.8)",
        transition: "transform 160ms ease"
    });

    document.body.appendChild(cutIn);

    requestAnimationFrame(() => {
        cutIn.style.opacity = "1";
        text.style.transform = "skew(-8deg) scale(1)";
    });

    setTimeout(() => {
        cutIn.style.opacity = "0";
        text.style.transform = "skew(-8deg) scale(1.08)";
        setTimeout(() => cutIn.remove(), 180);
    }, 1000);
}


/* ========================================
   PLAYER COLORS
======================================== */

/*
 * [4人対戦対応 / 色分け]
 * プレイヤーごとの色(青・赤・黄・緑)は shared/constants.js の
 * PLAYER_COLORSただ一箇所で管理する。ここではその16進数カラーコードを
 * 枠線やUIで使いやすいrgba()に変換するだけにしておき、
 * 「誰が何色か」を複数箇所で決め打ちしないようにする。
 */
function hexToRgba(hex, alpha) {
    const normalized = String(hex || "").replace("#", "");

    const r = parseInt(normalized.slice(0, 2), 16) || 0;
    const g = parseInt(normalized.slice(2, 4), 16) || 0;
    const b = parseInt(normalized.slice(4, 6), 16) || 0;

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getPlayerColorHex(player) {
    return (
        window.MONSTER_WAR_CONSTANTS?.PLAYER_COLORS?.[Number(player)] ||
        "#999999"
    );
}

function getPlayerColorRgba(player, alpha = 1) {
    return hexToRgba(getPlayerColorHex(player), alpha);
}


/* ========================================
   BATTLE STATE
======================================== */

/*
 * [4人対戦対応 / 盤面の自動FIT]
 * 4隅すべての城を定義しておき、実際にどれを使うかは
 * battleState.activePlayers（＝その対戦に実際に参加している人数分の
 * プレイヤー番号）を見て自動で絞り込む。
 * 2人対戦なら1・2番(対角2箇所)だけが使われる、以前と全く同じ配置になる。
 *
 * [1vs1限定サイズ変更]
 * 以前はconstのオブジェクトとしてBOARD_SIZE(16)を1回だけ埋め込んでいたが、
 * それだと後からBOARD_SIZEが12に変わっても城の位置が古い16のままズレて
 * しまう。呼ばれるたびにその時点のBOARD_SIZEで座標を作り直す関数にした。
 */
function getSiegeCastles() {
    return {
        1: { row: BOARD_SIZE, column: 1 },       // 左下
        2: { row: 1, column: BOARD_SIZE },       // 右上
        3: { row: 1, column: 1 },                // 左上
        4: { row: BOARD_SIZE, column: BOARD_SIZE } // 右下
    };
}

const battleState = {

    turn: 1,

    currentPlayer: 1,

    /*
     * [4人対戦対応]
     * 実際にこの対戦へ参加しているプレイヤー番号の一覧(着席順)。
     * オフライン対戦(ホットシート)では常に[1, 2]。
     * オンライン対戦ではbattle_start受信時に、実際に着席していた
     * 人数分(2〜4人)のプレイヤー番号へ差し替えられる。
     * 手番のローテーション・城の自動配置・パネル表示すべてが
     * この配列だけを基準に動く。
     */
    activePlayers: [1, 2],

    /*
     * 脱落済みのプレイヤー番号一覧。
     * 城を落とされる、または自軍が全滅すると、そのプレイヤーだけが
     * ここに追加されて手番ローテーションから外れる（対戦自体は続行）。
     * activePlayers.length - eliminatedPlayers.length が1人になった時点で
     * 対戦全体が終了する。
     */
    eliminatedPlayers: [],

    selectedUnitId: null,

    movableCells: [],

    units: [],

    movedUnits: new Set(),

    actionPhase: null,

    // [MOVE UNDO]
    // actionPhase中のユニットが「移動前にいたマス」を覚えておくための領域。
    // 行動(技/待機/ブラフ)を選ぶ前に「移動をやり直す」を押したとき、
    // ここへ戻す。行動を確定した後はfinishUnitAction()でnullに戻す。
    actionOriginRow: null,

    actionOriginColumn: null,

    skillPhase: null,

    skillDirection: null,

    skillTargetCells: [],

    selectedSkillId: null,

    gameOver: false,

    winner: null,

    gameOverReason: "",

    battleLogs: [],

    bluffUnits: new Set(),

    /*
     * プレイヤーごとに共有するブラフ使用回数。
     * [4人対戦対応] 3人目・4人目が参加しても使えるよう、
     * 1〜4番すべてに用意しておく(2人対戦では3・4番は単に使われない)。
     */
    bluffUses: {
        1: {
            ketsukacchin: 1,
            ketsuiki: 1,
            dappunta: 1
        },
        2: {
            ketsukacchin: 1,
            ketsuiki: 1,
            dappunta: 1
        },
        3: {
            ketsukacchin: 1,
            ketsuiki: 1,
            dappunta: 1
        },
        4: {
            ketsukacchin: 1,
            ketsuiki: 1,
            dappunta: 1
        }
    },

    /*
     * [BUGFIX / タブを閉じて再度開くとキャラソンが消える件]
     * キルカットインで流れ始めたキャラソンは、これまで
     * battleStateの一部として同期されておらず、あくまで
     * 各クライアントのローカルな再生状態でしかなかった。
     * そのため再読み込み(タブを閉じて再度開く等)すると
     * initialize()が毎回デフォルトBGMから再生し直してしまい、
     * すでにキャラソンへ切り替わっていたはずの試合でも
     * デフォルトBGMに戻ってしまっていた。
     * 「今流れているべき曲」をbattleState自体に持たせて
     * serializeBattleState/applyOnlineStateで同期対象に含めることで、
     * 再接続時にも正しい曲へ復元できるようにする。
     * null = デフォルトBGM、数値 = そのcharacterIdのキャラソン。
     */
    currentTrackCharacterId: null

};

/* ========================================
   PLAYER 1 PARTY
======================================== */

function loadPlayer1Party() {

    try {

        const saved =
            JSON.parse(
                localStorage.getItem(
                    window.MONSTER_WAR_CONSTANTS.STORAGE_KEYS.PARTY
                ) || "[]"
            );


        if (Array.isArray(saved)) {

            const party =
                saved
                    .filter(
                        id =>
                            getCharacter(id)
                    )
                    .slice(0, window.MONSTER_WAR_CONSTANTS.PARTY_MAX_SIZE);


            if (party.length > 0) {

                return party;

            }

        }

    } catch (error) {

        console.error(
            "パーティの読み込みに失敗しました。",
            error
        );

    }


    return [
        1,
        2,
        3,
        4,
        5,
        6
    ];

}


/* ========================================
   PARTY
======================================== */

const PLAYER_1_PARTY =
    loadPlayer1Party();


/*
 * 現在は対戦相手が未接続のため仮パーティ
 */
const PLAYER_2_PARTY = [
    7,
    8,
    9,
    10,
    11,
    12
];


/* ========================================
   BATTLE LOG
======================================== */

function ensureBattleLog() {

    if (!battleField || !fieldArea) {
        return null;
    }

    let logElement =
        fieldArea.querySelector(".battle-log");

    if (!logElement) {

        logElement =
            document.createElement("div");

        logElement.className = "battle-log";
        logElement.setAttribute("aria-live", "polite");

        // 盤面のサイズやレイアウトを変更しないよう、
        // battle-field-wrapperの中にログを絶対配置する。
        const wrapper =
            fieldArea.querySelector(".battle-field-wrapper");

        if (wrapper) {
            wrapper.appendChild(logElement);
        } else {
            fieldArea.appendChild(logElement);
        }
    }

    return logElement;
}

function addBattleLogFromOnline(message) {

    if (!message) {
        return;
    }

    const logElement = ensureBattleLog();

    if (!logElement) {
        return;
    }

    battleState.battleLogs.push(String(message));

    logElement.innerHTML = "";

    battleState.battleLogs.forEach(
        (messageText, index) => {

            const entry =
                document.createElement("div");

            entry.className = "battle-log-entry";

            if (
                index ===
                battleState.battleLogs.length - 1
            ) {
                entry.classList.add("latest");
            }

            entry.textContent = messageText;

            logElement.appendChild(entry);
        }
    );

    logElement.scrollTop =
        logElement.scrollHeight;
}


function addBattleLog(message) {

    if (!message) {
        return;
    }

    const logElement = ensureBattleLog();

    if (!logElement) {
        return;
    }

    const logMessage = String(message);
    battleState.battleLogs.push(logMessage);

    // オンライン対戦ではログを即時イベントとして相手へ送信します。
    // battle_stateの送信タイミングに依存しないため、
    // キルログなども両画面へ確実に反映されます。
    if (
        ONLINE_ROOM_ID &&
        onlineSocket &&
        onlineSocket.readyState === WebSocket.OPEN &&
        !onlineApplyingState
    ) {
        onlineSendBattleEvent("battle_log", {
            message: logMessage
        });
    }

    logElement.innerHTML = "";

    battleState.battleLogs.forEach(
        (messageText, index) => {

            const entry =
                document.createElement("div");

            entry.className = "battle-log-entry";

            if (
                index ===
                battleState.battleLogs.length - 1
            ) {
                entry.classList.add("latest");
            }

            entry.textContent = messageText;

            logElement.appendChild(entry);
        }
    );

    logElement.scrollTop =
        logElement.scrollHeight;
}


/* ========================================
   BOARD PERSPECTIVE
======================================== */

/*
 * [4人対戦対応 / 自分の陣地を常に左下に見せる]
 * 以前はPLAYER2のときだけ180度反転(上下左右とも反転)していたが、
 * PLAYER3(左上スタート)・PLAYER4(右下スタート)にも対応させた。
 * ゲームデータ(行・列)自体は変更せず、CSS Gridの表示位置だけを
 * 反転させている点は以前と同じ。
 *
 * PLAYER1: 反転なし(元々左下)
 * PLAYER2: 上下・左右とも反転(元は右上)
 * PLAYER3: 上下だけ反転(元は左上)
 * PLAYER4: 左右だけ反転(元は右下)
 */
function updateBoardPerspective() {

    if (!battleField) {
        return;
    }

    const playerNumber = Number(MY_PLAYER_NUMBER);

    const flipRow = playerNumber === 2 || playerNumber === 3;
    const flipColumn = playerNumber === 2 || playerNumber === 4;

    battleField
        .querySelectorAll(".board-cell")
        .forEach(cell => {

            const row = Number(cell.dataset.row);
            const column = Number(cell.dataset.column);

            cell.style.gridRow =
                String(flipRow ? BOARD_SIZE - row + 1 : row);

            cell.style.gridColumn =
                String(flipColumn ? BOARD_SIZE - column + 1 : column);
        });

}


/* ========================================
   CREATE BOARD
======================================== */

function createBoard() {

    if (!battleField) {
        return;
    }

    // [1vs1限定サイズ変更] CSS側の --board-size もBOARD_SIZEの現在値に合わせる。
    applyBoardSizeCssVariable();


    battleField.innerHTML = "";


    for (
        let row = 1;
        row <= BOARD_SIZE;
        row++
    ) {

        for (
            let column = 1;
            column <= BOARD_SIZE;
            column++
        ) {

            const cell =
                document.createElement(
                    "div"
                );


            cell.className =
                "board-cell";


            cell.dataset.row =
                row;


            cell.dataset.column =
                column;


            /*
             * [CHECKER BOARD / 保守性]
             * 以前はCSSの:nth-child(40n+...)で
             * 20列固定の市松模様を再現していたが、
             * BOARD_SIZEを変更すると列数がずれて
             * 模様が壊れてしまっていた。
             *
             * (row + column) の偶奇でクラスを付与する方式にすることで、
             * BOARD_SIZEがいくつであっても正しい市松模様になる。
             */

            if ((row + column) % 2 === 0) {

                cell.classList.add(
                    "alt-cell"
                );

            }


            cell.addEventListener(
                "click",
                () => {

                    handleCellClick(
                        row,
                        column
                    );

                }
            );


            battleField.appendChild(
                cell
            );

        }

    }

    /*
     * 盤面右下の「N × N」表記もBOARD_SIZEから自動生成する
     */

    if (fieldArea) {

        fieldArea.dataset.boardLabel =
            `${BOARD_SIZE} × ${BOARD_SIZE}`;

    }

    updateBoardPerspective();
    renderCastles();
}


/* ========================================
   GET CELL
======================================== */

function getCell(
    row,
    column
) {

    return battleField?.querySelector(
        `.board-cell[data-row="${row}"][data-column="${column}"]`
    );

}

/* ========================================
   SIEGE BATTLE
======================================== */

/*
 * [4人対戦対応 / 盤面の自動FIT]
 * SIEGE_CASTLESには4隅すべてを定義してあるが、実際に「城」として
 * 機能するのは今の対戦に参加しているプレイヤー(battleState.activePlayers)の
 * 分だけ。脱落済みのプレイヤーの城は無効化しない
 * （脱落後もそのマスへの侵入自体は特に意味を持たないので、
 * getCastleAtの呼び出し側であるcheckCastleVictory側で
 * 「すでに脱落済みの城には反応しない」判定を行う）。
 */
function getActiveCastles() {
    return Object.entries(getSiegeCastles())
        .filter(
            ([player]) =>
                battleState.activePlayers.includes(Number(player))
        )
        .map(
            ([player, castle]) => [Number(player), castle]
        );
}

function getCastleAt(row, column) {

    for (const [player, castle] of getActiveCastles()) {

        if (
            castle.row === row &&
            castle.column === column
        ) {
            return player;
        }
    }

    return null;
}


function renderCastles() {

    /*
     * [4人対戦対応]
     * オフライン既定の2人分でまず1回描画され、オンライン対戦では
     * battle_start受信時に実際の参加人数(2〜4人)へ差し替えて
     * 再度呼ばれる。再描画のたびに前回分の城マークを消してから
     * 現在のactivePlayers分だけを描き直す。
     */
    battleField
        ?.querySelectorAll(".board-cell.siege-castle")
        .forEach(
            cell => {
                cell.classList.remove("siege-castle");
                delete cell.dataset.castleOwner;
                cell.innerHTML = "";
            }
        );

    getActiveCastles()
        .forEach(
            ([player, castle]) => {

                const cell =
                    getCell(
                        castle.row,
                        castle.column
                    );

                if (!cell) {
                    return;
                }

                cell.classList.add(
                    "siege-castle"
                );

                cell.dataset.castleOwner =
                    player;

                cell.innerHTML = `
                    <div class="castle-mark">
                        <span>城</span>
                        <small>P${player}</small>
                    </div>
                `;
            }
        );
}


function showBattleResult(
    winner,
    reason
) {

    if (battleState.gameOver) {
        return;
    }

    battleState.gameOver = true;
    // [4人対戦対応] 相討ちで全員脱落した場合はwinnerがnullになり得るので、
    // Number(null)===0にならないようnull自体を保持する。
    battleState.winner = winner === null || winner === undefined ? null : Number(winner);
    battleState.gameOverReason = String(reason || "");

    if (
        battleState.winner !== null &&
        Number(battleState.winner) !== Number(MY_PLAYER_NUMBER)
    ) {
        showYouLoseCutIn();
    }

    battleState.selectedUnitId = null;
    battleState.movableCells = [];
    battleState.actionPhase = null;
    battleState.skillPhase = null;
    battleState.skillStep = null;

    clearCellStates();

    renderUnitIcons();
    renderPlayerPanels();

    /*
     * 結果パネル（YOU LOSE表示・タイトルに戻るボタンを含む）の描画は
     * updateControlPanel()側に一本化してある。
     * こうすることで、勝敗をローカルで検知したクライアントだけでなく、
     * applyOnlineState()経由でgameOverを受け取った側（＝敗者側や観戦者）でも
     * 同じロジックで結果パネルが描画される。
     */
    updateControlPanel();

    // オンライン対戦では勝敗情報を含む最終状態を相手へ即時同期する。
    if (ONLINE_ROOM_ID && !onlineApplyingState) {
        onlineSendState();
    }
}


/*
 * [4人対戦対応 / 脱落方式]
 * 以前は2人対戦専用で「どちらかが全滅したら即決着」だったが、
 * 3〜4人対戦では「脱落した本人だけがその場で抜け、対戦は続行」という
 * ルールになった。
 *
 * getActivePlayers()はまだ脱落していない参加プレイヤー番号を返す。
 * 手番のローテーション(advanceToNextPlayer)もこれを基準に回すため、
 * 脱落者は自動的に手番から外れる。
 */
function getActivePlayers() {
    return battleState.activePlayers.filter(
        player => !battleState.eliminatedPlayers.includes(player)
    );
}

function eliminatePlayer(player, reason) {

    if (
        battleState.gameOver ||
        battleState.eliminatedPlayers.includes(player)
    ) {
        return;
    }

    battleState.eliminatedPlayers.push(player);

    /*
     * 脱落したプレイヤーの残りユニットは、Task1で実装した
     * 「死亡ユニットはマスに残したままグレーアウト」の仕組みを
     * そのまま流用する形で、その場で全滅扱いにする。
     */
    battleState.units
        .filter(
            targetUnit =>
                Number(targetUnit.player) === Number(player) &&
                targetUnit.alive
        )
        .forEach(
            targetUnit => {
                targetUnit.hp = 0;
                targetUnit.alive = false;
            }
        );

    addBattleLog(
        `${getPlayerDisplayName(player)}が脱落した！（${reason}）`
    );

    const remaining = getActivePlayers();

    if (remaining.length <= 1) {
        showBattleResult(
            remaining[0] ?? null,
            remaining.length === 1
                ? `${getPlayerDisplayName(remaining[0])}以外が全員脱落`
                : "全員脱落"
        );
    }
}

function checkVictoryCondition() {

    if (battleState.gameOver) {
        return true;
    }

    /*
     * まだ脱落していない参加プレイヤーのうち、
     * 生存ユニットが1体もいない人をここで脱落させる。
     * （eliminatePlayer内でgameOverになった場合はそこで対戦終了処理まで行われる）
     */
    getActivePlayers().forEach(
        player => {

            const hasAliveUnit =
                battleState.units.some(
                    targetUnit =>
                        Number(targetUnit.player) === Number(player) &&
                        targetUnit.alive
                );

            if (!hasAliveUnit) {
                eliminatePlayer(player, "全滅");
            }

        }
    );

    return battleState.gameOver;
}


function checkCastleVictory(unit) {

    if (!unit || !unit.alive) {
        return false;
    }

    const castleOwner =
        getCastleAt(
            unit.row,
            unit.column
        );

    if (
        castleOwner === null ||
        castleOwner === unit.player ||
        battleState.eliminatedPlayers.includes(castleOwner)
    ) {
        return false;
    }

    addBattleLog(
        `${unit.name}が${getPlayerDisplayName(castleOwner)}の城へ侵入！`
    );

    eliminatePlayer(
        castleOwner,
        `${getPlayerDisplayName(unit.player)}に城を落とされた`
    );

    /*
     * 残りの参加者が1人になっていれば対戦全体の終了(gameOver)まで
     * eliminatePlayer内で処理済み。まだ複数人残っていれば、
     * このユニットは通常どおり行動選択フェーズへ進む
     * （＝moveUnit()側に「即終了ではない」ことを伝えるためfalseを返す）。
     */
    return battleState.gameOver;
}



/* ========================================
   CREATE UNIT
======================================== */

function createUnit(
    characterId,
    player,
    row,
    column,
    index
) {

    const character =
        getCharacter(characterId);


    if (!character) {
        return null;
    }


    return {

        unitId:
            `${player}-${characterId}-${index}`,

        player,

        characterId,

        name:
            character.name,

        image:
            character.image,

        maxHp:
            character.hp,

        hp:
            character.hp,

        attack:
            character.attack,

        defense:
            character.defense,

        move:
            character.move,

        row,

        column,

        alive: true,

        // 同じキャラクターが前回使った技
        // 次の行動では同じ技を連続使用できない
        lastSkillId: null,

        bluffType: null,

        /*
         * [BUGFIX / ドライブカンチョーの移動力がターンをまたいで
         * 伸び続ける件]
         * ドライブカンチョー(move_buff_all_allies)でmoveへ加算した
         * 分をここに記録しておく。guardNextTurn等と同様、
         * advanceToNextPlayer()で「このユニットの持ち主に
         * 次の自分の手番が回ってきた瞬間」に、この量だけmoveを
         * 差し引いて0に戻す。
         */
        moveBuffAmount: 0

    };

}


/* ========================================
   FORMATION
======================================== */

function getFormationPositions(
    player
) {

    /*
     * 攻城戦の初期配置
     * BOARD_SIZEに追従して、盤面外へ出ないようにする。
     *
     * [4人対戦対応]
     * 4隅すべてに、それぞれの城を囲むL字型の初期配置を用意した。
     * PLAYER 1：左下の城をL字に囲む
     * PLAYER 2：右上の城をL字に囲む
     * PLAYER 3：左上の城をL字に囲む
     * PLAYER 4：右下の城をL字に囲む
     */

    if (player === 2) {
        return [
            { row: 2, column: BOARD_SIZE },
            { row: 3, column: BOARD_SIZE },
            { row: 4, column: BOARD_SIZE },
            { row: 1, column: BOARD_SIZE - 1 },
            { row: 1, column: BOARD_SIZE - 2 },
            { row: 1, column: BOARD_SIZE - 3 }
        ];
    }

    if (player === 3) {
        return [
            { row: 2, column: 1 },
            { row: 3, column: 1 },
            { row: 4, column: 1 },
            { row: 1, column: 2 },
            { row: 1, column: 3 },
            { row: 1, column: 4 }
        ];
    }

    if (player === 4) {
        return [
            { row: BOARD_SIZE - 1, column: BOARD_SIZE },
            { row: BOARD_SIZE - 2, column: BOARD_SIZE },
            { row: BOARD_SIZE - 3, column: BOARD_SIZE },
            { row: BOARD_SIZE, column: BOARD_SIZE - 1 },
            { row: BOARD_SIZE, column: BOARD_SIZE - 2 },
            { row: BOARD_SIZE, column: BOARD_SIZE - 3 }
        ];
    }

    return [
        { row: BOARD_SIZE - 1, column: 1 },
        { row: BOARD_SIZE - 2, column: 1 },
        { row: BOARD_SIZE - 3, column: 1 },
        { row: BOARD_SIZE, column: 2 },
        { row: BOARD_SIZE, column: 3 },
        { row: BOARD_SIZE, column: 4 }
    ];
}


/* ========================================
   CREATE UNITS
======================================== */

function createUnits() {

    battleState.units = [];


    /*
     * [4人対戦対応]
     * 以前はPLAYER1/PLAYER2の2人決め打ちだったが、
     * battleState.activePlayers（実際にこの対戦に参加している
     * プレイヤー番号、2〜4人）の分だけユニットを生成するようにした。
     * オフライン対戦(ホットシート)ではactivePlayersが常に[1, 2]なので、
     * 従来どおりPLAYER_1_PARTY/PLAYER_2_PARTYが使われる。
     */
    const players = battleState.activePlayers.map(
        player => ({
            player,
            party:
                ONLINE_ROOM_ID
                    ? (onlinePartyByPlayer[player] ?? [])
                    : (
                        player === 1
                            ? PLAYER_1_PARTY
                            : player === 2
                                ? PLAYER_2_PARTY
                                : []
                    )
        })
    );


    players.forEach(
        ({
            party,
            player
        }) => {

            const positions =
                getFormationPositions(
                    player
                );


            party.forEach(
                (
                    characterId,
                    index
                ) => {

                    const position =
                        positions[index];


                    if (!position) {
                        return;
                    }


                    const unit =
                        createUnit(

                            characterId,

                            player,

                            position.row,

                            position.column,

                            index

                        );


                    if (unit) {

                        battleState.units.push(
                            unit
                        );

                    }

                }
            );

        }
    );

}


/* ========================================
   UNIT SEARCH
======================================== */

function getUnit(
    unitId
) {

    return battleState.units.find(
        unit =>
            unit.unitId === unitId
    );

}


function getUnitAt(
    row,
    column
) {

    return battleState.units.find(
        unit =>

            unit.alive &&

            unit.row === row &&

            unit.column === column

    );

}


/* ========================================
   RENDER UNIT ICONS
======================================== */

function renderUnitIcons() {

    if (!battleField) {
        return;
    }


    /*
     * 以前のアイコンをすべて削除
     */

    battleField
        .querySelectorAll(
            ".board-unit-icon"
        )
        .forEach(
            icon => {

                icon.remove();

            }
        );


    /*
     * 生存・死亡を問わず全ユニットを盤面へ配置する。
     *
     * 死亡したキャラも「そのマスにいた」というオブジェクトとして
     * 盤面に残し、アイコンをグレーアウトして表示する
     * （デッドカンチョーで削除されるまでは残り続ける）。
     *
     * 同じマスに死亡ユニットと生存ユニットが重なった場合に
     * 生存側が必ず手前に見えるよう、
     * 「死亡ユニット → 生存ユニット」の順で描画する。
     */

    const drawOrderUnits =
        [...battleState.units].sort(
            (a, b) =>
                Number(a.alive) - Number(b.alive)
        );

    drawOrderUnits.forEach(
        unit => {

            const cell =
                getCell(
                    unit.row,
                    unit.column
                );


            if (!cell) {
                return;
            }


            const icon =
                document.createElement(
                    "img"
                );


            icon.className =
                unit.alive
                    ? "board-unit-icon"
                    : "board-unit-icon dead";


            icon.src =
                unit.image;


            icon.alt =
                "";


            /*
             * アイコン自体はクリック判定を持たせない
             * → 下のマスをそのままクリックできる
             */

            icon.style.position =
                "absolute";

            icon.style.left =
                "50%";

            icon.style.top =
                "50%";

            icon.style.width =
                "82%";

            icon.style.height =
                "82%";

            icon.style.transform =
                "translate(-50%, -50%)";

            icon.style.objectFit =
                "contain";

            icon.style.pointerEvents =
                "none";

            icon.style.userSelect =
                "none";

            /*
             * 死亡ユニットは生存ユニットの下に
             * 表示されるよう、z-indexを一段低くする
             */

            icon.style.zIndex =
                unit.alive
                    ? "2"
                    : "1";


            /*
             * 選択中のキャラだけ少し強調
             * （死亡ユニットは選択できないため、常に生存ユニットのみ対象）
             */

            if (
                unit.alive &&
                battleState.selectedUnitId ===
                unit.unitId
            ) {

                icon.style.filter =
                    "brightness(1.2)";

                icon.style.transform =
                    "translate(-50%, -50%) scale(1.08)";

            }


            /*
             * PLAYERごとに薄い枠を追加
             * [4人対戦対応] 青/赤の2択だったのを、
             * PLAYER_COLORS(青・赤・黄・緑)から引く方式に変更。
             */

            icon.style.boxSizing =
                "border-box";


            icon.style.border =
                `2px solid ${getPlayerColorRgba(unit.player, 0.8)}`;


            icon.style.borderRadius =
                "50%";


            /*
             * 死亡ユニットのグレーアウト表示。
             * filterはborder/box-shadowを含めた
             * アイコン全体に一括で適用されるため、
             * 枠線ごと自然にモノクロ化される。
             */

            if (!unit.alive) {

                icon.style.filter =
                    "grayscale(1) brightness(0.55)";

                icon.style.opacity =
                    "0.55";

            }


            cell.appendChild(
                icon
            );

        }
    );

}


/* ========================================
   CLEAR BOARD STATES
======================================== */

function clearCellStates() {

    battleField
        ?.querySelectorAll(
            ".board-cell"
        )
        .forEach(
            cell => {

                cell.classList.remove(
                    "movable",
                    "selected",
                    "skill-target",
                    "skill-target-self",
                    "skill-direction"
                );

            }
        );

}


/* ========================================
   MOVEMENT RANGE
======================================== */

function getMovableCells(unit) {

    if (!unit || !unit.alive) {
        return [];
    }

    /*
     * 経路探索による移動。
     *
     * コマが存在するマスは
     * 「停止」だけでなく「通過」も不可。
     *
     * したがって敵コマを跨いで
     * 奥へ移動することはできません。
     *
     * 敵城は空きマスなので侵入可能です。
     *
     * 現在いるマスも移動先として選択可能。
     * その場にとどまる場合は
     * 現在位置をクリックします。
     */

    const cells = [
        {
            row: unit.row,
            column: unit.column
        }
    ];

    const queue = [
        {
            row: unit.row,
            column: unit.column,
            distance: 0
        }
    ];

    const visited = new Set([
        `${unit.row},${unit.column}`
    ]);

    const directions = [
        {
            row: -1,
            column: 0
        },
        {
            row: 1,
            column: 0
        },
        {
            row: 0,
            column: -1
        },
        {
            row: 0,
            column: 1
        }
    ];

    while (queue.length > 0) {

        const current = queue.shift();

        if (
            current.distance >=
            Number(unit.move || 0)
        ) {
            continue;
        }

        directions.forEach(
            direction => {

                const row =
                    current.row +
                    direction.row;

                const column =
                    current.column +
                    direction.column;

                if (
                    row < 1 ||
                    row > BOARD_SIZE ||
                    column < 1 ||
                    column > BOARD_SIZE
                ) {
                    return;
                }

                const key =
                    `${row},${column}`;

                if (visited.has(key)) {
                    return;
                }

                /*
                 * 生存中のコマは障害物。
                 * 敵味方を問わず跨げません。
                 */
                if (
                    getUnitAt(
                        row,
                        column
                    )
                ) {
                    return;
                }

                visited.add(key);

                const distance =
                    current.distance + 1;

                cells.push({
                    row,
                    column
                });

                queue.push({
                    row,
                    column,
                    distance
                });
            }
        );
    }

    return cells;
}


/* ========================================
   SELECT UNIT
======================================== */

function selectUnit(
    unitId
) {

    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    if (battleState.gameOver) {
        return;
    }

    const unit =
        getUnit(unitId);


    if (
        !unit ||
        !unit.alive
    ) {

        return;

    }


    if (
        unit.player !==
        battleState.currentPlayer
    ) {

        return;

    }


    /*
     * 移動後の行動選択中は
     * 他のキャラクターを選択できない
     */

    if (
        battleState.actionPhase
    ) {

        return;

    }


    if (
        battleState.movedUnits.has(
            unit.unitId
        )
    ) {

        return;

    }


    battleState.selectedUnitId =
        unit.unitId;

    /*
     * [BUGFIX / 連続使用不可が機能していなかった件]
     * 以前はここで unit.lastSkillId を毎回nullにリセットしていたが、
     * これだと「前回使ったのと同じ技かどうか」を判定する直前に
     * 毎回消してしまうことになり、制約が実質常に無効化されていた
     * （このユニットを選び直すたびに前回の記録が消えるので、
     * 直前に使った技が二度と技選択画面に反映されなかった）。
     *
     * 「連続使用不可」を機能させるには、ここでリセットしてはいけない。
     * lastSkillId は
     *   ・技を実際に発動したとき → その技のIDを記録（executeSkill内）
     *   ・待機／ブラフを選んだとき → null にリセット（waitUnit/selectBluffType内）
     * の2箇所だけで更新する。これにより
     * 「1 攻撃 → 2 待機 → 3 攻撃」で1と同じ技を3でも使えるが、
     * 「1 攻撃 → 2 攻撃（同じ技）」は正しくブロックされる。
     */

    battleState.movableCells =
        getMovableCells(
            unit
        );


    clearCellStates();


    const selectedCell =
        getCell(
            unit.row,
            unit.column
        );


    selectedCell?.classList.add(
        "selected"
    );


    battleState.movableCells
        .forEach(
            ({
                row,
                column
            }) => {

                getCell(
                    row,
                    column
                )?.classList.add(
                    "movable"
                );

            }
        );


    renderUnitIcons();

    renderPlayerPanels();

    updateControlPanel();

}


/* ========================================
   BOARD CLICK
======================================== */

function handleCellClick(
    row,
    column
) {

    if (battleState.gameOver) {
        return;
    }

    /*
     * 技の対象選択中
     */

    if (battleState.skillPhase) {

        handleSkillTargetClick(row, column);

        return;

    }


    /*
     * 移動後の行動選択中は
     * 通常の盤面操作を受け付けない
     */

    if (battleState.actionPhase) {

        return;

    }


const clickedUnit =
    getUnitAt(row, column);

if (clickedUnit) {
    const selectedUnit =
        getUnit(battleState.selectedUnitId);

    // 選択中のキャラクター自身のマスなら、
    // キャラクター再選択ではなく移動判定へ進む
    if (
        !selectedUnit ||
        clickedUnit.unitId !== selectedUnit.unitId
    ) {
        if (
            clickedUnit.player ===
            battleState.currentPlayer
        ) {
            selectUnit(clickedUnit.unitId);
        }

        return;
    }
}


    const unit =
        getUnit(
            battleState.selectedUnitId
        );


    if (!unit) {
        return;
    }


    const movable =
        battleState.movableCells.some(
            cell =>
                cell.row === row &&
                cell.column === column
        );


    if (!movable) {
        return;
    }


    moveUnit(
        unit,
        row,
        column
    );

}


/* ========================================
   MOVE UNIT
======================================== */

function moveUnit(
    unit,
    row,
    column
) {

    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    // [MOVE UNDO]
    // 上書きする前に、移動前の位置を覚えておく。
    battleState.actionOriginRow =
        unit.row;

    battleState.actionOriginColumn =
        unit.column;

    unit.row =
        row;


    unit.column =
        column;

    /*
     * [BUGFIX / 移動やり直しがログに逐次残ってしまう件]
     * 以前はここで移動する度に必ずログを1行追加していたため、
     * 「移動 → やり直す → 別の場所へ移動」を繰り返すたびに
     * ログが際限なく増えていた（やり直して消えたはずの移動まで
     * ログに残り続けてしまっていた）。
     *
     * 移動はまだ「やり直せる」段階なので、ここではログに残さない。
     * 実際にログへ記録するのは、行動（技/待機/ブラフ）が確定して
     * もう後戻りできなくなった時点＝finishUnitAction() の中でまとめて行う。
     * これにより、何度やり直しても最終的な移動先が1回だけ記録される。
     *
     * 例外は下の敵城への突入（即時決着）。
     * この場合はfinishUnitAction()を経由しないため、ここで記録する。
     */

    /*
     * [4人対戦対応]
     * 敵城へ到達すると、その城の持ち主だけがその場で脱落する
     * (checkCastleVictory内)。残りの参加者が1人になった場合のみ
     * battleState.gameOverがtrueになり、ここで即座に行動選択フェーズを
     * スキップして終了する。複数人がまだ残っている場合はfalseが返るため、
     * このユニットは通常どおり下の行動選択フェーズへ進む。
     */
    if (checkCastleVictory(unit)) {

        addBattleLog(
            `${unit.name}が(${row},${column})へ移動した！`
        );

        onlineSendState();
        return;
    }


    battleState.movedUnits.add(
        unit.unitId
    );


    battleState.selectedUnitId =
        null;


    battleState.movableCells =
        [];


    /*
     * 移動完了後は
     * 必ず行動選択フェーズへ移行
     */

    battleState.actionPhase =
        unit.unitId;


    clearCellStates();


    renderUnitIcons();

    renderPlayerPanels();

    updateControlPanel();

    // 移動中はまだ相手へ同期しない。
    // 「移動 → 移動をやり直す」の途中経過を相手側へ送らず、
    // 行動確定時にだけ最終状態を同期する。

}


/*
 * [BUGFIX / 移動やり直しがログに逐次残ってしまう件]
 *
 * 以前はmoveUnit()が呼ばれる度（＝移動する度）に必ず
 * ログを1行追加しており、「移動 → やり直す → 別の場所へ移動」を
 * 繰り返すたびにログが際限なく増えていた
 * （やり直して無かったことになった移動まで、ログには残り続けていた）。
 *
 * 移動はundoMove()で取り消せる「まだ確定していない」状態なので、
 * moveUnit()の時点ではログに残さないようにした。
 * 代わりに、行動（技/待機/ブラフ）を確定させる
 * waitUnit() / executeSkill() / selectBluffType() の先頭で
 * この関数を呼び、「最終的にどこへ移動したか」を1回だけ記録する。
 * 移動していれば(actionOriginRow/Columnと現在地が違えば)ログに残し、
 * 結局移動しなかった（その場に留まった）場合は何も残さない。
 */
function logFinalizedMovementIfAny(unit) {

    if (!unit) {
        return;
    }

    if (
        battleState.actionOriginRow === null ||
        battleState.actionOriginColumn === null
    ) {
        return;
    }

    if (
        unit.row === battleState.actionOriginRow &&
        unit.column === battleState.actionOriginColumn
    ) {
        return;
    }

    addBattleLog(
        `${unit.name}が(${unit.row},${unit.column})へ移動した！`
    );

}


/* ========================================
   ACTION
======================================== */

function areAllCurrentPlayerUnitsActed() {

    const currentPlayer = Number(battleState.currentPlayer);

    const aliveUnits = battleState.units.filter(
        unit =>
            unit.alive &&
            Number(unit.player) === currentPlayer
    );

    if (aliveUnits.length === 0) {
        return false;
    }

    return aliveUnits.every(
        unit => battleState.movedUnits.has(unit.unitId)
    );
}

function finishUnitAction() {

    battleState.actionPhase = null;
    battleState.actionOriginRow = null;
    battleState.actionOriginColumn = null;
    battleState.skillPhase = null;
    battleState.skillDirection = null;
    battleState.skillTargetCells = [];
    battleState.skillSelectedTargetCells = [];
    battleState.skillStep = null;
    battleState.selectedSkillId = null;
    battleState.selectedUnitId = null;
    battleState.movableCells = [];

    clearCellStates();

    renderUnitIcons();
    renderPlayerPanels();
    updateControlPanel();

    if (areAllCurrentPlayerUnitsActed()) {
        endTurn();
        return;
    }

    onlineSendState();

}


/* ========================================
   WAIT
======================================== */

/* ========================================
   UNDO MOVE
======================================== */

function undoMove() {
    if (isSpectatorMode()) return;

    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    const unit =
        getUnit(
            battleState.actionPhase
        );

    if (
        !unit ||
        unit.player !== battleState.currentPlayer
    ) {
        return;
    }

    if (
        battleState.actionOriginRow === null ||
        battleState.actionOriginColumn === null
    ) {
        // 移動前の位置が記録されていない場合は何もしない
        // （待機の直後にブラウザバックした等の想定外の状態を保護）。
        return;
    }

    /*
     * [BUGFIX / 移動やり直しがログに逐次残ってしまう件]
     * やり直しは「なかったことにする」操作なので、
     * ここではログに何も残さない。移動自体のログも
     * moveUnit()側でもう出していないので、やり直しても
     * ログには何も痕跡が残らなくなる。
     */

    // 移動前の位置へ戻す
    unit.row = battleState.actionOriginRow;
    unit.column = battleState.actionOriginColumn;

    battleState.movedUnits.delete(unit.unitId);
    battleState.actionPhase = null;
    battleState.actionOriginRow = null;
    battleState.actionOriginColumn = null;

    // そのまま同じユニットを選択した状態に戻し、
    // 移動先を選び直せるようにする。
    battleState.selectedUnitId = unit.unitId;
    battleState.movableCells = getMovableCells(unit);

    clearCellStates();

    const selectedCell = getCell(unit.row, unit.column);
    selectedCell?.classList.add("selected");

    battleState.movableCells.forEach(({ row, column }) => {
        getCell(row, column)?.classList.add("movable");
    });

    renderUnitIcons();
    renderPlayerPanels();
    updateControlPanel();

    // やり直しも途中経過なので、ここでは同期しない。
    // 次に技・待機・ブラフなどで行動を確定した時点で最終状態を同期する。
}

function waitUnit() {
    if (isSpectatorMode()) return;


    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    const unit =
        getUnit(
            battleState.actionPhase
        );

    if (
        !unit ||
        unit.player !== battleState.currentPlayer
    ) {
        return;
    }

    logFinalizedMovementIfAny(unit);

    addBattleLog(`${unit.name}はその場で待機した！`);

    /*
     * [BUGFIX / 連続使用不可]
     * 技を使わない行動(待機)を挟んだので、
     * 「前回使った技」の記録はここでリセットする。
     * これにより「1 攻撃 → 2 待機 → 3 攻撃」で
     * 1と同じ技を3でも使えるようになる。
     */
    unit.lastSkillId = null;

    // 移動せず、その場にとどまって行動終了。
    battleState.movedUnits.add(unit.unitId);

    finishUnitAction();

}


/* ========================================
   BLUFF
======================================== */

function bluffUnit() {
    if (isSpectatorMode()) return;


    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    const unit =
        getUnit(
            battleState.actionPhase
        );

    if (
        !unit ||
        unit.player !== battleState.currentPlayer
    ) {
        return;
    }

    showBluffSelection(unit);

}


function showBluffSelection(unit) {

    const panel =
        document.getElementById(
            "battle-control-panel"
        );

    if (!panel || !unit) {
        return;
    }

    const bluffOptions = [
        {
            key: "ketsukacchin",
            name: "ケツカッチン",
            description: "次ターンに受けるダメージを0にする。時差式カンチョーには無効。"
        },
        {
            key: "ketsuiki",
            name: "ケツイキ",
            description: "次ターンに受けたダメージと同じ量を回復する。"
        },
        {
            key: "dappunta",
            name: "脱糞ター",
            description: "次ターンに受けるダメージを攻撃者へ返す。"
        }
    ];

    panel.innerHTML = `

        <div class="turn-info">
            <span>TURN ${battleState.turn}</span>
            <strong>${getPlayerDisplayName(battleState.currentPlayer)}</strong>
        </div>

        <div class="selected-info">
            <span>${unit.name}</span>
            <span>ブラフを選択</span>
        </div>

        <div class="bluff-selection">
            ${
                bluffOptions.map(option => {
                    const playerBluffUses =
                        battleState.bluffUses?.[battleState.currentPlayer] || {};

                    const uses =
                        Number(
                            playerBluffUses[option.key] ?? 0
                        );

                    return `
                        <button
                            type="button"
                            class="bluff-select-button"
                            data-bluff-type="${option.key}"
                            ${uses <= 0 ? "disabled" : ""}
                        >
                            <strong>${option.name}</strong>
                            <span>残り ${uses}回</span>
                            <small>${option.description}</small>
                        </button>
                    `;
                }).join("")
            }
        </div>

        <button
            type="button"
            id="bluff-cancel-button"
        >
            戻る
        </button>

    `;

    panel
        .querySelectorAll(".bluff-select-button")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    const type =
                        button.dataset.bluffType;

                    selectBluffType(unit, type);
                }
            );
        });

    panel
        .querySelector(
            "#bluff-cancel-button"
        )
        ?.addEventListener(
            "click",
            updateControlPanel
        );
}


/*
 * [ガード/ブラフ／「自分の次のターンまで有効」の仕様]
 *
 * 以前は「PLAYER1/2のどちらが使ったか」から次に攻撃してくる
 * turn番号を逆算して一致判定する(getNextOpponentTurnNumber)方式だったが、
 * これは2人対戦専用のロジックで、3〜4人対戦のように手番が
 * 複数人を経由して回ってくる場合には対応できなかった
 * （自分の次の番が来るまでに何人分の攻撃を受けるか分からないため）。
 *
 * 今は「ターン番号が一致するか」ではなく「まだ発動していないか」だけを見る
 * 状態ベースの判定にして、失効はadvanceToNextPlayer()側で
 * 「自分の次の手番が来た瞬間」に行うようにした。
 * これにより2〜4人のどの人数でも同じロジックで正しく動く。
 */

function selectBluffType(unit, type) {

    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    if (!unit || !type) {
        return;
    }

    const playerBluffUses =
        battleState.bluffUses?.[battleState.currentPlayer];

    if (!playerBluffUses) {
        return;
    }

    const uses =
        Number(
            playerBluffUses[type] ?? 0
        );

    if (uses <= 0) {
        return;
    }

    playerBluffUses[type] = uses - 1;

    logFinalizedMovementIfAny(unit);

    unit.bluffType = type;

    battleState.bluffUnits.add(
        unit.unitId
    );

    /*
     * [BUGFIX / ブラフを使った後だと同じ技を連続使用できてしまう件]
     * 以前はここで unit.lastSkillId を即座にnullへリセットしていた。
     * しかしブラフ選択はここで行動を終えるとは限らず、この直後に
     * そのまま攻撃(技発動)へ進めるようになっている(下のコメント参照)。
     * そのため「1 デスカンチョー → 2 ブラフ+デスカンチョー」のように
     * ブラフを挟むだけで、直前に使った技をリセットしてから
     * 同じ技をもう一度発動できてしまい、「連続使用不可」が
     * 実質無効化されていた。
     *
     * ブラフ単体は技を使わない行動なので「前回使った技」の記録を
     * 消してよいのは、この後さらに攻撃せず本当に行動を終えた場合
     * (＝この後「待機」が選ばれた場合)だけでよい。その場合は
     * waitUnit()側で改めてlastSkillIdがnullにリセットされるため、
     * ここでの早すぎるリセットは不要かつ有害。
     * ここを削除することで、
     *   ・1 デスカンチョー → 2 ブラフのみ(待機で終了) → 3 デスカンチョー
     *     は引き続き使用可能
     *   ・1 デスカンチョー → 2 ブラフ+デスカンチョー(同ターン内で発動)
     *     は正しくブロックされる
     * という意図通りの挙動になる。
     */

    /*
     * [ブラフと攻撃の両立]
     * 以前はここでfinishUnitAction()を呼び、ブラフを選んだ時点で
     * このユニットの行動を「待機」と同じように確定させ、
     * ターンを終えていた（＝ブラフと攻撃を同じターンに両立できなかった）。
     *
     * 今回、ブラフを仕込んだ後もそのまま攻撃(技を発動)へ進めるように、
     * finishUnitAction()は呼ばずbattleState.actionPhaseを維持したまま
     * 行動選択パネルへ戻す。何も攻撃しなければ、この後「待機」を選んで
     * 通常どおり行動を終えられる。
     *
     * ただし移動位置はブラフを確定した時点でロックする
     * （actionOriginRow/Columnをクリアし、「移動をやり直す」を
     * 選べなくする＝updateControlPanel側でボタンごと非表示にする）。
     * これをしないと、この後executeSkill()が呼ばれた際に
     * logFinalizedMovementIfAny()が同じ移動ログをもう一度
     * 記録してしまう。
     */
    battleState.actionOriginRow = null;
    battleState.actionOriginColumn = null;

    clearCellStates();

    renderUnitIcons();
    renderPlayerPanels();
    updateControlPanel();

    onlineSendState();
}


/* ========================================
   SKILL SYSTEM
======================================== */

function getSkillTargeting(skill) {
    return skill?.targeting || {
        type: "self",
        range: 0,
        targetCount: "single",
        targetSide: "self"
    };
}

function getDeadUnitAt(row, column) {
    return battleState.units.find(
        unit =>
            !unit.alive &&
            unit.row === row &&
            unit.column === column
    );
}

function getDirectionOffsets(direction) {
    const offsets = {
        up: { row: -1, column: 0 },
        down: { row: 1, column: 0 },
        left: { row: 0, column: -1 },
        right: { row: 0, column: 1 }
    };

    return offsets[direction] || null;
}

function getFrontCells(unit, range, direction) {
    const offset = getDirectionOffsets(direction);

    if (!offset) {
        return [];
    }

    const cells = [];
    const maxRange = Number(range) || 0;

    for (let distance = 1; distance <= maxRange; distance++) {
        const row = unit.row + offset.row * distance;
        const column = unit.column + offset.column * distance;

        if (
            row < 1 ||
            row > BOARD_SIZE ||
            column < 1 ||
            column > BOARD_SIZE
        ) {
            break;
        }

        cells.push({ row, column });
    }

    return cells;
}

function getMoveRangeTargetCells(unit) {
    const cells = [];

    for (let row = 1; row <= BOARD_SIZE; row++) {
        for (let column = 1; column <= BOARD_SIZE; column++) {
            const distance =
                Math.abs(unit.row - row) +
                Math.abs(unit.column - column);

            if (distance > unit.move) {
                continue;
                }

            cells.push({ row, column });
        }
    }

    return cells;
}

function getAllMapTargetCells(unit) {
    return battleState.units
        .filter(
            target =>
                target.alive &&
                target.player === unit.player
        )
        .map(target => ({
            row: target.row,
            column: target.column
        }));
}

function getSkillCandidateCells(unit, skill, direction = null) {
    const targeting = getSkillTargeting(skill);

    switch (targeting.type) {
        case "self":
            return [{ row: unit.row, column: unit.column }];

        case "direction":
            return getFrontCells(
                unit,
                targeting.range,
                direction
            );

        case "move_range":
            return getMoveRangeTargetCells(unit);

        case "all_map":
            return getAllMapTargetCells(unit);

        default:
            return [];
    }
}

function getTargetUnitAtCell(row, column, targetSide, unit) {
    if (targetSide === "dead_ally") {
        const deadUnit = getDeadUnitAt(row, column);

        return deadUnit && deadUnit.player === unit.player
            ? deadUnit
            : null;
    }

    /*
     * [ALIVE / DEAD KANCHOO用に追加]
     * 敵の死体だけを対象にしたい技用。
     */
    if (targetSide === "dead_enemy") {
        const deadUnit = getDeadUnitAt(row, column);

        return deadUnit && deadUnit.player !== unit.player
            ? deadUnit
            : null;
    }

    /*
     * [ALIVE / DEAD KANCHOO用に追加]
     * 自軍・敵軍を問わず、死体であれば対象にできる技用。
     * 「デッドカンチョー」は基本的にこれを使う想定
     * （敵味方どちらの死体もマップから消せるようにするため）。
     */
    if (targetSide === "dead_any") {
        return getDeadUnitAt(row, column) || null;
    }

    const target = getUnitAt(row, column);

    if (!target) {
        return null;
    }

    if (targetSide === "enemy" && target.player !== unit.player) {
        return target;
    }

    if (targetSide === "ally" && target.player === unit.player) {
        return target;
    }

    if (targetSide === "self" && target.unitId === unit.unitId) {
        return target;
    }

    return null;
}

function getSkillTargetsFromCells(unit, skill, cells) {
    const targeting = getSkillTargeting(skill);
    const targets = [];

    cells.forEach(({ row, column }) => {
        const target = getTargetUnitAtCell(
            row,
            column,
            targeting.targetSide,
            unit
        );

        if (target && !targets.includes(target)) {
            targets.push(target);
        }
    });

    return targets;
}

function getAvailableDirections(unit, skill) {
    const directions = ["up", "down", "left", "right"];

    return directions.filter(direction => {
        const cells = getSkillCandidateCells(
            unit,
            skill,
            direction
        );

        return getSkillTargetsFromCells(
            unit,
            skill,
            cells
        ).length > 0;
    });
}

function getTargetCellsFromTargets(targets) {
    return targets.map(target => ({
        row: target.row,
        column: target.column
    }));
}

function hasSkillTargets(unit, skill) {
    const targeting = getSkillTargeting(skill);

    if (targeting.type === "direction") {
        return getAvailableDirections(unit, skill).length > 0;
    }

    const candidateCells = getSkillCandidateCells(unit, skill);

    return getSkillTargetsFromCells(
        unit,
        skill,
        candidateCells
    ).length > 0;
}

function isSkillTargetCell(row, column) {
    return battleState.skillTargetCells.some(
        cell =>
            cell.row === row &&
            cell.column === column
    );
}

function showSkillSelection() {
    const unit = getUnit(battleState.actionPhase);

    if (
        !unit ||
        unit.player !== battleState.currentPlayer
    ) {
        return;
    }

    battleState.skillPhase = null;
    battleState.skillStep = "skill_select";
    battleState.skillDirection = null;
    battleState.skillTargetCells = [];
    battleState.skillSelectedTargetCells = [];
    battleState.selectedSkillId = null;

    clearCellStates();

    const panel = document.getElementById("battle-control-panel");

    if (!panel) {
        return;
    }

    const skills = getCharacterSkills(unit.characterId);

    panel.innerHTML = `
        <div class="turn-info">
            <span>TURN ${battleState.turn}</span>
            <strong>${getPlayerDisplayName(battleState.currentPlayer)}</strong>
        </div>

        <div class="selected-info">
            <span>${unit.name}</span>
            <span>技を選択してください</span>
        </div>

        <div class="action-buttons skill-buttons">
            ${
                skills.length > 0
                    ? skills.map(skill => `
                        <button
                            type="button"
                            class="skill-button"
                            data-skill-id="${skill.id}"
                            ${unit.lastSkillId === skill.id ? "disabled" : ""}
                        >
                            ${skill.name}
                            ${unit.lastSkillId === skill.id ? "（連続使用不可）" : ""}
                        </button>
                    `).join("")
                    : `
                        <div class="no-skill-message">
                            使用可能な技がありません
                        </div>
                    `
            }
        </div>

        <button
            type="button"
            id="skill-cancel-button"
        >
            戻る
        </button>
    `;

    panel
        .querySelectorAll("[data-skill-id]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const skill = getSkill(
                    Number(button.dataset.skillId)
                );

                if (skill) {
                    selectSkill(unit, skill);
                }
            });
        });

    panel
        .querySelector("#skill-cancel-button")
        ?.addEventListener("click", () => {
            battleState.skillStep = null;
            updateControlPanel();
        });
}

function selectSkill(unit, skill) {

    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    if (
        unit.lastSkillId != null &&
        Number(unit.lastSkillId) === Number(skill.id)
    ) {
        alert(`${skill.name}は連続して使用できません。`);
        showSkillSelection();
        return;
    }

    const targeting = getSkillTargeting(skill);

    battleState.skillPhase = unit.unitId;
    battleState.selectedSkillId = skill.id;
    battleState.skillDirection = null;
    battleState.skillTargetCells = [];
    battleState.skillSelectedTargetCells = [];

    clearCellStates();

    /* ----------------------------------------
       1. 対象の存在確認
    ---------------------------------------- */
    if (!hasSkillTargets(unit, skill)) {
        alert(`${skill.name}の対象が存在しません。`);
        showSkillSelection();
        return;
    }

    /* ----------------------------------------
       2. 方向攻撃か範囲攻撃かを確認
    ---------------------------------------- */
    if (targeting.type === "direction") {
        showDirectionSelection(unit, skill);
        return;
    }

    /* ----------------------------------------
       3. 範囲攻撃・自己対象など
    ---------------------------------------- */
    battleState.skillTargetCells = getSkillCandidateCells(
        unit,
        skill
    );

    const targets = getSkillTargetsFromCells(
        unit,
        skill,
        battleState.skillTargetCells
    );

    if (targeting.targetCount === "all" || targeting.targetCount === "all_allies") {
        battleState.skillSelectedTargetCells =
            getTargetCellsFromTargets(targets);

        showSkillConfirmation(unit, skill);
        return;
    }

    if (targeting.type === "self") {
        battleState.skillSelectedTargetCells = [
            { row: unit.row, column: unit.column }
        ];

        showSkillConfirmation(unit, skill);
        return;
    }

    showTargetSelection(unit, skill);
}

function showDirectionSelection(unit, skill) {
    const panel = document.getElementById("battle-control-panel");

    if (!panel) {
        return;
    }

    const directions = getAvailableDirections(unit, skill);

    battleState.skillStep = "direction_select";

    panel.innerHTML = `
        <div class="turn-info">
            <span>TURN ${battleState.turn}</span>
            <strong>${getPlayerDisplayName(battleState.currentPlayer)}</strong>
        </div>

        <div class="selected-info">
            <span>${skill.name}</span>
            <span>対象のいる方向を選択してください</span>
        </div>

        <div class="action-buttons direction-buttons">
            ${
                directions.map(direction => {
                    const labels = {
                        up: "↑",
                        down: "↓",
                        left: "←",
                        right: "→"
                    };

                    /*
                     * [BUGFIX / P3・P4の攻撃方向ボタンの矢印が実際の向きと逆になる件]
                     *
                     * direction("up"/"down"/"left"/"right")は盤面の絶対座標
                     * （row/columnの増減）で管理されており、これ自体は
                     * プレイヤーごとに変わらない。
                     * 一方、盤面の見た目はupdateBoardPerspective()で
                     * プレイヤーごとに次のように回転させている。
                     *   P1: 回転なし
                     *   P2: 上下・左右とも反転
                     *   P3: 上下のみ反転
                     *   P4: 左右のみ反転
                     * 以前はP2（上下左右とも反転）専用の対応表しかなく、
                     * P3・P4では回転していない絶対方向の矢印がそのまま
                     * 表示されていたため、実際にユニットが攻撃する向きと
                     * 画面上の矢印の向きが一致しないことがあった。
                     * updateBoardPerspective()と同じflipRow/flipColumnの
                     * 条件を使い、ボタンに表示する矢印だけを
                     * プレイヤーの見た目に合わせて回転させる
                     * （実際に選択されるdirection自体は絶対方向のまま変えない）。
                     */
                    const myPlayerNumber = Number(MY_PLAYER_NUMBER);
                    const flipRow = myPlayerNumber === 2 || myPlayerNumber === 3;
                    const flipColumn = myPlayerNumber === 2 || myPlayerNumber === 4;

                    const visualDirection = {
                        up: flipRow ? "down" : "up",
                        down: flipRow ? "up" : "down",
                        left: flipColumn ? "right" : "left",
                        right: flipColumn ? "left" : "right"
                    }[direction] || direction;

                    const displayDirection =
                        labels[visualDirection] || labels[direction];

                    return `
                        <button
                            type="button"
                            class="skill-button direction-button"
                            data-direction="${direction}"
                            data-display-direction="${displayDirection}"
                        >
                            ${displayDirection}
                        </button>
                    `;
                }).join("")
            }
        </div>

        <button
            type="button"
            id="skill-cancel-button"
        >
            戻る
        </button>
    `;

    panel
        .querySelectorAll("[data-direction]")
        .forEach(button => {
            button.addEventListener("click", () => {
                selectSkillDirection(
                    unit,
                    skill,
                    button.dataset.direction
                );
            });
        });

    panel
        .querySelector("#skill-cancel-button")
        ?.addEventListener("click", showSkillSelection);
}

function selectSkillDirection(unit, skill, direction) {
    const availableDirections = getAvailableDirections(
        unit,
        skill
    );

    if (!availableDirections.includes(direction)) {
        return;
    }

    const candidateCells = getSkillCandidateCells(
        unit,
        skill,
        direction
    );

    const targets = getSkillTargetsFromCells(
        unit,
        skill,
        candidateCells
    );

    if (targets.length === 0) {
        alert(`${skill.name}の対象が存在しません。`);
        showSkillSelection();
        return;
    }

    battleState.skillDirection = direction;
    battleState.skillTargetCells = candidateCells;
    battleState.skillStep = "target_select";

    if (getSkillTargeting(skill).targetCount === "all") {
        battleState.skillSelectedTargetCells =
            getTargetCellsFromTargets(targets);

        showSkillConfirmation(unit, skill);
        return;
    }

    showTargetSelection(unit, skill);
}

function showTargetSelection(unit, skill) {
    const panel = document.getElementById("battle-control-panel");

    if (!panel) {
        return;
    }

    battleState.skillStep = "target_select";
    battleState.skillSelectedTargetCells = [];

    clearCellStates();

    battleState.skillTargetCells.forEach(({ row, column }) => {
        getCell(row, column)?.classList.add("skill-target");
    });

    panel.innerHTML = `
        <div class="turn-info">
            <span>TURN ${battleState.turn}</span>
            <strong>${getPlayerDisplayName(battleState.currentPlayer)}</strong>
        </div>

        <div class="selected-info">
            <span>${skill.name}</span>
            <span>対象を選択してください</span>
        </div>

        <button
            type="button"
            id="skill-cancel-button"
        >
            戻る
        </button>
    `;

    panel
        .querySelector("#skill-cancel-button")
        ?.addEventListener("click", () => {
            if (battleState.skillDirection) {
                showDirectionSelection(unit, skill);
            } else {
                showSkillSelection();
            }
        });
}

function showSkillConfirmation(unit, skill) {
    const panel = document.getElementById("battle-control-panel");

    if (!panel) {
        return;
    }

    battleState.skillStep = "confirm";

    clearCellStates();

    battleState.skillSelectedTargetCells.forEach(({ row, column }) => {
        getCell(row, column)?.classList.add("skill-target");
    });

    panel.innerHTML = `
        <div class="turn-info">
            <span>TURN ${battleState.turn}</span>
            <strong>${getPlayerDisplayName(battleState.currentPlayer)}</strong>
        </div>

        <div class="selected-info">
            <span>${skill.name}</span>
            <span>この対象に発動しますか？</span>
        </div>

        <div class="action-buttons">
            <button
                type="button"
                id="skill-confirm-button"
            >
                発動
            </button>

            <button
                type="button"
                id="skill-cancel-button"
            >
                戻る
            </button>
        </div>
    `;

    panel
        .querySelector("#skill-confirm-button")
        ?.addEventListener("click", () => {
            const targets = getSkillTargetsFromCells(
                unit,
                skill,
                battleState.skillSelectedTargetCells
            );

            if (targets.length === 0) {
                alert(`${skill.name}の対象が存在しません。`);
                showSkillSelection();
                return;
            }

            executeSkill(
                unit,
                skill,
                battleState.skillSelectedTargetCells
            );
        });

    panel
        .querySelector("#skill-cancel-button")
        ?.addEventListener("click", () => {
            if (battleState.skillDirection) {
                showDirectionSelection(unit, skill);
            } else {
                showSkillSelection();
            }
        });
}

function handleSkillTargetClick(row, column) {
    const unit = getUnit(battleState.skillPhase);
    const skill = getSkill(
        Number(battleState.selectedSkillId)
    );

    if (!unit || !skill) {
        return;
    }

    if (
        battleState.skillStep !== "target_select" ||
        !isSkillTargetCell(row, column)
    ) {
        return;
    }

    const targeting = getSkillTargeting(skill);
    const target = getTargetUnitAtCell(
        row,
        column,
        targeting.targetSide,
        unit
    );

    if (!target) {
        return;
    }

    battleState.skillSelectedTargetCells = [
        { row, column }
    ];

    showSkillConfirmation(unit, skill);
}

function getUnitsOnCells(cells) {
    return cells
        .map(({ row, column }) => getUnitAt(row, column))
        .filter(
            (unit, index, array) =>
                unit && array.indexOf(unit) === index
        );
}

function getDeadUnitsOnCells(cells) {
    return cells
        .map(({ row, column }) => getDeadUnitAt(row, column))
        .filter(
            (unit, index, array) =>
                unit && array.indexOf(unit) === index
        );
}

function applyDamage(
    attacker,
    target,
    skill,
    damage,
    ignoreDefense = false,
    ignoreBluff = false
) {
    if (!target || !target.alive) {
        return;
    }

    let finalDamage = Math.max(
        0,
        Number(damage) || 0
    );

    /*
     * [ガード/ブラフ／「自分の次のターンまで有効」の仕様]
     * 以前は「予約しておいたturn番号と一致するか」で判定していたが、
     * 今は単に「まだ発動していないか(=trueのままか)」だけを見る。
     * 自分の次の手番が来た時点での失効はadvanceToNextPlayer()が
     * 別途行うので、ここでは状態のON/OFFだけを見ればよい。
     */
    const guardActive = !!target.guardNextTurn;

    if (guardActive && !ignoreDefense) {
        finalDamage = Math.floor(finalDamage / 2);
    }

    const bluffActive =
        !ignoreBluff &&
        !!target.bluffType;

    /*
     * [ブラフ発動時のログ表示]
     * 以前はどのブラフでも「○○のケツカッチン発動！」のような
     * 汎用ログ1行＋その下の通常ダメージログ（無効化された場合は
     * 「0ダメージ」）という組み合わせだった。
     * ここでは種類ごとに指定された1行だけで完結するようにする。
     * （ケツカッチンが時差式カンチョーで貫通された場合など、
     * 効果が発動しなかった場合は通常のダメージログへフォールバックする）
     */
    let bluffAbsorbed = false;

    if (bluffActive) {

        if (
            target.bluffType === "ketsukacchin" &&
            !skill?.piercesKetsukacchin
        ) {
            finalDamage = 0;
            bluffAbsorbed = true;

            addBattleLog(
                `${target.name}はケツカッチンを発動！ダメージを無効化した！`
            );

        } else if (target.bluffType === "ketsuiki") {

            target.hp = Math.min(
                target.maxHp,
                target.hp + finalDamage
            );

            addBattleLog(
                `${target.name}はケツイキした！${target.name}は${finalDamage}回復！`
            );

            finalDamage = 0;
            bluffAbsorbed = true;

        } else if (
            target.bluffType === "dappunta" &&
            attacker &&
            attacker.alive
        ) {

            addBattleLog(
                `${target.name}は脱糞した！${attacker.name}に${finalDamage}ダメージ！`
            );

            attacker.hp = Math.max(
                0,
                attacker.hp - finalDamage
            );

            if (attacker.hp <= 0) {
                attacker.hp = 0;
                attacker.alive = false;
                addBattleLog(`${attacker.name}は倒れた！`);
            }

            finalDamage = 0;
            bluffAbsorbed = true;

        } else {

            // ケツカッチンが時差式カンチョーで貫通された場合などのフォールバック。
            const bluffNames = {
                ketsukacchin: "ケツカッチン",
                ketsuiki: "ケツイキ",
                dappunta: "脱糞ター"
            };

            addBattleLog(
                `${target.name}のブラフ(${bluffNames[target.bluffType] || target.bluffType})が破られた！`
            );

        }

        target.bluffType = null;
        battleState.bluffUnits.delete(
            target.unitId
        );
    }

    if (!bluffAbsorbed && attacker && skill && target) {
        addBattleLog(
            `${target.name}に${finalDamage}ダメージ！`
        );
    }

    target.hp = Math.max(
        0,
        target.hp - finalDamage
    );

    if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        addBattleLog(`${target.name}は倒れた！`);

        // 撃破演出をオンライン対戦では両画面へ送信する。
        // オフラインでは従来どおりこの画面だけで再生する。
        if (attacker && attacker.characterId != null) {
            if (
                ONLINE_ROOM_ID &&
                onlineSocket &&
                onlineSocket.readyState === WebSocket.OPEN
            ) {
                /*
                 * [BUGFIX / 倒された側でキャラソンが一周分遅れる件]
                 *
                 * ここから送るkill_cut_inイベントはWebSocket経由なので、
                 * サーバーを経由して自分自身に返ってくる（＝実際に
                 * playCharacterSong()が呼ばれ、battleState.currentTrackCharacterIdが
                 * 更新される）のはこの関数の実行が終わったあと、非同期に
                 * なる。ところがこの直後、finishUnitAction()の中で
                 * onlineSendState()が同期的に呼ばれ、その時点の
                 * battleState.currentTrackCharacterId（＝まだ更新前の古い値）を
                 * battle_stateとして相手にも送ってしまっていた。
                 *
                 * 倒された側のクライアントは
                 *   1. kill_cut_inを受信 → 正しい曲を再生開始
                 *   2. 直後にその古いbattle_stateを受信
                 *      → currentTrackCharacterIdが食い違うと判定し、
                 *        いったん元の曲に戻してしまう
                 *   3. 後続の（正しい値を積んだ）battle_stateが届いて
                 *      ようやく正しい曲に戻るが、そのぶん再生開始が
                 *      遅れ、結果的に攻撃側の再生位置とズレる
                 *      （一周分遅れて聞こえる）
                 * という流れでズレていた。
                 *
                 * kill_cut_inを送る全く同じタイミングで
                 * battleState.currentTrackCharacterIdも即座に更新して
                 * おけば、直後のonlineSendState()には最初から正しい値が
                 * 乗るので、この食い違いが起きなくなる。
                 * （実際に音を鳴らし始めるのは、他のクライアントと
                 *  タイミングを揃えるため、これまで通りサーバーから
                 *  返ってきたイベントを受け取ってから＝playCharacterSong()
                 *  呼び出し時のままにしてある）
                 */
                battleState.currentTrackCharacterId = attacker.characterId;

                onlineSendBattleEvent(
                    "kill_cut_in",
                    {
                        unitId: attacker.unitId,
                        player: attacker.player,
                        name: attacker.name,
                        image: attacker.image,
                        characterId: attacker.characterId
                    }
                );
            } else {
                showKillCutIn(attacker);
                playCharacterSong(attacker.characterId);
            }
        }
    }

    if (guardActive) {
        target.guardNextTurn = false;
    }

    checkVictoryCondition();
}


function applyDamageToTargets(
    attacker,
    targets,
    skill,
    multiplier = 1,
    ignoreDefense = false
) {
    targets.forEach(target => {
        const power =
            Number(skill.power || 0) *
            multiplier;

        const damage =
            Math.floor(
                power *
                Number(attacker.attack || 0) /
                Math.max(1, Number(target.defense || 0)) /
                2 *
                (0.85 + Math.random() * 0.15)
            );

        applyDamage(
            attacker,
            target,
            skill,
            damage,
            ignoreDefense
        );
    });
}

function healTargets(targets, amount) {
    targets
        .filter(target => target.alive)
        .forEach(target => {
            target.hp = Math.min(
                target.maxHp,
                target.hp + amount
            );
        });
}

function reviveTarget(target, hp) {
    if (!target) {
        return;
    }

    target.alive = true;
    target.hp = Math.min(
        target.maxHp,
        Math.max(1, hp)
    );
}

function removeTarget(target) {
    if (!target) {
        return;
    }

    const index = battleState.units.indexOf(target);

    if (index >= 0) {
        battleState.units.splice(index, 1);
    }
}

function damage_scale_with_move_distance(unit, skill, { enemies }, multiplier){

    // このターン、移動前の位置から何マス移動したか。
    const moveDistance =
        battleState.actionOriginRow !== null &&
        battleState.actionOriginColumn !== null
            ? Math.abs(unit.row - battleState.actionOriginRow) +
              Math.abs(unit.column - battleState.actionOriginColumn)
            : 0;

    // 1マスにつき威力+20%（お好みで係数は調整してください）。
    const moveBonusMultiplier = moveDistance * 1;

    applyDamageToTargets(
        unit,
        enemies,
        skill,
        multiplier * moveBonusMultiplier
    );
}

/* ========================================
   SKILL EFFECT REGISTRY

   [保守性についての回答 / Q3]
   これまでは switch (skill.id) というように、
   「技のID(数字)」ごとに直接効果をハードコードしていた。
   そのため、skillDatabase に新しい技を追加しても、
   ここに対応する case を書き足さない限りその技は
   何も起きない(=DBに追加するだけでは自動的に
   使えるようにはならない) という状態だった。

   ここでは skill.effect という文字列
   (例: "damage" "revive" "remove_dead" など)を見て
   SKILL_EFFECTS から処理を引く方式に変更した。

   game-data.js の skillDatabase に定義されている
   全13技それぞれに effect フィールドを付与し、
   移行を完了させたため、旧来の switch(skill.id) は
   もう使われておらず削除した。

   これからは、
     1. skillDatabase の技定義に effect: "revive" のように
        1行足すだけで、
     2. その effect が既に SKILL_EFFECTS にある種類
        （ダメージ・回復・蘇生・削除・ガード等）であれば
        battle.js を一切編集せずにその技が動く。
     3. 本当に新しい種類の効果が必要な時だけ、
        SKILL_EFFECTS に1関数追加すればよい。
   という形になり、「DBに追加したら自動で使えるか」への
   答えはYESになった。
======================================== */

const SKILL_EFFECTS = {

    // 敵へ通常ダメージ（旧: id 1, 2, 5）
    damage: (unit, skill, { enemies }, multiplier) => {
        applyDamageToTargets(unit, enemies, skill, multiplier);
    },

    /*
     * 対象が多いほど威力が下がる攻撃（例: 貫・チョー）。
     *
     * 実際に命中した敵の数で power を割ることで、
     * 「対象が多いほど威力が下がる」を表現する。
     * 敵1体なら通常通りの威力、2体なら半分、3体なら1/3……となる。
     */
    damage_falloff_by_target_count: (unit, skill, { enemies }, multiplier) => {
        if (enemies.length === 0) {
            return;
        }

        const falloffMultiplier =
            multiplier / enemies.length;

        applyDamageToTargets(
            unit,
            enemies,
            skill,
            falloffMultiplier
        );
    },

    // 防御力を無視したダメージ（旧: id 10）
    damage_ignore_defense: (unit, skill, { enemies }, multiplier) => {
        applyDamageToTargets(unit, enemies, skill, multiplier, true);
    },

    // 通常ダメージ + 追加の防御無視固定ダメージ（旧: id 9）
    damage_plus_true_damage: (unit, skill, { enemies }, multiplier) => {
        applyDamageToTargets(unit, enemies, skill, multiplier);

        enemies.forEach(target => {
            if (target.alive) {
                applyDamage(
                    unit,
                    target,
                    skill,
                    Number(skill.power || 0) * multiplier,
                    true
                );
            }
        });
    },

    /*
     * 味方の死亡ユニットを蘇生する（旧: id 3）。
     *
     * skill.power が指定されていれば従来どおりそのHPで蘇生し、
     * 未指定(0 / null / undefined)の場合はそのユニットの
     * maxHpで蘇生する＝HPMAX蘇生になる。
     *
     * → 「アライブカンチョー」はDB側で
     *    effect: "revive" とし、power を省略（または0）にすれば
     *    そのままHPMAX蘇生として動作する。
     */
    revive: (unit, skill, { deadTargets }) => {
        const target = deadTargets.find(
            candidate => candidate.player === unit.player
        );

        if (!target) {
            return;
        }

        const revivePower =
            Number(skill.power || 0) > 0
                ? Number(skill.power)
                : target.maxHp;

        reviveTarget(target, revivePower);
    },

    /*
     * 死亡ユニットをマップ上から完全に削除する（旧: id 4）。
     *
     * removeTarget() は battleState.units 配列から
     * ユニットそのものを取り除くため、
     * 以後 getDeadUnitAt() では二度と見つからなくなり、
     * 結果として「蘇生することもできなくなる」を
     * 自動的に満たす。
     *
     * targeting.targetSide を "dead_ally" ではなく
     * "dead_any"（自軍・敵軍どちらの死体も対象にできる）に
     * すれば、敵の死体にも使える「デッドカンチョー」になる。
     */
    remove_dead: (unit, skill, { deadTargets }) => {
        deadTargets.forEach(target => {
            removeTarget(target);
        });
    },

    // 次に使う技の威力を一時的に上げる（旧: id 6）
    double_power_next_turn: unit => {
        unit.nextPowerMultiplier = 2;
        unit.nextPowerTurn = battleState.turn + 1;
    },

    // 味方単体を回復（旧: id 7）
    heal_single_ally: (unit, skill, { allies }) => {
        healTargets(allies.slice(0, 1), Number(skill.power || 0));
    },

    /*
     * 自軍全体の移動力を上げる（旧: id 8）
     *
     * [BUGFIX / ターンが変わった後も移動力が伸び続ける件]
     * 以前はtarget.moveへ+2するだけで、失効させる処理が
     * どこにも無かった。そのため一度使うと効果が永久に残り、
     * もう一度使うとさらに+2され…と際限なく積み上がっていた。
     *
     * guard_next_turn(ケツ絞め)と同じ「自分の次の手番が来た瞬間に
     * 失効」の方式にするため、加算した量をtarget.moveBuffAmountに
     * 記録しておく。実際の失効処理はadvanceToNextPlayer()側で行う。
     * (同じユニットに重ねて使った場合でも、加算した合計量を
     * 覚えておくので過不足なく元に戻せる)
     */
    move_buff_all_allies: unit => {
        battleState.units
            .filter(
                target =>
                    target.alive &&
                    target.player === unit.player
            )
            .forEach(target => {
                target.move += 2;
                target.moveBuffAmount = (target.moveBuffAmount || 0) + 2;
            });
    },

    // 次に受けるダメージを軽減する（旧: id 11）
    // 「自分の次のターンまで有効」の失効処理はadvanceToNextPlayer()側で行う。
    guard_next_turn: unit => {
        unit.guardNextTurn = true;
    },

    // 自分と相手のHPを揃えるように防御無視ダメージを与える（旧: id 12）
    equalize_hp_damage: (unit, skill, { enemies }) => {
        enemies.forEach(target => {
            if (unit.hp <= target.hp) {
                applyDamage(
                    unit,
                    target,
                    skill,
                    target.hp - unit.hp,
                    true
                );
            }
        });
    },

    /*
     * このターン移動した距離に応じて威力が上がる（ジェットカンチョー）。
     * 実装自体は上のdamage_scale_with_move_distance()関数にあったが、
     * ここに登録されていなかったため、skillDatabase側でこのeffectを
     * 指定してもSKILL_EFFECTS[skill.effect]がundefinedになり、
     * コンソールにエラーが出るだけで何も起きていなかった。
     * (加えてgame-data.js側は"amage_scale_with_move_distance"と
     * 綴りが1文字欠けていたので、そちらも修正が必要)
     */
    damage_scale_with_move_distance,

    /*
     * 自爆する代わりに大ダメージを与える（神風カンチョー）。
     * ・敵への威力は damage_falloff_by_target_count と同じ考え方で、
     *   対象が多いほど1体あたりの威力を下げる(multiplier / enemies.length)。
     * ・その後、発動した本人を戦闘不能にする(自爆)。
     *   applyDamage()を自分自身に対して呼ぶ形にはせず、直接HPを0にして
     *   alive=falseにしている(ガード/ブラフ等の被弾処理を自爆に
     *   巻き込みたくないため)。
     * ・自爆によって参加人数が1人になる可能性があるので、
     *   最後に必ずcheckVictoryCondition()を呼び直す。
     */
    kamikaze_damage: (unit, skill, { enemies }, multiplier) => {
        if (enemies.length > 0) {
            const falloffMultiplier = multiplier / enemies.length;

            applyDamageToTargets(
                unit,
                enemies,
                skill,
                falloffMultiplier
            );
        }

        if (unit.alive) {
            unit.hp = 0;
            unit.alive = false;
            addBattleLog(`${unit.name}は自爆した！`);
        }

        checkVictoryCondition();
    }

};

/*
 * [保守性 / 移行完了]
 * game-data.js側の全13技に effect フィールドを付与したため、
 * IDに直接ひも付いていた旧switch文(applySkillEffectByLegacyId)は
 * 廃止した。
 *
 * これ以降、新しい技を追加する場合は
 * skillDatabase に effect: "..." を必ず指定すること。
 * 既存のSKILL_EFFECTSにある種類を指定するだけなら
 * battle.js は一切変更不要で動く。
 * 本当に新しい効果が必要な時だけ、SKILL_EFFECTSに
 * 1関数追加すればよい。
 *
 * effect の指定漏れ・タイポは、今までのように
 * 「何も起きずに黙って失敗する」のではなく、
 * ここで必ずコンソールにエラーを出す。
 */
function applySkillEffect(
    unit,
    skill,
    targets,
    deadTargets,
    multiplier
) {
    const enemies = targets.filter(
        target => target.player !== unit.player
    );

    const allies = targets.filter(
        target => target.player === unit.player
    );

    const context = { enemies, allies, deadTargets };

    const handler =
        SKILL_EFFECTS[skill.effect];

    if (!handler) {

        console.error(
            `技 "${skill.name}"（id=${skill.id}）に有効な effect が` +
            `設定されていません（effect="${skill.effect}"）。` +
            `skillDatabase側にeffectフィールドを追加するか、` +
            `SKILL_EFFECTSに対応する関数を追加してください。`
        );

        return;

    }

    // [命中率] skill.accuracy（0〜100）が未指定なら常に命中(100)扱い。
    // デスカンチョーのように外れることがある技は、
    // game-data.js側のskillDatabaseに accuracy: 50 のように指定するだけでよい。
    const accuracy =
        Number.isFinite(Number(skill.accuracy))
            ? Number(skill.accuracy)
            : 100;

    if (Math.random() * 100 >= accuracy) {
        addBattleLog(`${unit.name}の${skill.name}は外れた！`);
        return;
    }

    handler(unit, skill, context, multiplier);
}

function executeSkill(
    unit,
    skill,
    targetCells
) {

    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    if (!unit || !skill) {
        return;
    }

    // UIを経由せず実行された場合も連続使用を防止する
    if (
        unit.lastSkillId != null &&
        Number(unit.lastSkillId) === Number(skill.id)
    ) {
        alert(`${skill.name}は連続して使用できません。`);
        showSkillSelection();
        return;
    }

    const targets =
        getUnitsOnCells(targetCells);

    const deadTargets =
        getDeadUnitsOnCells(targetCells);

    logFinalizedMovementIfAny(unit);

    addBattleLog(
        `${unit.name}が${skill.name}を発動！`
    );

    const multiplier =
        unit.nextPowerTurn === battleState.turn
            ? (unit.nextPowerMultiplier || 1)
            : 1;

    applySkillEffect(
        unit,
        skill,
        targets,
        deadTargets,
        multiplier
    );

    // 技を実際に発動したら、その技を「前回使用した技」として記録
    unit.lastSkillId = Number(skill.id);

    if (checkVictoryCondition()) {
        onlineSendState();
        return;
    }

    if (
        unit.nextPowerTurn ===
        battleState.turn
    ) {
        unit.nextPowerMultiplier = 1;
        unit.nextPowerTurn = null;
    }

    finishUnitAction();
}
function createStatusCard(
    unit
) {

    const card =
        document.createElement(
            "div"
        );


    card.className =
        "character-status-card";


    card.dataset.unitId =
        unit.unitId;


    // [4人対戦対応] 青/赤の2択だったのを、そのままplayer-N(1〜4)にした。
    card.classList.add(
        `player-${unit.player}`
    );


    if (
        battleState.selectedUnitId ===
        unit.unitId
    ) {

        card.classList.add(
            "selected"
        );

    }


    if (!unit.alive) {

        card.classList.add(
            "defeated"
        );

    }


    if (
        battleState.movedUnits.has(
            unit.unitId
        )
    ) {

        card.classList.add(
            "moved"
        );

    }


    if (
        battleState.bluffUnits.has(
            unit.unitId
        ) &&
        Number(unit.player) === Number(MY_PLAYER_NUMBER)
    ) {

        // ブラフは自分のユニットにだけ見せる（相手には通常状態と区別させない）
        card.classList.add(
            "bluff"
        );

    }


    const hpRate =

        unit.maxHp > 0

            ? Math.max(
                0,
                Math.min(
                    100,
                    (
                        unit.hp /
                        unit.maxHp
                    ) * 100
                )
            )

            : 0;


    const skills = getCharacterSkills(
        unit.characterId
    );


    card.innerHTML = `

        <div class="status-card-main">

            <div class="status-character-image">

                <img
                    src="${unit.image}"
                    alt="${unit.name}"
                >

            </div>


            <div class="status-character-info">

                <div class="status-character-name">
                    ${unit.name}
                </div>


                <div class="status-hp-row">

                    <span>
                        HP
                    </span>

                    <span>
                        ${unit.hp}/${unit.maxHp}
                    </span>

                </div>


                <div class="status-hp-bar">

                    <div
                        class="status-hp-fill"
                        style="width:${hpRate}%"
                    ></div>

                </div>

            </div>

        </div>


        <div class="status-stats">

            <span>
                ATK

                <strong>
                    ${unit.attack}
                </strong>

            </span>


            <span>
                DEF

                <strong>
                    ${unit.defense}
                </strong>

            </span>


            <span>
                MOVE

                <strong>
                    ${unit.move}
                </strong>

            </span>

        </div>


        <div class="status-skills">

            <div class="status-skills-title">
                技
            </div>

            <div class="status-skills-list">

                ${
                    skills.length > 0
                        ? skills.map(skill => `
                            <div
                                class="status-skill"
                                title="${skill.description || ""}"
                            >
                                <span class="status-skill-name">
                                    ${skill.name}
                                </span>
                                <span class="status-skill-power">
                                    ${skill.power > 0 ? `威力 ${skill.power}` : "変化"}
                                </span>
                            </div>
                        `).join("")
                        : `
                            <div class="status-skill-empty">
                                技なし
                            </div>
                        `
                }

            </div>

        </div>


        ${
            battleState.bluffUnits.has(
                unit.unitId
            ) &&
            Number(unit.player) === Number(MY_PLAYER_NUMBER)

                ? `

                    <div class="status-bluff">
                        BLUFF
                    </div>

                `

                : ""
        }

    `;


    /*
     * 移動後の行動選択中は
     * ステータスカードから
     * 別キャラを選択できないようにする
     */

    card.addEventListener(
        "click",
        () => {

            if (
                battleState.actionPhase
            ) {

                return;

            }


            selectUnit(
                unit.unitId
            );

        }
    );


    return card;

}


/* ========================================
   PLAYER STATUS PANELS
======================================== */

/*
 * [4人対戦対応 / 自分を左下に固定する視点]
 *
 * スロット番号(1〜4、画面上の位置)と実プレイヤー番号(1〜4、
 * 誰が赤か青か)は今は別物になっている。
 *
 * スロットの画面上の位置は固定:
 *   スロット1 = 左下 (2人対戦での唯一の自分側パネルと同じ位置)
 *   スロット2 = 右下 (2人対戦での相手パネルと同じ位置)
 *   スロット4 = 右上
 *   スロット3 = 左上
 *
 * オンライン対戦では「自分(MY_PLAYER_NUMBER)」を必ずスロット1(左下)に
 * 固定し、残りの参加者をスロット2→4→3の順(時計回り)に割り当てる。
 * オフライン対戦(ホットシート)や観戦時は自分という視点がないので、
 * activePlayersの並び順(着席順)をそのままスロット1から詰めていく。
 * こうすると2人対戦の場合は常にスロット1=PLAYER1、スロット2=PLAYER2に
 * なり、以前の見た目と完全に一致する。
 */
function getVisualSlotAssignments() {

    const slotOrder = [1, 2, 4, 3]; // 左下 → 右下 → 右上 → 左上(時計回り)

    const perspectivePlayer =
        (!isSpectatorMode() && ONLINE_ROOM_ID) &&
        battleState.activePlayers.includes(Number(MY_PLAYER_NUMBER))
            ? Number(MY_PLAYER_NUMBER)
            : battleState.activePlayers[0];

    const others =
        battleState.activePlayers.filter(
            player => player !== perspectivePlayer
        );

    const ordered =
        battleState.activePlayers.includes(perspectivePlayer)
            ? [perspectivePlayer, ...others]
            : [...battleState.activePlayers];

    const assignment = {};

    slotOrder.forEach(
        (slotNumber, index) => {
            assignment[slotNumber] = ordered[index] ?? null;
        }
    );

    return assignment;
}

function renderPlayerPanels() {

    const assignment = getVisualSlotAssignments();

    /*
     * 3人目以降が参加している対戦かどうかで、bodyにクラスを付け外しする。
     * battle.css側はこのクラスを見て、スロット1・2のパネルを
     * 半分の高さにしてスロット3・4と上下に並べるレイアウトへ切り替える。
     * 2人対戦のときはこのクラスが付かず、以前と全く同じ見た目になる。
     */
    document.body.classList.toggle(
        "multiplayer-3plus",
        battleState.activePlayers.length > 2
    );

    // スロット1(左下)はスロット3(左上)が空いていれば全高表示にする。
    // スロット2(右下)も同様にスロット4(右上)基準で判定する。
    const slotSoloMap = {
        1: assignment[3] == null,
        2: assignment[4] == null,
        3: false,
        4: false
    };

    [1, 2, 3, 4].forEach(
        slotNumber => {

            const elements = PLAYER_PANEL_SLOTS[slotNumber];

            if (!elements || !elements.panel || !elements.list) {
                return;
            }

            const player = assignment[slotNumber];

            elements.panel.classList.toggle(
                "slot-hidden",
                player == null
            );

            elements.panel.classList.toggle(
                "slot-solo",
                !!slotSoloMap[slotNumber]
            );

            elements.list.innerHTML = "";

            if (player == null) {

                if (elements.name) {
                    elements.name.textContent = "";
                }

                return;

            }

            const colorHex = getPlayerColorHex(player);

            elements.panel.style.borderColor = colorHex;

            if (elements.name) {

                elements.name.textContent =
                    getPlayerDisplayName(player);

                elements.name.style.color = colorHex;

                elements.name.style.background =
                    `linear-gradient(90deg, ${getPlayerColorRgba(player, 0.15)}, transparent)`;

                elements.name.style.borderBottomColor = colorHex;

            }

            battleState.units
                .filter(
                    unit =>
                        Number(unit.player) === Number(player)
                )
                .forEach(
                    unit => {

                        const card =
                            createStatusCard(
                                unit
                            );

                        if (card) {
                            elements.list.appendChild(card);
                        }

                    }
                );

        }
    );

}


/* ========================================
   END TURN
======================================== */

/*
 * [4人対戦対応 / 手番ローテーション]
 * 以前は「PLAYER1⇔PLAYER2」の決め打ちの切り替えだったが、
 * 2〜4人のうち脱落していない人だけを対象に、着席順(activePlayers)を
 * ぐるぐる回すローテーションに変更した。脱落者は自然にスキップされる。
 *
 * ローテーションの先頭(一番若いプレイヤー番号)まで一周したら
 * turnを1つ進める。以前の「PLAYER2→PLAYER1でturn++」も、
 * 2人対戦の場合はこの「先頭に戻ったら」と完全に一致する。
 */
function advanceToNextPlayer() {

    const active = getActivePlayers();

    if (active.length === 0) {
        return;
    }

    const currentIndex = active.indexOf(battleState.currentPlayer);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % active.length;

    if (nextIndex === 0) {
        battleState.turn++;
    }

    battleState.currentPlayer = active[nextIndex];

    /*
     * [ガード/ブラフ／「自分の次のターンまで有効」の失効処理]
     * 手番が回ってきたプレイヤー自身の、まだ発動していない
     * ガード/ブラフをここで失効させる。
     * (使わずに温存されていた分は、自分の番が来た時点で切れる)
     *
     * [BUGFIX / ドライブカンチョーの移動力がターンをまたいで
     * 伸び続ける件]
     * ドライブカンチョーで加算したmoveも、ガード/ブラフと同じ
     * タイミング(自分の次の手番が来た瞬間)で元に戻す。
     * moveBuffAmountに「加算した合計量」を記録してあるので、
     * それをそのまま差し引いて0にリセットする。
     * (死亡していても記録上は加算されたままのため、生死を問わず
     * 対象にする)
     */
    battleState.units
        .filter(
            targetUnit =>
                Number(targetUnit.player) === Number(battleState.currentPlayer)
        )
        .forEach(
            targetUnit => {
                targetUnit.guardNextTurn = false;

                if (targetUnit.bluffType) {
                    targetUnit.bluffType = null;
                    battleState.bluffUnits.delete(targetUnit.unitId);
                }

                if (targetUnit.moveBuffAmount) {
                    targetUnit.move -= targetUnit.moveBuffAmount;
                    targetUnit.moveBuffAmount = 0;
                }
            }
        );
}

function endTurn() {
    if (isSpectatorMode()) return;


    if (
        ONLINE_ROOM_ID &&
        battleState.currentPlayer !== MY_PLAYER_NUMBER
    ) {
        return;
    }

    if (battleState.gameOver) {
        return;
    }

    /*
     * 行動選択中の場合は
     * TURN ENDを押せないようにする
     */

    if (
        battleState.actionPhase
    ) {

        return;

    }


    battleState.selectedUnitId =
        null;


    battleState.movableCells =
        [];


    battleState.actionPhase =
        null;

    /*
     * [BUGFIX / 一ターン置いてもデスカンチョーが打てないことがある件]
     * 一部のユニットを一度もクリックしないまま(＝waitUnit()も
     * selectBluffType()も一度も通らないまま)TURN ENDした場合、
     * そのユニットは今回「何もしなかった」のと同じはずなのに、
     * lastSkillIdの更新・リセットのタイミングがwaitUnit/selectBluffType
     * の2箇所にしかなかったため、記録が前回のまま残り続けていた。
     *
     * そのため、「1 デスカンチョー発動 → 2 このユニットには一切触れず
     * TURN ENDだけ押す → 3 デスカンチョーを打とうとする」という、
     * 体感的には1ターン分間を置いたはずの操作が、実際には
     * 「連続使用」と同じ扱いになってブロックされ続けてしまっていた。
     *
     * movedUnitsをクリアする直前(＝今回のターンでの行動記録が
     * まだ残っている最後のタイミング)に、今回一度も行動しなかった
     * このプレイヤーの生存ユニットを洗い出し、waitUnit()と同じ扱いで
     * lastSkillIdをリセットする。
     */
    const currentPlayerNumberForSkip = Number(battleState.currentPlayer);

    battleState.units
        .filter(
            targetUnit =>
                targetUnit.alive &&
                Number(targetUnit.player) === currentPlayerNumberForSkip &&
                !battleState.movedUnits.has(targetUnit.unitId)
        )
        .forEach(targetUnit => {
            targetUnit.lastSkillId = null;
        });

    battleState.movedUnits.clear();


    clearCellStates();


    advanceToNextPlayer();

    /*
     * [BUGFIX / 連続使用不可が機能していなかった件]
     * 以前はここで、手番が回ってきたプレイヤーの全ユニットの
     * lastSkillIdを毎ターンnullにリセットしていた。
     * これだと「前回使った技と同じか」を判定する直前
     * （＝そのユニットが次に技を選ぶまさにその瞬間）に
     * 必ず記録を消してしまうため、制約が常に無効化されていた。
     *
     * lastSkillIdのリセットは、待機／ブラフを選んだとき
     * （waitUnit / selectBluffType）にのみ行う方式に変更したため、
     * ここでの一括リセットは削除した。
     */

    if (battleState.currentPlayer === Number(MY_PLAYER_NUMBER)) {
        showYourTurnCutIn();
    }

    renderUnitIcons();

    renderPlayerPanels();

    updateControlPanel();

    onlineSendState();

}


/* ========================================
   CONTROL PANEL
======================================== */

function updateControlPanel() {

    const panel =
        document.getElementById(
            "battle-control-panel"
        );


    if (!panel) {
        return;
    }

    /*
     * [BUGFIX / 敗北側でYOU LOSE表示とタイトルに戻るボタンが出ない件]
     *
     * 以前はこの結果パネルの描画がshowBattleResult()の中だけにあり、
     * オンライン対戦で相手の勝利を検知したクライアント（＝勝者側）でしか
     * 呼ばれていなかった。
     * 敗者側はapplyOnlineState()経由でbattleState.gameOverを受け取るだけで、
     * updateControlPanel()を呼ぶのみだったため、
     * 下の「観戦者/相手ターンなら空にする」判定に引っかかって
     * 結果パネルが一切描画されなかった（自分のターンでない限り）。
     *
     * 決着後は誰の手番かに関わらず結果パネルを最優先で描画するように、
     * ここでgameOverを最初にチェックする。
     */
    if (battleState.gameOver) {

        panel.style.display = "";

        panel.innerHTML = `
            <div class="battle-result">
                <div class="battle-result-label">
                    SIEGE BATTLE
                </div>

                <strong>
                    ${
                        battleState.winner === null
                            ? "引き分け"
                            : `${getPlayerDisplayName(battleState.winner)} WIN`
                    }
                </strong>

                <span>
                    ${battleState.gameOverReason || ""}
                </span>

                <button
                    type="button"
                    id="return-title-button"
                    style="margin-top:18px;padding:12px 24px;cursor:pointer;"
                >
                    タイトルに戻る
                </button>
            </div>
        `;

        document
            .getElementById("return-title-button")
            ?.addEventListener("click", () => {
                window.location.href = "/title/title.html";
            });

        return;
    }

    /*
     * 操作パネルだけを制御します。
     * 盤面・パーティ表示の処理には触れません。
     * 観戦者、または相手ターンではパネルを空にします。
     */
    if (
        isSpectatorMode() ||
        Number(battleState.currentPlayer) !== Number(MY_PLAYER_NUMBER)
    ) {
        panel.innerHTML = "";
        panel.style.display = "none";
        return;
    }

    panel.style.display = "";

    const selected =
        getUnit(
            battleState.selectedUnitId
        );


    const actionUnit =
        getUnit(
            battleState.actionPhase
        );


    /*
     * 移動完了後の行動選択
     */

    if (actionUnit) {

        panel.innerHTML = `

            <div class="turn-info">

                <span>
                    TURN ${battleState.turn}
                </span>

                <strong>
                    ${getPlayerDisplayName(battleState.currentPlayer)}
                </strong>

            </div>


            <div class="selected-info">

                <span>
                    ${actionUnit.name}
                </span>

                <span>
                    ${
                        actionUnit.bluffType
                            ? "ブラフ発動中・攻撃も可能"
                            : "移動完了"
                    }
                </span>

            </div>


            <div class="action-buttons">

                <button
                    type="button"
                    id="skill-action-button"
                >
                    技を発動
                </button>


                <button
                    type="button"
                    id="wait-action-button"
                >
                    待機
                </button>

                ${
                    /*
                     * [ブラフと攻撃の両立]
                     * このユニットが既にブラフを仕込み済み(actionUnit.bluffType)
                     * であれば、「ブラフ」ボタンは表示しない
                     * (1ユニット1ターンにつきブラフは1回だけ)。
                     * 「移動をやり直す」も、ブラフ確定と同時に移動位置を
                     * ロックする仕様にしたため、ここでは表示しない。
                     */
                    actionUnit.bluffType
                        ? ""
                        : `
                            <button
                                type="button"
                                id="bluff-action-button"
                            >
                                ブラフ
                            </button>


                            <button
                                type="button"
                                id="undo-move-action-button"
                            >
                                移動をやり直す
                            </button>
                        `
                }

            </div>

        `;


        panel
            .querySelector(
                "#skill-action-button"
            )
            ?.addEventListener(
                "click",
                showSkillSelection
            );


        panel
            .querySelector(
                "#wait-action-button"
            )
            ?.addEventListener(
                "click",
                waitUnit
            );


        panel
            .querySelector(
                "#bluff-action-button"
            )
            ?.addEventListener(
                "click",
                bluffUnit
            );


        panel
            .querySelector(
                "#undo-move-action-button"
            )
            ?.addEventListener(
                "click",
                undoMove
            );


        return;

    }


    /*
     * 通常のキャラクター選択画面
     */

    panel.innerHTML = `

        <div class="turn-info">

            <span>
                TURN ${battleState.turn}
            </span>

            <strong>
                PLAYER
                ${battleState.currentPlayer}
            </strong>

        </div>


        <div class="selected-info">

            ${
                selected

                    ? `

                        <span>
                            ${selected.name}
                        </span>

                        <span>
                            HP
                            ${selected.hp}/${selected.maxHp}
                        </span>

                    `

                    : `

                        <span>
                            キャラクターを選択してください
                        </span>

                    `
            }

        </div>


        <button
            type="button"
            id="end-turn-button"
        >
            TURN END
        </button>

    `;


    document
        .getElementById(
            "end-turn-button"
        )
        ?.addEventListener(
            "click",
            endTurn
        );

}


/* ========================================
   INITIALIZE
======================================== */

function initialize() {

    /*
     * [1vs1限定サイズ変更]
     * オフライン(ホットシート)は常にactivePlayers=[1,2]の2人対戦、
     * オンラインもbattle_start受信前はまだ人数不明でこの初期値のまま
     * なので、いずれの場合も一旦「2人対戦」前提のサイズ(12)で作る。
     * オンラインで実際に3〜4人対戦だった場合は、battle_start受信時に
     * BOARD_SIZEを再計算してcreateBoard()を呼び直す。
     */
    BOARD_SIZE = getBoardSizeForPlayerCount(battleState.activePlayers.length);

    createBoard();

    ensureBattleLog();

    createUnits();

    startBattleBgm();

    /*
     * 初期配置を盤面へ表示
     */

    renderUnitIcons();

    renderPlayerPanels();

    updateControlPanel();

}


initialize();
connectOnlineBattle();

})();