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
        let playerIndex = room.battlePlayers.findIndex(
            player => player.name === name
        );

        if (playerIndex === -1) {
            playerIndex = room.battlePlayers.findIndex(
                player => !player.name
            );
        }

        socket.room = room;
        socket.playerName = name;

        if (playerIndex !== -1) {
            socket.playerNumber = playerIndex + 1;

            const player = room.battlePlayers[playerIndex];
            const isExistingPlayer = player.name === name;

            player.name = name;

            // バトル画面からの再接続では、ROOMで確定したpartyを保持する。
            // 新規プレイヤーだけ初期化する。
            if (!isExistingPlayer) {
                player.ready = false;
                player.party = [];
            }
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
            let index = room.battlePlayers.findIndex(
                player =>
                    player.name === socket.playerName
            );

            if (index === -1) {
                index = room.battlePlayers.findIndex(
                    player => !player.name
                );
            }

            if (index !== -1) {
                const player = room.battlePlayers[index];
                const isExistingPlayer = player.name === socket.playerName;

                player.name = socket.playerName;
                socket.playerNumber = index + 1;

                /*
                 * BATTLE画面からの再接続では、ROOMで確定した
                 * ready / party を絶対に消さない。
                 *
                 * ここでready=falseにすると、room_readyで両者READY済みでも
                 * battle_join時のsendBattleStart()が成立せず、
                 * battle_startが送信されない。
                 */
                if (!isExistingPlayer) {
                    player.ready = false;
                    player.party = [];
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
        if (socket.playerNumber !== 1 && socket.playerNumber !== 2) {
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

        // BATTLE画面が後から接続しても、ROOMで確定済みの
        // P1/P2パーティを必ず直接返す。
        if (room.battleStarted) {
            send(socket, {
                type: "battle_sync",
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
            });
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

            /*
             * ROOM -> BATTLE の画面遷移では、ROOM側のWebSocketが
             * 一度切断されてからBATTLE側が再接続します。
             * その瞬間にpartyを消すとBATTLEが取得できなくなるため、
             * battleStarted後はプレイヤー情報を保持します。
             */
            if (
                player.name === socket.playerName &&
                !room.battleStarted
            ) {
                player.name = "";
                player.ready = false;
                player.party = [];
            }
        }

        /*
         * battleStarted後はBATTLE側の再接続を待つ必要があるため、
         * 接続が一時的に0本になってもROOMを破棄しません。
         */
        if (room.sockets.size === 0) {
            if (!room.battleStarted) {
                rooms.delete(room.roomId);
            }
        } else {
            broadcastRoom(room);
        }
    });
});

server.listen(PORT, () => {
    console.log(`MONSTER WAR server: http://localhost:${PORT}`);
});