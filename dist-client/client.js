"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // crypto.ts
  function toBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function fromBase64(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  }
  async function generateKeyPair() {
    return crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: CURVE },
      true,
      ["deriveKey"]
    );
  }
  async function exportPublicKey(keyPair) {
    const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    return toBase64(raw);
  }
  async function deriveSharedKey(peerPublicKey, myKeyPair) {
    const peerKey = await crypto.subtle.importKey(
      "raw",
      fromBase64(peerPublicKey),
      { name: "ECDH", namedCurve: CURVE },
      false,
      []
    );
    return crypto.subtle.deriveKey(
      { name: "ECDH", public: peerKey },
      myKeyPair.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async function encryptMessage(sharedKey, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);
    return { ciphertext: toBase64(ciphertext), iv: toBase64(iv.buffer) };
  }
  async function decryptMessage(sharedKey, { ciphertext, iv }) {
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) },
      sharedKey,
      fromBase64(ciphertext)
    );
    return new TextDecoder().decode(plainBuf);
  }
  async function computeFingerprint(myPublicKey, peerPublicKey) {
    const [a, b] = [myPublicKey, peerPublicKey].sort();
    const data = new TextEncoder().encode(a + b);
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const hex = [...new Uint8Array(hashBuf)].map((x) => x.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 12).match(/.{1,4}/g).join("");
  }
  var CURVE;
  var init_crypto = __esm({
    "crypto.ts"() {
      "use strict";
      CURVE = "P-256";
    }
  });

  // client.ts
  var require_client = __commonJS({
    "client.ts"() {
      init_crypto();
      var socket = io();
      var thisRoom = null;
      var menu = document.getElementById("menu");
      var chat = document.getElementById("chat");
      var createRoom = document.getElementById("createRoom");
      var joinRoom = document.getElementById("joinRoom");
      var roomCode = document.getElementById("roomCode");
      var currentRoom = document.getElementById("currentRoom");
      var messages = document.getElementById("messages");
      var messageInput = document.getElementById("messageInput");
      var sendMessage = document.getElementById("sendMessage");
      var myKeyPair = null;
      var myPublicKey = null;
      var sharedKey = null;
      createRoom.addEventListener("click", () => {
        socket.emit("create-room");
      });
      socket.on("room-created", ({ code }) => {
        enterRoom(code);
      });
      joinRoom.addEventListener("click", () => {
        const code = roomCode.value.trim();
        if (!code) return;
        socket.emit("join-room", {
          code
        });
      });
      socket.on("room-joined", ({ code }) => {
        enterRoom(code);
        startHandshake();
      });
      socket.on("user-joined", () => {
        startHandshake();
      });
      socket.on("user-left", () => {
        sharedKey = null;
        messageInput.disabled = true;
      });
      function enterRoom(code) {
        thisRoom = code;
        currentRoom.textContent = code;
        menu.hidden = true;
        chat.hidden = false;
        messageInput.disabled = false;
        messageInput.focus();
      }
      async function startHandshake() {
        if (!myKeyPair) {
          myKeyPair = await generateKeyPair();
          myPublicKey = await exportPublicKey(myKeyPair);
        }
        socket.emit("public-key", { code: thisRoom, key: myPublicKey });
      }
      socket.on("public-key", async ({ key }) => {
        if (!myKeyPair) {
          myKeyPair = await generateKeyPair();
          myPublicKey = await exportPublicKey(myKeyPair);
          socket.emit("public-key", { code: thisRoom, key: myPublicKey });
        }
        sharedKey = await deriveSharedKey(key, myKeyPair);
        messageInput.disabled = false;
        if (myPublicKey) {
          const fingerprint = await computeFingerprint(myPublicKey, key);
        }
      });
      async function send() {
        const message = messageInput.value.trim();
        if (!currentRoom || !message || !sharedKey) return;
        const { ciphertext, iv } = await encryptMessage(sharedKey, message);
        socket.emit("send-message", {
          code: thisRoom,
          ciphertext,
          iv
        });
        addMessage("You", message);
        messageInput.value = "";
      }
      sendMessage.addEventListener("click", send);
      messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          send();
        }
      });
      socket.on("receive-message", async ({ ciphertext, iv }) => {
        if (!sharedKey) return;
        try {
          const message = await decryptMessage(sharedKey, { ciphertext, iv });
          addMessage("Other", message);
        } catch (err) {
          console.log("failed to decrypt");
        }
      });
      function addMessage(sender, message) {
        const element = document.createElement("p");
        element.textContent = `${sender}: ${message}`;
        messages.appendChild(element);
      }
    }
  });
  require_client();
})();
