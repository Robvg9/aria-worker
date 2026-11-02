#!/usr/bin/env python3
"""Measure the exported Heed ONNX detector in a torch-free CPU process.

Input feature arrays are generated from ephemeral synthetic eSpeak WAV files
by the pinned Heed reference preprocessor. This process loads only NumPy and
ONNX Runtime, so its RSS is a better estimate of the inference worker than
the much larger training process.
"""
from __future__ import annotations

import argparse
import json
import resource
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort


def probability(session, features: np.ndarray) -> tuple[float, float]:
    started = time.perf_counter()
    output = session.run(None, {"mel": np.ascontiguousarray(features, dtype=np.float32)})[0]
    elapsed_ms = (time.perf_counter() - started) * 1000
    logit = float(np.asarray(output).reshape(-1)[0])
    score = 1.0 / (1.0 + np.exp(-max(-80.0, min(80.0, logit))))
    return float(score), elapsed_ms


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--features-dir", required=True)
    parser.add_argument("--threshold", required=True, type=float)
    args = parser.parse_args()

    model_path = Path(args.model)
    features_dir = Path(args.features_dir)
    if not model_path.is_file() or not 0 < args.threshold < 1:
        raise SystemExit("invalid_model_or_threshold")

    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

    load_started = time.perf_counter()
    session = ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    load_ms = (time.perf_counter() - load_started) * 1000

    # Warm the session before timing. Only one already-preprocessed synthetic
    # feature array is used and the warm-up is excluded from reported metrics.
    files = sorted(features_dir.glob("*.npy"))
    positive_files = [p for p in files if p.name.startswith("pos_")]
    negative_files = [p for p in files if p.name.startswith("neg_")]
    if not positive_files or not negative_files:
        raise SystemExit("held_out_feature_sets_missing")
    warmup = np.load(positive_files[0], allow_pickle=False)
    for _ in range(5):
        session.run(None, {"mel": np.ascontiguousarray(warmup, dtype=np.float32)})

    positive_scores = []
    negative_scores = []
    timings = []
    for path, target in [(p, positive_scores) for p in positive_files] + [
        (p, negative_scores) for p in negative_files
    ]:
        features = np.load(path, allow_pickle=False)
        score, elapsed_ms = probability(session, features)
        target.append(score)
        timings.append(elapsed_ms)

    tp = sum(score >= args.threshold for score in positive_scores)
    fp = sum(score >= args.threshold for score in negative_scores)
    tpr = tp / len(positive_scores)
    fpr = fp / len(negative_scores)
    ordered = sorted(timings)
    p95 = ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))]
    report = {
        "model_file_bytes": model_path.stat().st_size,
        "onnxruntime_version": ort.__version__,
        "execution_provider": "CPUExecutionProvider",
        "intra_op_threads": 1,
        "session_load_ms": round(load_ms, 3),
        "mean_inference_ms": round(float(np.mean(timings)), 4),
        "median_inference_ms": round(float(np.median(timings)), 4),
        "p95_inference_ms": round(float(p95), 4),
        "max_inference_ms": round(float(max(timings)), 4),
        "mean_real_time_factor": round(float(np.mean(timings)) / 1000.0, 6),
        "threshold": args.threshold,
        "positive_count": len(positive_scores),
        "true_positives": tp,
        "false_negatives": len(positive_scores) - tp,
        "negative_count": len(negative_scores),
        "false_positives": fp,
        "true_negatives": len(negative_scores) - fp,
        "tpr": round(tpr, 6),
        "fpr": round(fpr, 6),
        "peak_process_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2),
    }
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
