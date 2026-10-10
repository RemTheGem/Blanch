const CURVE = 'P-256';


// make sure web crypto API and socket.io can talk
// one uses raw binary, other only text

function toBase64(buf){
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64){
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

// make an Elliptic Curve Diffie-Hellman keypair
// make sure the ECDH keys are used for getting to our actual key
// and not encryption

export async function generateKeyPair(){
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE},
    true,
    ['deriveKey']
  );
}

// export the public key as base64

export async function exportPublicKey(keyPair) {
  const raw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return toBase64(raw);
}

// derived the shared key used for the actual encryption

export async function deriveSharedKey(peerPublicKey, myKeyPair){
  const peerKey = await crypto.subtle.importKey(
    'raw',
    fromBase64(peerPublicKey),
    {name: 'ECDH', namedCurve: CURVE},
    false,
    []
  );
  return crypto.subtle.deriveKey(
    {name: 'ECDH', public: peerKey},
    myKeyPair.privateKey,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt', decrypt]
  );
}

// uses AES-GCM to ensure nothing is tampered
// encode from bytes to base64
// fresh iv every messsage cuz security

export async function encryptMessage(sharedKey, plaintext){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, sharedKey, encoded);
  return {ciphertext: toBase64(ciphertext), iv: toBase64(iv)};
}

// decode back from base64 to bytes
// decrypt message and turn it into string

export async function decryptMessage(sharedKey, {ciphertext, iv}) {
  const plainBuf = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: fromBase64(iv)},
    sharedKey,
    fromBase64(ciphertext)
  );
  return new TextDecoder().decode(plainBuf);
}

// avoid Man in the middle attack by hashing both public keys  
// into a short string

export async function computeFingerprint(myPublicKey, peerPublicKey){
  const [a, b] = [myPublicKey, peerPublicKey].sort();
  const data = new TextEncoder().encode(a+b);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hashBuf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 12).match(/.{1,4}/g).join('');
}