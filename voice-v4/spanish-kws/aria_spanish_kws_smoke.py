#!/usr/bin/env python3
"""Synthetic Spanish KWS feasibility smoke for ARIA / Oye ARIA.

Downloads a pinned public sherpa-onnx Spanish open-vocabulary KWS model.
Audio is synthesized locally in the ephemeral GitHub runner, processed locally,
and deleted at the end. Only aggregate detection outcomes and timings are saved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import wave
from pathlib import Path

import numpy as np
import sentencepiece as spm
import sherpa_onnx

REPO = "https://huggingface.co/jguerrisi/sherpa-onnx-kws-zipformer-es-3M-2026-08-08"
REVISION = "d4fa6bd"
ASSETS = {
    "encoder-epoch-20-avg-2-chunk-16-left-64.onnx":
        "b97a544b46e0e18fb4a9fc022c3f75256d4e60ab244cc7217dd01819e2d8145f",
    "decoder-epoch-20-avg-2-chunk-16-left-64.onnx":
        "61e75374f546c07b404f93509157a54b1d2f53d00a648bdd5de08599c711a7ae",
    "joiner-epoch-20-avg-2-chunk-16-left-64.onnx":
        "97f105dfa7bb1230f99abd153643106da73e5de7795b40e1a81a836c34eb5c60",
    "tokens.txt": None,
    "bpe.model": None,
}
CASES = (
    ("positive_aria", "Aria", "aria", True),
    ("positive_oye_aria", "Oye Aria", "oye_aria", True),
    ("positive_aria_command", "Aria, abre Chrome", "aria", True),
    ("positive_oye_aria_command", "Oye Aria, abre Chrome", "oye_aria", True),
    ("negative_malaria", "Malaria", None, False),
    ("negative_maria", "María", None, False),
    ("negative_area", "Área", None, False),
    ("negative_oye_maria", "Oye María", None, False),
    ("negative_oye_malaria", "Oye Malaria", None, False),
    ("negative_oye_area", "Oye Área", None, False),
    ("negative_theory", "La teoría es interesante", None, False),
    ("negative_browser", "Abre el navegador", None, False),
    ("negative_weather", "Hoy hace buen tiempo", None, False),
    ("negative_radio", "Enciende la radio", None, False),
    ("control_ayuda", "Ayuda", "control_ayuda", False),
    ("control_policia", "Policía", "control_policia", False),
)

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def download_asset(filename: str, root: Path) -> Path:
    target = root / filename
    url = f"{REPO}/resolve/{REVISION}/{filename}"
    subprocess.run(
        ["curl", "--fail", "--location", "--retry", "3", "--retry-delay", "2",
         "--silent", "--show-error", url, "--output", str(target)],
        check=True,
    )
    expected = ASSETS[filename]
    if expected and sha256(target) != expected:
        raise RuntimeError("model_checksum_mismatch:" + filename)
    return target

def available_spanish_voices() -> list[str]:
    output = subprocess.check_output(["espeak-ng", "--voices"], text=True, errors="replace")
    voices = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 5 and re.fullmatch(r"es(?:-[a-z]{2})?", fields[1], flags=re.I):
            voices.append(fields[1])
    # Keep the corpus diverse but bounded; use known installed Spanish voice IDs.
    ordered = [voice for voice in ("es", "es-la", "es-mx") if voice in voices]
    return ordered or ["es"]

def synthesize(phrase: str, voice: str, speed: int, index: int, root: Path) -> tuple[Path, float]:
    source = root / f"raw-{index}.wav"
    converted = root / f"pcm-{index}.wav"
    subprocess.run(
        ["espeak-ng", "-v", voice, "-s", str(speed), "-w", str(source), phrase],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(converted)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    with wave.open(str(converted), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
            raise RuntimeError("audio_format_invalid")
        duration = audio.getnframes() / audio.getframerate()
    return converted, duration

def read_pcm(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise RuntimeError("expected_mono_pcm16")
        sample_rate = audio.getframerate()
        raw = audio.readframes(audio.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0, sample_rate

def make_keyword_file(sp: spm.SentencePieceProcessor, root: Path, phrase: str, tag: str, score: float, threshold: float) -> tuple[Path, list[str]]:
    configured = [(phrase, tag, score, threshold), ("ayuda", "control_ayuda", 1.0, 0.20), ("policía", "control_policia", 1.0, 0.20)]
    lines = []
    target_pieces = []
    for configured_phrase, configured_tag, configured_score, configured_threshold in configured:
        pieces = sp.encode(configured_phrase.lower(), out_type=str)
        if not pieces or any(not piece for piece in pieces):
            raise RuntimeError("bpe_encode_failed")
        if configured_tag == tag:
            target_pieces = pieces
        lines.append(" ".join(pieces) + f" :{configured_score:.2f} #{configured_threshold:.2f} @{configured_tag}")
    target = root / f"keywords-{tag}-{score:.2f}-{threshold:.2f}.txt"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return target, target_pieces

def detect(kws: sherpa_onnx.KeywordSpotter, samples: np.ndarray, sample_rate: int) -> tuple[list[str], float]:
    stream = kws.create_stream()
    chunk = int(sample_rate * 0.1)
    leading = np.zeros(int(sample_rate * 0.35), dtype=np.float32)
    trailing = np.zeros(int(sample_rate * 0.66), dtype=np.float32)
    data = np.concatenate([leading, samples, trailing])
    started = time.perf_counter()
    detections: list[str] = []
    for offset in range(0, len(data), chunk):
        stream.accept_waveform(sample_rate, data[offset:offset + chunk])
        while kws.is_ready(stream):
            kws.decode_stream(stream)
            result = kws.get_result(stream)
            if result:
                detections.append(str(result).strip().lstrip("@"))
                kws.reset_stream(stream)
    stream.input_finished()
    while kws.is_ready(stream):
        kws.decode_stream(stream)
        result = kws.get_result(stream)
        if result:
            detections.append(str(result).strip().lstrip("@"))
            kws.reset_stream(stream)
    return detections, time.perf_counter() - started

def create_spotter(root: Path, keywords_file: Path, threshold: float = 0.20):
    return sherpa_onnx.KeywordSpotter(
        tokens=str(root / "tokens.txt"),
        encoder=str(root / "encoder-epoch-20-avg-2-chunk-16-left-64.onnx"),
        decoder=str(root / "decoder-epoch-20-avg-2-chunk-16-left-64.onnx"),
        joiner=str(root / "joiner-epoch-20-avg-2-chunk-16-left-64.onnx"),
        num_threads=1,
        max_active_paths=4,
        keywords_file=str(keywords_file),
        keywords_score=1.0,
        keywords_threshold=threshold,
        provider="cpu",
    )

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    root = Path(args.workdir)
    root.mkdir(parents=True, exist_ok=True)
    report_path = Path(args.report)
    started = time.perf_counter()
    try:
        for filename in ASSETS:
            download_asset(filename, root)
        sp = spm.SentencePieceProcessor(model_file=str(root / "bpe.model"))
        voices = available_spanish_voices()
        speeds = (125, 150, 175)

        # Synthesize once; candidate configurations share the same clips.
        samples_by_case: dict[str, list[tuple[np.ndarray, int, float]]] = {}
        index = 0
        with tempfile.TemporaryDirectory(prefix="aria-es-kws-audio-") as audio_dir:
            audio_root = Path(audio_dir)
            for case_id, phrase, _candidate, _expected in CASES:
                samples_by_case[case_id] = []
                for voice in voices:
                    for speed in speeds:
                        wav_path, duration = synthesize(phrase, voice, speed, index, audio_root)
                        samples, sample_rate = read_pcm(wav_path)
                        samples_by_case[case_id].append((samples, sample_rate, duration))
                        index += 1

            results = {}
            score_sweep = (1.0, 2.0, 4.0, 8.0)
            threshold_sweep = (0.05, 0.10, 0.20)
            for candidate, phrase in (("aria", "aria"), ("oye_aria", "oye aria")):
                configurations = []
                for score in score_sweep:
                    for threshold in threshold_sweep:
                        keyword_file, target_pieces = make_keyword_file(sp, root, phrase, candidate, score, threshold)
                        load_started = time.perf_counter()
                        kws = create_spotter(root, keyword_file)
                        load_ms = (time.perf_counter() - load_started) * 1000
                        candidate_rows = []
                        for case_id, _phrase, expected_candidate, expected_positive in CASES:
                            for variant_idx, (samples, sample_rate, duration) in enumerate(samples_by_case[case_id]):
                                labels, elapsed = detect(kws, samples, sample_rate)
                                expected_for_candidate = expected_positive and (
                                    expected_candidate == candidate
                                    or (candidate == "aria" and expected_candidate == "oye_aria")
                                )
                                expected_control = case_id in ("control_ayuda", "control_policia")
                                control_tag = "control_ayuda" if case_id == "control_ayuda" else "control_policia" if case_id == "control_policia" else None
                                candidate_rows.append({
                                    "case": case_id,
                                    "variant": variant_idx,
                                    "expected_positive": expected_for_candidate,
                                    "target_detected": candidate in labels,
                                    "target_detection_count": labels.count(candidate),
                                    "control_expected": expected_control,
                                    "control_detected": bool(control_tag and control_tag in labels),
                                    "unexpected_labels": [label for label in labels if label not in (candidate, "control_ayuda", "control_policia")],
                                    "audio_seconds": round(duration, 3),
                                    "decode_ms": round(elapsed * 1000, 2),
                                    "real_time_factor": round(elapsed / max(duration, 0.001), 4),
                                })
                        positives = [row for row in candidate_rows if row["expected_positive"]]
                        negatives = [row for row in candidate_rows if not row["expected_positive"] and not row["control_expected"]]
                        controls = [row for row in candidate_rows if row["control_expected"]]
                        fp = [row for row in negatives if row["target_detected"]]
                        fn = [row for row in positives if not row["target_detected"]]
                        tp = [row for row in positives if row["target_detected"]]
                        configurations.append({
                            "configured_phrase": phrase,
                            "target_score": score,
                            "target_threshold": threshold,
                            "target_bpe_pieces": target_pieces,
                            "model_load_ms": round(load_ms, 2),
                            "positive_count": len(positives),
                            "true_positives": len(tp),
                            "false_negatives": len(fn),
                            "negative_count": len(negatives),
                            "false_positives": len(fp),
                            "control_phrase_count": len(controls),
                            "control_phrase_hits": sum(1 for row in controls if row["control_detected"]),
                            "duplicate_detection_samples": sum(1 for row in candidate_rows if row["target_detection_count"] > 1),
                            "mean_real_time_factor": round(float(np.mean([row["real_time_factor"] for row in candidate_rows])), 4),
                            "false_positive_cases": sorted({row["case"] for row in fp}),
                            "false_negative_cases": sorted({row["case"] for row in fn}),
                        })
                        del kws
                results[candidate] = configurations

        # A candidate can only be shortlisted with >=95% synthetic positives and zero
        # confusable negatives in this small, explicitly limited smoke corpus.
        shortlist = []
        for name, configurations in results.items():
            eligible = [
                row for row in configurations
                if row["positive_count"] > 0
                and row["true_positives"] / row["positive_count"] >= 0.95
                and row["false_positives"] == 0
                and row["duplicate_detection_samples"] == 0
                and row["control_phrase_hits"] / max(row["control_phrase_count"], 1) >= 0.70
            ]
            if eligible:
                shortlist.append({
                    "candidate": name,
                    "best_configuration": max(eligible, key=lambda row: row["true_positives"] / row["positive_count"])
                })
        report = {
            "status": "shortlist_candidate" if shortlist else "no_candidate_passed_synthetic_gate",
            "shortlisted": shortlist,
            "model_repo": "jguerrisi/sherpa-onnx-kws-zipformer-es-3M-2026-08-08",
            "model_revision": REVISION,
            "model_files_sha256_verified": True,
            "model_files": {name: ASSETS[name] for name in ASSETS if ASSETS[name]},
            "spanish_tts_voices": voices,
            "speeds_wpm": list(speeds),
            "synthetic_case_count": len(CASES),
            "score_sweep": list(score_sweep),
            "threshold_sweep": list(threshold_sweep),
            "result_by_candidate": results,
            "elapsed_seconds": round(time.perf_counter() - started, 2),
            "limitations": [
                "eSpeak synthetic speech is not Cuban human speech or a microphone recording.",
                "This model was trained largely on read audiobook speech and synthetic phrases; accent and far-field noise may differ.",
                "Passing this small synthetic corpus is only a shortlist signal, not real-world FAR/FRR certification.",
                "No audio, transcript, voice sample, or contact data is uploaded or retained in artifacts.",
                "No owner device is contacted; this runs on a disposable GitHub-hosted Linux runner.",
            ],
        }
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({
            "status": report["status"],
            "shortlisted": shortlist,
            "spanish_tts_voices": voices,
            "score_sweep": list(score_sweep),
            "threshold_sweep": list(threshold_sweep),
            "best_by_candidate": {
                name: max(rows, key=lambda row: row["true_positives"] / max(row["positive_count"], 1))
                for name, rows in results.items()
            },
            "elapsed_seconds": report["elapsed_seconds"],
        }))
        return 0
    except Exception as exc:
        report = {
            "status": "candidate_test_error",
            "error_type": type(exc).__name__,
            "elapsed_seconds": round(time.perf_counter() - started, 2),
            "limitations": ["Candidate not accepted. No user audio was processed."],
        }
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
