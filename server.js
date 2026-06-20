const WebSocket = require('ws');
const http = require('http');

const PORT = 8080;
const clients = new Map();
const pins = new Map(); // pin -> wsUrl

function genPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

let currentPin = genPin();
let currentUrl = '';

console.log(`PIN initial: ${currentPin}`);

const wss = new WebSocket.Server({ port: PORT });

function broadcast(obj, excludeId = null) {
  clients.forEach(({ ws }, id) => {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(obj));
  });
}

function broadcastState() {
  broadcast({
    type: 'SERVER_STATE',
    clients: [...clients.entries()].map(([id, c]) => ({
      id, role: c.role, info: c.info, connectedAt: c.connectedAt,
    })),
    pin: currentPin,
    url: currentUrl,
  });
}


// Keep-alive ping la fiecare 10 secunde
setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.ping();
    }
  });
}, 10000);

wss.on('connection', (ws) => {
  ws.on('pong', () => { ws.isAlive = true; });

  const id = Math.random().toString(36).slice(2) + Date.now();
  clients.set(id, { ws, role: 'reader', info: {}, connectedAt: Date.now() });
  console.log(`[+] ${id.slice(0,8)} total=${clients.size}`);

  ws.send(JSON.stringify({
    type: 'CONNECTED',
    clientId: id,
    pin: currentPin,
    url: currentUrl,
  }));
  broadcastState();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    switch (msg.type) {
      case 'REGISTER':
        const c = clients.get(id);
        if (c) { c.role = msg.role || 'reader'; c.info = msg.info || {}; }
        broadcastState();
        break;

      case 'SET_URL':
        currentUrl = msg.url || '';
        currentPin = genPin();
        console.log(`URL: ${currentUrl} | PIN: ${currentPin}`);
        broadcastState();
        break;

      case 'GET_PIN':
        ws.send(JSON.stringify({ type: 'PIN_INFO', pin: currentPin, url: currentUrl }));
        break;

      case 'NFC_TAG_READ':
        broadcast({ type: 'NFC_TAG_READ', ...msg, fromClient: id });
        break;

      case 'APDU_RELAY_REQUEST': {
        const target = clients.get(msg.targetClientId);
        if (!target) {
          ws.send(JSON.stringify({ type: 'APDU_RELAY_ERROR', requestId: msg.requestId, error: 'TARGET_NOT_FOUND' }));
          return;
        }
        const timer = setTimeout(() => {
          ws.send(JSON.stringify({ type: 'APDU_RELAY_ERROR', requestId: msg.requestId, error: 'TIMEOUT' }));
        }, 500);
        target.ws._pending = { requesterWs: ws, timer };
        target.ws.send(JSON.stringify({
          type: 'APDU_COMMAND', apdu: msg.apdu,
          requestId: msg.requestId, fromClientId: id
        }));
        break;
      }

      case 'APDU_RELAY_RESPONSE': {
        clients.forEach(({ ws: cws }) => {
          if (cws._pending) {
            clearTimeout(cws._pending.timer);
            cws._pending.requesterWs.send(JSON.stringify({
              type: 'APDU_RELAY_RESPONSE',
              requestId: msg.requestId,
              apdu: msg.apdu,
              fromClientId: id
            }));
            delete cws._pending;
          }
        });
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice': {
        // WebRTC signaling: trimite mesajul către celelalte telefoane conectate
        broadcast({
          ...msg,
          fromClientId: id
        }, id);
        break;
      }

      case 'GET_CLIENTS':
        ws.send(JSON.stringify({
          type: 'CLIENTS_LIST',
          clients: [...clients.entries()].map(([i, c]) => ({
            id: i, role: c.role, info: c.info, connectedAt: c.connectedAt
          }))
        }));
        break;

      case 'BROADCAST':
        broadcast({ type: 'BROADCAST', from: id, data: msg.data }, id);
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    console.log(`[-] ${id.slice(0,8)} total=${clients.size}`);
    broadcast({ type: 'CLIENT_DISCONNECTED', clientId: id });
    broadcastState();
  });
});

console.log(`NFC Tuneless Server pe port ${PORT}`);

// HTTP endpoint pentru URL update
const httpServer = require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url.startsWith('/seturl')) {
    const url = new URL('http://localhost' + req.url).searchParams.get('url');
    if (url) {
      currentUrl = url;
      currentPin = genPin();
      console.log(`\n🔗 URL: ${url}\n🔑 PIN: ${currentPin}\n`);
      broadcastState();
    }
    res.end('OK');
  } else if (req.url === '/pin') {
    res.end(JSON.stringify({ pin: currentPin, url: currentUrl }));
  } else {
    res.end('NFC Tuneless Server');
  }
});
httpServer.listen(8081, () => console.log('HTTP pe port 8081'));
