import os
import json
import time
import sqlite3
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "strokes.db")
DEFAULT_SESSION = "public"

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SECRET_KEY"] = "replace-with-a-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS strokes (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        ts REAL,
        event_type TEXT,
        payload TEXT
    )
    """)
    conn.commit()
    conn.close()

def save_event(session_id, event_type, payload):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO strokes (session_id, ts, event_type, payload) VALUES (?, ?, ?, ?)",
        (session_id, time.time(), event_type, json.dumps(payload))
    )
    conn.commit()
    conn.close()

def load_session_events(session_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT ts, event_type, payload FROM strokes WHERE session_id = ? ORDER BY ts ASC",
        (session_id,)
    )
    rows = c.fetchall()
    conn.close()
    events = []
    for ts, et, payload in rows:
        events.append({"ts": ts, "event": et, "payload": json.loads(payload)})
    return events

@app.route("/")
def index():
    session = request.args.get("session", DEFAULT_SESSION)
    return render_template("index.html", session_id=session)

@app.route("/api/replay/<session_id>")
def api_replay(session_id):
    events = load_session_events(session_id)
    return jsonify({"session_id": session_id, "events": events})


@socketio.on("join")
def on_join(data):
    session_id = data.get("session_id", DEFAULT_SESSION)
    username = data.get("username", "Anon")
    join_room(session_id)
    emit("user_joined", {"username": username}, room=session_id)
    # send summary
    events = load_session_events(session_id)
    emit("session_info", {"session_id": session_id, "event_count": len(events)})

@socketio.on("leave")
def on_leave(data):
    session_id = data.get("session_id", DEFAULT_SESSION)
    username = data.get("username", "Anon")
    leave_room(session_id)
    emit("user_left", {"username": username}, room=session_id)

@socketio.on("stroke")
def on_stroke(data):
    session_id = data.get("session_id", DEFAULT_SESSION)
    stroke = data.get("stroke")
    if session_id and stroke:
        save_event(session_id, "stroke", stroke)

        emit("stroke", {"stroke": stroke}, room=session_id, include_self=False)

@socketio.on("clear")
def on_clear(data):
    session_id = data.get("session_id", DEFAULT_SESSION)
    payload = {"by": data.get("username", "Anon")}
    save_event(session_id, "clear", payload)
    emit("clear", payload, room=session_id)

@socketio.on("chat")
def on_chat(data):
    session_id = data.get("session_id", DEFAULT_SESSION)
    payload = {
        "username": data.get("username", "Anon"),
        "message": data.get("message"),
        "ts": time.time()
    }
    save_event(session_id, "chat", payload)
    emit("chat", payload, room=session_id)

@socketio.on("undo")
def on_undo(data):
    session_id = data.get("session_id", DEFAULT_SESSION)
    payload = {"by": data.get("username", "Anon")}
    save_event(session_id, "undo", payload)
    emit("undo", payload, room=session_id)

if __name__ == "__main__":
    init_db()
    print("Starting LiveBoard on http://127.0.0.1:5000")
    socketio.run(app, host="0.0.0.0", port=5000)


