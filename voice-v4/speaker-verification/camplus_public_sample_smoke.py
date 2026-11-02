#!/usr/bin/env python3
"""Hosted-only feasibility smoke for the sherpa-onnx CAM++ speaker embedding model.

Uses public test clips distributed with the sherpa-onnx release. No owner's voice,
microphone, enrollment recording, or audio artifact is used or uploaded.
The report contains only aggregate cosine scores and runtime metadata.
"""
from __future__ import annotations

import argparse
import json
import resource
import time
import urllib.request
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf


BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
MODEL = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
CLIPS = {
    "owner_a": "fangjun-sr-1.wav",
    "owner_b": "fangjun-sr-2.wav",
    "owner_c": "fangjun-sr-3.wav",
    "same_a": "fangjun-test-sr-1.wav",
    "same_b": "fangjun-test-sr-2.wav",
    "other_a": "leijun-test-sr-1.wav",
    "other_b": "liudehua-test-sr-1.wav",
}


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "ARIA-Voice-V4-CI"})
    with urllib.request.urlopen(request, timeout=60) as response, target.open("wb") as output:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            output.write(block)


def load_embedding(extractor, path: Path) -> tuple[np.ndarray, float]:
    samples, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if samples.ndim == 2:
        samples = samples.mean(axis=1)
    if samples.ndim != 1 or sample_rate <= 0 or len(samples) < int(sample_rate):
        raise ValueError("sample_invalid")
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    stream = extractor.create_stream()
    started = time.perf_counter()
    stream.accept_waveform(sample_rate=sample_rate, waveform=samples)
    stream.input_finished()
    if not extractor.is_ready(stream):
        raise ValueError("embedding_not_ready")
    vector = np.asarray(extractor.compute(stream), dtype=np.float32).reshape(-1)
    elapsed_ms = (time.perf_counter() - started) * 1000
    if not vector.size or not np.isfinite(vector).all():
        raise ValueError("embedding_invalid")
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-8:
        raise ValueError("embedding_norm_invalid")
    return vector / norm, elapsed_ms


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / max(float(np.linalg.norm(a) * np.linalg.norm(b)), 1e-8))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()

    root = Path(args.workdir)
    root.mkdir(parents=True, exist_ok=True)
    report_path = Path(args.report)

    try:
        model_path = root / MODEL
        download(BASE + MODEL, model_path)
        for filename in CLIPS.values():
            target = root / filename
            download(BASE + filename, target)

        load_started = time.perf_counter()
        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(model_path),
            num_threads=1,
            debug=False,
            provider="cpu",
        )
        if not config.validate():
            raise ValueError("extractor_config_invalid")
        extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        model_load_ms = (time.perf_counter() - load_started) * 1000

        embeddings = {}
        latency = []
        for key, filename in CLIPS.items():
            vector, elapsed_ms = load_embedding(extractor, root / filename)
            embeddings[key] = vector
            latency.append(elapsed_ms)

        enrollment = np.mean(
            np.stack([embeddings["owner_a"], embeddings["owner_b"], embeddings["owner_c"]]),
            axis=0,
        )
        enrollment /= max(float(np.linalg.norm(enrollment)), 1e-8)
        same_scores = [
            cosine(enrollment, embeddings["same_a"]),
            cosine(enrollment, embeddings["same_b"]),
        ]
        different_scores = [
            cosine(enrollment, embeddings["other_a"]),
            cosine(enrollment, embeddings["other_b"]),
        ]
        same_min = min(same_scores)
        different_max = max(different_scores)
        margin = same_min - different_max
        passed = margin > 0.05

        result = {
            "status": "candidate_rank_pass" if passed else "candidate_rank_inconclusive",
            "model": MODEL,
            "model_size_bytes": model_path.stat().st_size,
            "embedding_dimension": int(embeddings["owner_a"].size),
            "model_load_ms": round(model_load_ms, 2),
            "mean_embedding_ms": round(float(np.mean(latency)), 2),
            "max_embedding_ms": round(float(np.max(latency)), 2),
            "peak_process_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2),
            "same_speaker_min_cosine": round(same_min, 5),
            "different_speaker_max_cosine": round(different_max, 5),
            "ranking_margin": round(margin, 5),
            "sample_count": len(CLIPS),
            "limitations": [
                "Public sample clips are not the owner's voice or Cuban Spanish.",
                "A small same/different ranking smoke does not calibrate false-accept or false-reject rates.",
                "Hosted Linux CPU/RAM results do not predict Android, RobVG, or LaCueva performance.",
                "Voice replay and synthetic voice attacks are not tested.",
            ],
        }
        report_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({k: result[k] for k in (
            "status", "model_size_bytes", "embedding_dimension", "model_load_ms",
            "mean_embedding_ms", "max_embedding_ms", "peak_process_rss_mb",
            "same_speaker_min_cosine", "different_speaker_max_cosine", "ranking_margin"
        )}))
        return 0 if passed else 4
    except Exception as exc:
        result = {
            "status": "candidate_test_error",
            "error_type": type(exc).__name__,
            "limitations": ["The candidate was not accepted. No user audio was processed."],
        }
        report_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
