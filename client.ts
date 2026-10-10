import { generateKeyPair, exportPublicKey, deriveSharedKey, encryptMessage, decryptMessage, computeFingerprint, type EncryptedPayload } from "./crypto.js";

declare const io: any;

const socket=  io();
let thisRoom: string | null = null;

const menu = document.getElementById('menu')!;
const chat = document.getElementById("chat") as HTMLButtonElement;

const createRoom = document.getElementById("createRoom") as HTMLButtonElement;
const joinRoom = document.getElementById("joinRoom") as HTMLButtonElement;

const roomCode = document.getElementById("roomCode") as HTMLInputElement;
const currentRoom = document.getElementById("currentRoom") as HTMLElement;

const messages = document.getElementById("messages") as HTMLElement;
const messageInput = document.getElementById("messageInput") as HTMLInputElement;
const sendMessage = document.getElementById("sendMessage") as HTMLButtonElement;

// encryption state

let myKeyPair: CryptoKeyPair | null = null;
let myPublicKey: string | null = null;
let sharedKey: CryptoKey | null = null;

// create room

createRoom.addEventListener("click", ()=>{
  socket.emit("create-room");
});

socket.on("room-created", ({code}: {code: string})=>{
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

socket.on("room-joined", ({code}: {code: string})=>{
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

function enterRoom(code: string){
  thisRoom = code;
  currentRoom.textContent = code;
  menu.hidden = true;
  chat.hidden = false;
  messageInput.disabled = false;

  messageInput.focus();
}

// handshake

async function startHandshake(): Promise<void>{
  if(!myKeyPair){
    myKeyPair = await generateKeyPair();
    myPublicKey = await exportPublicKey(myKeyPair);
  }
  socket.emit('public-key', {code: thisRoom, key: myPublicKey});
}

socket.on('public-key', async ({key}: {key: string})=>{
  if(!myKeyPair){
    myKeyPair = await generateKeyPair();
    myPublicKey = await exportPublicKey(myKeyPair);
    socket.emit('public-key', {code: thisRoom, key: myPublicKey});
  }
  sharedKey = await deriveSharedKey(key, myKeyPair);
  messageInput.disabled = false;
  if(myPublicKey){
    const fingerprint = await computeFingerprint(myPublicKey, key);
  }
})

// send message 

async function send(){
  const message = messageInput.value.trim();
  if(!currentRoom || !message || !sharedKey) return;

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

messageInput.addEventListener("keydown", (event: KeyboardEvent)=>{
  if(event.key === "Enter"){
    send();
  }
});

// receive message

socket.on("receive-message", async ({ciphertext, iv}: EncryptedPayload) => {
  if(!sharedKey) return;
  try{
    const message = await decryptMessage(sharedKey, {ciphertext, iv});
    addMessage("Other", message);
  }
  catch(err){
    console.log("failed to decrypt");
  }
});

// display message

function addMessage(sender: string, message: string){
  const element = document.createElement('p');
  element.textContent = `${sender}: ${message}`;
  messages.appendChild(element);
}