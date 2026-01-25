import express, { json } from 'express';
import next from "next";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { ExpressPeerServer } from "peer";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// 接続中のユーザー情報を保持するMapオブジェクト
// キー: socket.id, 値: ユーザー情報 (User型オブジェクト)
const users = new Map();

app.prepare().then(() => {

  //server.get('*', (req, res) => handle(req, res));
  const server = createServer(handle);
  const io = new Server(server);
  // With Express Peer Server
  const peerServer = ExpressPeerServer;

  // Signalling server
  const expressPeerServer = peerServer(server, {
    allow_discovery: true,
    //debug: true
  });

  // Manage p2p keys
  const connectedKeys: any[] = [];
  expressPeerServer.on('connection', (key) => {

    if (connectedKeys.indexOf(key) !== -1) {
      connectedKeys.push(key);
    }
    console.log('connectedKeys', connectedKeys);
  });
  expressPeerServer.on('disconnect', (key) => {
    const index = connectedKeys.indexOf(key);
    if (index > -1) {
      connectedKeys.splice(index, 1);
    }
    console.log('disconnect', connectedKeys);
  });

  /*
   * Socket.IOによるリアルタイム通信の処理
   */
  // Socket.IO接続ハンドラー
  io.on("connection", (socket) => {
    console.log(`接続確立: ${socket.id}`);

    // ユーザーがログインした際の処理
    socket.on("user:login", (userData) => {
      console.log("ログインデータ受信:", userData);

      // サーバー側でsocket.idをユーザーIDとして正式に割り当てる
      const updatedUserData = {
        ...userData,
        id: socket.id,
      };

      // ユーザー情報をMapに保存
      users.set(socket.id, updatedUserData);

      // 新規ユーザーの入室を全クライアントに通知 (システムメッセージ)
      io.emit("message:new", {
        id: `msg-${Date.now()}`,
        type: "system",
        content: `${updatedUserData.name} が入室しました`,
        timestamp: new Date().toISOString(),
      });

      // 接続中のユーザー一覧を全クライアントに送信
      const usersList = Array.from(users.values());
      io.emit("users:update", usersList);

      console.log(`ログイン: ${updatedUserData.name} (${socket.id})`);
      console.log(`現在のユーザー数: ${users.size}`);
      console.log("ユーザーリスト:", usersList);
    });

    // クライアントからチャットメッセージを受信した際の処理
    socket.on("message:send", (message) => {
      const messageWithId = {
        ...message,
        id: `msg-${Date.now()}`,
      };

      // 全クライアントにメッセージをブロードキャスト
      io.emit("message:new", messageWithId);

      console.log(`メッセージ: ${message.content} from ${message.sender}`);
    });

    // クライアントからユーザーの位置情報更新を受信した際の処理
    socket.on("user:move", (position) => {
      // 該当ユーザーの情報を取得・更新
      const userData = users.get(socket.id);
      if (userData) {
        userData.position = position;
        users.set(socket.id, userData);

        // 更新された位置情報を全クライアントに送信
        const usersList = Array.from(users.values());
        io.emit("users:update", usersList);
        console.log(
          `ユーザー移動: ${userData.name} to (${position.x}, ${position.y})`
        );
      } else {
        console.log(`移動エラー: ユーザーが見つかりません (${socket.id})`);
      }
    });

    // クライアントからタイピング状態の通知を受信した際の処理
    socket.on("user:typing", (isTyping) => {
      const userData = users.get(socket.id);
      if (userData) {
        // 送信者以外の全クライアントにタイピング状態をブロードキャスト
        socket.broadcast.emit("user:typing", {
          userId: userData.id,
          name: userData.name,
          isTyping,
        });
      }
    });

    // 配信側からのオファー送信
    socket.on("offer", (toSocketId, offer) => {
      const userData = users.get(socket.id);
      console.log('offer', offer);
      socket.to(toSocketId).emit("offer", userData.id, offer, userData.name);
    });

    // 受信側からのアンサーを配信側へ渡す
    socket.on("answer", ({ answer }) => {
      console.log('answer', socket.id)
      io.emit("answer", { cid: socket.id, answer })
    });

    // クライアントとの接続が切断された際の処理
    socket.on("disconnect", () => {
      const userData = users.get(socket.id);

      if (userData) {
        // ユーザー情報をMapから削除
        users.delete(socket.id);

        // ユーザーの退室を全クライアントに通知 (システムメッセージ)
        io.emit("message:new", {
          id: `msg-${Date.now()}`,
          type: "system",
          content: `${userData.name} が退室しました`,
          timestamp: new Date().toISOString(),
        });

        // 更新されたユーザー一覧を送信
        const usersList = Array.from(users.values());
        io.emit("users:update", usersList);

        console.log(`切断: ${userData.name} (${socket.id})`);
        console.log(`現在のユーザー数: ${users.size}`);
        console.log("ユーザーリスト:", usersList);
      }
    });
  });


  server.listen(port, () => {
    console.log(
      `> Server listening at http://localhost:${port} as ${dev ? "development" : process.env.NODE_ENV}`,
    );
  });
});