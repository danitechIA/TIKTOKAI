"""Transcripción con timestamps por palabra usando Groq (Whisper large-v3)."""
import httpx

from . import config


def transcribe_audio(audio_path: str, language: str | None = None) -> dict:
    """Llama a la API de Groq y devuelve {language, words:[{word,start,end}]}.

    Usa response_format=verbose_json + timestamp_granularities[word] para
    obtener el tiempo exacto de cada palabra (necesario para el karaoke).
    """
    if not config.GROQ_API_KEY:
        raise RuntimeError("Falta GROQ_API_KEY en el .env")

    url = f"{config.GROQ_BASE}/audio/transcriptions"
    headers = {"Authorization": f"Bearer {config.GROQ_API_KEY}"}

    data = {
        "model": config.TRANSCRIBE_MODEL,
        "response_format": "verbose_json",
        "timestamp_granularities[]": "word",
    }
    if language and language != "auto":
        data["language"] = language

    with open(audio_path, "rb") as f:
        files = {"file": ("audio.mp3", f, "audio/mpeg")}
        with httpx.Client(timeout=180) as client:
            resp = client.post(url, headers=headers, data=data, files=files)

    if resp.status_code != 200:
        raise RuntimeError(f"Groq transcripción {resp.status_code}: {resp.text[:400]}")

    payload = resp.json()
    raw_words = payload.get("words") or []
    words = []
    for i, w in enumerate(raw_words):
        text = (w.get("word") or "").strip()
        if not text:
            continue
        words.append({
            "i": i,
            "word": text,
            "start": round(float(w.get("start", 0.0)), 3),
            "end": round(float(w.get("end", 0.0)), 3),
            "enabled": True,
        })

    # Reindexar de forma limpia
    for idx, w in enumerate(words):
        w["i"] = idx

    return {
        "language": payload.get("language", language or config.DEFAULT_LANGUAGE),
        "raw_text": (payload.get("text") or "").strip(),
        "words": words,
    }
