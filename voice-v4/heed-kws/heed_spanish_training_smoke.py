#!/usr/bin/env python3
"""Train/evaluate tiny Spanish ARIA KWS candidates with synthetic eSpeak data.

Runs only on a disposable GitHub-hosted runner. No user microphone, voiceprint,
recordings, or device is accessed. Synthetic results are shortlist evidence only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import numpy as np
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import torch
from heed.audio import load_wav, log_mel, prepare_clip
from heed.eval import evaluate_dirs
from heed.export import export_to_onnx
from heed.trainer import TrainerConfig, train_wake_word

VOICE_CANDIDATES = (
    "es", "es+f1", "es+f2", "es+f3", "es+m1", "es+m2", "es+m3",
    "es-la", "es-mx",
)
SPEEDS = (125, 150, 175)
PITCHES = (35, 55, 75)
NEGATIVE_PHRASES = (
    "Malaria", "María", "Área", "Oye María", "Oye Malaria", "Oye Área",
    "Hoy haría", "Oye Ariel", "Oye Amalia", "Oye ahora", "Oye allá",
    "Abre el navegador", "Hoy hace buen tiempo", "Enciende la radio",
    "La teoría del área", "Hola María", "Dime ahora", "Oye Ana",
    "Mira el área", "Me llamo María", "Hoy iría a casa", "Oye, ya",
    "Oye, hola", "Oye, Ariel", "A ver si aparece",
)


def run_espeak(voice: str, speed: int, pitch: int, phrase: str, target: Path) -> None:
    subprocess.run(
        [
            "espeak-ng", "-v", voice, "-s", str(speed), "-p", str(pitch),
            "-a", "165", "-w", str(target), phrase,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
    )
    with wave.open(str(target), "rb") as audio:
        if audio.getnframes() < 3000 or audio.getnchannels() not in (1, 2):
            raise RuntimeError("synthetic_audio_invalid")


def available_profiles(root: Path) -> list[str]:
    usable = []
    for profile in VOICE_CANDIDATES:
        target = root / ("probe-" + profile.replace("+", "_") + ".wav")
        try:
            run_espeak(profile, 150, 55, "Oye Aria", target)
            usable.append(profile)
        except Exception:
            continue
    return usable or []


def synth_clip(voice: str, speed: int, pitch: int, phrase: str,
               target_dir: Path, index: int) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"clip_{index:05d}.wav"
    run_espeak(voice, speed, pitch, phrase, target)
    return target


def make_phrase_set(candidate: str, positive_dir: Path, negative_dir: Path,
                    voices: list[str], speeds: tuple[int, ...],
                    pitches: tuple[int, ...], positives: int | None = None) -> dict:
    phrase = "Aria" if candidate == "aria" else "Oye Aria"
    positive_phrases = (
        ["Aria", "Aria abre Chrome", "Oye Aria"]
        if candidate == "aria"
        else ["Oye Aria", "Oye Aria abre Chrome"]
    )
    negative_phrases = list(NEGATIVE_PHRASES)
    if candidate == "oye_aria":
        negative_phrases.extend(["Oye", "Aria", "Oye, Aria no", "Oye, hay área"])
    index = 0
    positive_count = 0
    negative_count = 0

    for voice in voices:
        for speed in speeds:
            for pitch in pitches:
                for text in positive_phrases:
                    synth_clip(voice, speed, pitch, text, positive_dir, index)
                    index += 1
                    positive_count += 1
                for text in negative_phrases:
                    synth_clip(voice, speed, pitch, text, negative_dir, index)
                    index += 1
                    negative_count += 1

    return {
        "phrase": phrase,
        "positive_count": positive_count,
        "negative_count": negative_count,
        "negative_phrase_count": len(negative_phrases),
    }


def run_candidate(candidate: str, root: Path, train_voices: list[str],
                  test_voices: list[str], fallback_single_voice: bool,
                  model_artifact_dir: Path) -> dict:
    candidate_root = root / candidate
    train_pos = candidate_root / "train" / "positive"
    train_neg = candidate_root / "train" / "negative"
    test_pos = candidate_root / "test" / "positive"
    test_neg = candidate_root / "test" / "negative"
    model_path = candidate_root / "model.pt"

    training_summary = make_phrase_set(
        candidate, train_pos, train_neg, train_voices, (125, 150, 175), (35, 55, 75)
    )
    evaluation_summary = make_phrase_set(
        candidate, test_pos, test_neg, test_voices, (130, 160, 180), (30, 60, 85)
    )

    config = TrainerConfig(
        phrase=training_summary["phrase"],
        epochs=25,
        batch_size=32,
        aug_positives_per_real=8,
        aug_negatives_per_real=5,
        threshold_target_fpr=0.001,
        tts_positives=0,
        kokoro_positives=0,
        model_size="medium",
        device="cpu",
        use_rir=True,
        rir_pool_size=12,
        use_parametric_noise=True,
        parametric_noise_pool_size=12,
        spectral_matching=False,
        partial_negatives=True,
        specaugment=True,
    )
    started = time.perf_counter()
    artifact = train_wake_word(
        positive_dir=train_pos,
        negative_dir=train_neg,
        output_path=model_path,
        phrase=training_summary["phrase"],
        cfg=config,
        log_fn=lambda _message: None,
    )
    train_seconds = time.perf_counter() - started

    test_report = evaluate_dirs(model_path, test_pos, test_neg)
    tpr = float(test_report.tpr)
    fpr = float(test_report.fpr)
    # Synthetic benchmark only. Never call this owner-speaker acceptance.
    shortlisted = tpr >= 0.95 and fpr == 0.0

    result = {
        "candidate": candidate,
        "phrase": training_summary["phrase"],
        "status": "synthetic_shortlist_candidate" if shortlisted else "candidate_rejected",
        "training": {
            "positive_clips": training_summary["positive_count"],
            "negative_clips": training_summary["negative_count"],
            "train_voice_profiles": len(train_voices),
            "model_size": config.model_size,
            "parameters": int(artifact.n_params),
            "training_seconds": round(train_seconds, 2),
            "calibrated_threshold": round(float(artifact.threshold), 5),
        },
        "held_out_eval": {
            "positive_clips": int(test_report.n_positives),
            "negative_clips": int(test_report.n_negatives),
            "held_out_voice_profiles": len(test_voices),
            "tpr": round(tpr, 5),
            "fpr": round(fpr, 5),
            "accuracy": round(float(test_report.accuracy), 5),
            "auc_approx": round(float(test_report.auc_approx), 5),
            "mean_positive_score": round(float(test_report.mean_pos_score), 5),
            "mean_negative_score": round(float(test_report.mean_neg_score), 5),
        },
        "limitations": [
            "All speech is synthetic eSpeak NG; it is not Cuban human speech.",
            "eSpeak voice variants are not independent real speakers.",
            "The held-out split is synthetic and small; zero false positives does not certify a real-world false-activation rate.",
            "No user voice, microphone, or personal biometric data is used.",
        ],
    }

    if shortlisted:
        export_started = time.perf_counter()
        exported = export_to_onnx(model_path, candidate_root / "export", int8=True,
                                  log_fn=lambda _message: None)
        runtime_model = exported.int8_path if exported.int8_path and exported.int8_path.exists() else exported.onnx_path

        # Recreate only aggregate held-out features in a temporary directory.
        # The runtime benchmark itself runs in a separate process that imports
        # NumPy + ONNX Runtime but not PyTorch, isolating deployment RSS.
        with tempfile.TemporaryDirectory(prefix="aria-heed-onnx-features-") as feature_dir:
            features_root = Path(feature_dir)
            for index, wav_path in enumerate(sorted(test_pos.glob("*.wav"))):
                features = log_mel(prepare_clip(load_wav(wav_path))).numpy()
                np.save(features_root / f"pos_{index:05d}.npy", features, allow_pickle=False)
            for index, wav_path in enumerate(sorted(test_neg.glob("*.wav"))):
                features = log_mel(prepare_clip(load_wav(wav_path))).numpy()
                np.save(features_root / f"neg_{index:05d}.npy", features, allow_pickle=False)

            runtime_process = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("onnx_runtime_bench.py")),
                    "--model", str(runtime_model),
                    "--features-dir", str(features_root),
                    "--threshold", str(float(artifact.threshold)),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=300,
            )
            runtime_report = json.loads(runtime_process.stdout.strip().splitlines()[-1])

        onnx_shortlisted = (
            runtime_report["tpr"] >= 0.95
            and runtime_report["fpr"] == 0.0
        )
        result["status"] = "synthetic_shortlist_candidate" if onnx_shortlisted else "candidate_rejected"
        result["onnx_runtime_eval"] = {
            "format": "onnx_int8" if runtime_model == exported.int8_path else "onnx_fp32",
            "threshold": float(artifact.threshold),
            "positive_count": runtime_report["positive_count"],
            "true_positives": runtime_report["true_positives"],
            "false_negatives": runtime_report["false_negatives"],
            "negative_count": runtime_report["negative_count"],
            "false_positives": runtime_report["false_positives"],
            "true_negatives": runtime_report["true_negatives"],
            "tpr": runtime_report["tpr"],
            "fpr": runtime_report["fpr"],
            "session_load_ms": runtime_report["session_load_ms"],
            "mean_inference_ms": runtime_report["mean_inference_ms"],
            "p95_inference_ms": runtime_report["p95_inference_ms"],
            "mean_real_time_factor": runtime_report["mean_real_time_factor"],
            "process_peak_rss_mb": runtime_report["peak_process_rss_mb"],
            "model_file_bytes": runtime_report["model_file_bytes"],
            "inference_threads": runtime_report["intra_op_threads"],
        }
        result["export"] = {
            "onnx_bytes": int(exported.onnx_size_bytes),
            "int8_bytes": int(exported.int8_size_bytes or 0),
            "onnx_export_seconds": round(time.perf_counter() - export_started, 2),
            "max_abs_error_fp32": round(float(exported.max_abs_error_fp32), 8),
            "max_abs_error_int8": (
                round(float(exported.max_abs_error_int8), 8)
                if exported.max_abs_error_int8 is not None else None
            ),
        }

        # Preserve only the small inference model, never the synthetic WAVs or
        # training dataset. The artifact is a shortlist candidate, not release.
        model_artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_name = f"{candidate}-{result['onnx_runtime_eval']['format']}.onnx"
        artifact_path = model_artifact_dir / artifact_name
        shutil.copy2(runtime_model, artifact_path)
        digest = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
        result["model_artifact"] = {
            "file": str(artifact_path),
            "bytes": artifact_path.stat().st_size,
            "sha256": digest,
            "release_approved": False,
            "approval_reason": "synthetic-only-shortlist",
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    workdir = Path(args.workdir)
    report_path = Path(args.report)
    workdir.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    start = time.perf_counter()

    try:
        with tempfile.TemporaryDirectory(prefix="aria-heed-es-") as probe_dir:
            profiles = available_profiles(Path(probe_dir))
        if not profiles:
            raise RuntimeError("no_spanish_espeak_profile_available")

        # Keep at least one profile aside for evaluation. If the hosted image
        # exposes only one Spanish voice, vary prosody and report that limitation.
        if len(profiles) >= 3:
            train_voices = profiles[:-2]
            test_voices = profiles[-2:]
            fallback_single_voice = False
        elif len(profiles) == 2:
            train_voices = profiles[:1]
            test_voices = profiles[1:]
            fallback_single_voice = False
        else:
            train_voices = profiles
            test_voices = profiles
            fallback_single_voice = True

        with tempfile.TemporaryDirectory(prefix="aria-heed-data-") as data_dir:
            root = Path(data_dir)
            model_artifact_dir = workdir / "shortlisted-models"
            results = [
                run_candidate("aria", root, train_voices, test_voices, fallback_single_voice, model_artifact_dir),
                run_candidate("oye_aria", root, train_voices, test_voices, fallback_single_voice, model_artifact_dir),
            ]

        passed = [row["candidate"] for row in results if row["status"] == "synthetic_shortlist_candidate"]
        report = {
            "status": "synthetic_shortlist_available" if passed else "no_candidate_passed_synthetic_gate",
            "shortlisted_candidates": passed,
            "engine": "heed-wakeword==0.1.4",
            "engine_license": "Apache-2.0",
            "spanish_tts_profiles": profiles,
            "training_profiles": train_voices,
            "held_out_profiles": test_voices,
            "single_profile_fallback": fallback_single_voice,
            "candidate_results": results,
            "elapsed_seconds": round(time.perf_counter() - start, 2),
            "process_peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2),
            "limitations": [
                "Synthetic shortlist is not owner voice enrollment or Spanish/Cuban acoustic certification.",
                "This does not test speaker verification, spoofing/replay, microphone capture, battery, background services, or PC/Android resource use.",
                "No user devices are contacted; audio is generated and discarded on a temporary GitHub-hosted runner.",
            ],
        }
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({
            "status": report["status"],
            "shortlisted_candidates": passed,
            "spanish_tts_profiles": profiles,
            "train_profiles": train_voices,
            "held_out_profiles": test_voices,
            "candidate_metrics": [
                {"candidate": row["candidate"], "status": row["status"],
                 "tpr": row["held_out_eval"]["tpr"], "fpr": row["held_out_eval"]["fpr"],
                 "threshold": row["training"]["calibrated_threshold"]}
                for row in results
            ],
            "elapsed_seconds": report["elapsed_seconds"],
            "process_peak_rss_mb": report["process_peak_rss_mb"],
        }))
        return 0
    except Exception as exc:
        report = {
            "status": "candidate_test_error",
            "error_type": type(exc).__name__,
            "elapsed_seconds": round(time.perf_counter() - start, 2),
            "limitations": ["No candidate accepted; no user audio or device was accessed."],
        }
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
