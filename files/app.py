import os
import re
import time
import threading
import subprocess
from flask import Flask, render_template
from flask_socketio import SocketIO

app = Flask(__name__, template_folder=".", static_url_path="", static_folder=".")
app.config["SECRET_KEY"] = "lynis-brutalist-0xDEAD"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

LYNIS_REPORT = "/var/log/lynis-report.dat"
LYNIS_LOG    = "/var/log/lynis.log"

WARN_RE = re.compile(r"^warning\[]=(.+)$")
SUGG_RE = re.compile(r"^suggestion\[]=(.+)$")
HRDN_RE = re.compile(r"^hardening_index=(\d+)$")
TEST_RE = re.compile(r"^tests_performed=(\d+)$")

def _readable_path(path):
    """Return a sudoable tail command if the file needs elevated read."""
    if os.access(path, os.R_OK):
        return ["tail", "-F", "-n", "+1", path]
    return ["sudo", "tail", "-F", "-n", "+1", path]

def lynis_line_generator(path):
    cmd = _readable_path(path)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )
    try:
        for line in iter(proc.stdout.readline, ""):
            yield line.rstrip()
    finally:
        proc.terminate()

def parse_and_emit():
    """Background thread: tail Lynis report and emit events over WebSocket."""
    # Brief wait for first run / file to appear
    for _ in range(30):
        if os.path.exists(LYNIS_REPORT):
            break
        time.sleep(1)

    if not os.path.exists(LYNIS_REPORT):
        socketio.emit("error", {"msg": f"Report not found: {LYNIS_REPORT}"})
        return

    for line in lynis_line_generator(LYNIS_REPORT):
        wm = WARN_RE.match(line)
        if wm:
            socketio.emit("warning", {"text": wm.group(1)})
            continue

        sm = SUGG_RE.match(line)
        if sm:
            socketio.emit("suggestion", {"text": sm.group(1)})
            continue

        hm = HRDN_RE.match(line)
        if hm:
            socketio.emit("hardening_index", {"value": int(hm.group(1))})
            continue

        tm = TEST_RE.match(line)
        if tm:
            socketio.emit("tests_performed", {"value": int(tm.group(1))})

@app.route("/favicon.ico")
def fav():
    return "", 204

@app.route("/")
def index():
    return open("index.html").read()

@socketio.on("connect")
def on_connect():
    socketio.emit("status", {"msg": "LINK ESTABLISHED — PARSING LYNIS REPORT"})

def start_background():
    t = threading.Thread(target=parse_and_emit, daemon=True)
    t.start()

if __name__ == "__main__":
    start_background()
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
