// EN: starts the HTTP server. Port comes from the environment (PORT), default 5002.
// Franco: bey-ebda2 el server. El port gai men el environment (PORT), w el default 5002.
const { createApp } = require('./app');

const port = Number(process.env.PORT || 5002);
createApp().listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', service: 'certificate-compliance', port }));
});
