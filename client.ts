import { generateKeyPair, exportPublicKey, deriveSharedKey, encryptMessage, decryptMessage, encryptBytes, decryptBytes, computeFingerprint, type EncryptedPayload } from "./crypto.js";
import { toDataURL } from "qrcode";

const MAX_FILE_BYTES = 25 * 1024 * 1024 * 4;
// size of each chunk
const CHUNK_SIZE = 1024 * 1024;

// metadata for sent and received files
interface FileMeta {
  name: string;
  type: string;
}


// details for sent files
interface OutgoingTransfer {
  transferId: string;
  bytes: ArrayBuffer;
  nextSeq: number;
  totalChunks: number;
  fileName: string;
  fileType: string;
}


// details for incoming messages
interface IncomingTransfer {
  transferId: string;
  meta: FileMeta;
  chunks: Uint8Array[];
  totalChunks: number;
  receiveCount: number;
}

let outgoingTransfer: OutgoingTransfer | null = null;
let incomingTransfer: IncomingTransfer | null = null;
let sawIncomingChunkSinceLastSend = true;

declare const io: any;

const socket=  io();
let thisRoom: string | null = null;

const menu = document.getElementById('menu')!;
const chat = document.getElementById("chat") as HTMLElement;

const createRoom = document.getElementById("createRoom") as HTMLButtonElement;
const joinRoom = document.getElementById("joinRoom") as HTMLButtonElement;

const roomCode = document.getElementById("roomCode") as HTMLInputElement;
const currentRoom = document.getElementById("currentRoom") as HTMLElement;

const qrCodeImage = document.getElementById("qrCodeImage") as HTMLImageElement;
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

const urlParams = new URLSearchParams(window.location.search);
const codeFromUrl = urlParams.get("code");
if(codeFromUrl){
  roomCode.value = codeFromUrl;
  socket.emit("join-room", {code: codeFromUrl});
}

createRoom.addEventListener("click", ()=>{
  socket.emit("create-room");
});

socket.on("room-created", ({code}: {code: string})=>{
  enterRoom(code);
  // turn room code into url and into qrcode
  const joinUrl = `${window.location.origin}?code=${code}`;
  toDataURL(joinUrl).then((resolvedValue) => {
    qrCodeImage.src = resolvedValue; 
  });
});


// join room

joinRoom.addEventListener("click", ()=>{
  const code = roomCode.value.trim();

  if(!code) return;
  socket.emit("join-room", {
    code
  });
});

// when room is created enter it and start handshake
socket.on("room-joined", ({code}: {code: string})=>{
  enterRoom(code);
  startHandshake();
});

// when second user joins start handshake and let user 1 know
socket.on('user-joined', ()=>{
  startHandshake();
  addMessage("System", "User joined!");
});

// if a user leaves disable messaging
socket.on('user-left', ()=>{
  addMessage("System", "User Left!")
  sharedKey = null;
  messageInput.disabled = true;
});

// enter chat

function enterRoom(code: string){
  thisRoom = code;
  currentRoom.textContent = code;
  menu.hidden = true;
  chat.hidden = false;
  messageInput.disabled = true;

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
  if(!file || !thisRoom || !sharedKey) return;

  // send one file at a time
  if(outgoingTransfer){
    addMessage("System", "Still sending a previous file. Wait for it to finish!");
    return;
  }

  // make sure the file is below the size limit
  if(file.size > MAX_FILE_BYTES){
    addMessage("System", "File too large")
    return;
  }

  // turn the data into raw bytes, calculate how many chunks it is
  // and give it a unique id
  const rawBytes = await file.arrayBuffer();
  const totalChunks = Math.max(1, Math.ceil(rawBytes.byteLength / CHUNK_SIZE));
  const transferId = crypto.randomUUID();

  outgoingTransfer = {transferId, bytes: rawBytes, nextSeq: 0, totalChunks, fileName: file.name, fileType: file.type};

  const metaEnc = await encryptMessage (sharedKey, JSON.stringify({name: file.name, type: file.type} as FileMeta));

  // start sending file and show progress
  socket.emit("file-start", {
    code: thisRoom, transferId, metaCiphertext: metaEnc.ciphertext, metaIv: metaEnc.iv, totalChunks,
  });
  showProgress("out", file.name, 0, totalChunks);
  await trySendNextChunk();
});

// check if we can send the next chunk
async function trySendNextChunk(): Promise<void> {
  if(!outgoingTransfer || !sharedKey || !thisRoom) return;
  if(incomingTransfer && !sawIncomingChunkSinceLastSend) return;

  const {transferId, bytes, nextSeq, totalChunks, fileName, fileType} = outgoingTransfer;
  if(nextSeq >= totalChunks){
    socket.emit("file-end", {code: thisRoom, transferId});
    renderFile("You", fileName, fileType, bytes);
    hideProgress("out");
    outgoingTransfer = null;
    return;
  }
  const start = nextSeq * CHUNK_SIZE;
  const slice = bytes.slice(start, start + CHUNK_SIZE);
  const enc = await encryptBytes(sharedKey, slice);
  socket.emit("file-chunk", {code: thisRoom, transferId, seq: nextSeq, ciphertext: enc.ciphertext, iv: enc.iv});
  sawIncomingChunkSinceLastSend = false;
}

// when a chunk ACK is received try sending the next chunk
socket.on("file-chunk-ack", ({transferId, seq}: {transferId: string, seq: number})=>{
  if(outgoingTransfer?.transferId !== transferId || seq !== outgoingTransfer.nextSeq)return;
  outgoingTransfer.nextSeq++;
  showProgress("out", outgoingTransfer.fileName, outgoingTransfer.nextSeq, outgoingTransfer.totalChunks);
  trySendNextChunk();
});

// receive files

socket.on("file-start", async ({ transferId, metaCiphertext, metaIv, totalChunks }:
  { transferId: string; metaCiphertext: string; metaIv: string; totalChunks: number }) => {
  if (!sharedKey) return;
  try {
    const metaJson = await decryptMessage(sharedKey, { ciphertext: metaCiphertext, iv: metaIv });
    const meta: FileMeta = JSON.parse(metaJson);
    incomingTransfer = { transferId, meta, chunks: [], totalChunks, receiveCount: 0 };
    showProgress("in", meta.name, 0, totalChunks);
  } catch (err) {
    console.log("failed to read incoming file metadata");
  }
});

// for each chunk, decrypt the bytes and send ack for each one
socket.on("file-chunk", async ({transferId, seq, ciphertext, iv}: {transferId: string; seq: number; ciphertext: ArrayBuffer; iv: Uint8Array})=>{
  if(!sharedKey || !thisRoom || incomingTransfer?.transferId !== transferId) return;
  try{
    const bytes = await decryptBytes(sharedKey, {ciphertext, iv});
    incomingTransfer.chunks[seq] = new Uint8Array(bytes);
    incomingTransfer.receiveCount++;
    showProgress("in", incomingTransfer.meta.name, incomingTransfer.receiveCount, incomingTransfer.totalChunks);

    socket.emit("file-chunk-ack", {code: thisRoom, transferId, seq});
    sawIncomingChunkSinceLastSend =  true;
    trySendNextChunk();
  }
  catch(err) {
    console.log("failed to decrypt incoming chunk");
  }
});

// combine file chunks when they finish
socket.on("file-end", ({transferId}: {transferId: string})=>{
  if(incomingTransfer?.transferId !== transferId) return;
  const totalBytes = incomingTransfer.chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for(const chunk of incomingTransfer.chunks){
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  renderFile("Other", incomingTransfer.meta.name, incomingTransfer.meta.type, combined.buffer);
  hideProgress("in");
  incomingTransfer = null;
})

// progress bar

function showProgress(direction: "in" | "out", fileName: string, done: number, total: number): void{
  const container = document.getElementById(direction === "out" ? "progressOut" : "progressIn");
  if(!container) return;
  const pct = Math.round((done/total) *100);
  container.hidden = false;
  container.innerHTML = `<progress value="${done}" max="${total}"></progress> ${direction === "out" ? "Sending" : "Receiving"} ${fileName} | ${pct}%`;
}

function hideProgress(direction: "in" | "out"): void {
  const container = document.getElementById(direction === "out" ? "progressOut" : "progressIn");
  if(!container) return;
  container.hidden = true;
  container.innerHTML = "";
}

// helper for scroll

function scrollToBottom(): void {
  const isNearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
  if (isNearBottom) {
    messages.scrollTop = messages.scrollHeight;
  }
}

// render file (previews)

function renderFile(sender: string, name: string, type: string, data: ArrayBuffer): void{
  const blob = new Blob([data], {type});
  const url = URL.createObjectURL(blob);
  const wrapper = document.createElement('p');
  wrapper.classList.add('bubble', sender === "You" ? "bubble-you" : "bubble-other");
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
  scrollToBottom();
}

// file input

fileInputButton.addEventListener('click', () => fileInput.click());

// display message

function addMessage(sender: string, message: string){
  const element = document.createElement('p');
  element.textContent = `${sender}: ${message}`;
  element.classList.add('bubble');
  if (sender === "You") element.classList.add('bubble-you');
  else if(sender === "System") element.classList.add('bubble-system');
  else element.classList.add('bubble-other');
  messages.appendChild(element);
  scrollToBottom();
}