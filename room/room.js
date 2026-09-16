(() => {
    "use strict";

    const PLAYER_NAME_STORAGE_KEY =
        "monsterWarPlayerName";

    const FIXED_ROOM_ID =
        "MONSTER_WAR";

    function getPlayerName() {
        const savedName =
            localStorage.getItem(
                PLAYER_NAME_STORAGE_KEY
            );

        if (savedName) {
            const useSavedName =
                window.confirm(
                    `プレイヤーネーム「${savedName}」を使用しますか？`
                );

            if (useSavedName) {
                return savedName
                    .trim()
                    .slice(0, 12) || "PLAYER";
            }
        }

        while (true) {
            const input =
                window.prompt(
                    "プレイヤーネームを入力してください。"
                );

            if (input === null) {
                window.location.href =
                    "../title/title.html";
                return "PLAYER";
            }

            const name =
                input.trim().slice(0, 12);

            if (name) {
                localStorage.setItem(
                    PLAYER_NAME_STORAGE_KEY,
                    name
                );
                return name;
            }

            window.alert(
                "プレイヤーネームを入力してください。"
            );
        }
    }

    const playerName = getPlayerName();

    const playerNameDisplay =
        document.getElementById(
            "player-name-display"
        );

    const roomIdDisplay =
        document.getElementById(
            "room-id-display"
        );

    const selectedTableDisplay =
        document.getElementById(
            "selected-table"
        );

    const connectionStatus =
        document.getElementById(
            "connection-status"
        );

    const battleTable =
        document.getElementById(
            "battle-table"
        );

    const spectatorTable =
        document.getElementById(
            "spectator-table"
        );

    const readyButton =
        document.getElementById(
            "ready-button"
        );

    const backButton =
        document.getElementById(
            "back-button"
        );

    const battlePlayer1 =
        document.getElementById(
            "battle-player-1"
        );

    const battlePlayer2 =
        document.getElementById(
            "battle-player-2"
        );

    const battleReady1 =
        document.getElementById(
            "battle-ready-1"
        );

    const battleReady2 =
        document.getElementById(
            "battle-ready-2"
        );

    let socket = null;

    let myPlayerNumber = 0;

    let battleStartedHandled =
        false;

    let roomState = {
        roomId:
            FIXED_ROOM_ID,

        battlePlayers: [
            {
                name: "",
                ready: false
            },
            {
                name: "",
                ready: false
            }
        ],

        spectators: [],

        battleStarted:
            false
    };

    function getParty() {
        try {
            const party =
                JSON.parse(
                    localStorage.getItem(
                        "monsterWarParty"
                    ) ||
                    "[]"
                );

            if (
                Array.isArray(
                    party
                )
            ) {
                return party
                    .map(Number)
                    .filter(
                        Number.isFinite
                    )
                    .slice(0, 6);
            }
        } catch (error) {
            console.warn(
                "パーティの読み込みに失敗しました。",
                error
            );
        }

        return [];
    }

    function setConnectionStatus(
        text,
        connected = false
    ) {
        if (
            !connectionStatus
        ) {
            return;
        }

        connectionStatus.textContent =
            text;

        connectionStatus.classList.toggle(
            "connected",
            connected
        );
    }

    function renderRoom() {
        if (
            playerNameDisplay
        ) {
            playerNameDisplay.textContent =
                playerName;
        }

        if (
            roomIdDisplay
        ) {
            roomIdDisplay.textContent =
                FIXED_ROOM_ID;
        }

        const players =
            roomState.battlePlayers ||
            [
                {
                    name: "",
                    ready: false
                },
                {
                    name: "",
                    ready: false
                }
            ];

        if (
            battlePlayer1
        ) {
            battlePlayer1.textContent =
                players[0]?.name ||
                "WAITING";
        }

        if (
            battlePlayer2
        ) {
            battlePlayer2.textContent =
                players[1]?.name ||
                "WAITING";
        }

        if (
            battleReady1
        ) {
            battleReady1.textContent =
                players[0]?.ready
                    ? "READY"
                    : "WAITING";

            battleReady1.classList.toggle(
                "ready",
                !!players[0]?.ready
            );
        }

        if (
            battleReady2
        ) {
            battleReady2.textContent =
                players[1]?.ready
                    ? "READY"
                    : "WAITING";

            battleReady2.classList.toggle(
                "ready",
                !!players[1]?.ready
            );
        }

        if (
            selectedTableDisplay
        ) {
            if (
                myPlayerNumber === 1 ||
                myPlayerNumber === 2
            ) {
                selectedTableDisplay.textContent =
                    "対戦卓";
            } else {
                selectedTableDisplay.textContent =
                    "観戦";
            }
        }

        if (
            battleTable
        ) {
            battleTable.classList.toggle(
                "active",
                myPlayerNumber === 1 ||
                myPlayerNumber === 2
            );
        }

        if (
            spectatorTable
        ) {
            spectatorTable.classList.toggle(
                "active",
                myPlayerNumber === 0
            );
        }

        if (
            readyButton
        ) {
            const isPlayer =
                myPlayerNumber === 1 ||
                myPlayerNumber === 2;

            const ready =
                isPlayer &&
                !!players[
                    myPlayerNumber - 1
                ]?.ready;

            readyButton.disabled =
                !isPlayer;

            const label =
                readyButton.querySelector(
                    ".button-label"
                );

            if (label) {
                label.textContent =
                    ready
                        ? "解除"
                        : "準備";
            }

            readyButton.classList.toggle(
                "ready",
                ready
            );
        }
    }

    function send(
        payload
    ) {
        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {
            return false;
        }

        socket.send(
            JSON.stringify(
                payload
            )
        );

        return true;
    }

    function connect() {
        const protocol =
            location.protocol ===
            "https:"
                ? "wss:"
                : "ws:";

        const host =
            location.host ||
            "localhost:8080";

        setConnectionStatus(
            "CONNECTING..."
        );

        try {
            socket =
                new WebSocket(
                    `${protocol}//${host}`
                );
        } catch (error) {
            setConnectionStatus(
                "CONNECTION ERROR"
            );

            console.error(
                error
            );

            return;
        }

        socket.addEventListener(
            "open",
            () => {
                setConnectionStatus(
                    "ONLINE",
                    true
                );

                /*
                 * ルームIDは送るが、
                 * サーバー側でも必ず
                 * MONSTER_WARに固定する。
                 */
                send({
                    type:
                        "room_join",

                    roomId:
                        FIXED_ROOM_ID,

                    playerName
                });
            }
        );

        socket.addEventListener(
            "message",
            event => {
                let message;

                try {
                    message =
                        JSON.parse(
                            event.data
                        );
                } catch {
                    return;
                }

                handleServerMessage(
                    message
                );
            }
        );

        socket.addEventListener(
            "close",
            () => {
                setConnectionStatus(
                    "OFFLINE"
                );
            }
        );

        socket.addEventListener(
            "error",
            error => {
                console.error(
                    "WebSocket error:",
                    error
                );

                setConnectionStatus(
                    "CONNECTION ERROR"
                );
            }
        );
    }

    function handleServerMessage(
        message
    ) {
        switch (
            message.type
        ) {
            case "room_connected": {
                myPlayerNumber =
                    Number(
                        message.playerNumber
                    ) || 0;

                roomState.roomId =
                    FIXED_ROOM_ID;

                renderRoom();

                break;
            }

            case "room_state": {
                roomState =
                    message.room ||
                    roomState;

                /*
                 * room_stateにも自分のPLAYER番号が
                 * 含まれる場合だけ更新する。
                 */
                const receivedPlayerNumber =
                    Number(
                        message.yourPlayerNumber
                    );

                if (
                    receivedPlayerNumber === 1 ||
                    receivedPlayerNumber === 2
                ) {
                    myPlayerNumber =
                        receivedPlayerNumber;
                }

                /*
                 * 1・2なら対戦プレイヤー。
                 * 0なら観戦者。
                 */
                renderRoom();

                break;
            }

            case "battle_start": {
                if (
                    battleStartedHandled
                ) {
                    return;
                }

                battleStartedHandled =
                    true;

                const myPlayer =
                    myPlayerNumber;

                window.location.href =
                    `../battle/battle.html?room=${encodeURIComponent(
                        FIXED_ROOM_ID
                    )}&player=${myPlayer}&name=${encodeURIComponent(
                        playerName
                    )}`;

                break;
            }
        }
    }

    function toggleReady() {
        if (
            myPlayerNumber !== 1 &&
            myPlayerNumber !== 2
        ) {
            return;
        }

        const index =
            myPlayerNumber - 1;

        const currentReady =
            !!roomState
                .battlePlayers?.[
                index
            ]?.ready;

        send({
            type:
                "room_ready",

            ready:
                !currentReady,

            party:
                getParty()
        });
    }

    /*
     * 卓選択は不要。
     * 1・2番なら自動的に対戦卓。
     * 3人目以降は自動的に観戦。
     */

    battleTable?.addEventListener(
        "click",
        () => {
            /*
             * 自動参加方式なので
             * ここでは何もしない。
             */
        }
    );

    spectatorTable?.addEventListener(
        "click",
        () => {
            /*
             * 自動参加方式なので
             * ここでは何もしない。
             */
        }
    );

    readyButton?.addEventListener(
        "click",
        toggleReady
    );

    backButton?.addEventListener(
        "click",
        () => {
            if (
                socket &&
                socket.readyState ===
                    WebSocket.OPEN
            ) {
                socket.close();
            }

            window.location.href =
                "../title/title.html";
        }
    );

    renderRoom();

    connect();

})();