(() => {
    "use strict";

    const C = window.MONSTER_WAR_CONSTANTS;

    const PLAYER_NAME_STORAGE_KEY = C.STORAGE_KEYS.PLAYER_NAME;
    const SESSION_ID_STORAGE_KEY = C.STORAGE_KEYS.SESSION_ID;
    const PARTY_STORAGE_KEY = C.STORAGE_KEYS.PARTY;
    const FIXED_ROOM_ID = C.FIXED_ROOM_ID;

    /*
     * [IDENTITY FIX]
     * 名前は同じものを複数人が使える単なる表示ラベルなので、
     * サーバー側の本人確認には使えません。
     * タブ（ページセッション）ごとに一意なsessionIdを発行し、
     * sessionStorageに保存して、ROOM→BATTLEの画面遷移をまたいで
     * 同じIDを使い続けることで「同じ名前の別人」と区別します。
     * sessionStorageはタブ単位なので、同じ端末でも別タブ・別人なら
     * 別のsessionIdになります。
     */
    function generateSessionId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            try {
                return window.crypto.randomUUID();
            } catch (error) {
                // フォールバックへ続行
            }
        }

        return "sid-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    }

    function getSessionId() {
        let sessionId = sessionStorage.getItem(SESSION_ID_STORAGE_KEY);

        if (!sessionId) {
            sessionId = generateSessionId();
            sessionStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
        }

        return sessionId;
    }

    function getPlayerName() {
        const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);

        if (savedName) {
            const useSavedName = window.confirm(`プレイヤーネーム「${savedName}」を使用しますか？`);

            if (useSavedName) {
                return savedName.trim().slice(0, C.PLAYER_NAME_MAX_LENGTH) || C.DEFAULT_PLAYER_NAME;
            }
        }

        while (true) {
            const input = window.prompt("プレイヤーネームを入力してください。");

            if (input === null) {
                window.location.href = "../title/title.html";
                return C.DEFAULT_PLAYER_NAME;
            }

            const name = input.trim().slice(0, C.PLAYER_NAME_MAX_LENGTH);

            if (name) {
                localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
                return name;
            }

            window.alert("プレイヤーネームを入力してください。");
        }
    }

    const playerName = getPlayerName();
    let sessionId = getSessionId();

    const playerNameDisplay = document.getElementById("player-name-display");
    const roomIdDisplay = document.getElementById("room-id-display");
    const selectedTableDisplay = document.getElementById("selected-table");
    const connectionStatus = document.getElementById("connection-status");
    const battleTable = document.getElementById("battle-table");
    const spectatorTable = document.getElementById("spectator-table");
    const spectatorCountDisplay = document.getElementById("spectator-count");
    const readyButton = document.getElementById("ready-button");
    const backButton = document.getElementById("back-button");
    const battlePlayer1 = document.getElementById("battle-player-1");
    const battlePlayer2 = document.getElementById("battle-player-2");
    const battleReady1 = document.getElementById("battle-ready-1");
    const battleReady2 = document.getElementById("battle-ready-2");

    let socket = null;
    let myPlayerNumber = 0;
    let selectedTable = null;
    let myReady = false;
    let battleStartedHandled = false;

    let roomState = {
        roomId: FIXED_ROOM_ID,
        battlePlayers: [
            { name: "", ready: false },
            { name: "", ready: false }
        ],
        spectators: [],
        battleStarted: false
    };

    function getParty() {
        try {
            const party = JSON.parse(localStorage.getItem(PARTY_STORAGE_KEY) || "[]");

            if (Array.isArray(party)) {
                return party
                    .map(Number)
                    .filter(Number.isFinite)
                    .slice(0, C.PARTY_MAX_SIZE);
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

    function resolveMyPlayerNumber() {
        // サーバーから割り当てられた番号を最優先します。
        // 卓を選択していない状態では、自分の名前が空席に一致していても
        // PLAYER扱いにはしません。
        return myPlayerNumber;
    }

    function renderRoom() {
        if (playerNameDisplay) {
            playerNameDisplay.textContent = playerName;
        }

        if (roomIdDisplay) {
            roomIdDisplay.textContent = FIXED_ROOM_ID;
        }

        const players = roomState.battlePlayers || [
            { name: "", ready: false },
            { name: "", ready: false }
        ];

        if (battlePlayer1) {
            battlePlayer1.textContent = players[0]?.name || "WAITING";
        }

        if (battlePlayer2) {
            battlePlayer2.textContent = players[1]?.name || "WAITING";
        }

        if (battleReady1) {
            battleReady1.textContent = players[0]?.ready ? "READY" : "WAITING";
            battleReady1.classList.toggle("ready", !!players[0]?.ready);
        }

        if (battleReady2) {
            battleReady2.textContent = players[1]?.ready ? "READY" : "WAITING";
            battleReady2.classList.toggle("ready", !!players[1]?.ready);
        }

        if (selectedTableDisplay) {
            if (selectedTable === "battle1") {
                selectedTableDisplay.textContent = "対戦卓1";
            } else if (selectedTable === "battle2") {
                selectedTableDisplay.textContent = "対戦卓2";
            } else if (selectedTable === "spectator") {
                selectedTableDisplay.textContent = "観戦卓";
            } else {
                selectedTableDisplay.textContent = "卓を選択してください";
            }
        }

        if (battleTable) {
            battleTable.classList.toggle(
                "active",
                selectedTable === "battle1" || selectedTable === "battle2"
            );
        }

        if (spectatorTable) {
            spectatorTable.classList.toggle("active", selectedTable === "spectator");
        }

        if (spectatorCountDisplay) {
            // [BUGFIX] 観戦卓の人数表示が常に0のまま更新されていなかった。
            spectatorCountDisplay.textContent = String(
                (roomState.spectators || []).length
            );
        }

        if (readyButton) {
            const isPlayer = myPlayerNumber === 1 || myPlayerNumber === 2;
            const serverReady = isPlayer && !!players[myPlayerNumber - 1]?.ready;

            // 送信直後はサーバーからroom_stateが返るまで
            // 自分のローカル状態を表示します。
            const ready = isPlayer && (myReady || serverReady);

            // PLAYER 1/2に割り当てられたら、
            // 常に準備ボタンを操作可能にします。
            // 接続前だけは無効にして、接続後の再描画で有効化します。
            const isConnected = socket && socket.readyState === WebSocket.OPEN;

            readyButton.disabled = !isPlayer || !isConnected;

            const label = readyButton.querySelector(".button-label");

            if (label) {
                label.textContent = ready ? "解除" : "準備";
            }

            readyButton.classList.toggle("ready", ready);
        }
    }

    function send(payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return false;
        }

        socket.send(JSON.stringify(payload));
        return true;
    }

    function connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const host = location.host || "localhost:8080";

        setConnectionStatus("CONNECTING...");

        try {
            socket = new WebSocket(`${protocol}//${host}`);
        } catch (error) {
            setConnectionStatus("CONNECTION ERROR");
            console.error(error);
            return;
        }

        socket.addEventListener("open", () => {
            setConnectionStatus("ONLINE", true);

            // 接続直後にも描画して、準備ボタンの状態を更新します。
            renderRoom();

            /*
             * ルームIDは送るが、
             * サーバー側でも必ず
             * MONSTER_WARに固定する。
             */
            send({
                type: "room_join",
                roomId: FIXED_ROOM_ID,
                playerName,
                sessionId
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

        socket.addEventListener("error", error => {
            console.error("WebSocket error:", error);
            setConnectionStatus("CONNECTION ERROR");
        });
    }

    function handleServerMessage(message) {
        switch (message.type) {
            case "room_connected": {
                if (typeof message.sessionId === "string" && message.sessionId) {
                    sessionId = message.sessionId;
                    sessionStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
                }

                const assignedPlayerNumber = Number(message.playerNumber);

                // ROOM入室時点では卓未選択です。
                // 卓の割り当てはtable_assignedで受け取ります。
                myPlayerNumber =
                    assignedPlayerNumber === 1 || assignedPlayerNumber === 2
                        ? assignedPlayerNumber
                        : 0;

                resolveMyPlayerNumber();

                roomState.roomId = FIXED_ROOM_ID;

                renderRoom();
                break;
            }

            case "room_state": {
                roomState = message.room || roomState;

                const receivedPlayerNumber = Number(message.yourPlayerNumber);

                /*
                 * サーバーがPLAYER 1/2を割り当てた場合だけ
                 * 自分の番号を更新する。
                 *
                 * これ以外のroom_stateで0に戻さない。
                 */
                if (receivedPlayerNumber === 1 || receivedPlayerNumber === 2) {
                    myPlayerNumber = receivedPlayerNumber;
                }

                resolveMyPlayerNumber();

                if (myPlayerNumber === 1 || myPlayerNumber === 2) {
                    myReady = !!roomState.battlePlayers?.[myPlayerNumber - 1]?.ready;
                }

                renderRoom();
                break;
            }

            case "table_assigned": {
                selectedTable = message.table || null;

                const assigned = Number(message.playerNumber);
                myPlayerNumber = assigned === 1 || assigned === 2 ? assigned : 0;

                resolveMyPlayerNumber();
                renderRoom();
                break;
            }

            case "room_error": {
                window.alert(message.message || "卓のアサインに失敗しました。");
                break;
            }

            case "battle_start": {
                if (battleStartedHandled) return;

                battleStartedHandled = true;

                if (
                    selectedTable !== "battle1" &&
                    selectedTable !== "battle2" &&
                    selectedTable !== "spectator"
                ) {
                    // 卓未選択のROOM参加者は試合開始してもBATTLEへ移動しません。
                    battleStartedHandled = false;
                    return;
                }

                if (selectedTable === "spectator") {
                    window.location.href =
                        `../battle/battle.html?room=${encodeURIComponent(FIXED_ROOM_ID)}` +
                        `&spectator=true&name=${encodeURIComponent(playerName)}` +
                        `&session=${encodeURIComponent(sessionId)}`;
                    return;
                }

                const myPlayer = selectedTable === "battle2" ? 2 : 1;

                window.location.href =
                    `../battle/battle.html?room=${encodeURIComponent(FIXED_ROOM_ID)}` +
                    `&player=${myPlayer}&name=${encodeURIComponent(playerName)}` +
                    `&session=${encodeURIComponent(sessionId)}`;

                break;
            }
        }
    }

    function toggleReady() {
        resolveMyPlayerNumber();

        if (myPlayerNumber !== 1 && myPlayerNumber !== 2) {
            return;
        }

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        const index = myPlayerNumber - 1;
        const currentReady = !!roomState.battlePlayers?.[index]?.ready;

        myReady = !currentReady;
        renderRoom();

        const sent = send({
            type: "room_ready",
            ready: myReady,
            party: getParty()
        });

        if (!sent) {
            myReady = currentReady;
            renderRoom();
        }
    }

    /*
     * 卓は自動アサインせず、ユーザーが明示的に選択します。
     */
    function selectTable(table) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        send({ type: "room_select_table", table });
    }

    battlePlayer1?.addEventListener("click", () => selectTable("battle1"));
    battlePlayer2?.addEventListener("click", () => selectTable("battle2"));
    spectatorTable?.addEventListener("click", () => selectTable("spectator"));
    readyButton?.addEventListener("click", toggleReady);

    backButton?.addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }

        window.location.href = "../title/title.html";
    });

    renderRoom();
    connect();
})();
