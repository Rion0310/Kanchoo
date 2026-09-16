# MONSTER WAR オンライン対戦版

## 1. 構成

Node.js + WebSocket (`ws`) でオンライン対戦サーバーを動かします。

サーバーはプロジェクト直下の `server.js` からゲーム本体も静的配信します。

```text
kanchoo/
├─ server.js
├─ package.json
├─ title/
├─ room/
├─ battle/
├─ build/
├─ database/
├─ images/
└─ audio/
```

## 2. ローカル起動

プロジェクト直下で:

```bash
npm install
npm start
```

Windowsでは `start-server.bat` をダブルクリックしても起動できます。

起動後:

`http://localhost:8080/`

を開いてください。

## 3. インターネット公開

RenderなどのNode.js Web Serviceへプロジェクト全体を配置し、以下で起動できます。

```text
Root Directory: 空欄
Build Command: npm install
Start Command: npm start
```

HTTPS環境ではゲーム側が自動的に `wss://` を使用します。

## 4. オンライン対戦の流れ

1. タイトル画面からONLINE BATTLEへ進む。
2. ROOMへ入り、ROOM IDを共有する。
3. 2人が同じROOMに接続する。
4. それぞれ対戦卓を選択する。
5. 両者が準備する。
6. サーバーからBATTLE開始を通知する。
7. BATTLE側もWebSocketをROOMへ登録してから対戦通信を開始する。
8. ターン、ユニット状態、HP、技、ブラフ、ログ、勝敗状態などを同期する。

## 5. 注意

現段階では、サーバーはターン所有者と状態の順序を管理し、ゲーム状態そのものはクライアントが計算して送信します。

一般公開版にする場合は、移動可能マス・技の射程・ダメージ・勝敗などをサーバー側で検証するサーバー権威型へ移行することを推奨します。
