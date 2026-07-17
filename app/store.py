"""Persistencia de proyectos en disco (un JSON por proyecto)."""
import json
import shutil
import threading
import time
import uuid
from pathlib import Path

from . import config

_lock = threading.RLock()


def _project_dir(pid: str) -> Path:
    return config.PROJECTS_DIR / pid


def _project_file(pid: str) -> Path:
    return _project_dir(pid) / "project.json"


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def create_project(name: str) -> dict:
    pid = new_id()
    d = _project_dir(pid)
    d.mkdir(parents=True, exist_ok=True)
    proj = {
        "id": pid,
        "name": name or "Sin título",
        "created_at": time.time(),
        "status": "created",
        "source": None,
        "audio_path": None,
        "transcript": None,
        "style": dict(config.DEFAULT_STYLE),
        "titles": [],
        "sounds": [],
        "caption": None,
        "output": None,
        "steps": {
            "upload": {"status": "done"},
            "transcribe": {"status": "pending", "error": None},
            "render": {"status": "pending", "error": None},
            "caption": {"status": "pending", "error": None},
        },
    }
    save_project(proj)
    return proj


def save_project(proj: dict):
    with _lock:
        path = _project_file(proj["id"])
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(proj, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)


def _migrate(proj: dict) -> dict:
    """Migración: el gancho antiguo (style.hook_*) pasa a ser un elemento de la
    lista `titles`, y aparece la lista `sounds`. Ambas son elementos con tiempo
    que viven en pistas de la línea de tiempo."""
    if "titles" not in proj:
        titles = []
        st = proj.get("style") or {}
        if st.get("hook_enabled") and (st.get("hook_text") or "").strip():
            titles.append({
                "id": "t-hook",
                "text": st["hook_text"].strip(),
                "start": 0.0,
                "end": float(st.get("hook_seconds") or 2.5),
                "color": st.get("hook_color") or "#FFFFFF",
                "size": int(st.get("hook_size") or 120),
                "pos": float(st.get("hook_position") or 24),
                "sound": st.get("hook_sound") or "",
            })
        proj["titles"] = titles
    if "sounds" not in proj:
        proj["sounds"] = []
    return proj


def load_project(pid: str) -> dict | None:
    with _lock:
        path = _project_file(pid)
        if not path.exists():
            return None
        return _migrate(json.loads(path.read_text(encoding="utf-8")))


def update_project(pid: str, **changes) -> dict | None:
    with _lock:
        proj = load_project(pid)
        if proj is None:
            return None
        proj.update(changes)
        save_project(proj)
        return proj


def set_step(pid: str, step: str, status: str, error: str | None = None):
    with _lock:
        proj = load_project(pid)
        if proj is None:
            return
        proj.setdefault("steps", {})[step] = {"status": status, "error": error}
        save_project(proj)


def list_projects() -> list[dict]:
    items = []
    for d in config.PROJECTS_DIR.iterdir():
        if d.is_dir():
            p = load_project(d.name)
            if p:
                items.append(p)
    items.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return items


def delete_project(pid: str) -> bool:
    with _lock:
        d = _project_dir(pid)
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
            return True
        return False


def project_dir(pid: str) -> Path:
    return _project_dir(pid)
