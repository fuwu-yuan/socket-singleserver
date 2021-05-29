'use strict';

const merge = require('deepmerge');
const WebSocket = require('ws');
const {
    v1: uuidv1,
    v4: uuidv4,
} = require('uuid');

var e = function() {
    Object.prototype.deepmerge = function(source) {
        return merge(this, source);
    };
    WebSocket.Server.prototype.getUniqueID = function () {
        return uuidv4();
    };
    WebSocket.Server.prototype.broadcast = function(sender, data){
        let cnt = 0;
        this.clients.forEach(client => {
            if (sender.id !== client.id) {
                client.send(JSON.stringify(data));
                cnt++;
            }
        });
        return cnt;
    }
}

exports = module.exports = e;
