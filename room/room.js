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
    const spectatorNamesDisplay = document.getElementById("spectator-names");
    const readyButton = document.getElementById("ready-button");
    const backButton = document.getElementById("back-button");

    /*
     * [4人対戦対応]
     * PLAYER1/PLAYER2決め打ちだった参照を、
     * C.BATTLE_MAX_PLAYERS(現在は4)の数だけ動的に集めるようにした。
     * 卓の人数を増減させたくなったときはconstants.js側の値を
     * 変えるだけで、ここは自動的に追従する。
     *
     * battleSlots[i] は「1始まりのプレイヤー番号」をキーにしたオブジェクトで、
     * slotEl: クリック対象になる枠全体の要素
     *   [BUGFIX / 卓参加ボタンの当たり判定が文字の部分にしかない件]
     *   以前は名前テキスト要素(#battle-player-N)自体にclickを貼っていたため、
     *   見た目上クリックできそうな枠全体（ラベルやREADY表示、余白）を
     *   クリックしても反応しなかった。room.html側で枠全体に振った
     *   #battle-slot-N にclickを貼ることで、枠のどこを押しても
     *   対戦卓へ参加できるようにしてある。
     * nameEl: プレイヤー名を表示するテキスト要素
     * readyEl: READY/WAITING表示要素
     */
    const battleSlots = [];

    for (let player = 1; player <= C.BATTLE_MAX_PLAYERS; player++) {
        battleSlots.push({
            player,
            slotEl: document.getElementById(`battle-slot-${player}`),
            nameEl: document.getElementById(`battle-player-${player}`),
            readyEl: document.getElementById(`battle-ready-${player}`)
        });
    }

    function isValidPlayerNumber(number) {
        return (
            Number.isInteger(number) &&
            number >= 1 &&
            number <= C.BATTLE_MAX_PLAYERS
        );
    }

    let socket = null;
    let myPlayerNumber = 0;
    let selectedTable = null;
    let myReady = false;
    let battleStartedHandled = false;

    function createEmptyBattlePlayers() {
        return Array.from(
            { length: C.BATTLE_MAX_PLAYERS },
            () => ({ name: "", ready: false })
        );
    }

    let roomState = {
        roomId: FIXED_ROOM_ID,
        battlePlayers: createEmptyBattlePlayers(),
        spectators: [],
        battleStarted: false,
        mapId: null,
        selectedMapId: null,
        mapChangedBy: ""
    };


    /* ========================================
       MAP SELECT / TABLE TOOLS (ROOM画面に差し込むUI)

       room.html を書き換えなくても動くよう、必要な要素と
       スタイルはこのファイルから差し込む。
       表示位置を変えたい場合は room.html の好きな場所に
         <div id="room-map-select"></div>
         <div id="room-table-tools"></div>
       を置けば、そこに描画される(無ければ対戦卓の直後に自動で作る)。
    ======================================== */

    /*
     * マップ定義(shared/battle-maps.js)。
     * room.html で読み込んでいなければ、ここで自動的に読み込む。
     */
    function getMapsApi() {
        return window.MONSTER_WAR_MAPS || null;
    }

    function ensureMapsApiLoaded() {
        if (getMapsApi() || document.getElementById("battle-maps-script")) {
            return;
        }

        const script = document.createElement("script");
        script.id = "battle-maps-script";
        script.src = "../shared/battle-maps.js";
        script.addEventListener("load", () => renderRoom());
        script.addEventListener("error", () => {
            console.error("shared/battle-maps.js の読み込みに失敗しました。");
        });
        document.head.appendChild(script);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function injectRoomToolStyles() {
        if (document.getElementById("room-tool-styles")) {
            return;
        }

        const style = document.createElement("style");
        style.id = "room-tool-styles";
        style.textContent = `
            .room-map-select {
                margin: 16px 0;
                padding: 14px;
                background: #101010;
                border: 1px solid #333333;
                color: #ffffff;
            }
            .room-map-select-head {
                display: flex;
                flex-wrap: wrap;
                align-items: baseline;
                gap: 6px 12px;
                margin-bottom: 10px;
            }
            .room-map-select-label {
                color: #888888;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.2em;
            }
            .room-map-select-current {
                font-size: 16px;
                font-weight: 700;
            }
            .room-map-select-sub {
                color: #888888;
                font-size: 11px;
            }
            /* マップは横一列に並べ、増えたら左右にスクロールして見る */
            .room-map-list {
                display: flex;
                gap: 8px;
                overflow-x: auto;
                overflow-y: hidden;
                padding-bottom: 8px;
                scroll-snap-type: x proximity;
                scroll-padding: 0 4px;
                scrollbar-width: thin;
                scrollbar-color: #555555 #151515;
            }
            .room-map-list::-webkit-scrollbar {
                height: 6px;
            }
            .room-map-list::-webkit-scrollbar-track {
                background: #151515;
            }
            .room-map-list::-webkit-scrollbar-thumb {
                background: #555555;
            }
            .room-map-item {
                flex: 0 0 150px;
                scroll-snap-align: start;
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 8px;
                background: #171717;
                border: 1px solid #2d2d2d;
                color: #ffffff;
                font-family: inherit;
                text-align: left;
                cursor: pointer;
            }
            .room-map-item:hover:not(:disabled) {
                border-color: #888888;
                background: #1e1e1e;
            }
            .room-map-item:disabled {
                cursor: default;
            }
            .room-map-item.is-current {
                border-color: #ffffff;
                box-shadow: inset 0 0 0 1px #ffffff;
            }
            .room-map-item strong {
                font-size: 13px;
            }
            .room-map-item span {
                color: #999999;
                font-size: 10px;
                line-height: 1.5;
            }
            .room-map-item .map-preview {
                width: 100%;
                aspect-ratio: 1;
                display: grid;
                grid-template-columns: repeat(var(--preview-size), minmax(0, 1fr));
                grid-template-rows: repeat(var(--preview-size), minmax(0, 1fr));
                gap: 1px;
                padding: 4px;
                background: #070707;
            }
            .room-map-item .map-preview-cell {
                display: block;
                background-color: #2a2a2a;
                background-size: cover;
                background-position: center;
            }
            .room-map-item .map-preview-cell.is-wall {
                background-color: #6b6b6b;
            }
            .room-map-item .map-preview-cell.is-void {
                background: transparent;
            }
            .room-map-note {
                margin: 8px 0 0;
                color: #777777;
                font-size: 10px;
            }

            .room-seat-release {
                position: absolute;
                top: 4px;
                right: 4px;
                z-index: 2;
                padding: 2px 6px;
                border: 1px solid #b85252;
                background: rgba(40, 16, 16, 0.92);
                color: #ff9a9a;
                font-family: inherit;
                font-size: 10px;
                font-weight: 700;
                cursor: pointer;
            }
            .room-seat-release:hover {
                background: #5a1f1f;
                color: #ffffff;
            }
            .room-seat-offline {
                position: absolute;
                left: 4px;
                top: 4px;
                z-index: 2;
                padding: 1px 5px;
                background: #3a2a10;
                color: #e7c86a;
                font-size: 9px;
                font-weight: 700;
            }

            .room-table-tools {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px 12px;
                margin: 8px 0 16px;
                color: #999999;
                font-size: 11px;
            }
            .room-table-tools.is-stuck {
                padding: 8px 10px;
                border: 1px solid #91804b;
                background: #1d1b16;
                color: #e7c86a;
            }
            .room-force-reset {
                padding: 6px 12px;
                border: 1px solid #6b2f2f;
                background: #1d1616;
                color: #ff9a9a;
                font-family: inherit;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
            }
            .room-force-reset:hover {
                background: #2b1d1d;
                border-color: #b85252;
                color: #ffffff;
            }
        `;
        document.head.appendChild(style);
    }

    function ensureToolContainer(id, className) {
        let element = document.getElementById(id);

        if (!element) {
            element = document.createElement("div");
            element.id = id;

            const anchor =
                document.getElementById("room-table-tools") ||
                battleTable;

            if (anchor && anchor.parentNode) {
                anchor.insertAdjacentElement("afterend", element);
            } else {
                document.body.appendChild(element);
            }
        }

        element.classList.add(className);

        return element;
    }

    function isSeated() {
        return (
            isValidPlayerNumber(myPlayerNumber) &&
            !!roomState.battlePlayers?.[myPlayerNumber - 1]?.name
        );
    }

    function renderMapSelect() {
        const api = getMapsApi();

        if (!api) {
            ensureMapsApiLoaded();
            return;
        }

        const container = ensureToolContainer("room-map-select", "room-map-select");

        const seatedCount =
            (roomState.battlePlayers || []).filter(player => player?.name).length;
        const playerCount = Math.max(2, seatedCount);

        const currentMapId = roomState.mapId;
        const currentMap = api.BATTLE_MAPS[currentMapId];
        const canChoose = isSeated() && !roomState.battleStarted;
        const maps = api.getMapsForPlayerCount(playerCount);

        const wasAutoFallback =
            roomState.selectedMapId &&
            roomState.selectedMapId !== currentMapId;

        // 再描画(room_stateのたびに起きる)で横スクロール位置が戻らないよう保存しておく
        const previousScrollLeft =
            container.querySelector(".room-map-list")?.scrollLeft ?? null;

        container.innerHTML = `
            <div class="room-map-select-head">
                <span class="room-map-select-label">FIELD</span>
                <span class="room-map-select-current">
                    ${escapeHtml(currentMap?.name || "―")}
                </span>
                <span class="room-map-select-sub">
                    ${playerCount}人対戦
                    ${roomState.mapChangedBy ? ` ・ ${escapeHtml(roomState.mapChangedBy)} が選択` : ""}
                    ${wasAutoFallback ? " ・ 選択中のマップはこの人数では使えないため既定マップになります" : ""}
                </span>
            </div>
            <div class="room-map-list">
                ${maps.map(map => `
                    <button
                        type="button"
                        class="room-map-item${map.id === currentMapId ? " is-current" : ""}"
                        data-map-id="${escapeHtml(map.id)}"
                        ${canChoose ? "" : "disabled"}
                    >
                        ${api.buildMapPreviewHtml(map, C.PLAYER_COLORS || {})}
                        <strong>${escapeHtml(map.name)}</strong>
                        <span>${escapeHtml(map.description || "")}</span>
                    </button>
                `).join("")}
            </div>
            <p class="room-map-note">
                ${
                    roomState.battleStarted
                        ? "対戦中はマップを変更できません。"
                        : canChoose
                            ? "対戦卓に着席している人なら誰でも変更できます。変更すると全員の準備が解除されます。"
                            : "対戦卓に着席するとマップを選べます。"
                }
            </p>
        `;

        const list = container.querySelector(".room-map-list");

        if (list) {
            if (previousScrollLeft !== null) {
                list.scrollLeft = previousScrollLeft;
            } else {
                // 初回表示では選択中のマップが見える位置までスクロールする
                list.querySelector(".room-map-item.is-current")
                    ?.scrollIntoView({ block: "nearest", inline: "center" });
            }

            // マウスホイール(縦回転)でも左右にスクロールできるようにする
            list.addEventListener("wheel", event => {
                if (
                    Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
                    list.scrollWidth > list.clientWidth
                ) {
                    list.scrollLeft += event.deltaY;
                    event.preventDefault();
                }
            }, { passive: false });
        }

        container.querySelectorAll(".room-map-item").forEach(button => {
            button.addEventListener("click", () => {
                if (!canChoose || button.dataset.mapId === currentMapId) {
                    return;
                }

                send({ type: "room_select_map", mapId: button.dataset.mapId });
            });
        });
    }

    /*
     * [卓の強制解放]
     * 自分以外が座っている対戦卓に「解放」ボタンを出す。
     * 持ち主の接続が切れている席には「切断中」を表示する。
     */
    function renderSeatReleaseButtons() {
        const players = roomState.battlePlayers || [];

        battleSlots.forEach(({ player, slotEl }) => {
            if (!slotEl) {
                return;
            }

            slotEl.querySelector(".room-seat-release")?.remove();
            slotEl.querySelector(".room-seat-offline")?.remove();

            const info = players[player - 1];

            if (!info?.name) {
                return;
            }

            if (getComputedStyle(slotEl).position === "static") {
                slotEl.style.position = "relative";
            }

            if (info.connected === false) {
                const offline = document.createElement("span");
                offline.className = "room-seat-offline";
                offline.textContent = "切断中";
                slotEl.appendChild(offline);
            }

            if (player === myPlayerNumber || roomState.battleStarted) {
                return;
            }

            const button = document.createElement("button");
            button.type = "button";
            button.className = "room-seat-release";
            button.textContent = "解放";
            button.title = "この席を強制的に空けます";

            button.addEventListener("click", event => {
                // 枠全体のクリック(=その卓に座る)を発火させない
                event.stopPropagation();

                const ok = window.confirm(
                    `対戦卓${player}（${info.name}）を強制的に空けますか？`
                );

                if (ok) {
                    send({ type: "room_force_release", player });
                }
            });

            slotEl.appendChild(button);
        });
    }

    /*
     * [対戦卓の強制リセット]
     * 対戦卓を全部空けて、固まった対戦状態も解除する。
     */
    function renderTableTools() {
        const container = ensureToolContainer("room-table-tools", "room-table-tools");

        const stuck = !!roomState.battleStarted;

        container.classList.toggle("is-stuck", stuck);

        container.innerHTML = `
            <span>
                ${
                    stuck
                        ? "対戦中です。対戦が終わっているのに卓が空かない場合はリセットしてください。"
                        : "卓の表示がおかしいときは、対戦卓をリセットできます。"
                }
            </span>
            <button type="button" class="room-force-reset">
                対戦卓をリセット
            </button>
        `;

        container.querySelector(".room-force-reset")?.addEventListener("click", () => {
            const ok = window.confirm(
                stuck
                    ? "進行中の対戦を打ち切って、対戦卓をすべて空けます。よろしいですか？"
                    : "対戦卓をすべて空けます。よろしいですか？"
            );

            if (ok) {
                send({ type: "room_force_reset" });
            }
        });
    }

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

        const players = roomState.battlePlayers || createEmptyBattlePlayers();

        /*
         * [4人対戦対応]
         * PLAYER1・PLAYER2それぞれ個別に書いていた表示更新を
         * battleSlotsのループに統一。3人目・4人目が増えても
         * ここを増やす必要がない。
         */
        battleSlots.forEach(({ player, nameEl, readyEl }) => {
            const info = players[player - 1];

            if (nameEl) {
                nameEl.textContent = info?.name || "WAITING";
            }

            if (readyEl) {
                readyEl.textContent = info?.ready ? "READY" : "WAITING";
                readyEl.classList.toggle("ready", !!info?.ready);
            }
        });

        if (selectedTableDisplay) {
            const selectedPlayerMatch = /^battle([1-9]\d*)$/.exec(selectedTable || "");

            if (selectedPlayerMatch) {
                selectedTableDisplay.textContent = `対戦卓${selectedPlayerMatch[1]}`;
            } else if (selectedTable === "spectator") {
                selectedTableDisplay.textContent = "観戦卓";
            } else {
                selectedTableDisplay.textContent = "卓を選択してください";
            }
        }

        if (battleTable) {
            battleTable.classList.toggle(
                "active",
                /^battle[1-9]\d*$/.test(selectedTable || "")
            );
        }

        if (spectatorTable) {
            spectatorTable.classList.toggle("active", selectedTable === "spectator");
        }

        const spectatorNames = roomState.spectators || [];

        if (spectatorCountDisplay) {
            // [BUGFIX] 観戦卓の人数表示が常に0のまま更新されていなかった。
            spectatorCountDisplay.textContent = String(spectatorNames.length);
        }

        if (spectatorNamesDisplay) {
            /*
             * [観戦者名の表示]
             * 名前は他のユーザーが自由入力した文字列なので、innerHTMLに
             * そのまま流し込まずtextContentで1件ずつ要素化してから追加する
             * （XSS対策）。
             */
            spectatorNamesDisplay.textContent = "";

            spectatorNames.forEach(name => {
                const nameChip = document.createElement("span");

                nameChip.className = "spectator-name-chip";
                nameChip.textContent = name || "SPECTATOR";

                spectatorNamesDisplay.appendChild(nameChip);
            });
        }

        if (readyButton) {
            const isPlayer = isValidPlayerNumber(myPlayerNumber);
            const serverReady = isPlayer && !!players[myPlayerNumber - 1]?.ready;

            // 送信直後はサーバーからroom_stateが返るまで
            // 自分のローカル状態を表示します。
            const ready = isPlayer && (myReady || serverReady);

            // PLAYERのいずれかの枠に割り当てられたら、
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

        renderSeatReleaseButtons();
        renderTableTools();
        renderMapSelect();
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
                    isValidPlayerNumber(assignedPlayerNumber)
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
                 * サーバーがPLAYER枠(1〜C.BATTLE_MAX_PLAYERS)を
                 * 割り当てた場合だけ自分の番号を更新する。
                 *
                 * これ以外のroom_stateで0に戻さない。
                 */
                if (isValidPlayerNumber(receivedPlayerNumber)) {
                    myPlayerNumber = receivedPlayerNumber;
                }

                resolveMyPlayerNumber();

                if (isValidPlayerNumber(myPlayerNumber)) {
                    myReady = !!roomState.battlePlayers?.[myPlayerNumber - 1]?.ready;
                }

                renderRoom();
                break;
            }

            case "table_assigned": {
                selectedTable = message.table || null;

                const assigned = Number(message.playerNumber);
                myPlayerNumber = isValidPlayerNumber(assigned) ? assigned : 0;

                // [卓の強制解放/リセット] 席を外された場合は準備状態も解除
                if (!myPlayerNumber) {
                    myReady = false;
                }

                resolveMyPlayerNumber();
                renderRoom();
                break;
            }

            case "room_error": {
                window.alert(message.message || "卓のアサインに失敗しました。");
                break;
            }

            // [卓の強制解放/リセット] 他の人の操作で席を外されたときのお知らせ
            case "room_notice": {
                if (message.message) {
                    window.alert(message.message);
                }
                break;
            }

            case "battle_start": {
                if (battleStartedHandled) return;

                battleStartedHandled = true;

                /*
                 * [4人対戦対応]
                 * 以前は"battle1"/"battle2"の2択だけを見ていたが、
                 * "battle3"/"battle4"（さらに枠を増やした場合もその先）を
                 * 汎用的に受け付けるようにした。
                 */
                const selectedTableMatch = /^battle([1-9]\d*)$/.exec(selectedTable || "");

                if (!selectedTableMatch && selectedTable !== "spectator") {
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

                const myPlayer = Number(selectedTableMatch[1]);

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

        if (!isValidPlayerNumber(myPlayerNumber)) {
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

    battleSlots.forEach(({ player, slotEl }) => {
        slotEl?.addEventListener("click", () => selectTable(`battle${player}`));
    });

    spectatorTable?.addEventListener("click", () => selectTable("spectator"));
    readyButton?.addEventListener("click", toggleReady);

    backButton?.addEventListener("click", () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }

        window.location.href = "../title/title.html";
    });

    injectRoomToolStyles();
    ensureMapsApiLoaded();
    renderRoom();
    connect();
})();