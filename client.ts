import { generateKeyPair, exportPublicKey, deriveSharedKey, encryptMessage, decryptMessage, encryptBytes, decryptBytes, computeFingerprint, type EncryptedPayload } from "./crypto.js";

// file size limited to 5MB for now
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface FileMeta {
  name: string;
  type: string;
}

declare const io: any;

const socket=  io();
let thisRoom: string | null = null;

const menu = document.getElementById('menu')!;
const chat = document.getElementById("chat") as HTMLElement;

const createRoom = document.getElementById("createRoom") as HTMLButtonElement;
const joinRoom = document.getElementById("joinRoom") as HTMLButtonElement;

const roomCode = document.getElementById("roomCode") as HTMLInputElement;
const currentRoom = document.getElementById("currentRoom") as HTMLElement;

const messages = document.getElementById("messages") as HTMLElement;
const messageInput = document.getElementById("messageInput") as HTMLInputElement;
const sendMessage = document.getElementById("sendMessage") as HTMLButtonElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const fileInputButton = document.getElementById("fileInputButton") as HTMLButtonElement;

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
  if(!thisRoom || !message || !sharedKey) return;

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

// FILE HANDLING

// send files

fileInput.addEventListener("change", async () =>{
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if(!file || !currentRoom || !sharedKey) return;

  if(file.size > MAX_FILE_BYTES){
    console.log("File too large");
    return;
  }

  const rawBytes = await file.arrayBuffer();
  const fileEnc = await encryptBytes(sharedKey, rawBytes);
  const metaEnc = await encryptMessage (sharedKey, JSON.stringify({name: file.name, type: file.type} as FileMeta));

  socket.emit("send-file", {
    code: thisRoom, fileCiphertext: fileEnc.ciphertext, fileIv: fileEnc.iv, metaCiphertext: metaEnc.ciphertext, metaIv: metaEnc.iv
  });
  renderFile("You", file.name, file.type, rawBytes);
});

// receive files

interface IncomingFile {
  fileCiphertext: ArrayBuffer;
  fileIv: Uint8Array;
  metaCiphertext: string;
  metaIv: string;
}

socket.on("receive-file", async ({fileCiphertext, fileIv, metaCiphertext, metaIv}: IncomingFile) =>{
  if(!sharedKey) return;

  try{
    const metaJson = await decryptMessage(sharedKey, {ciphertext: metaCiphertext, iv: metaIv});
    const meta: FileMeta = JSON.parse(metaJson);
    const bytes = await decryptBytes(sharedKey, {ciphertext: fileCiphertext, iv: fileIv});
    renderFile("Other", meta.name, meta.type, bytes);
  } catch(err){
    console.log("failed to decrypt file");
  }
});

// render file (previews)

function renderFile(sender: string, name: string, type: string, data: ArrayBuffer): void{
  const blob = new Blob([data], {type});
  const url = URL.createObjectURL(blob);
  const wrapper = document.createElement('p');
  const label = document.createElement('span');
  label.textContent = `${sender}: `;
  wrapper.appendChild(label);

  if(type.startsWith('image/')){
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    img.style.maxWidth = '200px';
    img.style.display = 'block';
    wrapper.appendChild(img);
  }
  else{
    const link = document.createElement('a');
    link.href = url;
    link.textContent = ` ${name}`;
    link.download = name;
    wrapper.appendChild(link);
  }
  messages.appendChild(wrapper);
}

// file input

fileInputButton.addEventListener('click', () => fileInput.click());

// display message

function addMessage(sender: string, message: string){
  const element = document.createElement('p');
  element.textContent = `${sender}: ${message}`;
  messages.appendChild(element);
}