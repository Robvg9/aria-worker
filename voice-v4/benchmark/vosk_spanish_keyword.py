#!/usr/bin/env python3
"""Hosted-runner smoke benchmark for a Spanish Vosk wake-word candidate.

Uses synthetic espeak-ng speech only. Never records a microphone or stores transcript text.
This is an API/model feasibility check, not a device-performance or speaker-verification test.
"""
from __future__ import annotations

import argparse
import json
import resource
import subprocess
import tempfile
import time
import wave
from pathlib import Path

from vosk import KaldiRecognizer, Model, SetLogLevel


CASES = (
    ("positive_aria", "Aria", True),
    ("positive_oye_aria", "Oye Aria", True),
    ("negative_malaria", "Malaria", False),
    ("negative_maria", "María", False),
    ("negative_area", "Área", False),
    ("negative_other", "Abre el navegador", False),
    ("negative_conversation", "Hoy hace buen tiempo", False),
)


def make_audio(text: str, output_dir: Path, index: int) -> tuple[Path, float]:
    source = output_dir / f"source-{index}.wav"
    target = output_dir / f"audio-{index}.wav"
    subprocess.run(
        ["espeak-ng", "-v", "es", "-s", "145", "-w", str(source), text],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-ac", "1", "-ar", "16000",
            "-sample_fmt", "s16", str(target),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    with wave.open(str(target), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
            raise RuntimeError("Audio conversion did not produce mono PCM16 at 16 kHz")
        duration = audio.getnframes() / audio.getframerate()
    return target, duration


def detect(model: Model, wav_path: Path) -> tuple[bool, float]:
    with wave.open(str(wav_path), "rb") as audio:
        sample_rate = audio.getframerate()
        pcm = audio.readframes(audio.getnframes())

    # Keep the grammar narrow. [unk] permits speech outside the single wake token.
    grammar = json.dumps(["aria", "[unk]"], ensure_ascii=False)
    recognizer = KaldiRecognizer(model, sample_rate, grammar)
    started = time.perf_counter()
    for offset in range(0, len(pcm), 4000):
        recognizer.AcceptWaveform(pcm[offset:offset + 4000])
    result = json.loads(recognizer.FinalResult() or "{}")
    elapsed = time.perf_counter() - started
    tokens = str(result.get("text", "")).lower().split()
    return "aria" in tokens, elapsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Path to extracted vosk-model-small-es-0.42")
    parser.add_argument("--report", required=True, help="JSON report path; contains no transcript text or audio")
    args = parser.parse_args()

    model_dir = Path(args.model)
    if not model_dir.is_dir():
        raise SystemExit(f"Model directory does not exist: {model_dir}")

    SetLogLevel(-1)
    load_started = time.perf_counter()
    try:
        model = Model(str(model_dir))
    except Exception as exc:
        print(json.dumps({"status": "model_load_failed", "error_type": type(exc).__name__}))
        return 2
    model_load_ms = round((time.perf_counter() - load_started) * 1000, 2)

    results = []
    with tempfile.TemporaryDirectory(prefix="aria-vosk-es-") as temp:
        temp_dir = Path(temp)
        for index, (name, phrase, expected) in enumerate(CASES):
            wav_path, duration = make_audio(phrase, temp_dir, index)
            try:
                detected, elapsed = detect(model, wav_path)
            except Exception as exc:
                report = {
                    "status": "grammar_or_decode_unsupported",
                    "error_type": type(exc).__name__,
                    "model": model_dir.name,
                    "model_load_ms": model_load_ms,
                }
                Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
                print(json.dumps(report))
                return 3

            results.append({
                "case": name,
                "expected_wake": expected,
                "detected_wake": detected,
                "pass": detected is expected,
                "audio_seconds": round(duration, 3),
                "decode_ms": round(elapsed * 1000, 2),
                "real_time_factor": round(elapsed / max(duration, 0.001), 4),
            })

    peak_rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2)
    false_positives = [row["case"] for row in results if row["detected_wake"] and not row["expected_wake"]]
    false_negatives = [row["case"] for row in results if not row["detected_wake"] and row["expected_wake"]]
    passed = all(row["pass"] for row in results)
    report = {
        "status": "pass" if passed else "candidate_rejected",
        "model": model_dir.name,
        "model_load_ms": model_load_ms,
        "process_peak_rss_mb": peak_rss_mb,
        "synthetic_cases": len(results),
        "false_positive_cases": false_positives,
        "false_negative_cases": false_negatives,
        "results": results,
        "limitations": [
            "Synthetic espeak-ng Spanish is not Cuban owner speech.",
            "Hosted-runner resource results do not predict CPU/RAM on RobVG, LaCueva, or Android.",
            "This does not test speaker verification, microphone capture, background lifecycle, battery, or real acoustic false-accept rates.",
        ],
    }
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "model": report["model"],
        "model_load_ms": report["model_load_ms"],
        "process_peak_rss_mb": peak_rss_mb,
        "false_positive_cases": false_positives,
        "false_negative_cases": false_negatives,
    }))
    return 0 if passed else 4


if __name__ == "__main__":
    raise SystemExit(main())
