// EN: Finds the real file type from the FIRST BYTES of the file ("magic bytes"). The file name and the
//     Content-Type sent by the browser are ignored, because the user controls both and can lie.
// Franco: Bey-3raf noo3 el file el 7a2i2i men awel bytes fel file ("magic bytes"). Esm el file w el
//     Content-Type elly el browser ba3tooh mabnesta3melhomsh, 3ashan el user hwa elly beyt7akkem feehom w momken yekdeb.
'use strict';

// EN: the three allowed types and their first bytes (docs/API_CONTRACT.md section 5.1).
// Franco: el 3 anwa3 el masmoo7a w awel bytes bta3etha.
const SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
];

// EN: returns 'application/pdf', 'image/jpeg' or 'image/png'. Returns null for anything else.
// Franco: beyrga3 el noo3 law PDF aw JPEG aw PNG. Ay 7aga tanya beyrga3 null.
function detectMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  for (const sig of SIGNATURES) {
    const matches = buffer.length >= sig.bytes.length && sig.bytes.every((byte, i) => buffer[i] === byte);
    if (matches) return sig.mime;
  }
  return null;
}

module.exports = { detectMimeType };
