// EN: Reads ONE uploaded file from a multipart/form-data request into memory (max 5 MB) using "multer".
//     Anything too big, or not shaped like our form, is turned into our normal error format.
// Franco: Bey2ra file wa7ed men request multipart/form-data fel memory (5 MB bel kteer) b maktabet "multer".
//     Ay 7aga akbar men el masmoo7 aw shakla mesh zay el form bta3etna betetgheyyar le format el errors el 3adi.
'use strict';
const { badRequest, payloadTooLarge } = require('../../common/errors');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // EN: 5 MB, same as the database CHECK / Franco: 5 MB zay el CHECK fel database

// EN: multer error -> our HTTP error. LIMIT_FILE_SIZE is the "too big" case -> 413.
// Franco: error men multer -> error HTTP bta3na. LIMIT_FILE_SIZE ya3ni el file kebeer -> 413.
function mapUploadError(err) {
  switch (err && err.code) {
    case 'LIMIT_FILE_SIZE': return payloadTooLarge('The file is larger than 5 MB');
    case 'LIMIT_UNEXPECTED_FILE': return badRequest('Send the file in one field named "file"');
    case 'LIMIT_FILE_COUNT': return badRequest('Send exactly one file');
    case 'LIMIT_FIELD_VALUE':
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_PART_COUNT': return badRequest('A form field is too long or there are too many fields');
    default:
      if ((err && err.name === 'MulterError') || /multipart|boundary|unexpected end of form/i.test((err && err.message) || '')) {
        return badRequest('The upload is not valid multipart/form-data');
      }
      return err;
  }
}

// EN: Express middleware. multer is loaded on first use, so /health works even without it.
//     After it runs: req.file = { buffer, size, ... } and req.body = the text fields.
//     We never use req.file.originalname (the user's file name): the S3 key is random.
// Franco: Middleware bta3 Express. multer betetsa7ab awel ma nesta3melha, f /health beyeshtaghal men gheirha.
//     Ba3d ma beyeshtaghal: req.file = { buffer, size, ... } w req.body = el fields el nasseya.
//     3omrena ma nesta3mel req.file.originalname (esm el file bta3 el user): el S3 key 3ashwa2i.
function singleFileUpload() {
  let handler = null;
  return function receiveFile(req, res, next) {
    if (!handler) {
      const multer = require('multer');
      handler = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 2048, parts: 12 },
      }).single('file');
    }
    handler(req, res, (err) => (err ? next(mapUploadError(err)) : next()));
  };
}

module.exports = { singleFileUpload, mapUploadError, MAX_FILE_BYTES };
