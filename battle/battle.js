(() => {

/* ========================================
   MONSTER WAR
   BATTLE FIELD
   キャラアイコン表示版
======================================== */

const BOARD_SIZE = 16;

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


const player1Status =
    document.getElementById(
        "player-1-status"
    );


const player2Status =
    document.getElementById(
        "player-2-status"
    );


/* ========================================
   ONLINE BATTLE
======================================== */

const battleUrlParams =
    new URLSearchParams(window.location.search);

const ONLINE_ROOM_ID =
    battleUrlParams.get("room") || "";

let MY_PLAYER_NUMBER =
    Number(battleUrlParams.get("player")) === 2
        ? 2
        : 1;

const ONLINE_PLAYER_NAME =
    battleUrlParams.get("name") ||
    `PLAYER${MY_PLAYER_NUMBER}`;

let onlineSocket = null;
let onlineApplyingState = false;
let onlineParty1 = null;
let onlineParty2 = null;
let onlinePlayerNames = {
    1: "PLAYER1",
    2: "PLAYER2"
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
        bluffUses: battleState.bluffUses
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

    battleState.turn = Number(state.turn || 1);
    battleState.currentPlayer = Number(state.currentPlayer || 1);
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
            2: String(state.playerNames[2] || "PLAYER2")
        };
    }
    battleState.battleLogs =
        Array.isArray(state.battleLogs) ? state.battleLogs : [];
    battleState.bluffUnits =
        new Set(Array.isArray(state.bluffUnits) ? state.bluffUnits : []);
    battleState.bluffUses =
        state.bluffUses || battleState.bluffUses;

    clearCellStates();
    renderUnitIcons();
    renderPlayerPanels();
    updateControlPanel();

    if (
        !previousGameOver && battleState.gameOver &&
        battleState.winner &&
        battleState.winner !== Number(MY_PLAYER_NUMBER)
    ) {
        showYouLoseCutIn();
    }

    if (
        (battleState.turn !== previousTurn ||
            battleState.currentPlayer !== previousPlayer) &&
        battleState.currentPlayer === Number(MY_PLAYER_NUMBER)
    ) {
        showYourTurnCutIn();
    }

    onlineApplyingState = false;
}

function getPlayerDisplayName(playerNumber) {
    const number = Number(playerNumber);

    if (number === 1 || number === 2) {
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
            playerName: ONLINE_PLAYER_NAME
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
            if (Number(message.playerNumber) === 1 || Number(message.playerNumber) === 2) {
                MY_PLAYER_NUMBER = Number(message.playerNumber);
                updateBoardPerspective();
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
                table: "battle"
            }));

            onlineSocket.send(JSON.stringify({
                type: "battle_join",
                roomId: ONLINE_ROOM_ID,
                player: MY_PLAYER_NUMBER
            }));

            return;
        }

        if (message.type === "battle_start") {
            if (onlineBattleStarted) {
                return;
            }

            const players = message.players || [];

            const player1 = players.find(
                player => Number(player.player) === 1
            );
            const player2 = players.find(
                player => Number(player.player) === 2
            );

            /*
             * [PARTY FIX 4: battle_startのpartyを唯一の初期値にする]
             *
             * サーバーのroom_readyで確定したpartyを受け取り、
             * createUnits()より前に反映します。
             */
            if (Array.isArray(player1?.party)) {
                onlineParty1 = player1.party.map(Number).filter(Number.isFinite).slice(0, 6);
            }

            if (Array.isArray(player2?.party)) {
                onlineParty2 = player2.party.map(Number).filter(Number.isFinite).slice(0, 6);
            }

            onlinePlayerNames = {
                1: String(player1?.name || "PLAYER1"),
                2: String(player2?.name || "PLAYER2")
            };

            onlineBattleStarted = true;

            createUnits();
            renderUnitIcons();
            renderPlayerPanels();
            updateControlPanel();
            if (MY_PLAYER_NUMBER === 1) {
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
   CHARACTER SONG
======================================== */


let characterSongAudio = null;

function playCharacterSong(characterId) {

    const song = characterSongDatabase?.[characterId];

    if (characterSongAudio) {
        characterSongAudio.pause();
        characterSongAudio.currentTime = 0;
    }

    if (!song || !song.path) {
        characterSongAudio = new Audio("../audio/CanChoke.mp3");
        characterSongAudio.volume = 1.0;

        characterSongAudio.play().catch(error => {
            console.error("通常曲の再生に失敗しました。", error);
        });

        console.log("通常曲を再生します。");
        return;
    }

    characterSongAudio = new Audio(song.path);
    characterSongAudio.volume = 1.0;

    characterSongAudio.play().catch(error => {
        console.error("キャラソングの再生に失敗しました。", error);
    });

    console.log(`${song.title} を再生します。`);
}


/* ========================================
   KILL CUT-IN
======================================== */

let killCutInTimer = null;
let yourTurnCutInTimer = null;
let lastYourTurnKey = null;

function showYourTurnCutIn() {

    if (Number(MY_PLAYER_NUMBER) !== 1 && Number(MY_PLAYER_NUMBER) !== 2) {
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
   BATTLE STATE
======================================== */

const SIEGE_CASTLES = {
    1: { row: 16, column: 1 },
    2: { row: 1, column: 16 }
};

const battleState = {

    turn: 1,

    currentPlayer: 1,

    selectedUnitId: null,

    movableCells: [],

    units: [],

    movedUnits: new Set(),

    actionPhase: null,

    skillPhase: null,

    skillDirection: null,

    skillTargetCells: [],

    selectedSkillId: null,

    gameOver: false,

    winner: null,

    gameOverReason: "",

    battleLogs: [],

    bluffUnits: new Set(),

    // プレイヤーごとに共有するブラフ使用回数
    bluffUses: {
        1: {
            ketsukacchin: 2,
            ketsuiki: 2,
            dappunta: 2
        },
        2: {
            ketsukacchin: 2,
            ketsuiki: 2,
            dappunta: 2
        }
    }

};


/* ========================================
   DATABASE
======================================== */

function getCharacter(id) {

    return characterDatabase.find(
        character =>
            character.id === id
    );

}


function getSkill(id) {

    return skillDatabase.find(
        skill =>
            skill.id === Number(id)
    );

}


function getCharacterSkills(
    characterId
) {

    return (
        characterSkillsDatabase[
            characterId
        ] || []
    )
        .map(id => getSkill(id))
        .filter(Boolean);

}


/* ========================================
   PLAYER 1 PARTY
======================================== */

function loadPlayer1Party() {

    try {

        const saved =
            JSON.parse(
                localStorage.getItem(
                    "monsterWarParty"
                ) || "[]"
            );


        if (Array.isArray(saved)) {

            const party =
                saved
                    .filter(
                        id =>
                            getCharacter(id)
                    )
                    .slice(0, 6);


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

function updateBoardPerspective() {

    if (!battleField) {
        return;
    }

    const playerNumber = Number(MY_PLAYER_NUMBER);

    battleField
        .querySelectorAll(".board-cell")
        .forEach(cell => {

            const row = Number(cell.dataset.row);
            const column = Number(cell.dataset.column);

            if (playerNumber === 2) {
                // P2側ではP2の陣営が手前になるよう、
                // ゲームデータを変更せず表示位置だけ180度反転します。
                cell.style.gridRow = String(BOARD_SIZE - row + 1);
                cell.style.gridColumn = String(BOARD_SIZE - column + 1);
            } else {
                cell.style.gridRow = String(row);
                cell.style.gridColumn = String(column);
            }
        });
}


/* ========================================
   CREATE BOARD
======================================== */

function createBoard() {

    if (!battleField) {
        return;
    }


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

function getCastleAt(row, column) {

    for (const player of [1, 2]) {

        const castle =
            SIEGE_CASTLES[player];

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

    Object.entries(SIEGE_CASTLES)
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
    battleState.winner = Number(winner);
    battleState.gameOverReason = String(reason || "");

    if (Number(winner) !== Number(MY_PLAYER_NUMBER)) {
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

    const panel =
        document.getElementById(
            "battle-control-panel"
        );

    if (panel) {

        panel.innerHTML = `
            <div class="battle-result">
                <div class="battle-result-label">
                    SIEGE BATTLE
                </div>

                <strong>
                    ${getPlayerDisplayName(winner)} WIN
                </strong>

                <span>
                    ${reason}
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
    }

    document
        .getElementById("return-title-button")
        ?.addEventListener("click", () => {
            window.location.href = "/title/title.html";
        });

    // オンライン対戦では勝敗情報を含む最終状態を相手へ即時同期する。
    if (ONLINE_ROOM_ID && !onlineApplyingState) {
        onlineSendState();
    }
}


function checkVictoryCondition() {

    if (battleState.gameOver) {
        return true;
    }

    const alive1 =
        battleState.units.some(
            unit =>
                unit.player === 1 &&
                unit.alive
        );

    const alive2 =
        battleState.units.some(
            unit =>
                unit.player === 2 &&
                unit.alive
        );

    if (!alive1) {
        showBattleResult(
            2,
            "PLAYER 1の全滅"
        );
        return true;
    }

    if (!alive2) {
        showBattleResult(
            1,
            "PLAYER 2の全滅"
        );
        return true;
    }

    return false;
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
        castleOwner === unit.player
    ) {
        return false;
    }

    showBattleResult(
        unit.player,
        `${getPlayerDisplayName(unit.player)}が敵城へ侵入`
    );

    return true;
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
        bluffTurn: null

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
     *
     * PLAYER 2：右上の城（1,16）をL字に囲む
     * PLAYER 1：左下の城（16,1）をL字に囲む
     */

    if (player === 2) {
        return [
            { row: 2, column: 16 },
            { row: 3, column: 16 },
            { row: 4, column: 16 },
            { row: 1, column: 15 },
            { row: 1, column: 14 },
            { row: 1, column: 13 }
        ];
    }

    return [
        { row: 15, column: 1 },
        { row: 14, column: 1 },
        { row: 13, column: 1 },
        { row: 16, column: 2 },
        { row: 16, column: 3 },
        { row: 16, column: 4 }
    ];
}


/* ========================================
   CREATE UNITS
======================================== */

function createUnits() {

    battleState.units = [];


    const players = [

        {
            party:
                onlineParty2 ??
                (ONLINE_ROOM_ID ? [] : PLAYER_2_PARTY),

            player: 2

        },

        {
            party:
                onlineParty1 ??
                (ONLINE_ROOM_ID ? [] : PLAYER_1_PARTY),

            player: 1

        }

    ];


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
     * 生存しているキャラだけ盤面へ配置
     */

    battleState.units
        .filter(
            unit =>
                unit.alive
        )
        .forEach(
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
                    "board-unit-icon";


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

                icon.style.zIndex =
                    "2";


                /*
                 * 選択中のキャラだけ少し強調
                 */

                if (
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
                 */

                icon.style.boxSizing =
                    "border-box";


                icon.style.border =
                    unit.player === 1
                        ? "2px solid rgba(59,130,246,0.8)"
                        : "2px solid rgba(239,68,68,0.8)";


                icon.style.borderRadius =
                    "50%";


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

    unit.row =
        row;


    unit.column =
        column;

    addBattleLog(
        `${unit.name}が(${row},${column})へ移動した！`
    );


    /*
     * 敵城へ到達した時点で即時勝利。
     * 行動選択フェーズには進まない。
     */
    if (checkCastleVictory(unit)) {
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

    // 移動した時点で即座に相手へ盤面を同期します。
    // 行動終了まで待たないため、移動そのものが遅れて表示されません。
    onlineSendState();

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

function waitUnit() {

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

    addBattleLog(`${unit.name}はその場で待機した！`);

    // 移動せず、その場にとどまって行動終了。
    battleState.movedUnits.add(unit.unitId);

    finishUnitAction();

}


/* ========================================
   BLUFF
======================================== */

function bluffUnit() {

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

    // ブラフを仕込んだこと自体は明示せず、通常の待機と同じログを表示する。
    addBattleLog(`${unit.name}はその場で待機した！`);

    unit.bluffType = type;
    unit.bluffTurn = battleState.turn + 1;

    battleState.bluffUnits.add(
        unit.unitId
    );

    finishUnitAction();
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

                    return `
                        <button
                            type="button"
                            class="skill-button"
                            data-direction="${direction}"
                        >
                            ${labels[direction]}
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

    const guardActive =
        target.guardNextTurn &&
        target.guardTurn === battleState.turn;

    if (guardActive && !ignoreDefense) {
        finalDamage = Math.floor(finalDamage / 2);
    }

    const bluffActive =
        !ignoreBluff &&
        target.bluffType &&
        target.bluffTurn === battleState.turn;

    if (bluffActive) {
        const bluffNames = {
            ketsukacchin: "ケツカッチン",
            ketsuiki: "ケツイキ",
            dappunta: "脱糞ター"
        };

        addBattleLog(
            `${target.name}の${bluffNames[target.bluffType] || target.bluffType}発動！`
        );

        if (
            target.bluffType === "ketsukacchin" &&
            Number(skill?.id) !== 9
        ) {
            finalDamage = 0;
        }

        if (target.bluffType === "ketsuiki") {
            target.hp = Math.min(
                target.maxHp,
                target.hp + finalDamage
            );
            finalDamage = 0;
        }

        if (
            target.bluffType === "dappunta" &&
            attacker &&
            attacker.alive
        ) {
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
        }

        target.bluffType = null;
        target.bluffTurn = null;
        battleState.bluffUnits.delete(
            target.unitId
        );
    }

    if (attacker && skill && target) {
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
        target.guardTurn = null;
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

    switch (skill.id) {
        case 1:
        case 2:
        case 5:
            applyDamageToTargets(
                unit,
                enemies,
                skill,
                multiplier
            );
            break;

        case 3:
            reviveTarget(
                deadTargets.find(
                    target =>
                        target.player === unit.player
                ),
                skill.power
            );
            break;

        case 4:
            removeTarget(
                deadTargets.find(
                    target =>
                        target.player === unit.player
                )
            );
            break;

        case 6:
            unit.nextPowerMultiplier = 2;
            unit.nextPowerTurn =
                battleState.turn + 1;
            break;

        case 7:
            healTargets(
                allies.slice(0, 1),
                Number(skill.power || 0)
            );
            break;

        case 8:
            battleState.units
                .filter(
                    target =>
                        target.alive &&
                        target.player === unit.player
                )
                .forEach(target => {
                    target.move += 2;
                });
            break;

        case 9:
            applyDamageToTargets(
                unit,
                enemies,
                skill,
                multiplier
            );

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
            break;

        case 10:
            applyDamageToTargets(
                unit,
                enemies,
                skill,
                multiplier,
                true
            );
            break;

        case 11:
            unit.guardNextTurn = true;
            unit.guardTurn =
                battleState.turn + 1;
            break;

        case 12:
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
            break;
    }
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


    card.classList.add(

        unit.player === 1
            ? "player-1"
            : "player-2"

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
        )
    ) {

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
            )

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

function renderPlayerPanels() {

    if (player1Status) {

        player1Status.innerHTML =
            "";

    }


    if (player2Status) {

        player2Status.innerHTML =
            "";

    }


    const player1Units =
        battleState.units.filter(
            unit =>
                unit.player === 1
        );


    const player2Units =
        battleState.units.filter(
            unit =>
                unit.player === 2
        );


    player1Units.forEach(
        unit => {

            const card =
                createStatusCard(
                    unit
                );


            if (
                card &&
                player1Status
            ) {

                player1Status.appendChild(
                    card
                );

            }

        }
    );


    player2Units.forEach(
        unit => {

            const card =
                createStatusCard(
                    unit
                );


            if (
                card &&
                player2Status
            ) {

                player2Status.appendChild(
                    card
                );

            }

        }
    );

}


/* ========================================
   END TURN
======================================== */

function endTurn() {

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


    battleState.movedUnits.clear();


    clearCellStates();


    if (
        battleState.currentPlayer === 1
    ) {

        battleState.currentPlayer =
            2;

    } else {

        battleState.currentPlayer =
            1;

        battleState.turn++;

    }

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
                    移動完了
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


                <button
                    type="button"
                    id="bluff-action-button"
                >
                    ブラフを<br>仕込んで待機
                </button>

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

    createBoard();

    ensureBattleLog();

    createUnits();

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