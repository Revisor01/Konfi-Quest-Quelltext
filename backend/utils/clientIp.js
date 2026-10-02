// Echte Client-Adresse fuer die Rate-Limiter.
//
// WARUM NICHT EINFACH DEN HEADER: Ein
// Header ist Nutzereingabe. Wer das Backend erreicht, ohne durch den eigenen
// Proxy zu gehen, setzt X-Real-IP selbst -- mit jeder Anfrage eine andere
// Adresse -- und kein Limiter greift mehr. Der Header wird deshalb nur noch
// angenommen, wenn die Anfrage nachweislich vom Proxy kommt: Der direkte
// Gegenueber (req.socket.remoteAddress) muss im Docker-Netz liegen.
const net = require('net');
const proxyaddr = require('proxy-addr');

const vertrauterProxy = proxyaddr.compile(['loopback', 'linklocal', 'uniquelocal']);

const ohneMapping = (adresse) => {
  const m = /^::ffff:(.+)$/i.exec(adresse);
  return m && net.isIPv4(m[1]) ? m[1] : adresse;
};

const clientIp = (req) => {
  const header = req.headers && req.headers['x-real-ip'];
  const peer = req.socket && req.socket.remoteAddress;
  if (!peer) return req.ip;
  if (!vertrauterProxy(peer, 0)) return ohneMapping(peer);
  if (typeof header === 'string') {
    const kandidat = header.trim();
    if (net.isIP(kandidat) !== 0) return kandidat;
  }
  return req.ip;
};

module.exports = { clientIp };
