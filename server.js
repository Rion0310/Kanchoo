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
        battleStarted: false,
        battleState: null,
        expectedPlayer: 1
    };
}

function getOrCreateRoom(roomId) {
    const id = String(roomId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!id) return null;
    if (!rooms.has(id)) rooms.set(id, createRoom(id));
    return rooms.get(id);
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
                yourPlayerNumber: socket.playerNumber
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
            (socket.playerNumber === 1 || socket.playerNumber === 2)
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

        // PLAYER番号はクライアントではなくサーバーで一度だけ決定する。
        // 空いている最初の枠を割り当てる。
        let playerIndex = -1;

        for (let i = 0; i < room.battlePlayers.length; i++) {
            if (!room.battlePlayers[i].name) {
                playerIndex = i;
                break;
            }
        }

        socket.room = room;
        socket.playerName = name;

        if (playerIndex !== -1) {
            socket.playerNumber = playerIndex + 1;

            room.battlePlayers[playerIndex].name = name;
            room.battlePlayers[playerIndex].ready = false;
            room.battlePlayers[playerIndex].party = [];
        } else {
            // 3人目以降は観戦者
            socket.playerNumber = 0;
            room.spectators.add(socket);
        }

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

        if (table === "battle") {
            /*
             * [FIX 1: READY状態を維持]
             * battle側のroom_select_tableでREADYをfalseに戻すと、
             * 対戦画面への接続だけでROOMの準備状態が解除されます。
             * READYの変更はroom_readyだけが担当します。
             */
            let index = -1;

            if (
                socket.playerNumber === 1 ||
                socket.playerNumber === 2
            ) {
                const ownedIndex = socket.playerNumber - 1;

                if (
                    room.battlePlayers[ownedIndex].name ===
                    socket.playerName
                ) {
                    index = ownedIndex;
                }
            }

            if (index === -1) {
                index = room.battlePlayers.findIndex(
                    player =>
                        player.name === socket.playerName
                );
            }

            if (index === -1) {
                index = room.battlePlayers.findIndex(
                    player => !player.name
                );
            }

            if (index !== -1) {
                room.battlePlayers[index].name = socket.playerName;
                socket.playerNumber = index + 1;

                if (Array.isArray(data.party) && data.party.length > 0) {
                    room.battlePlayers[index].party =
                        data.party
                            .map(Number)
                            .filter(Number.isFinite)
                            .slice(0, 6);
                }

                // READY状態はここでは変更しない。
            }

            room.spectators.delete(socket);
            broadcastRoom(room);
            return;
        }

        if (table === "spectator") {
            // すでにPLAYERとして割り当てられている接続を
            // 卓選択だけでPLAYER枠から外さない。
            if (socket.playerNumber === 0) {
                room.spectators.add(socket);
            }
            broadcastRoom(room);
            return;
        }
    }

    if (data.type === "room_ready") {
        if (
            socket.playerNumber !== 1 &&
            socket.playerNumber !== 2
        ) {
            return;
        }

        const index = socket.playerNumber - 1;
        const player = room.battlePlayers[index];

        // このスロットを所有している接続以外からの更新を拒否。
        if (player.name !== socket.playerName) {
            return;
        }

        player.ready = data.ready === true;

        if (Array.isArray(data.party)) {
            player.party =
                data.party
                    .map(Number)
                    .filter(Number.isFinite)
                    .slice(0, 6);
        }

        broadcastRoom(room);
        sendBattleStart(room);
        return;
    }

    if (data.type === "battle_join") {
        if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
            return;
        }

        /*
         * [FIX 2: パーティ同期]
         * 空のpartyでは既存の確定パーティを上書きしません。
         */
        if (Array.isArray(data.party) && data.party.length > 0) {
            room.battlePlayers[socket.playerNumber - 1].party =
                data.party
                    .map(Number)
                    .filter(Number.isFinite)
                    .slice(0, 6);
        }

        socket.inBattle = true;

        if (room.battleStarted) {
            sendBattleStart(room);
        }

        if (room.battleState) {
            send(socket, {
                type: "battle_state",
                state: room.battleState,
                party1: room.battlePlayers[0].party || [],
                party2: room.battlePlayers[1].party || [],
                sender: "server"
            });
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

        const sender = Number(socket.playerNumber);

        /*
         * [FIX 3: 初期盤面の競合防止]
         * battle_start直後はserver側のbattleStateがnullです。
         * PLAYER 1だけが初期状態を登録します。
         */
        if (!room.battleState) {
            if (sender !== 1) {
                return;
            }

            room.battleState = {
                ...incomingState,
                turn: 1,
                currentPlayer: 1,
                party1: room.battlePlayers[0].party || [],
                party2: room.battlePlayers[1].party || []
            };

            room.expectedPlayer = 1;
        } else {
            /*
             * [FIX 4: ターン権限をサーバー側で固定]
             * currentPlayer / turn はbattle_stateから変更させません。
             * ターン交代はbattle_end_turnだけが行います。
             */
            if (sender !== room.expectedPlayer) {
                return;
            }

            room.battleState = {
                ...room.battleState,
                ...incomingState,
                turn: room.battleState.turn,
                currentPlayer: room.battleState.currentPlayer,
                party1: room.battlePlayers[0].party || [],
                party2: room.battlePlayers[1].party || []
            };
        }

        for (const peer of room.sockets) {
            if (
                peer.inBattle &&
                peer.readyState === WebSocket.OPEN
            ) {
                send(peer, {
                    type: "battle_state",
                    state: room.battleState,
                    party1: room.battlePlayers[0].party || [],
                    party2: room.battlePlayers[1].party || [],
                    sender: socket.playerNumber
                });
            }
        }

        return;
    }

    /*
     * [FIX 5: サーバー側ターン終了]
     * TURN ENDはクライアントがcurrentPlayerを直接変更せず、
     * サーバーがPLAYER 1 -> PLAYER 2 -> PLAYER 1へ交代します。
     * ターン終了ログもここで生成して両画面へ送ります。
     */
    if (data.type === "battle_end_turn") {
        if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
            return;
        }

        if (!socket.inBattle || !room.battleState) {
            return;
        }

        const sender = Number(socket.playerNumber);

        if (sender !== room.expectedPlayer) {
            return;
        }

        if (room.battleState.gameOver || room.battleState.actionPhase) {
            return;
        }

        const state = {
            ...room.battleState,
            selectedUnitId: null,
            movableCells: [],
            actionPhase: null,
            skillPhase: null,
            skillDirection: null,
            skillTargetCells: [],
            skillSelectedTargetCells: [],
            selectedSkillId: null,
            movedUnits: [],
            battleLogs: Array.isArray(room.battleState.battleLogs)
                ? [...room.battleState.battleLogs]
                : [],
            party1: room.battlePlayers[0].party || [],
            party2: room.battlePlayers[1].party || []
        };

        const nextPlayer = sender === 1 ? 2 : 1;

        if (sender === 1) {
            state.battleLogs.push(
                "PLAYER 1のターン終了。PLAYER 2のターン開始！"
            );
        } else {
            state.turn = Number(state.turn || 1) + 1;
            state.battleLogs.push(
                "PLAYER 2のターン終了。PLAYER 1のターン開始！"
            );
        }

        state.currentPlayer = nextPlayer;

        room.battleState = state;
        room.expectedPlayer = nextPlayer;

        for (const peer of room.sockets) {
            if (
                peer.inBattle &&
                peer.readyState === WebSocket.OPEN
            ) {
                send(peer, {
                    type: "battle_state",
                    state: room.battleState,
                    party1: room.battlePlayers[0].party || [],
                    party2: room.battlePlayers[1].party || [],
                    sender: "server"
                });
            }
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
                player.name = "";
                player.ready = false;
                player.party = [];
            }
        }

        if (
            room.sockets.size === 0
        ) {
            rooms.delete(room.roomId);
        } else {
            broadcastRoom(room);
        }
    });
});

server.listen(PORT, () => {
    console.log(`MONSTER WAR server: http://localhost:${PORT}`);
});
