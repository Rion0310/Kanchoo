const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const rooms = new Map();

function createRoom(roomId) {
    return {
        roomId,
        battlePlayers: [
            { name: "", ready: false, party: [] },
            { name: "", ready: false, party: [] }
        ],
        spectators: new Set(),
        sockets: new Set(),
        battleStarted: false,//
        battleState: null,
        expectedPlayer: 1,
        battleResetTimer: null
    };
}

function getOrCreateRoom(roomId) {
    const id = String(roomId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
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
    room.expectedPlayer = 1;

    room.battlePlayers = [
        { name: "", ready: false, party: [] },
        { name: "", ready: false, party: [] }
    ];

    // 現在のROOM接続はそのまま残し、
    // PLAYER枠だけを新しい対戦のために解放する。
    for (const socket of room.sockets) {
        socket.inBattle = false;

        if (socket.playerNumber === 1 || socket.playerNumber === 2) {
            // 試合終了後は卓から完全に解放します。
            // 勝者・敗者を観戦卓へ自動移動させない。
            socket.playerNumber = 0;
            socket.table = null;
        }
    }

    broadcastRoom(room);
}

function scheduleBattleRoomReset(room, delay = 5000) {
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

function sendBattleStart(room) {
    if (!room.battlePlayers[0].name || !room.battlePlayers[1].name) return;
    if (!room.battlePlayers[0].ready || !room.battlePlayers[1].ready) return;

    room.battleStarted = true;

    const payload = {
        type: "battle_start",
        roomId: room.roomId,
        players: [
            {
                player: 1,
                name: room.battlePlayers[0].name,
                party: room.battlePlayers[0].party || []
            },
            {
                player: 2,
                name: room.battlePlayers[1].name,
                party: room.battlePlayers[1].party || []
            }
        ]
    };

    for (const socket of room.sockets) {
        if (
            socket.readyState === WebSocket.OPEN &&
            (socket.playerNumber === 1 || socket.playerNumber === 2 ||
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
                    playerNumber: socket.playerNumber
                });
                send(socket, {
                    type: "room_state",
                    room: publicRoom(room),
                    yourPlayerNumber: socket.playerNumber
                });
            }
            return;
        }

        const name = String(data.playerName || "PLAYER")
            .trim()
            .slice(0, 30) || "PLAYER";

        // ROOMへ入っただけでは卓に自動アサインしません。
        // PLAYER枠の復元が必要なのはBATTLEからの再接続だけです。
        let playerIndex = -1;

        if (data.reconnectBattle === true) {
            playerIndex = room.battlePlayers.findIndex(
                player => player.name === name
            );
        }

        socket.room = room;
        socket.playerName = name;
        socket.playerNumber =
            playerIndex !== -1 ? playerIndex + 1 : 0;
        socket.table =
            playerIndex !== -1
                ? `battle${playerIndex + 1}`
                : null;

        room.sockets.add(socket);

        send(socket, {
            type: "room_connected",
            roomId: room.roomId,
            playerNumber: socket.playerNumber
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

        if (table === "battle1" || table === "battle2") {
            requestedIndex = Number(table.slice(-1)) - 1;
        } else if (table === "battle") {
            // BATTLE側の再接続用。名前から元のPLAYER枠を復元します。
            requestedIndex = room.battlePlayers.findIndex(
                player => player.name === socket.playerName
            );

            if (requestedIndex === -1) {
                requestedIndex = room.battlePlayers.findIndex(
                    player => !player.name
                );
            }
        }

        if (requestedIndex !== 0 && requestedIndex !== 1) {
            send(socket, {
                type: "room_error",
                message: "指定された対戦卓が見つかりません。"
            });
            return;
        }

        // 現在の卓から別の卓へ移動する場合は、
        // 先に自分が占有していたPLAYER枠を解放します。
        if (
            socket.playerNumber === 1 ||
            socket.playerNumber === 2
        ) {
            const currentIndex = socket.playerNumber - 1;

            if (currentIndex !== requestedIndex) {
                const currentPlayer =
                    room.battlePlayers[currentIndex];

                if (
                    currentPlayer &&
                    currentPlayer.name === socket.playerName &&
                    !room.battleStarted
                ) {
                    currentPlayer.name = "";
                    currentPlayer.ready = false;
                    currentPlayer.party = [];
                }
            }
        }

        const player = room.battlePlayers[requestedIndex];

        // 他のプレイヤーが使用中の卓にはアサインしません。
        if (player.name && player.name !== socket.playerName) {
            send(socket, {
                type: "room_error",
                message: `対戦卓${requestedIndex + 1}は使用中です。`
            });
            return;
        }

        // 以前観戦卓にいた場合は解除します。
        room.spectators.delete(socket);

        const isExistingPlayer = player.name === socket.playerName;
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
        if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
            send(socket, {
                type: "room_error",
                message: "PLAYERとして参加していません。"
            });
            return;
        }

        const index = socket.playerNumber - 1;
        const player = room.battlePlayers[index];

        if (!player || player.name !== socket.playerName) {
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
                .slice(0, 6);
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
            socket.playerNumber !== 0 &&
            socket.playerNumber !== 1 &&
            socket.playerNumber !== 2
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
        if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
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
        if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
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

        if (nextPlayer === 1 || nextPlayer === 2) {
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

        if (socket.playerNumber === 1 || socket.playerNumber === 2) {
            const index = socket.playerNumber - 1;
            const player = room.battlePlayers[index];

            if (player.name === socket.playerName) {
                // ROOM → BATTLEではWebSocketが切り替わるため、
                // ROOM側の切断だけでPLAYER情報を消さない。
                // battleStarted後はもちろん、再接続前のpartyも保持する。
                if (!room.battleStarted) {
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