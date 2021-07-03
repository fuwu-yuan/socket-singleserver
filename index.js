'use strict';

require('dotenv').config()

const https = require('https');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const ngrok = require('ngrok');
const express = require('express');
const cors = require('cors');
const util = require('./util');
const url = require('url');
require("./prototypes")();

const privateKey = fs.readFileSync('./certs/privkey1.pem', 'utf8');
const certificate = fs.readFileSync('./certs/cert1.pem', 'utf8');
const ca = fs.readFileSync('./certs/chain1.pem', 'utf8');

const {
    v4: uuidv4,
} = require('uuid');

const wsServers = [];

const credentials = {
    key: privateKey,
    cert: certificate,
    ca: ca
};

const app = express();

// Add headers
app.use(cors({
    'origin': '*',
    'methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
    'preflightContinue': false
}));

app.use(express.json());

let server = null;
if (process.env.SSL === 'true') {
    console.log("Creating server with SSL");
    server = https.createServer(credentials, app);
}else {
    console.log("Creating server without SSL");
    server = http.createServer(app);
}

server.on('upgrade', function upgrade(request, socket, head) {
    const pathname = url.parse(request.url).pathname;

    let uid = pathname.substr(1);
    let wsServer = findOneServerByCriteria({"uid": uid});
    if (wsServer) {
        wsServer.wss.handleUpgrade(request, socket, head, function done(ws) {
            wsServer.wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});



app.post('/api/room', (req, res) => {
    const game = req.body.game || null;
    const version = req.body.version || null;
    let name = req.body.name || null;
    let data = req.body.data || {};
    const limit = !isNaN(parseInt(req.body.limit)) ? parseInt(req.body.limit) : 0;

    if (game && version && name) {
        let wsServer = {uid: null, game: game, version: version, name: name, open: true, limit: limit, clients: [], data: data};
        console.log("[wss] Creating new WebSocketServer ", wsServer);
        if (!findOneServerByCriteria({game: game, version: version, name: name})) {
            const uid = uuidv4();
            wsServer.uid = uid;
            const wss = new WebSocket.Server({ noServer: true, path: "/"+uid });
            console.log("[wss] New WebSocketServer created: ", wss.options.path);
            wsServer.wss = wss;
            initWebSocketServer(wsServer);
            wsServers.push(wsServer);
            return res.status(200).json({status: "success", data: getPublicServerData(wsServer)});
        }else {
            console.log("[wss] WebSocketServer already exists ", wsServer);
            return res.status(200).json({status: "error", code: "name_already_exists", message: `A server with this name for the game ${name} (${version}) already exists`});
        }
    }else {
        console.log("[wss] Missing argument in request");
        return res.status(200).json({status: "error", code: "missing_parameters", message: "Missing parameters (game, version, name are required)"});
    }
});

app.post('/api/room/data/:uid', (req, res) => {
    const uid = req.params.uid;
    let body = req.body || null;

    console.log(body);

    if (body && typeof body === "object") {
        let merge = body.merge;
        let data = body.data;
        let index = findOneServerByCriteria({"uid": uid}, true);
        if (merge) {
            wsServers[index].data = wsServers[index].data.deepmerge(data);
        }else {
            let keys = Object.keys(data);
            for (const key of keys) {
                wsServers[index].data[key] = data[key];
            }
        }
        return res.status(200).json({status: "success", data: getPublicServerData(wsServers[index])});
    }else {
        return res.status(200).json({status: "error", code: "invalid_data", message: "Invalid data in body, you must post JSON data"});
    }
});

app.get('/api/room/data/:uid', (req, res) => {
    const uid = req.params.uid;

    let index = findOneServerByCriteria({"uid": uid}, true);
    let data = wsServers[index].data;
    return res.status(200).json({status: "success", data: data});
});

app.post('/api/room/close/:uid', (req, res) => {
    const uid = req.params.uid;
    let close = req.body.close === "true";

    let data = closeWebsocketServer(uid, close);
    if (data !== false) {
        return res.status(200).json({"status": "success", "data": data});
    }else {
        return res.status(200).json({"status": "error", code:"not_found", message: "No serveur found with uid " + uid});
    }
});

app.get('/api/room', (req, res) => {
    let servers = findServersByCriteria(req.query)
        .map((wsServer) => {
            wsServer.clientsCount = wsServer.wss.clients.size;
            return getPublicServerData(wsServer);
        });
    return res.status(200).json({status: "success", servers: servers});
});

function closeWebsocketServer(uid, close) {
    console.log((!close ? "Opening" : "Closing") + " serveur " + uid);
    let index = findOneServerByCriteria({"uid": uid}, true);
    if (index > -1) {
        wsServers[index].open = !close;
        return getPublicServerData(wsServers[index]);
    }else {
        return false;
    }
}

function getClientsUID(serverUID) {
    let server = findOneServerByCriteria({"uid": serverUID});
    let clientsUID = [];
    if (server) {
        for (let client of server.wss.clients) {
            clientsUID.push({uid: client.uid});
        }
    }
    return clientsUID;
}

function getPublicServerData(server) {
    let clearedServer = Object.assign({}, server);
    delete clearedServer.wss;
    return clearedServer;
}

function initWebSocketServer(wsServer) {
    wsServer.wss.on('connection', ws => {
        /* If trying to connect to a closed server, disconnecting client */
        if (wsServer.open === false) {
            ws.send(JSON.stringify({status:"error", code:"room_full", data: {room: getPublicServerData(wsServer)}}))
            ws.close();
            return;
        }

        /* Verify Server limit */
        if (wsServer.limit > 0) {
            /* If limit reached, we close server */
            if (wsServer.open && wsServer.wss.clients.size === wsServer.limit) {
                closeWebsocketServer(wsServer.uid, true);
            }
        }

        ws.uid = wsServer.wss.getUniqueID();
        console.log(`[wss] New connexion on ${wsServer.wss.options.path} (id: ${ws.uid})`);
        wsServer.clients = getClientsUID(wsServer.uid);
        console.log(JSON.stringify({status:"success", code:"connected", data: {room: getPublicServerData(wsServer), uid: ws.uid}}));
        ws.send(JSON.stringify({status:"success", code:"connected", data: {room: getPublicServerData(wsServer), uid: ws.uid}}));
        wsServer.wss.broadcast(ws, {code:"player_join"});
        ws.on('message', message => {
            console.log("[wss] New message on " + wsServer.wss.options.path + ": ", message);
            try{
                var data = JSON.parse(message);
                let cnt = wsServer.wss.broadcast(ws, {code: "broadcast", data: data});
                ws.send(JSON.stringify({code: "msg_sent", data:{msg: data, cnt: cnt}}));
            }catch(e) {
            }
        })
        ws.on('error',e=>console.log(e))
        ws.on('close',(e) => {
            console.log('Connexion closed on ' + wsServer.wss.options.path);
            /* If limit not reached and server was closed, we open it again */
            if (!wsServer.open && wsServer.wss.clients.size < wsServer.limit) {
                closeWebsocketServer(wsServer.uid, false);
            }
            wsServer.clients = getClientsUID(wsServer.uid);
            wsServer.wss.broadcast(ws, {code: "player_leave"});
            if (wsServer.wss.clients.size === 0) {
                console.log(`WebSocketServer ${wsServer.wss.options.path} has no client anymore. Closing it!`);
                wsServer.wss.close();
            }
        });
    })
        .on("close", () => {
            console.log("WebSocketServer " + wsServer.wss.options.path + " closed.");
            wsServers.splice(wsServers.indexOf(wsServer), 1);
        });
}

function findOneServerByCriteria(criteria, findIndex = false) {
    if (typeof criteria !== "object") return null;
    let fct = findIndex ? "findIndex" : "find";
    return wsServers[fct]((wsServer) => {
        let valid = true;
        for (const [key, value] of Object.entries(criteria)) {
            valid = valid && (wsServer[key] === value);
        }
        return valid;
    });
}

function findServersByCriteria(criteria) {
    if (typeof criteria !== "object") return [];

    return wsServers.filter((wsServer) => {
        let valid = true;
        for (const [key, value] of Object.entries(criteria)) {
            valid = valid && (wsServer[key].toString() === value);
        }
        return valid;
    });
}

server.listen(process.env.PORT, function listening() {
    console.log("Listening on port "+process.env.PORT);
    if (process.env.NGROK === 'true') {
        ngrok.connect({proto: 'http', addr: process.env.PORT}).then(url => {
            console.log("🔌 Ngrok connected: " + url.replace("https://", ""));
        });
    }
});
