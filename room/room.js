(() => {
"use strict";

const ROOM_STORAGE_KEY = "monsterWarRoom";
const PLAYER_NAME_STORAGE_KEY = "monsterWarPlayerName";

const params = new URLSearchParams(window.location.search);
const requestedRoomId =
    "CHINKO";

const playerName =
    localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || "PLAYER";

const playerNameDisplay =
    document.getElementById("player-name-display");

const roomIdDisplay =
    document.getElementById("room-id-display");

const selectedTableDisplay =
    document.getElementById("selected-table");

const connectionStatus =
    document.getElementById("connection-status");

const battleTable =
    document.getElementById("battle-table");

const spectatorTable =
    document.getElementById("spectator-table");

const readyButton =
    document.getElementById("ready-button");

const backButton =
    document.getElementById("back-button");

const battlePlayer1 =
    document.getElementById("battle-player-1");

const battlePlayer2 =
    document.getElementById("battle-player-2");

const battleReady1 =
    document.getElementById("battle-ready-1");

const battleReady2 =
    document.getElementById("battle-ready-2");

let socket = null;
let roomState = {
    roomId: requestedRoomId || createRoomId(),
    battlePlayers: [
        { name: "", ready: false },
        { name: "", ready: false }
    ],
    spectators: [],
    battleStarted: false
};
let selectedTable = null;
let myPlayerNumber = 0;
let battleStartedHandled = false;

function createRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";

    for (let i = 0; i < 6; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }

    return result;
}

function getParty() {
    try {
        const party =
            JSON.parse(
                localStorage.getItem("monsterWarParty") || "[]"
            );

        if (Array.isArray(party)) {
            return party
                .map(Number)
                .filter(Number.isFinite)
                .slice(0, 6);
        }
    } catch (error) {
        console.warn("パーティの読み込みに失敗しました。", error);
    }

    return [];
}

function setConnectionStatus(text, connected = false) {
    if (!connectionStatus) return;

    connectionStatus.textContent = text;
    connectionStatus.classList.toggle("connected", connected);
}

function saveRoom() {
    localStorage.setItem(
        ROOM_STORAGE_KEY,
        JSON.stringify(roomState)
    );
}

function renderRoom() {
    if (playerNameDisplay) {
        playerNameDisplay.textContent = playerName;
    }

    if (roomIdDisplay) {
        roomIdDisplay.textContent = roomState.roomId;
    }

    const players =
        roomState.battlePlayers || [
            { name: "", ready: false },
            { name: "", ready: false }
        ];

    if (battlePlayer1) {
        battlePlayer1.textContent =
            players[0]?.name || "WAITING";
    }

    if (battlePlayer2) {
        battlePlayer2.textContent =
            players[1]?.name || "WAITING";
    }

    if (battleReady1) {
        battleReady1.textContent =
            players[0]?.ready ? "READY" : "WAITING";
        battleReady1.classList.toggle(
            "ready",
            !!players[0]?.ready
        );
    }

    if (battleReady2) {
        battleReady2.textContent =
            players[1]?.ready ? "READY" : "WAITING";
        battleReady2.classList.toggle(
            "ready",
            !!players[1]?.ready
        );
    }

    if (selectedTableDisplay) {
        selectedTableDisplay.textContent =
            selectedTable === "battle"
                ? "対戦卓"
                : selectedTable === "spectator"
                    ? "観戦卓"
                    : "卓を選択してください";
    }

    battleTable?.classList.toggle(
        "active",
        selectedTable === "battle"
    );

    spectatorTable?.classList.toggle(
        "active",
        selectedTable === "spectator"
    );

    if (readyButton) {
        const isBattlePlayer =
            myPlayerNumber === 1 ||
            myPlayerNumber === 2;

        const currentReady =
            isBattlePlayer &&
            !!players[myPlayerNumber - 1]?.ready;

        readyButton.disabled = !isBattlePlayer;

        const label =
            readyButton.querySelector(".button-label");

        if (label) {
            label.textContent =
                currentReady ? "解除" : "準備";
        }

        readyButton.classList.toggle(
            "ready",
            currentReady
        );
    }
}

function connect() {
    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    const host =
        location.host || "localhost:8080";

    const url =
        `${protocol}//${host}`;

    setConnectionStatus("CONNECTING...");

    try {
        socket = new WebSocket(url);
    } catch (error) {
        setConnectionStatus("CONNECTION ERROR");
        console.error(error);
        return;
    }

    socket.addEventListener("open", () => {
        setConnectionStatus("ONLINE", true);

        send({
            type: "room_join",
            roomId: roomState.roomId,
            playerName
        });
    });

    socket.addEventListener("message", event => {
        let message;

        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }

        handleServerMessage(message);
    });

    socket.addEventListener("close", () => {
        setConnectionStatus("OFFLINE");
    });

    socket.addEventListener("error", () => {
        setConnectionStatus("CONNECTION ERROR");
    });
}

function send(payload) {
    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
}

function handleServerMessage(message) {
    switch (message.type) {
        case "room_connected":
            roomState.roomId =
                message.roomId || roomState.roomId;

            saveRoom();
            renderRoom();
            break;

        case "room_state":
            roomState =
                message.room || roomState;

            myPlayerNumber =
                roomState.battlePlayers.findIndex(
                    player =>
                        player.name === playerName
                ) + 1;

            if (
                myPlayerNumber !== 1 &&
                myPlayerNumber !== 2
            ) {
                myPlayerNumber = 0;
            }

            if (
                myPlayerNumber > 0
            ) {
                selectedTable = "battle";
            }

            saveRoom();
            renderRoom();
            break;

        case "battle_start":
            if (battleStartedHandled) {
                return;
            }

            battleStartedHandled = true;

            const myPlayer =
                message.players?.find(
                    player =>
                        player.name === playerName
                )?.player || myPlayerNumber;

            const roomId =
                message.roomId || roomState.roomId;

            window.location.href =
                `../battle/battle.html?room=${encodeURIComponent(roomId)}&player=${myPlayer}&name=${encodeURIComponent(playerName)}`;

            break;
    }
}

function selectTable(table) {
    selectedTable = table;

    if (table === "battle") {
        send({
            type: "room_select_table",
            table: "battle",
            party: getParty()
        });
    } else {
        send({
            type: "room_select_table",
            table: "spectator"
        });
    }

    renderRoom();
}

function toggleReady() {
    if (
        myPlayerNumber !== 1 &&
        myPlayerNumber !== 2
    ) {
        return;
    }

    const current =
        !!roomState.battlePlayers[
            myPlayerNumber - 1
        ]?.ready;

    send({
        type: "room_ready",
        ready: !current,
        party: getParty()
    });
}

battleTable?.addEventListener(
    "click",
    () => selectTable("battle")
);

spectatorTable?.addEventListener(
    "click",
    () => selectTable("spectator")
);

readyButton?.addEventListener(
    "click",
    toggleReady
);

backButton?.addEventListener(
    "click",
    () => {
        window.location.href =
            "../title/title.html";
    }
);

if (roomIdDisplay) {
    roomIdDisplay.title =
        "クリックでルームIDをコピー";

    roomIdDisplay.addEventListener(
        "click",
        async () => {
            try {
                const shareUrl =
                    new URL(window.location.href);

                shareUrl.searchParams.set(
                    "room",
                    roomState.roomId
                );

                await navigator.clipboard.writeText(
                    shareUrl.href
                );

                setConnectionStatus(
                    "ROOM LINK COPIED",
                    true
                );

                setTimeout(
                    () => {
                        if (
                            socket?.readyState ===
                            WebSocket.OPEN
                        ) {
                            setConnectionStatus(
                                "ONLINE",
                                true
                            );
                        }
                    },
                    1200
                );
            } catch {
                // Clipboard APIが使えない環境では何もしない
            }
        }
    );
}

renderRoom();
connect();

})();
