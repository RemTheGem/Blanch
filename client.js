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
});

// enter chat

function enterRoom(code){
  thisRoom = code;
  currentRoom.textContent = code;
  menu.hidden = true;
  chat.hidden = false;

  messageInput.focus();
}


// send message 

function send(){
  const message = messageInput.value.trim();
  if(!currentRoom || !message) return;

  socket.emit("send-message", {
    code: thisRoom, 
    ciphertext: message, 
    iv: "temp iv"
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

socket.on("receive-message", ({ciphertext}) => {
  addMessage("Other", ciphertext);
});

// display message

function addMessage(sender, message){
  const element = document.createElement('p');
  element.textContent = `${sender}: ${message}`;
  messages.appendChild(element);
}