import { generateKeyPair, exportPublicKey, deriveSharedKey, encryptMessage, decryptMessage, computeFingerprint } from "./crypto.js";

const socket=  io();
let thisRoom = null;

const menu = document.getElementById('menu');
const chat = document.getElementById("chat");

const createRoom = document.getElementById("createRoom");
const joinRoom = document.getElementById("joinRoom");

const roomCode = document.getElementById("roomCode");
const currentRoom = document.getElementById("currentRoom");

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendMessage = document.getElementById("sendMessage");

// encryption state

let myKeyPair = null;
let myPublicKey = null;
let sharedKey = null;

// create room

createRoom.addEventListener("click", ()=>{
  socket.emit("create-room");
});

socket.on("room-created", ({code})=>{
  enterRoom(code);
});


// join room

joinRoom.addEventListener("click", ()=>{
  const code = roomCode.value.trim();

  if(!code) return;
  socket.emit("join-room", {
    code
  });
});

socket.on("room-joined", ({code})=>{
  enterRoom(code);
  startHandshake();
});

socket.on('user-joined', ()=>{
  startHandshake();
});

socket.on('user-left', ()=>{
  sharedKey = null;
  messageInput.disabled = true;
});

// enter chat

function enterRoom(code){
  thisRoom = code;
  currentRoom.textContent = code;
  menu.hidden = true;
  chat.hidden = false;
  messageInput.disabled = true;

  messageInput.focus();
}

// handshake

async function startHandshake(){
  if(!myKeyPair){
    myKeyPair = await generateKeyPair();
    myPublicKey = await exportPublicKey(myKeyPair);
  }
  socket.emit('public-key', {code: thisRoom, key: myPublicKeyB64});
}

socket.on('public-key', async ({key})=>{
  if(!myKeyPair){
    myKeyPair = await generateKeyPair();
    myPublicKey = await exportPublicKey(myKeyPair);
    socket.emit('public-key', {code: thisRoom, key: myPublicKey});
  }
  sharedKey = await deriveSharedKey(key, myKeyPair);
  messageInput.disabled = false;
  const fingerprint = await computeFingerprint(myPublicKey, key);
})

// send message 

async function send(){
  const message = messageInput.value.trim();
  if(!currentRoom || !message) return;

  const {ciphertext, iv} = await encryptMessage(sharedKey, message);
  socket.emit("send-message", {
    code: thisRoom, 
    ciphertext, iv
  });

  addMessage("You", message);
  messageInput.value = "";
}

sendMessage.addEventListener("click", send);

// ENTER also sends

messageInput.addEventListener("keydown", (event)=>{
  if(event.key === "Enter"){
    send();
  }
});

// receive message

socket.on("receive-message", async ({ciphertext}) => {
  if(!sharedKey) return;
  try{
    const message = await decryptMessage(sharedKey, {ciphertext, iv});
    addMessage("Other", ciphertext);
  }
  catch(err){
    console.log("failed to decrypt");
  }
});

// display message

function addMessage(sender, message){
  const element = document.createElement('p');
  element.textContent = `${sender}: ${message}`;
  messages.appendChild(element);
}