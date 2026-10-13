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
  async function encryptBytes(sharedKey, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, data);
    return { ciphertext, iv };
  }
  async function decryptBytes(sharedKey, { ciphertext, iv }) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, ciphertext);
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
      var MAX_FILE_BYTES = 25 * 1024 * 1024;
      var CHUNK_SIZE = 64 * 1024;
      var outgoingTransfer = null;
      var incomingTransfer = null;
      var sawIncomingChunkSinceLastSend = true;
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
      var fileInput = document.getElementById("fileInput");
      var fileInputButton = document.getElementById("fileInputButton");
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
        if (!thisRoom || !message || !sharedKey) return;
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
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (!file || !currentRoom || !sharedKey) return;
        if (outgoingTransfer) {
          addMessage("System", "Still sending a previous file. Wait for it to finish!");
          return;
        }
        if (file.size > MAX_FILE_BYTES) {
          addMessage("System", "File too large");
          return;
        }
        const rawBytes = await file.arrayBuffer();
        const totalChunks = Math.max(1, Math.ceil(rawBytes.byteLength / CHUNK_SIZE));
        const transferId = crypto.randomUUID();
        outgoingTransfer = { transferId, bytes: rawBytes, nextSeq: 0, totalChunks, fileName: file.name, fileType: file.type };
        const metaEnc = await encryptMessage(sharedKey, JSON.stringify({ name: file.name, type: file.type }));
        socket.emit("file-start", {
          code: thisRoom,
          transferId,
          metaCiphertext: metaEnc.ciphertext,
          metaIv: metaEnc.iv,
          totalChunks
        });
        showProgress("out", file.name, 0, totalChunks);
        await trySendNextChunk();
      });
      async function trySendNextChunk() {
        if (!outgoingTransfer || !sharedKey || !thisRoom) return;
        if (incomingTransfer && !sawIncomingChunkSinceLastSend) return;
        const { transferId, bytes, nextSeq, totalChunks, fileName, fileType } = outgoingTransfer;
        if (nextSeq >= totalChunks) {
          socket.emit("file-end", { code: thisRoom, transferId });
          renderFile("You", fileName, fileType, bytes);
          hideProgress("out");
          outgoingTransfer = null;
          return;
        }
        const start = nextSeq * CHUNK_SIZE;
        const slice = bytes.slice(start, start + CHUNK_SIZE);
        const enc = await encryptBytes(sharedKey, slice);
        socket.emit("file-chunk", { code: thisRoom, transferId, seq: nextSeq, ciphertext: enc.ciphertext, iv: enc.iv });
        sawIncomingChunkSinceLastSend = false;
      }
      socket.on("file-chunk-ack", ({ transferId, seq }) => {
        if (outgoingTransfer?.transferId !== transferId || seq !== outgoingTransfer.nextSeq) return;
        outgoingTransfer.nextSeq++;
        showProgress("out", outgoingTransfer.fileName, outgoingTransfer.nextSeq, outgoingTransfer.totalChunks);
        trySendNextChunk();
      });
      socket.on("file-start", async ({ transferId, metaCiphertext, metaIv, totalChunks }) => {
        if (!sharedKey) return;
        try {
          const metaJson = await decryptMessage(sharedKey, { ciphertext: metaCiphertext, iv: metaIv });
          const meta = JSON.parse(metaJson);
          incomingTransfer = { transferId, meta, chunks: [], totalChunks, receiveCount: 0 };
          showProgress("in", meta.name, 0, totalChunks);
        } catch (err) {
          console.log("failed to read incoming file metadata");
        }
      });
      socket.on("file-chunk", async ({ transferId, seq, ciphertext, iv }) => {
        if (!sharedKey || !thisRoom || incomingTransfer?.transferId !== transferId) return;
        try {
          const bytes = await decryptBytes(sharedKey, { ciphertext, iv });
          incomingTransfer.chunks[seq] = new Uint8Array(bytes);
          incomingTransfer.receiveCount++;
          showProgress("in", incomingTransfer.meta.name, incomingTransfer.receiveCount, incomingTransfer.totalChunks);
          socket.emit("file-chunk-ack", { code: thisRoom, transferId, seq });
          sawIncomingChunkSinceLastSend = true;
          trySendNextChunk();
        } catch (err) {
          console.log("failed to decrypt incoming chunk");
        }
      });
      socket.on("file-end", ({ transferId }) => {
        if (incomingTransfer?.transferId !== transferId) return;
        const totalBytes = incomingTransfer.chunks.reduce((sum, c) => sum + c.byteLength, 0);
        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of incomingTransfer.chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        renderFile("Other", incomingTransfer.meta.name, incomingTransfer.meta.type, combined.buffer);
        hideProgress("in");
        incomingTransfer = null;
      });
      function showProgress(direction, fileName, done, total) {
        const container = document.getElementById(direction === "out" ? "progressOut" : "progressIn");
        if (!container) return;
        const pct = Math.round(done / total * 100);
        container.hidden = false;
        container.innerHTML = `<progress value="${done}" max="${total}"></progress> ${direction === "out" ? "Sending" : "Receiving"} ${fileName} | ${pct}%`;
      }
      function hideProgress(direction) {
        const container = document.getElementById(direction === "out" ? "progressOut" : "progressIn");
        if (!container) return;
        container.hidden = true;
        container.innerHTML = "";
      }
      function renderFile(sender, name, type, data) {
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const wrapper = document.createElement("p");
        const label = document.createElement("span");
        label.textContent = `${sender}: `;
        wrapper.appendChild(label);
        if (type.startsWith("image/")) {
          const img = document.createElement("img");
          img.src = url;
          img.alt = name;
          img.style.maxWidth = "200px";
          img.style.display = "block";
          wrapper.appendChild(img);
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.textContent = ` ${name}`;
          link.download = name;
          wrapper.appendChild(link);
        }
        messages.appendChild(wrapper);
      }
      fileInputButton.addEventListener("click", () => fileInput.click());
      function addMessage(sender, message) {
        const element = document.createElement("p");
        element.textContent = `${sender}: ${message}`;
        messages.appendChild(element);
      }
    }
  });
  require_client();
})();
