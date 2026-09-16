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

        // PLAYER番号はサーバーで決定する。
        // 既に同じ名前のPLAYERがいる場合は、その枠を再利用する。
        let playerIndex = room.battlePlayers.findIndex(
            player => player.name === name
        );

        // 同じ名前がいなければ、空いている最初の枠を割り当てる。
        if (playerIndex === -1) {
            playerIndex = room.battlePlayers.findIndex(
                player => !player.name
            );
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
            // PLAYER番号は room_join 時にサーバーが決定済み。
            // ここでは番号を再割り当てせず、現在の枠を維持する。
            if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
                const index = room.battlePlayers.findIndex(
                    player => !player.name
                );

                if (index !== -1) {
                    socket.playerNumber = index + 1;
                    room.battlePlayers[index].name = socket.playerName;
                    room.battlePlayers[index].ready = false;
                    room.battlePlayers[index].party = [];
                }
            }

            if (socket.playerNumber === 1 || socket.playerNumber === 2) {
                const player =
                    room.battlePlayers[socket.playerNumber - 1];

                // 自分のスロットだけ更新する。
                if (player.name === socket.playerName) {
                    player.ready = false;

                    if (Array.isArray(data.party)) {
                        player.party = data.party
                            .map(Number)
                            .filter(Number.isFinite)
                            .slice(0, 6);
                    }
                }
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

        if (Array.isArray(data.party)) {
            room.battlePlayers[socket.playerNumber - 1].party =
                data.party.map(Number).filter(Number.isFinite).slice(0, 6);
        }

        socket.inBattle = true;

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

    if (data.type === "battle_end_turn") {
        if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
            return;
        }

        if (!socket.inBattle) return;

        // まだ初期battle_stateを受け取っていない場合は、
        // クライアントのユニット状態を空にしないため何もしない。
        if (!room.battleState) {
            return;
        }

        const sender = Number(socket.playerNumber);
        const currentPlayer = Number(room.battleState.currentPlayer || 1);

        if (sender !== currentPlayer) {
            return;
        }

        room.battleState.selectedUnitId = null;
        room.battleState.movableCells = [];
        room.battleState.actionPhase = null;
        room.battleState.skillPhase = null;
        room.battleState.skillDirection = null;
        room.battleState.skillTargetCells = [];
        room.battleState.skillSelectedTargetCells = [];
        room.battleState.selectedSkillId = null;
        room.battleState.movedUnits = [];

        if (currentPlayer === 1) {
            room.battleState.currentPlayer = 2;
        } else {
            room.battleState.currentPlayer = 1;
            room.battleState.turn = Number(room.battleState.turn || 1) + 1;
        }

        room.expectedPlayer = room.battleState.currentPlayer;

        for (const peer of room.sockets) {
            if (
                peer.inBattle &&
                peer.readyState === WebSocket.OPEN
            ) {
                send(peer, {
                    type: "battle_state",
                    state: room.battleState,
                    sender: "server"
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

        const sender = Number(socket.playerNumber);

        // 最初のbattle_stateだけは、先に到着したPLAYERから受け付ける。
        // 以降はサーバーが管理する現在PLAYERだけが更新できる。
        if (room.battleState && sender !== room.expectedPlayer) {
            return;
        }

        if (room.battleState) {
            if (Number(incomingState.currentPlayer) !== Number(room.battleState.currentPlayer)) {
                return;
            }
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
