# Blanch
A temporary end-to-end encrypted chat room for two people. Made with Typescript, Socket.IO and Web Crypto API. 
No accounts, message history or servers. 

## Features
## Rooms
- Create a room and get a short code to share with whoever you wanna talk to
- Join by code, link or by scanning the room's QR code
- Maximum of two people can join each room
- Room is destroyed once both people leave

## Encryption
- ECDH (P-256) key exchange. Each side derives the same key independently
- AES-GCM 256 for every message and file chunk, with a fresh IV every single time
- A safery number shown once handshake completes so you can confirm with the other person and no one is in the middle
- The server only relays the ciphertext public keys. No way to read the messages

## File Sharing
- Send files by chunking and encrypting them piece by piece
- Live progress bar for both parties
- Messaging works during file transfer
- File transfer from both ends takes turns instead of prioritizing one
- Inline preview for images, download links for everything else

## Coming soon
- Any suggestions are welcome!

(First proper project with Websockets and Typescript. There's probably a lot to fix here lol)

## Use

You can try it at [blanch.onrender.com](https://blanch.onrender.com/)
