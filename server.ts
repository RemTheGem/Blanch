import path from "path";
import express from "express";
import http from "http";
import {Server} from "socket.io";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "..")));

interface Room{
  sockets: string[];
  createdAt: number;
}

const rooms: Record<string, Room> = {};

function makeRoomCode(){
  let code: string;
  do{
    code = crypto.randomBytes(8).toString('hex');
  }
  while(rooms[code]);
  return code;
}

function roomOf(socketId: string){
  for(const code of Object.keys(rooms)){
    const room = rooms[code];
    if(room.sockets.includes(socketId)){
      return {code, room};
    }
  }
  return null;
}

io.on('connection', (socket) =>{
  // room creation
  socket.on('create-room', ()=>{
    const code = makeRoomCode();
    rooms[code] = {
      sockets: [socket.id],
      createdAt: Date.now()
    };
    socket.join(code);
    socket.emit('room-created', {
      code
    });
    console.log(`Room ${code} created by ${socket.id}`);
  });

  // join room

  socket.on('join-room', ({code}) =>{
    const room = rooms[code];

    if(!room){
      socket.emit('join-error', {
        message: "Failed to connect"
      });
      return;
    }
    
    if(room.sockets.includes(socket.id)){
      return;
    }
    if(room.sockets.length >= 2){
      socket.emit('join-error', {message: "Failed to connect"});
      return;
    }

    room.sockets.push(socket.id);
    socket.join(code);
    socket.emit('room-joined',{
      code
    });

    socket.to(code).emit('user-joined');
    console.log(`${socket.id} joined room ${code}`);
  });


  socket.on('public-key', ({code, key})=>{
    const room = rooms[code];
    if(!room || !room.sockets.includes(socket.id)) return;
    socket.to(code).emit('public-key', {key});
  });

  socket.on('send-message', ({code, ciphertext, iv})=>{
    const room = rooms[code];
    if(!room) return;
    if(!room.sockets.includes(socket.id)){
      return;
    }
    socket.to(code).emit('receive-message', {
      ciphertext, iv
    });
  });

  socket.on('file-start', ({code, transferId, metaCiphertext, metaIv, totalChunks})=>{
    const room = rooms[code];
    if(!room || !room.sockets.includes(socket.id)) return;
    socket.to(code).emit('file-start', {transferId, metaCiphertext, metaIv, totalChunks});
  });

  socket.on('file-chunk', ({code, transferId, seq, ciphertext, iv})=>{
    const room = rooms[code];
    if(!room || !room.sockets.includes(socket.id)) return;
    socket.to(code).emit('file-chunk', {transferId, seq, ciphertext, iv});
  });

  socket.on('file-chunk-ack', ({code, transferId, seq})=>{
    const room = rooms[code];
    if(!room || !room.sockets.includes(socket.id)) return;
    socket.to(code).emit('file-chunk-ack', {transferId, seq});
  });

  socket.on('file-end', ({code, transferId}) =>{
    const room = rooms[code];
    if(!room || !room.sockets.includes(socket.id)) return;
    socket.to(code).emit('file-end', {transferId});
  });

  socket.on('disconnect', ()=>{
    const found = roomOf(socket.id);
    if(!found) return;
    const {code, room} = found;
    room.sockets = room.sockets.filter(id => id !== socket.id);

    socket.to(code).emit('user-left');

    if(room.sockets.length === 0){
      delete rooms[code];

      console.log(`Room ${code} destroyed`);
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Blanch running ");
});