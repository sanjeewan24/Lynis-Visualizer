import os
import re
import time
import threading
import subprocess
import csv as csv_mod
import io
from flask import Flask, Response
from flask_socketio import SocketIO

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, template_folder=BASE_DIR, static_url_path="", static_folder=BASE_DIR)
app.config["SECRET_KEY"] = "lynis-brutalist-0xDEAD"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

LYNIS_REPORT = "/var/log/lynis-report.dat"

# ── Session state ──────────────────────────────────────────
audit_log       = []
_seen           = set()
last_summary    = {"warnings": 0, "suggestions": 0}
current_summary = {"warnings": 0, "suggestions": 0}
audit_lock      = threading.Lock()

# ── .dat regex ─────────────────────────────────────────────
RE_WARN    = re.compile(r"^warning\[]=([^|]+)\|?([^|]*)\|?([^|]*)\|?(.*)$")
RE_SUGG    = re.compile(r"^suggestion\[]=([^|]+)\|?([^|]*)\|?(.*)$")
RE_HARDEN  = re.compile(r"^hardening_index=(\d+)$")
RE_TESTS   = re.compile(r"^tests_performed=(\d+)$")
RE_VULN    = re.compile(r"^vulnerable_package\[]=(.+)$")
RE_UNSAFE  = re.compile(r"^(?:systemd_service_unsafe|unsafe_service)\[]=(.+)$")
RE_EXPOSE  = re.compile(r"^(?:systemd_service_exposed|exposed_service)\[]=(.+)$")
RE_FIREWALL= re.compile(r"^firewall_active=(.+)$")
RE_MALWARE = re.compile(r"^malware_scanner=(.+)$")
RE_OS      = re.compile(r"^os=(.+)$")
RE_OS_VER  = re.compile(r"^os_version=(.+)$")
RE_KERNEL  = re.compile(r"^os_kernel_version_full=(.+)$")
RE_HOST    = re.compile(r"^hostname=(.+)$")

# ── stdout regex ───────────────────────────────────────────
RE_STDOUT_WARN    = re.compile(r"\[WARNING\]:\s*(.+)", re.IGNORECASE)
RE_STDOUT_SECTION = re.compile(r"^\[\+\]\s+(.+)$")
RE_STDOUT_CHECK   = re.compile(r"-\s+(.+?)\s{2,}\[\s*([A-Z][A-Z\s/]+?)\s*\]")

STDOUT_SEVERITY = {
    "WARNING":            "warning",
    "DISABLED":           "status_disabled",
    "NOT ENCRYPTED":      "status_disabled",
    "NOT INSTALLED":      "status_missing",
    "NONE":               "status_disabled",
    "UNSAFE":             "unsafe_service",
    "EXPOSED":            "exposed_service",
    "MEDIUM":             "status_medium",
    "PROTECTED":          "status_ok",
    "HARDENED":           "status_ok",
    "PARTIALLY HARDENED": "status_medium",
    "OK":                 "status_ok",
    "DONE":               "status_ok",
    "FOUND":              "status_ok",
    "ENABLED":            "status_ok",
    "INSTALLED":          "status_ok",
    "ACTIVE":             "status_ok",
    "NO UPDATE":          "status_ok",
    "NOT FOUND":          "status_missing",
    "WEAK":               "warning",
    "DIFFERENT":          "status_medium",
    "UNKNOWN":            "status_info",
    "DEFAULT":            "status_info",
    "SKIPPED":            "status_info",
}


def _emit(key, evt, event_name, payload):
    if key in _seen:
        return
    _seen.add(key)
    audit_log.append(evt)
    socketio.emit(event_name, payload)


def parse_dat_line(line):
    line = line.strip()
    if not line or line.startswith("#"):
        return

    m = RE_WARN.match(line)
    if m:
        test_id = m.group(1).strip()
        details = (m.group(3) or m.group(2) or "").strip()
        text    = f"[{test_id}] {details}" if details else test_id
        current_summary["warnings"] += 1
        delta = current_summary["warnings"] - last_summary["warnings"]
        _emit(f"dw:{line}", {"type": "warning", "text": text, "test_id": test_id},
              "warning", {"text": text, "delta": delta})
        return

    m = RE_SUGG.match(line)
    if m:
        test_id = m.group(1).strip()
        details = m.group(2).strip() or ""
        text    = f"[{test_id}] {details}" if details else test_id
        current_summary["suggestions"] += 1
        delta = current_summary["suggestions"] - last_summary["suggestions"]
        _emit(f"ds:{line}", {"type": "suggestion", "text": text, "test_id": test_id},
              "suggestion", {"text": text, "delta": delta})
        return

    m = RE_VULN.match(line)
    if m:
        text = f"Vulnerable package: {m.group(1).strip()}"
        _emit(f"dv:{line}", {"type": "vulnerability", "text": text},
              "vulnerability", {"text": text})
        return

    m = RE_UNSAFE.match(line)
    if m:
        text = f"Unsafe service: {m.group(1).strip()}"
        _emit(f"du:{line}", {"type": "unsafe_service", "text": text},
              "unsafe_service", {"text": text})
        return

    m = RE_EXPOSE.match(line)
    if m:
        text = f"Exposed service: {m.group(1).strip()}"
        _emit(f"de:{line}", {"type": "exposed_service", "text": text},
              "exposed_service", {"text": text})
        return

    m = RE_HARDEN.match(line)
    if m:
        val = int(m.group(1))
        key = f"dhi:{val}"
        if key not in _seen:
            _seen.add(key)
            audit_log.append({"type": "hardening_index", "value": val})
        socketio.emit("hardening_index", {"value": val})
        return

    m = RE_TESTS.match(line)
    if m:
        val = int(m.group(1))
        key = f"dtp:{val}"
        if key not in _seen:
            _seen.add(key)
            audit_log.append({"type": "tests_performed", "value": val})
        socketio.emit("tests_performed", {"value": val})
        return

    m = RE_FIREWALL.match(line)
    if m:
        _emit(f"dfw:{line}", {"type": "info", "text": f"Firewall active: {m.group(1).strip()}",
                              "category": "firewall"},
              "info_event", {"text": f"Firewall: {m.group(1).strip()}", "category": "firewall"})
        return

    m = RE_MALWARE.match(line)
    if m:
        _emit(f"dml:{line}", {"type": "info", "text": f"Malware scanner: {m.group(1).strip()}",
                              "category": "malware"},
              "info_event", {"text": f"Malware scanner: {m.group(1).strip()}", "category": "malware"})
        return

    m = RE_OS.match(line)
    if m:
        socketio.emit("system_info", {"key": "os", "value": m.group(1).strip()})
        return
    m = RE_OS_VER.match(line)
    if m:
        socketio.emit("system_info", {"key": "os_version", "value": m.group(1).strip()})
        return
    m = RE_KERNEL.match(line)
    if m:
        socketio.emit("system_info", {"key": "kernel", "value": m.group(1).strip()})
        return
    m = RE_HOST.match(line)
    if m:
        socketio.emit("system_info", {"key": "hostname", "value": m.group(1).strip()})
        return


def parse_stdout_line(line):
    stripped = line.strip()
    if not stripped:
        return

    m = RE_STDOUT_WARN.search(stripped)
    if m:
        text = m.group(1).strip()
        current_summary["warnings"] += 1
        delta = current_summary["warnings"] - last_summary["warnings"]
        _emit(f"sw:{text}", {"type": "warning", "text": f"[WARN] {text}"},
              "warning", {"text": f"[WARN] {text}", "delta": delta})
        return

    m = RE_STDOUT_SECTION.match(stripped)
    if m:
        socketio.emit("audit_section", {"section": m.group(1).strip()})
        return

    m = RE_STDOUT_CHECK.search(stripped)
    if m:
        label  = m.group(1).strip().rstrip("-").strip()
        status = m.group(2).strip().upper()
        category = STDOUT_SEVERITY.get(status, "status_info")
        text   = f"{label}: {status}"
        key    = f"sc:{text}"

        if category == "warning":
            current_summary["warnings"] += 1
            delta = current_summary["warnings"] - last_summary["warnings"]
            _emit(key, {"type": "warning", "text": text},
                  "warning", {"text": text, "delta": delta})
        elif category == "unsafe_service":
            _emit(key, {"type": "unsafe_service", "text": text},
                  "unsafe_service", {"text": text})
        elif category == "exposed_service":
            _emit(key, {"type": "exposed_service", "text": text},
                  "exposed_service", {"text": text})
        elif category in ("status_disabled", "status_missing"):
            _emit(key, {"type": "status_disabled", "text": text},
                  "status_disabled", {"text": text})
        elif category == "status_medium":
            _emit(key, {"type": "status_medium", "text": text},
                  "status_medium", {"text": text})
        else:
            _emit(key, {"type": "status_ok", "text": text, "status": status},
                  "status_check", {"text": text, "status": status, "category": category})


def parse_and_emit(wait=True):
    if wait:
        for _ in range(60):
            if os.path.exists(LYNIS_REPORT):
                break
            time.sleep(1)

    if not os.path.exists(LYNIS_REPORT):
        socketio.emit("error", {"msg": f"Report not found: {LYNIS_REPORT}"})
        return

    try:
        cmd = (["cat", LYNIS_REPORT] if os.access(LYNIS_REPORT, os.R_OK)
               else ["sudo", "cat", LYNIS_REPORT])
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, bufsize=1)
        for line in iter(proc.stdout.readline, ""):
            parse_dat_line(line.rstrip())
        proc.wait()
    except Exception as ex:
        socketio.emit("error", {"msg": f"DAT parse error: {ex}"})


# ── Routes ─────────────────────────────────────────────────
@app.route("/")
def index():
    return open(os.path.join(BASE_DIR, "index.html"), encoding="utf-8").read()

@app.route("/favicon.ico")
def fav():
    return "", 204

@app.route("/api/export")
def export_csv():
    buf = io.StringIO()
    writer = csv_mod.writer(buf)
    writer.writerow(["type", "text", "test_id"])
    for evt in audit_log:
        if evt.get("type") in ("warning", "suggestion", "vulnerability",
                               "unsafe_service", "exposed_service", "status_disabled"):
            writer.writerow([evt.get("type", ""), evt.get("text", ""), evt.get("test_id", "")])
    buf.seek(0)
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=lynis_audit.csv"})


# ── Socket handlers ────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    socketio.emit("status", {"msg": "LINK ESTABLISHED"})

@socketio.on("sync")
def handle_sync():
    socketio.emit("sync_dump", {"events": audit_log})

@socketio.on("request_history")
def handle_history():
    socketio.emit("history_dump", {"events": audit_log})

@socketio.on("start_audit")
def handle_start_audit():
    def run():
        global audit_log, _seen, current_summary

        if not audit_lock.acquire(blocking=False):
            socketio.emit("audit_status", {"state": "busy", "msg": "AUDIT ALREADY RUNNING"})
            return
        try:
            audit_log = []
            _seen = set()
            current_summary["warnings"]    = 0
            current_summary["suggestions"] = 0
            socketio.emit("session_reset", {})
            socketio.emit("audit_status", {"state": "running", "msg": "STARTING LYNIS AUDIT..."})

            proc = subprocess.Popen(
                ["sudo", "lynis", "audit", "system", "--no-colors"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                line = line.rstrip()
                if line:
                    socketio.emit("audit_progress", {"line": line})
                    parse_stdout_line(line)
            proc.wait()

            last_summary["warnings"]    = current_summary["warnings"]
            last_summary["suggestions"] = current_summary["suggestions"]

            socketio.emit("audit_status", {"state": "done", "msg": "PARSING REPORT FILE..."})
            time.sleep(1)
            parse_and_emit(wait=False)
            socketio.emit("audit_status", {"state": "finished", "msg": "ALL DATA LOADED"})

        except Exception as ex:
            socketio.emit("audit_status", {"state": "error", "msg": str(ex)})
        finally:
            audit_lock.release()

    threading.Thread(target=run, daemon=True).start()


if __name__ == "__main__":
    threading.Thread(target=parse_and_emit, args=(True,), daemon=True).start()
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
