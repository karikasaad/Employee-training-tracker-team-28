// EN: Stores certificate files in the PRIVATE S3 bucket (Floci locally, real S3 on AWS). The AWS library
//     is loaded on first use, so /health and the unit tests work without it. Credentials and the endpoint
//     come from the environment, never from the code. File contents are never logged.
// Franco: Beyekhazzen el files fel S3 bucket el PRIVATE (Floci local, S3 7a2i2i 3ala AWS). Maktabet AWS
//     betetsa7ab awel ma nesta3melha, f /health w el unit tests beyeshtaghalo men gheirha. El credentials
//     w el endpoint men el environment, 3omrohom ma yekoono fel code. Mo7tawa el file 3omro ma yet-log.
'use strict';

function createStorage({ client = null, bucket = process.env.CERTIFICATES_BUCKET || 'certificates' } = {}) {
  let s3 = client;
  function getClient() {
    if (!s3) {
      const { S3Client } = require('@aws-sdk/client-s3');
      s3 = new S3Client({
        region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
        // EN: AWS_ENDPOINT_URL points to Floci locally; unset = real AWS. Path style is needed for Floci.
        // Franco: AWS_ENDPOINT_URL beyshawer 3ala Floci local; mesh mawgood = AWS 7a2i2i. Path style le Floci.
        endpoint: process.env.AWS_ENDPOINT_URL || undefined,
        forcePathStyle: true,
      });
    }
    return s3;
  }

  async function put(key, body, contentType) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  }

  // EN: the client for download links. It signs with the PUBLIC address (S3_PUBLIC_ENDPOINT), because the
  //     browser must open the link and cannot reach the Docker name "floci". Signing is offline: no call is made.
  // Franco: client el links bta3et el download. Beyewa22a3 bel 3enwan el PUBLIC (S3_PUBLIC_ENDPOINT) 3ashan el
  //     browser lazem yeftah el link w mayeqdarsh yewsal le esm Docker "floci". El tawqee3 offline: mafeesh call.
  let signer = client;
  function getSigner() {
    if (!signer) {
      const { S3Client } = require('@aws-sdk/client-s3');
      signer = new S3Client({
        region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
        endpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.AWS_ENDPOINT_URL || undefined,
        forcePathStyle: true,
      });
    }
    return signer;
  }

  // EN: a pre-signed GET link that works for `expiresIn` seconds and forces a DOWNLOAD (Content-Disposition:
  //     attachment), so the browser never opens or runs the file. The bucket itself stays private.
  // Franco: link GET m3a tawqee3 beyeshtaghal le `expiresIn` sanya w beygbor el DOWNLOAD (Content-Disposition:
  //     attachment), f el browser 3omro ma yeftah aw yshaghal el file. El bucket nafso beyefdal private.
  async function presignedDownloadUrl(key, { fileName, mimeType, expiresIn }) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName}"`,
      ResponseContentType: mimeType,
    });
    return getSignedUrl(getSigner(), command, { expiresIn });
  }

  async function remove(key) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  return { put, remove, presignedDownloadUrl, bucket };
}

module.exports = { createStorage };
