const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");
const CONSTANTS = require("./shared/constants.js");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const rooms = new Map();

/*
 * [4人対戦対応]
 * 対戦卓の枠数はCONSTANTS.BATTLE_MAX_PLAYERSだけを見て決まるようにする。
 * 2人固定だった頃はここに直接2要素の配列を書いていたが、
 * 枠数を増やす/減らす場合にここと他の判定箇所とで
 * 食い違いが起きないよう、必ずこのヘルパー経由で生成する。
 */
function createEmptyBattlePlayers() {
    return Array.from(
        { length: CONSTANTS.BATTLE_MAX_PLAYERS },
        () => ({ sessionId: "", socket: null, name: "", ready: false, party: [] })
    );
}

function createRoom(roomId) {
    return {
        roomId,
        battlePlayers: createEmptyBattlePlayers(),
        spectators: new Set(),
        sockets: new Set(),
        battleStarted: false,//
        battleState: null,
        // 実際にその対戦を開始したプレイヤー番号一覧(1〜4のうち着席していた人数分)。
        // 手番のローテーションや同期チェックはこれを基準にする。
        activePlayers: [],
        expectedPlayer: 1,
        battleResetTimer: null
    };
}

function getOrCreateRoom(roomId) {
    const id = String(roomId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CONSTANTS.ROOM_ID_MAX_LENGTH);
    if (!id) return null;
    if (!rooms.has(id)) rooms.set(id, createRoom(id));
    return rooms.get(id);
}


function resetBattleRoom(room) {
    if (!room) return;

    if (room.battleResetTimer) {
        clearTimeout(room.battleResetTimer);
        room.battleResetTimer = null;
    }

    room.battleStarted = false;
    room.battleState = null;
    room.activePlayers = [];
    room.expectedPlayer = 1;

    room.battlePlayers = createEmptyBattlePlayers();

    // 現在のROOM接続はそのまま残し、
    // PLAYER枠だけを新しい対戦のために解放する。
    for (const socket of room.sockets) {
        socket.inBattle = false;

        if (socket.playerNumber >= 1 && socket.playerNumber <= CONSTANTS.BATTLE_MAX_PLAYERS) {
            // 試合終了後は卓から完全に解放します。
            // 勝者・敗者を観戦卓へ自動移動させない。
            socket.playerNumber = 0;
            socket.table = null;
        }
    }

    broadcastRoom(room);
}

function scheduleBattleRoomReset(room, delay = CONSTANTS.BATTLE_ROOM_RESET_DELAY_MS) {
    if (!room || room.battleResetTimer) return;

    room.battleResetTimer = setTimeout(() => {
        room.battleResetTimer = null;

        const hasActiveBattleSocket =
            [...room.sockets].some(
                socket =>
                    socket.inBattle &&
                    socket.readyState === WebSocket.OPEN
            );

        if (!hasActiveBattleSocket) {
            resetBattleRoom(room);
        }
    }, delay);
}

function publicRoom(room) {
    return {
        roomId: room.roomId,
        battlePlayers: room.battlePlayers.map(player => ({
            name: player.name,
            ready: !!player.ready
        })),
        spectators: [...room.spectators].map(socket => socket.playerName || "SPECTATOR"),
        battleStarted: room.battleStarted
    };
}

/*
 * [BUGFIX] 対戦卓→観戦卓の移動でPLAYER枠が解放されない問題
 *
 * 以前は「対戦卓1→対戦卓2」のように別の対戦卓へ移動するときだけ
 * 現在の枠を解放しており、「対戦卓→観戦卓」への移動では解放処理が
 * 呼ばれていなかった。そのため観戦卓へ移っても元の対戦卓に
 * 名前が残り続けていた。
 *
 * room_select_tableの行き先（対戦卓1/2・観戦卓のどれであっても）に
 * 関わらず、必ずこの関数で「今のPLAYER枠」を解放してから
 * 新しい卓へ移動させる。
 */
function releaseOwnedBattleSlot(room, socket) {
    if (socket.playerNumber < 1 || socket.playerNumber > CONSTANTS.BATTLE_MAX_PLAYERS) {
        return;
    }

    const currentIndex = socket.playerNumber - 1;
    const currentPlayer = room.battlePlayers[currentIndex];

    if (
        currentPlayer &&
        currentPlayer.socket === socket &&
        !room.battleStarted
    ) {
        currentPlayer.sessionId = "";
        currentPlayer.socket = null;
        currentPlayer.name = "";
        currentPlayer.ready = false;
        currentPlayer.party = [];
    }
}

function broadcastRoom(room) {
    const roomData = publicRoom(room);

    for (const socket of room.sockets) {
        if (socket.readyState === WebSocket.OPEN) {
            send(socket, {
                type: "room_state",
                room: roomData,
                yourPlayerNumber: socket.playerNumber//
            });
        }
    }
}

function send(socket, payload) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}

/*
 * [4人対戦対応 / 自動FIT]
 *
 * 「対戦卓についている全員がREADYを押したら、その時点の人数で開始する」
 * というルールに変更した。
 * 以前はPLAYER1・PLAYER2の両方が名前を持ちREADYであることを
 * 決め打ちでチェックしていたが、今は
 *   1. 実際に着席している(sessionIdを持つ)枠だけを対象にする
 *   2. 着席人数が最低開始人数(2人)以上であること
 *   3. 着席している枠が「全員」READYであること
 * の3条件がそろった時点で、そのときの着席人数(2〜4人)のまま開始する。
 * 盤面側(battle.js)はplayers配列の人数を見て城の配置などを自動調整する。
 */
function sendBattleStart(room) {
    const seatedIndexes = room.battlePlayers
        .map((player, index) => (player.sessionId ? index : -1))
        .filter(index => index !== -1);

    if (seatedIndexes.length < CONSTANTS.BATTLE_MIN_PLAYERS_TO_START) return;

    const allReady = seatedIndexes.every(
        index => room.battlePlayers[index].ready
    );

    if (!allReady) return;

    /*
     * [BUGFIX / P2以降の操作が反映されずターンが止まる問題]
     *
     * この関数はroom_readyで対戦が始まる瞬間だけでなく、
     * battle_join（BATTLE画面の接続・再接続のたびに送られる）からも
     * 呼ばれる。以前はここを毎回無条件で実行していたため、
     * スマホの回線切り替えや画面ロック・バックグラウンド化などで
     * 対戦中に誰か一人でも再接続すると、
     * 「今どのプレイヤーの手番か」を表すroom.expectedPlayerが
     * 対戦開始時点（＝PLAYER1）へ巻き戻ってしまっていた。
     *
     * その結果、本来はまだ手番が回ってきていないPLAYER1以外の
     * プレイヤー（例:PLAYER2）がbattle_stateを送っても
     * 「sender !== room.expectedPlayer」で毎回サーバーに
     * 弾かれ続け、そのプレイヤーの操作が相手画面に反映されず、
     * ターンも進まなくなっていた。
     *
     * 対戦がすでに始まっている場合は、activePlayers・expectedPlayerを
     * 再計算せず、既存の進行状況をそのまま維持する。
     * （再接続してきたクライアントには、この関数の呼び出し元
     * battle_joinハンドラが直後にroom.battleStateを送るため、
     * 最新の状態は別途届く）
     */
    const alreadyStarted = room.battleStarted;

    if (!alreadyStarted) {
        room.battleStarted = true;
        room.activePlayers = seatedIndexes.map(index => index + 1);
        room.expectedPlayer = room.activePlayers[0];
    }

    const payload = {
        type: "battle_start",
        roomId: room.roomId,
        players: seatedIndexes.map(index => ({
            player: index + 1,
            name: room.battlePlayers[index].name,
            party: room.battlePlayers[index].party || []
        }))
    };

    for (const socket of room.sockets) {
        if (
            socket.readyState === WebSocket.OPEN &&
            (room.activePlayers.includes(socket.playerNumber) ||
                room.spectators.has(socket))
        ) {
            send(socket, payload);
        }
    }
}

function handleMessage(socket, message) {
    let data;

    try {
        data = JSON.parse(message);
    } catch {
        return;
    }

    if (!data || typeof data.type !== "string") return;

    if (data.type === "room_join") {
        const room = getOrCreateRoom(data.roomId);
        if (!room) return;

        // 同じソケットからの二重JOINを防止
        if (socket.room) {
            if (socket.room === room) {
                send(socket, {
                    type: "room_connected",
                    roomId: room.roomId,
                    playerNumber: socket.playerNumber,
                    sessionId: socket.sessionId
                });
                send(socket, {
                    type: "room_state",
                    room: publicRoom(room),
                    yourPlayerNumber: socket.playerNumber
                });
            }
            return;
        }

        const name = String(data.playerName || CONSTANTS.DEFAULT_PLAYER_NAME)
            .trim()
            .slice(0, CONSTANTS.PLAYER_NAME_MAX_LENGTH) || CONSTANTS.DEFAULT_PLAYER_NAME;

        /*
         * [IDENTITY FIX]
         * 名前は表示用のラベルに過ぎず、同じ名前を名乗る
         * 別人が同時に来る可能性がある。本人確認には必ず
         * 接続ごとに発行される一意なsessionIdを使う。
         *
         * クライアントがsessionStorage等に保存済みのsessionIdを
         * 送ってきた場合はそれを引き継ぎ（＝再接続）、
         * 持っていなければここで新規発行する。
         */
        const incomingSessionId =
            typeof data.sessionId === "string"
                ? data.sessionId.trim().slice(0, 64)
                : "";

        const sessionId =
            incomingSessionId || crypto.randomUUID();

        // ROOMへ入っただけでは卓に自動アサインしません。
        // PLAYER枠の復元が必要なのはBATTLEからの再接続だけです。
        // 復元も名前ではなくsessionIdの一致で判定します。
        let playerIndex = -1;

        if (data.reconnectBattle === true) {
            playerIndex = room.battlePlayers.findIndex(
                player => player.sessionId && player.sessionId === sessionId
            );
        }

        socket.room = room;
        socket.sessionId = sessionId;
        socket.playerName = name;
        socket.playerNumber =
            playerIndex !== -1 ? playerIndex + 1 : 0;
        socket.table =
            playerIndex !== -1
                ? `battle${playerIndex + 1}`
                : null;

        // 枠を復元した場合、表示名は最新の入力内容に更新し、
        // この新しい接続を枠の所有者として記録する。
        // （ROOM→BATTLEでは古いROOM側ソケットがこの後closeするため、
        // 所有者を更新しておかないと、その古いソケットのclose処理で
        // 誤ってこの枠がクリアされてしまう。）
        if (playerIndex !== -1) {
            room.battlePlayers[playerIndex].name = name;
            room.battlePlayers[playerIndex].socket = socket;
        }

        room.sockets.add(socket);

        send(socket, {
            type: "room_connected",
            roomId: room.roomId,
            playerNumber: socket.playerNumber,
            sessionId: socket.sessionId
        });

        broadcastRoom(room);
        return;
    }

    const room = socket.room;
    if (!room) return;

    if (data.type === "room_select_table") {
        const table = data.table;

        if (table === "spectator") {
            // 観戦卓を選択した場合はPLAYER枠を取得せず、
            // この接続を観戦者として登録します。
            //
            // [BUGFIX] 対戦卓に居た場合はその枠を解放してから
            // 観戦卓へ移動する。以前はここで解放していなかったため、
            // 対戦卓に名前が残り続けていた。
            releaseOwnedBattleSlot(room, socket);

            room.spectators.add(socket);
            socket.playerNumber = 0;
            socket.table = "spectator";

            send(socket, {
                type: "table_assigned",
                table: "spectator"
            });

            broadcastRoom(room);
            return;
        }

        let requestedIndex = -1;

        /*
         * [4人対戦対応]
         * "battle1"〜"battle4"(CONSTANTS.BATTLE_MAX_PLAYERSまで)を
         * 汎用的に受け付ける。以前は"battle1"/"battle2"の2択だけを
         * 決め打ちでチェックしていた。
         */
        if (/^battle[1-9]\d*$/.test(table)) {
            const parsedNumber = Number(table.slice("battle".length));

            if (
                Number.isInteger(parsedNumber) &&
                parsedNumber >= 1 &&
                parsedNumber <= CONSTANTS.BATTLE_MAX_PLAYERS
            ) {
                requestedIndex = parsedNumber - 1;
            }
        } else if (table === "battle") {
            // BATTLE側の再接続用。sessionId（本人確認用の一意なID）から
            // 元のPLAYER枠を復元します。名前が他人と重複していても
            // 誤って別人の枠を渡さないようにするためです。
            requestedIndex = room.battlePlayers.findIndex(
                player =>
                    player.sessionId &&
                    player.sessionId === socket.sessionId
            );

            if (requestedIndex === -1) {
                requestedIndex = room.battlePlayers.findIndex(
                    player => !player.sessionId
                );
            }
        }

        if (requestedIndex < 0 || requestedIndex >= CONSTANTS.BATTLE_MAX_PLAYERS) {
            send(socket, {
                type: "room_error",
                message: "指定された対戦卓が見つかりません。"
            });
            return;
        }

        // 現在の卓から別の卓へ移動する場合は、
        // 先に自分が占有していたPLAYER枠を解放します。
        if (
            socket.playerNumber >= 1 &&
            socket.playerNumber <= CONSTANTS.BATTLE_MAX_PLAYERS &&
            socket.playerNumber - 1 !== requestedIndex
        ) {
            releaseOwnedBattleSlot(room, socket);
        }

        const player = room.battlePlayers[requestedIndex];

        /*
         * [IDENTITY FIX]
         * 「使用中かどうか」「本人かどうか」の判定は必ずsessionIdで行う。
         * 名前だけで判定すると、同名の別人が来たときに
         * 既存プレイヤーの枠を乗っ取れてしまう。
         */
        if (player.sessionId && player.sessionId !== socket.sessionId) {
            send(socket, {
                type: "room_error",
                message: `対戦卓${requestedIndex + 1}は使用中です。`
            });
            return;
        }

        // 以前観戦卓にいた場合は解除します。
        room.spectators.delete(socket);

        const isExistingPlayer =
            !!player.sessionId && player.sessionId === socket.sessionId;

        player.sessionId = socket.sessionId;
        player.socket = socket;
        player.name = socket.playerName;

        // 新しくPLAYER枠を取った場合だけREADY/PARTYを初期化します。
        if (!isExistingPlayer) {
            player.ready = false;
            player.party = [];
        }

        socket.playerNumber = requestedIndex + 1;
        socket.table = `battle${requestedIndex + 1}`;

        send(socket, {
            type: "table_assigned",
            table: socket.table,
            playerNumber: socket.playerNumber
        });

        broadcastRoom(room);
        return;
    }

    if (data.type === "room_ready") {
        if (socket.playerNumber < 1 || socket.playerNumber > CONSTANTS.BATTLE_MAX_PLAYERS) {
            send(socket, {
                type: "room_error",
                message: "PLAYERとして参加していません。"
            });
            return;
        }

        const index = socket.playerNumber - 1;
        const player = room.battlePlayers[index];

        if (!player || player.sessionId !== socket.sessionId) {
            send(socket, {
                type: "room_error",
                message: "PLAYER情報が一致しません。"
            });
            return;
        }

        player.ready = data.ready === true || data.ready === "true";

        if (Array.isArray(data.party)) {
            player.party = data.party
                .map(Number)
                .filter(Number.isFinite)
                .slice(0, CONSTANTS.PARTY_MAX_SIZE);
        }

        console.log(
            `[READY] room=${room.roomId} player=${socket.playerNumber} name=${socket.playerName} ready=${player.ready}`
        );

        broadcastRoom(room);
        sendBattleStart(room);
        return;
    }

    if (data.type === "battle_join") {
        if (
            socket.playerNumber < 0 ||
            socket.playerNumber > CONSTANTS.BATTLE_MAX_PLAYERS
        ) {
            return;
        }

        socket.inBattle = true;

        if (socket.playerNumber === 0) {
            if (room.battleStarted) {
                sendBattleStart(room);
            }

            if (room.battleState) {
                send(socket, {
                    type: "battle_state",
                    state: room.battleState,
                    sender: "server"
                });
            }

            return;
        }

        /*
         * [PARTY FIX 3: battle_joinでもpartyを上書きしない]
         *
         * ROOMのroom_readyで確定したpartyをそのまま使用します。
         * これによりP2のbattle_joinがP1のpartyを上書きする
         * 問題を防ぎます。
         */
        socket.inBattle = true;

        if (room.battleResetTimer) {
            clearTimeout(room.battleResetTimer);
            room.battleResetTimer = null;
        }

        if (room.battleStarted) {
            sendBattleStart(room);
        }

        if (room.battleState) {
            send(socket, {
                type: "battle_state",
                state: room.battleState,
                sender: "server"
            });
        }

        return;
    }

    if (data.type === "battle_event") {
        if (socket.playerNumber < 1 || socket.playerNumber > CONSTANTS.BATTLE_MAX_PLAYERS) {
            return;
        }

        if (!socket.inBattle) return;

        const eventName = String(data.event || "").trim();

        if (!eventName) {
            return;
        }

        /*
         * [BATTLE EVENT]
         * 攻撃側で発生した一度きりの演出イベントを
         * 同じ対戦ルームの両プレイヤーへ中継します。
         *
         * battle_stateとは分離しているため、
         * 状態同期の上書きによってキルカットインが
         * 消えたり二重発生したりすることを防ぎます。
         */
        for (const peer of room.sockets) {
            if (
                peer.inBattle &&
                peer.readyState === WebSocket.OPEN &&
                (eventName !== "battle_log" || peer !== socket)
            ) {
                send(peer, {
                    type: "battle_event",
                    event: eventName,
                    data: data.data || null,
                    sender: socket.playerNumber
                });
            }
        }

        return;
    }

    if (data.type === "battle_state") {
        if (socket.playerNumber < 1 || socket.playerNumber > CONSTANTS.BATTLE_MAX_PLAYERS) {
            return;
        }

        if (!socket.inBattle) return;

        const incomingState =
            data.state && typeof data.state === "object"
                ? data.state
                : null;

        if (!incomingState) return;

        const sender =
            Number(socket.playerNumber);

        if (sender !== room.expectedPlayer) {
            return;
        }

        room.battleState = incomingState;

        const nextPlayer =
            Number(incomingState.currentPlayer);

        if (nextPlayer >= 1 && nextPlayer <= CONSTANTS.BATTLE_MAX_PLAYERS) {
            room.expectedPlayer = nextPlayer;
        }

        for (const peer of room.sockets) {
            if (
                peer !== socket &&
                peer.inBattle &&
                peer.readyState === WebSocket.OPEN
            ) {
                send(peer, {
                    type: "battle_state",
                    state: room.battleState,
                    sender: socket.playerNumber
                });
            }
        }

        // 勝敗が確定した試合はROOMの対戦卓を解放する。
        // 最終状態を送信した後に解放するため、結果表示は維持されます。
        if (incomingState.gameOver === true) {
            for (const peer of room.sockets) {
                if (peer.inBattle) {
                    peer.inBattle = false;
                }
            }

            resetBattleRoom(room);
        }

        return;
    }
}

const server = http.createServer((req, res) => {
    let requestPath = decodeURIComponent(
        (req.url || "/").split("?")[0]
    );

    if (requestPath === "/") {
        // / から直接 title/title.html を返すと、title.html 内の
        // 相対パス（title.css / title.js）が /title.css /title.js として
        // 解決されてしまうため、タイトル画面へリダイレクトします。
        res.writeHead(302, {
            Location: "/title/title.html"
        });
        res.end();
        return;
    }

    const filePath = path.normalize(
        path.join(ROOT, requestPath)
    );

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".mp3": "audio/mpeg",
            ".svg": "image/svg+xml"
        };

        res.writeHead(200, {
            "Content-Type":
                contentTypes[ext] ||
                "application/octet-stream"
        });

        fs.createReadStream(filePath).pipe(res);
    });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", socket => {
    socket.room = null;
    socket.sessionId = null;
    socket.playerNumber = 0;
    socket.playerName = "";
    socket.inBattle = false;

    send(socket, {
        type: "connected"
    });

    socket.on("message", raw => {
        handleMessage(socket, raw.toString());
    });

    socket.on("close", () => {
        const room = socket.room;
        if (!room) return;

        room.sockets.delete(socket);
        room.spectators.delete(socket);

        if (socket.playerNumber >= 1 && socket.playerNumber <= CONSTANTS.BATTLE_MAX_PLAYERS) {
            const index = socket.playerNumber - 1;
            const player = room.battlePlayers[index];

            /*
             * [BUGFIX] 「戻る」直後に同じ名前で再入室すると卓がリセットされない
             *
             * sessionIdだけで比較すると、「戻る」で古いソケットがcloseする
             * 前に、同じsessionId（同じタブ＝sessionStorageを引き継ぐ）を
             * 持った新しい接続が先に同じ卓を取り直してしまった場合、
             * 古いソケットの遅れて届くclose処理が「自分のsessionIdと一致する
             * から」という理由で、新しい接続が取り直したばかりの枠を
             * 誤って消してしまっていた。
             *
             * 枠を実際に所有している「ソケットそのもの」を記録しておき、
             * 自分がまだ現在の所有者である場合だけクリアするようにする。
             */
            if (player.socket === socket) {
                // ROOM → BATTLEではWebSocketが切り替わるため、
                // ROOM側の切断だけでPLAYER情報を消さない。
                // battleStarted後はもちろん、再接続前のpartyも保持する。
                if (!room.battleStarted) {
                    player.sessionId = "";
                    player.socket = null;
                    player.name = "";
                    player.ready = false;
                    player.party = [];
                }
            }
        }

        if (room.sockets.size === 0) {
            // 接続が完全になくなったROOMは破棄します。
            if (room.battleResetTimer) {
                clearTimeout(room.battleResetTimer);
                room.battleResetTimer = null;
            }
            rooms.delete(room.roomId);
        } else {
            const hasActiveBattleSocket =
                [...room.sockets].some(
                    peer =>
                        peer.inBattle &&
                        peer.readyState === WebSocket.OPEN
                );

            if (room.battleStarted && !hasActiveBattleSocket) {
                // ROOM → BATTLEのWebSocket切り替え中に一時的に
                // 全BATTLE接続がなくなることがあるため、即時解放せず待ちます。
                scheduleBattleRoomReset(room);
            }

            broadcastRoom(room);
        }
    });
});

server.listen(PORT, () => {
    console.log(`MONSTER WAR server: http://localhost:${PORT}`);
});