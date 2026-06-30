"""Cola de trabajos en segundo plano con UN solo worker.

Serializa el trabajo pesado (transcripción + render) para no saturar los
4 vCPU compartidos con TradingAI: nunca corre más de un ffmpeg/whisper a la vez.
"""
import queue
import threading
import traceback

from . import store, transcribe, render, captions, media
from . import config

_q: "queue.Queue[tuple]" = queue.Queue()
_worker_started = False
_lock = threading.Lock()


def _do_transcribe(pid: str):
    proj = store.load_project(pid)
    if not proj:
        return
    store.set_step(pid, "transcribe", "running")
    audio = proj.get("audio_path")
    src = proj.get("source") or {}
    pdir = store.project_dir(pid)
    if not audio:
        audio = str(pdir / "audio.mp3")
        media.extract_audio(src["path"], audio)
        store.update_project(pid, audio_path=audio)
    lang = (proj.get("transcript") or {}).get("language") or config.DEFAULT_LANGUAGE
    result = transcribe.transcribe_audio(audio, lang)
    store.update_project(pid, transcript=result, status="transcribed")
    store.set_step(pid, "transcribe", "done")


def _do_render(pid: str):
    proj = store.load_project(pid)
    if not proj:
        return
    store.set_step(pid, "render", "running")
    output = render.render_project(proj)
    store.update_project(pid, output=output, status="rendered")
    store.set_step(pid, "render", "done")


def _do_caption(pid: str, hint: str = ""):
    proj = store.load_project(pid)
    if not proj:
        return
    store.set_step(pid, "caption", "running")
    text = (proj.get("transcript") or {}).get("raw_text", "")
    if not text:
        words = (proj.get("transcript") or {}).get("words", [])
        text = " ".join(w["word"] for w in words)
    result = captions.generate_caption(text, hint)
    store.update_project(pid, caption=result)
    store.set_step(pid, "caption", "done")


_HANDLERS = {
    "transcribe": _do_transcribe,
    "render": _do_render,
    "caption": _do_caption,
}


def _worker():
    while True:
        step, pid, kwargs = _q.get()
        try:
            _HANDLERS[step](pid, **kwargs)
        except Exception as e:
            traceback.print_exc()
            store.set_step(pid, step, "error", str(e)[:500])
        finally:
            _q.task_done()


def start_worker():
    global _worker_started
    with _lock:
        if not _worker_started:
            t = threading.Thread(target=_worker, daemon=True)
            t.start()
            _worker_started = True


def enqueue(step: str, pid: str, **kwargs):
    if step not in _HANDLERS:
        raise ValueError(f"Paso desconocido: {step}")
    store.set_step(pid, step, "queued")
    _q.put((step, pid, kwargs))
