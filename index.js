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
require("./prototypes")();

const privateKey = fs.readFileSync('./certs/privkey1.pem', 'utf8');
const certificate = fs.readFileSync('./certs/cert1.pem', 'utf8');
const ca = fs.readFileSync('./certs/chain1.pem', 'utf8');

const {
    v1: uuidv1,
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


app.post('/api/room', (req, res) => {
    const game = req.body.game || null;
    const version = req.body.version || null;
    let name = req.body.name || null;

    if (game && version && name) {
        let wsObj = {uid: null, game: game, version: version, name: name, open: "true", data: {}};
        console.log("[wss] Creating new WebSocketServer ", wsObj);
        if (!findOneServerByCriteria({game: game, version: version, name: name})) {
            const uid = uuidv1();
            wsObj.uid = uid;
            const wss = new WebSocket.Server({ server: server, path: "/"+uid });
            console.log("[wss] New WebSocketServer created: ", wss.options.path);
            initWebSocketServer(wss);

            wsObj.wss = wss;
            wsServers.push(wsObj);
            return res.status(200).json({status: "success", data: getPublicServerData(wsObj)});
        }else {
            console.log("[wss] WebSocketServer already exists ", wsObj);
            return res.status(200).json({status: "error", code: "name_already_exists", message: `A server with this name for the game ${name} (${version}) already exists`});
        }
    }else {
        console.log("[wss] Missing argument in request");
        return res.status(200).json({status: "error", code: "missing_parameters", message: "Missing parameters (game, version, name are required)"});
    }
});

app.post('/api/room/data/:uid', (req, res) => {
    const uid = req.params.uid;
    let data = req.body || null;

    if (util.isJson(data)) {
        data = JSON.parse(data);
        console.log("Adding data to " + uid + " : ", data);
        let index = findOneServerByCriteria({"uid": uid}, true);
        wsServers[index].data.deepmerge(data);
        return res.status(200).json({status: "success", data: getPublicServerData(wsServers[index])});
    }else {
        return res.status(200).json({status: "error", code: "invalid_data", message: "Invalid data in body, you must post JSON data"});
    }
});

app.post('/api/room/close/:uid', (req, res) => {
    const uid = req.params.uid;
    let close = req.body.close || null;

    if (close !== null) {
        console.log(!close ? "Opening" : "Closing" + " serveur " + uid);
        let index = findOneServerByCriteria({"uid": uid}, true);
        if (index >= -1) {
            wsServers[index].open = !close ? "true" : "false";
            return res.status(200).json({"status": "success", "data": getPublicServerData(wsServers[index])});
        }else {
            return res.status(200).json({"status": "error", code:"not_found", "message": "No serveur found with uid " + uid});
        }
    }else {
        return res.status(200).json({status: "error", code: "invalid_data", message: "Invalid data in body, you must post JSON data"});
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

function getPublicServerData(server) {
    delete server.wss;
    return server;
}

function initWebSocketServer(wss) {
    wss.on('connection', ws => {
        ws.id = wss.getUniqueID();
        console.log(`[wss] New connexion on ${wss.options.path} (id: ${ws.id})`);
        ws.send(JSON.stringify({status:"success", code:"connected"}));
        wss.broadcast(ws, {code:"player_join"});
        ws.on('message', message => {
            console.log("[wss] New message on " + wss.options.path + ": ", message);
            try{
                var data = JSON.parse(message);
                let cnt = wss.broadcast(ws, data);
                ws.send(JSON.stringify({status:"success", code: "msg_sent", data:{msg: data.msg, cnt: cnt}}));
            }catch(e) {
            }
        })
        ws.on('error',e=>console.log(e))
        ws.on('close',(e) => {
            console.log('Connexion closed on ' + wss.options.path);
            if (wss.clients.size === 0) {
                console.log(`WebSocketServer ${wss.options.path} has no client anymore. Closing it!`);
                wss.close();
            }
        });
    })
    .on("close", () => {
        console.log("WebSocketServer " + wss.options.path + " closed.");
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
            valid = valid && (wsServer[key] === value);
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
