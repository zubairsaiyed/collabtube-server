const fs = require('fs');
const got = require('got');
const WebSocket = require('ws');
const express = require("express");
const app = express();
var expressWs = require('express-ws')(app);
var wss = expressWs.getWss();

const API_KEY = process.env.YOUTUBE_API_KEY;
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Application started and Listening on port ${PORT}`);
});

function render_client_html(session_id) {
    var client_html = fs.readFileSync(__dirname + "/client.html")
    client_html = client_html.toString();
    client_html = client_html.replace(/\{\{session_id\}\}/g, session_id);
    return  client_html;
}

app.get("/", (req, res) => {
    res.redirect("/s/global")
});

app.get("/s/:sessionId", (req, res) => {
    res.send(render_client_html(req.params.sessionId));
});

app.get("/build/qrcode.min.js", (req, res) => {
    res.sendFile(__dirname + "/node_modules/qrcode/build/qrcode.min.js");
});

app.get("/favicon.png", (req, res) => {
    res.sendFile(__dirname + "/favicon.png");
});

app.get("/search", (req, res) => {
    const numResults = 10;
    const url = `https://www.googleapis.com/youtube/v3/search?type=video&part=snippet&maxResults=${numResults}&q=${req.query.q}&key=`+API_KEY;
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
    
var ws_to_session = new Map();
var session_to_ws = new Map();
var queues = new Map();
 
function noop() {}

function heartbeat(ws) {
  ws.isAlive = true;
}

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
                var data = {"action": "request_next_video"};
                broadcast(session_id, data);
                break;
            case "update_queue":
                if (!queues.has(session_id)) {
                    console.log("WARNING: no such queue exists");
                }
                queues.set(session_id, msg.queue);
                var data = {"action": "update_queue", "queue": msg.queue};
                broadcast(session_id, data, skipWs=ws);
                break;
            case "clear_queue":
                if (queues.has(session_id)) {
                    queues.delete(session_id);
                } else {
                    console.log("WARNING: no such queue exists");
                }
                var data = {"action": "clear_queue"};
                broadcast(session_id, data);
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
                var data = {"action": "pop_video", "video_link": msg.video_link};
                broadcast(session_id, data);
                break;
            case "append_video":
                if (msg.video_link === null || msg.video_link === undefined || msg.video_link.length === 0) {
                    console.log("invalid video link!");
                    break;
                }
                console.log("appending video " + msg.video_link + " to session id " + session_id);
                if (queues.has(session_id)) {
                    queues.get(session_id).push(msg.video_link);
                } else {
                    queues.set(session_id, [msg.video_link]);
                }
                var data = {"action": "append_video", "video_link": msg.video_link};
                broadcast(session_id, data);
                break;
            default:
                console.log("didn't recognize msg type " + msg);
        }
    });
    var data = {"title": "Test", "message":'Hello! Message From Server!!'};
    ws.send(JSON.stringify(data));

});


function broadcast(session_id, data, skipWs=null) {
    console.log(`broadcasting ${data['action']} for session id: ${session_id}: ${data}`);
    session_to_ws.get(session_id).forEach(function each(ws) {
        if (skipWs !== null && ws === skipWs) {
            return false;
        }
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
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
        console.log("Sending existing queue: " + queues.get(session_id));
        var data = {"action": "update_queue", "queue": queues.get(session_id)};
    } else {
        console.log("No existing queue, sending empty list");
        var data = {"action": "update_queue", "queue": []};
    }
    ws.send(JSON.stringify(data));

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
    if (queues.length > 0) {
        var empty_sessions = [];
        console.log("queues: ");
        queues.forEach(function(video_queue, session_id) {
            if (video_queue.length === 0) {
                empty_sessions.push(session_id);
            }
            console.log("   " + session_id + " | " + video_queue);
        });
        if (empty_sessions.length > 0) {
            console.log("removing empty sessions: " + empty_sessions);
            empty_sessions.forEach(queues.delete);
        }
    }
  }, 10000);
