require('dotenv').config();

// var config = require('./config');
// API_KEY = config.youtube_api_key;
API_KEY = process.env.YOUTUBE_API_KEY;
const got = require('got');
const fs = require('fs');


const WebSocket = require('ws');

const express = require("express");
const app = express();
var expressWs = require('express-ws')(app);
var wss = expressWs.getWss();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Application started and Listening on port ${PORT}`);
});


var client_html = fs.readFileSync(__dirname + "/client.html")
client_html = client_html.toString().replaceAll("{{PORT}}", PORT);

app.get("/", (req, res) => {
    res.send(client_html);
//   res.sendFile(__dirname + "/client.html");
});

app.get("/search", (req, res) => {
    const numResults = 10;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${numResults}&q=${req.query.q}&key=`+API_KEY;
    got.get(url, {responseType: 'json'})
    .then(resp => {
        const headerDate = resp.headers && resp.headers.date ? resp.headers.date : 'no response date';
        console.log('Status Code:', resp.statusCode);
        console.log('Date in Response header:', headerDate);
        res.send(resp.body);
    })
    .catch(err => {
        console.log('Error: ', err.message);
    });
});

app.get("/video", (req, res) => {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${req.query.id}&key=`+API_KEY;
    got.get(url, {responseType: 'json'})
    .then(resp => {
        const headerDate = resp.headers && resp.headers.date ? resp.headers.date : 'no response date';
        console.log('Status Code:', resp.statusCode);
        console.log('Date in Response header:', headerDate);
        res.send(resp.body);
    })
    .catch(err => {
        console.log('Error: ', err.message);
    });
});
    
// const wss = new WebSocket.Server({
//     port: 8080,
// });
var ws_to_session = new Map();
var session_to_ws = new Map();
var queues = new Map();
 
function noop() {}

function heartbeat(ws) {
  ws.isAlive = true;
}

// wss.on('connection', (ws, req) => {
app.ws('/', function(ws, req) {
    console.log("connection opened: " + req.socket.remoteAddress);

    ws.isAlive = true;
    ws.on('pong', function () {
        heartbeat(ws);
    });
    
    ws.on('open', function close() {
        console.log("connection opened");
    });    

    ws.on('close', function close() {
        closeConnection(ws);
        console.log("connection closed");
    });
    
    ws_to_session.set(ws, null);

    ws.on('message', message => {
        console.log(`Received message => ${message}`);
        msg = JSON.parse(message);
        var session_id;
        if (ws_to_session.get(ws) === null) {
            if (msg.action == "set_session") {
                updateSession(ws, msg.session_id);
            } else {
                console.log("ERROR: must set session id before messages can be received!");
            }
            return;
        }
        session_id = ws_to_session.get(ws);
        switch(msg.action) {
            case "set_session":
                updateSession(ws, msg.session_id);
                break;
            case "message":
                console.log(msg.message);
                break;
            case "request_next_video":
                broadcastNextVideo(session_id);
                break;
            case "clear_queue":
                if (queues.has(session_id)) {
                    queues.delete(session_id);
                } else {
                    console.log("WARNING: no such queue exists");
                }
                broadcastClear(session_id);
                break;
            case "pop_video":
                console.log("popping video " + msg.video_link + " from session id " + session_id);
                if (!(queues.has(session_id)) || queues.get(session_id).length < 1) {
                    console.log("WARNING: no such queue exists");
                } else if (queues.get(session_id)[0] != msg.video_link) {
                    console.log("WARNING: video " + msg.video_link + " is not at the top of the queue");
                } else {
                    console.log("Popped " + queues.get(session_id).shift() + " from queue");
                }
                broadcastPop(session_id, msg.video_link);
                break;
            case "append_video":
                console.log("appending video " + msg.video_link + " to session id " + session_id);
                if (queues.has(session_id)) {
                    queues.get(session_id).push(msg.video_link);
                } else {
                    queues.set(session_id, [msg.video_link]);
                }
                broadcastAppend(session_id, msg.video_link);
                break;
            default:
                console.log("didn't recognize msg type " + msg);
        }
    });
    var data = {"title": "Test", "message":'Hello! Message From Server!!'};
    ws.send(JSON.stringify(data));

});

function broadcastAppend(session_id, video_link) {
    console.log("broadcasting append video " + video_link + " for session id: " + session_id);
    session_to_ws.get(session_id).forEach(function each(ws) {
        if (ws.readyState === WebSocket.OPEN) {
            var data = {"action": "append_video", "video_link": video_link};
            ws.send(JSON.stringify(data));
        }
    });
}

function broadcastPop(session_id, video_link) {
    console.log("broadcasting pop video " + video_link + " for session id: " + session_id);
    session_to_ws.get(session_id).forEach(function each(ws) {
        if (ws.readyState === WebSocket.OPEN) {
            var data = {"action": "pop_video", "video_link": video_link};
            ws.send(JSON.stringify(data));
        }
    });
}

function broadcastNextVideo(session_id) {
    console.log("broadcasting request next video for session id: " + session_id);
    session_to_ws.get(session_id).forEach(function each(ws) {
        if (ws.readyState === WebSocket.OPEN) {
            var data = {"action": "request_next_video"};
            ws.send(JSON.stringify(data));
        }
    });
}


function broadcastClear(session_id) {
    console.log("broadcasting clear queue for session id: " + session_id);
    session_to_ws.get(session_id).forEach(function each(ws) {
        if (ws.readyState === WebSocket.OPEN) {
            var data = {"action": "clear_queue"};
            ws.send(JSON.stringify(data));
        }
    });
}


function updateQueues() {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            var data = {"action": "update_queues", "queues": queues};
            client.send(JSON.stringify(data));
        }
    });
}

function closeConnection(ws) {
    session_id = ws_to_session.get(ws);
    ws_to_session.delete(ws);

    if (session_to_ws.has(session_id)) {
       session_to_ws.get(session_id).delete(ws);
    } else {
        console.log("ERROR: unknown session!");
    }

}

function updateSession(ws, session_id) {
    ws_to_session.set(ws, session_id);
    console.log("Set session id for connection " + ws + " to " + ws_to_session.get(ws));
    // TODO - send existing queue to new connection, if it exists
    if (queues.has(session_id)) {
        var data = {"action": "update_queue", "queue": queues.get(session_id)};
        ws.send(JSON.stringify(data));
        console.log("Sending existing queue: " + queues.get(session_id));
    }

    if (session_to_ws.has(session_id)) {
        session_to_ws.get(session_id).add(ws);
    } else {
        session_to_ws.set(session_id, new Set([ws]));
    }
}


const interval = setInterval(function ping() {
    count = 0;
    wss.clients.forEach(function each(ws) {
        count += 1; 
        if (ws.isAlive === false) {
            console.log("closing an idle connection");
            closeConnection(ws);
            return ws.terminate();
        }
  
        ws.isAlive = false;
        ws.ping(noop);
    });

    console.log("num of clients: " + count);
    console.log("ws_to_session: " + ws_to_session.size);
    console.log("session_to_ws: " + session_to_ws.size);
    console.log("queues: ");
    queues.forEach(function(v, k) {
        console.log("   " + k + " | " + v);
    });
  }, 10000);
