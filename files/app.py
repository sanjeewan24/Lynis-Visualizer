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

audit_history = []
audit_log = []   # flat list for sync, mirrors audit_history
last_audit_summary = {"warnings": 0, "suggestions": 0}
current_audit_summary = {"warnings": 0, "suggestions": 0}
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

def parse_and_emit(wait=True):
    """Background thread: tail Lynis report and emit events over WebSocket."""
    if wait:
        for _ in range(30):
            if os.path.exists(LYNIS_REPORT):
                break
            time.sleep(1)

    if not os.path.exists(LYNIS_REPORT):
        socketio.emit("error", {"msg": f"Report not found: {LYNIS_REPORT}"})
        return

    if not os.path.exists(LYNIS_REPORT):
        socketio.emit("error", {"msg": f"Report not found: {LYNIS_REPORT}"})
        return

    for line in lynis_line_generator(LYNIS_REPORT):
        wm = WARN_RE.match(line)
        if wm:
            current_audit_summary["warnings"] += 1
            evt = {"type": "warning", "text": wm.group(1)}
            audit_history.append(evt)
            audit_log.append(evt)
            socketio.emit("warning", {
                "text": wm.group(1),
                "delta": current_audit_summary["warnings"] - last_audit_summary["warnings"]
            })
            continue

        sm = SUGG_RE.match(line)
        if sm:
            current_audit_summary["suggestions"] += 1
            evt = {"type": "suggestion", "text": sm.group(1)}
            audit_history.append(evt)
            audit_log.append(evt)
            socketio.emit("suggestion", {
                "text": sm.group(1),
                "delta": current_audit_summary["suggestions"] - last_audit_summary["suggestions"]
            })
            continue

        hm = HRDN_RE.match(line)
        if hm:
            evt = {"type": "hardening_index", "value": int(hm.group(1))}
            audit_history.append(evt)
            socketio.emit("hardening_index", {"value": int(hm.group(1))})
            continue

        tm = TEST_RE.match(line)
        if tm:
            evt = {"type": "tests_performed", "value": int(tm.group(1))}
            audit_history.append(evt)
            socketio.emit("tests_performed", {"value": int(tm.group(1))})

@app.route("/favicon.ico")
def fav():
    return "", 204

@app.route("/api/export")
def export_csv():
    import io, csv as csv_mod
    from flask import Response
    buf = io.StringIO()
    writer = csv_mod.writer(buf)
    writer.writerow(["type", "text"])
    for evt in audit_log:
        if evt.get("type") in ("warning", "suggestion"):
            writer.writerow([evt["type"], evt.get("text", "")])
    buf.seek(0)
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=lynis_audit.csv"}
    )

@app.route("/")
def index():
    return open("index.html").read()

@socketio.on("connect")
def on_connect():
    socketio.emit("status", {"msg": "LINK ESTABLISHED — PARSING LYNIS REPORT"})

@socketio.on("request_history")
def handle_request_history():
    socketio.emit("history_dump", {"events": audit_history})

@socketio.on("sync")
def handle_sync():
    socketio.emit("sync_dump", {"events": audit_log})

audit_lock = threading.Lock()

@socketio.on("start_audit")
def handle_start_audit():
    def run():
        if not audit_lock.acquire(blocking=False):
            socketio.emit("audit_status", {"state": "busy", "msg": "AUDIT ALREADY RUNNING"})
            return
        try:
            socketio.emit("audit_status", {"state": "running", "msg": "INITIALIZING LYNIS..."})
            proc = subprocess.Popen(
                ["sudo", "lynis", "audit", "system", "--no-colors"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                line = line.strip()
                if line:
                    socketio.emit("audit_progress", {"line": line})
            proc.wait()
            socketio.emit("audit_status", {"state": "done", "msg": "AUDIT COMPLETE — PARSING REPORT"})
            # Re-trigger report parsing after audit finishes
            threading.Thread(target=parse_and_emit, daemon=True).start()
        except Exception as e:
            socketio.emit("audit_status", {"state": "error", "msg": str(e)})
        finally:
            # Promote current to last on completion
            last_audit_summary["warnings"]     = current_audit_summary["warnings"]
            last_audit_summary["suggestions"]  = current_audit_summary["suggestions"]
            current_audit_summary["warnings"]  = 0
            current_audit_summary["suggestions"] = 0
            audit_lock.release()

    threading.Thread(target=run, daemon=True).start()

def start_background():
    t = threading.Thread(target=parse_and_emit, daemon=True)
    t.start()

if __name__ == "__main__":
    start_background()
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
