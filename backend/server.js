var express = require('express');
var http = require('http');
var socketIO = require('socket.io');
var cors = require('cors');

var app = express();
app.use(cors());

var server = http.createServer(app);

var io = socketIO(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

var waitingPlayer = null;
var games = {};

io.on("connection", function(socket) {
  console.log("A player connected: " + socket.id);

  if (waitingPlayer) {
    var roomId = waitingPlayer.id + "#" + socket.id;
    games[roomId] = {
      players: { white: waitingPlayer.id, black: socket.id }
    };
    waitingPlayer.join(roomId);
    socket.join(roomId);
    waitingPlayer.emit("gameStart", { color: "white", roomId: roomId });
    socket.emit("gameStart", { color: "black", roomId: roomId });
    waitingPlayer = null;
  } else {
    waitingPlayer = socket;
    socket.emit("waiting", "Waiting for opponent...");
  }

  socket.on("move", function(data) {
    socket.to(data.roomId).emit("opponentMove", data.move);
  });

  socket.on("webrtc-offer", function(data) {
    socket.to(data.roomId).emit("webrtc-offer", { offer: data.offer });
  });

  socket.on("webrtc-answer", function(data) {
    socket.to(data.roomId).emit("webrtc-answer", { answer: data.answer });
  });

  socket.on("webrtc-ice", function(data) {
    socket.to(data.roomId).emit("webrtc-ice", { candidate: data.candidate });
  });

  socket.on("disconnect", function() {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    for (var roomId in games) {
      var game = games[roomId];
      if (game.players.white === socket.id || game.players.black === socket.id) {
        io.to(roomId).emit("opponentLeft");
        delete games[roomId];
      }
    }
  });
});

server.listen(4000, function() {
  console.log("Server running on port 4000");
});