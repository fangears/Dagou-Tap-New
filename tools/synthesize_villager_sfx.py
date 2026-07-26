#!/usr/bin/env python3
"""Generate the original "block villager" performance samples.

The sounds are built from deterministic harmonic glottal sources, nasal
formant emphasis, a small noisy onset, and hand-shaped amplitude/pitch
envelopes. No recorded or third-party audio is used.
"""

from __future__ import annotations

import argparse
import math
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np


SAMPLE_RATE = 48_000
RNG_SEED = 0x56494C4C


@dataclass(frozen=True)
class SampleSpec:
    filename: str
    duration: float
    base_hz: float
    pitch_points: tuple[tuple[float, float], ...]
    envelope_points: tuple[tuple[float, float], ...]
    onset_noise: float
    brightness: float


SPECS = (
    SampleSpec(
        filename="villager_hm.wav",
        duration=0.24,
        base_hz=440.0,
        pitch_points=((0.0, 1.04), (0.035, 1.0), (0.14, 0.985), (0.24, 0.94)),
        envelope_points=(
            (0.0, 0.0),
            (0.008, 0.90),
            (0.035, 1.0),
            (0.12, 0.72),
            (0.205, 0.25),
            (0.24, 0.0),
        ),
        onset_noise=0.16,
        brightness=0.82,
    ),
    SampleSpec(
        filename="villager_ha.wav",
        duration=0.30,
        base_hz=440.0,
        pitch_points=((0.0, 1.10), (0.025, 1.02), (0.12, 0.98), (0.30, 0.90)),
        envelope_points=(
            (0.0, 0.0),
            (0.005, 1.0),
            (0.028, 0.88),
            (0.13, 0.70),
            (0.255, 0.22),
            (0.30, 0.0),
        ),
        onset_noise=0.23,
        brightness=1.0,
    ),
    SampleSpec(
        filename="villager_hmmm.wav",
        duration=0.72,
        base_hz=440.0,
        pitch_points=(
            (0.0, 1.05),
            (0.07, 1.01),
            (0.18, 1.0),
            (0.56, 1.0),
            (0.72, 0.94),
        ),
        envelope_points=(
            (0.0, 0.0),
            (0.010, 0.84),
            (0.055, 1.0),
            (0.16, 0.72),
            (0.56, 0.72),
            (0.64, 0.48),
            (0.72, 0.0),
        ),
        onset_noise=0.13,
        brightness=0.72,
    ),
)


def interpolate(points: tuple[tuple[float, float], ...], t: np.ndarray) -> np.ndarray:
    times = np.asarray([point[0] for point in points], dtype=np.float64)
    values = np.asarray([point[1] for point in points], dtype=np.float64)
    return np.interp(t, times, values)


def smooth_noise(rng: np.random.Generator, length: int, radius: int) -> np.ndarray:
    noise = rng.standard_normal(length + radius * 2)
    kernel = np.hanning(radius * 2 + 1)
    kernel /= np.sum(kernel)
    return np.convolve(noise, kernel, mode="valid")


def harmonic_weight(frequency: float, brightness: float) -> float:
    formants = (
        (440.0, 260.0, 1.15),
        (930.0, 330.0, 1.45),
        (1_760.0, 520.0, 0.78 * brightness),
        (2_650.0, 700.0, 0.34 * brightness),
    )
    emphasis = 0.18
    for center, width, gain in formants:
        emphasis += gain * math.exp(-0.5 * ((frequency - center) / width) ** 2)
    return emphasis


def synthesize(spec: SampleSpec, seed_offset: int) -> np.ndarray:
    rng = np.random.default_rng(RNG_SEED + seed_offset)
    frame_count = round(spec.duration * SAMPLE_RATE)
    t = np.arange(frame_count, dtype=np.float64) / SAMPLE_RATE
    pitch_ratio = interpolate(spec.pitch_points, t)
    instantaneous_hz = spec.base_hz * pitch_ratio
    phase = 2.0 * np.pi * np.cumsum(instantaneous_hz) / SAMPLE_RATE

    voice = np.zeros(frame_count, dtype=np.float64)
    for harmonic in range(1, 18):
        frequency = spec.base_hz * harmonic
        amplitude = (
            harmonic_weight(frequency, spec.brightness)
            / (harmonic ** 1.12)
        )
        harmonic_phase = rng.uniform(-0.16, 0.16)
        voice += amplitude * np.sin(harmonic * phase + harmonic_phase)

    # A slow, shallow modulation makes the short grunts organic. The long
    # sample disables it across the WSOLA plateau so pitch/RMS stay stable.
    modulation = 1.0 + 0.018 * np.sin(2.0 * np.pi * 5.3 * t + 0.4)
    if spec.filename == "villager_hmmm.wav":
        plateau = np.clip((t - 0.18) / 0.04, 0.0, 1.0)
        plateau *= np.clip((0.60 - t) / 0.04, 0.0, 1.0)
        modulation = modulation * (1.0 - plateau) + plateau
    voice *= modulation

    envelope = interpolate(spec.envelope_points, t)
    attack_noise = smooth_noise(rng, frame_count, 7)
    attack_decay = np.exp(-t / 0.032)
    breath_noise = smooth_noise(rng, frame_count, 3) * 0.018
    signal = voice * envelope
    signal += attack_noise * attack_decay * envelope * spec.onset_noise
    signal += breath_noise * envelope

    # Remove DC, guarantee click-free endpoints, and leave compressor headroom.
    signal -= np.mean(signal)
    edge = min(round(0.006 * SAMPLE_RATE), frame_count // 4)
    edge_fade = np.sin(np.linspace(0.0, np.pi / 2.0, edge)) ** 2
    signal[:edge] *= edge_fade
    signal[-edge:] *= edge_fade[::-1]
    peak = float(np.max(np.abs(signal)))
    if peak <= 1e-9:
        raise RuntimeError(f"{spec.filename}: generated silence")
    signal *= 0.78 / peak
    signal[0] = 0.0
    signal[-1] = 0.0
    return signal.astype(np.float32)


def write_pcm16(path: Path, signal: np.ndarray) -> None:
    pcm = np.clip(np.round(signal * 32767.0), -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())


def window_rms(signal: np.ndarray, start: float, end: float) -> np.ndarray:
    window = round(0.020 * SAMPLE_RATE)
    hop = round(0.010 * SAMPLE_RATE)
    first = round(start * SAMPLE_RATE)
    last = round(end * SAMPLE_RATE) - window
    return np.asarray(
        [
            math.sqrt(float(np.mean(signal[index:index + window] ** 2)))
            for index in range(first, last + 1, hop)
        ]
    )


def estimate_pitch(signal: np.ndarray, start: float, end: float) -> float:
    section = signal[round(start * SAMPLE_RATE):round(end * SAMPLE_RATE)].astype(
        np.float64
    )
    section -= np.mean(section)
    correlation = np.correlate(section, section, mode="full")[len(section) - 1:]
    min_lag = round(SAMPLE_RATE / 700.0)
    max_lag = round(SAMPLE_RATE / 250.0)
    lag = min_lag + int(np.argmax(correlation[min_lag:max_lag + 1]))
    return SAMPLE_RATE / lag


def validate(spec: SampleSpec, signal: np.ndarray, path: Path) -> dict[str, float]:
    expected_frames = round(spec.duration * SAMPLE_RATE)
    if len(signal) != expected_frames:
        raise RuntimeError(f"{path.name}: unexpected frame count")
    peak = float(np.max(np.abs(signal)))
    if peak > 0.8:
        raise RuntimeError(f"{path.name}: peak {peak:.4f} is too high")
    if abs(float(signal[0])) > 1e-6 or abs(float(signal[-1])) > 1e-6:
        raise RuntimeError(f"{path.name}: endpoints are not silent")

    result = {"duration": spec.duration, "peak": peak}
    if spec.filename == "villager_hmmm.wav":
        rms = window_rms(signal, 0.22, 0.52)
        rms_db = 20.0 * np.log10(np.maximum(rms, 1e-12))
        result["plateau_rms_span_db"] = float(np.max(rms_db) - np.min(rms_db))
        result["plateau_pitch_hz"] = estimate_pitch(signal, 0.22, 0.52)
        if result["plateau_rms_span_db"] > 1.5:
            raise RuntimeError(
                f"{path.name}: plateau RMS span "
                f"{result['plateau_rms_span_db']:.3f} dB is unstable"
            )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-directory",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "audio",
    )
    args = parser.parse_args()

    total_bytes = 0
    for index, spec in enumerate(SPECS):
        signal = synthesize(spec, index * 97)
        output_path = args.output_directory / spec.filename
        write_pcm16(output_path, signal)
        metrics = validate(spec, signal, output_path)
        total_bytes += output_path.stat().st_size
        details = " ".join(f"{key}={value:.4f}" for key, value in metrics.items())
        print(f"{output_path.name}: {details} bytes={output_path.stat().st_size}")

    print(f"total_bytes={total_bytes}")
    if total_bytes > 150 * 1024:
        raise RuntimeError("Generated villager WAV files exceed the 150 KiB budget")


if __name__ == "__main__":
    main()
