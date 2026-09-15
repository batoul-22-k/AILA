"""Configuration for the offline Ollama comparison experiment."""

from __future__ import annotations

import os
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit


PACKAGE_ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT_FILE = PACKAGE_ROOT / "evaluation_inputs.json"
DEFAULT_RESULTS_DIR = PACKAGE_ROOT / "results"
DEFAULT_MODEL_IDS = ("tinyllama-local", "gpt-oss-20b-cloud")
OLLAMA_CLOUD_PRICING = {
    "pricing_type": "free_tier_or_subscription",
    "direct_request_cost_usd": None,
    "usage_limit_applies": True,
}
OLLAMA_CLOUD_PRICING_DISPLAY = {
    "direct_request_cost": "Not reported",
    "plan": "Ollama Free or configured subscription",
    "usage_limits": "Apply",
}
EVALUATION_MODELS = {
    "tinyllama-local": {
        "provider": "ollama",
        "model": "tinyllama",
        "deployment_type": "local",
        "internet_required": False,
        "data_leaves_institution": False,
        "offline_supported": True,
    },
    "gpt-oss-20b-local": {
        "provider": "ollama",
        "model": "gpt-oss:20b",
        "deployment_type": "local",
        "internet_required": False,
        "data_leaves_institution": False,
        "offline_supported": True,
        "minimum_system_ram_gib": 16,
        "optional": True,
    },
    "gpt-oss-20b-cloud": {
        "provider": "ollama",
        "model": "gpt-oss:20b-cloud",
        "deployment_type": "cloud",
        "internet_required": True,
        "data_leaves_institution": True,
        "offline_supported": False,
        "pricing": OLLAMA_CLOUD_PRICING,
        "pricing_display": OLLAMA_CLOUD_PRICING_DISPLAY,
    },
}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {value!r}") from exc


def _env_positive_int(name: str, default: int) -> int:
    value = _env_int(name, default)
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer, got {value!r}")
    return value


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean, got {value!r}")


def _env_optional_int(name: str, default: int | None) -> int | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {value!r}") from exc
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive integer when set, got {value!r}")
    return parsed


def _env_model_ids() -> tuple[str, ...]:
    explicit_ids = os.getenv("EVALUATION_MODEL_IDS")
    if explicit_ids and explicit_ids.strip():
        models = tuple(item.strip() for item in explicit_ids.split(",") if item.strip())
    elif os.getenv("EVALUATION_MODEL_A") or os.getenv("EVALUATION_MODEL_B"):
        models = (
            os.getenv("EVALUATION_MODEL_A", DEFAULT_MODEL_IDS[0]).strip(),
            os.getenv("EVALUATION_MODEL_B", DEFAULT_MODEL_IDS[1]).strip(),
        )
    else:
        models = DEFAULT_MODEL_IDS

    if _env_bool("EVALUATION_INCLUDE_GPT_OSS_20B_LOCAL", False) and "gpt-oss-20b-local" not in models:
        models = (*models, "gpt-oss-20b-local")
    if not models:
        raise ValueError("At least one evaluation model must be configured.")
    return models


def _load_model_registry() -> dict[str, dict[str, Any]]:
    registry = {key: dict(value) for key, value in EVALUATION_MODELS.items()}
    raw_json = os.getenv("EVALUATION_MODELS_JSON")
    if not raw_json or not raw_json.strip():
        return registry
    try:
        custom = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ValueError("EVALUATION_MODELS_JSON must be a JSON object.") from exc
    if not isinstance(custom, dict):
        raise ValueError("EVALUATION_MODELS_JSON must be a JSON object.")
    for model_id, model_config in custom.items():
        if not isinstance(model_config, dict):
            raise ValueError(f"EVALUATION_MODELS_JSON entry {model_id!r} must be an object.")
        registry[str(model_id)] = dict(model_config)
    return registry


def normalize_base_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.path.rstrip("/") == "/api/generate":
        return urlunsplit((parsed.scheme, parsed.netloc, "", "", "")).rstrip("/")
    return value.strip().rstrip("/")


@dataclass(frozen=True)
class EvaluationConfig:
    model_a: str = DEFAULT_MODEL_IDS[0]
    model_b: str = DEFAULT_MODEL_IDS[1]
    ollama_base_url: str = "http://localhost:11434"
    timeout_seconds: int = 600
    prompt_chars: int = 1800
    num_ctx: int = 2048
    num_predict: int = 700
    temperature: int = 1
    seed: int | None = None
    keep_alive: int | str = "2m"
    num_gpu: int = 0
    num_thread: int = 0
    unload_timeout_seconds: int = 30
    request_delay_seconds: int = 5
    use_json_schema: bool = False
    model_ids: tuple[str, ...] | None = None
    evaluation_models: dict[str, dict[str, Any]] = field(default_factory=lambda: {key: dict(value) for key, value in EVALUATION_MODELS.items()})
    attempts_per_model: int = 3
    questions_per_request: int = 4
    max_passages: int | None = None
    require_cloud_preflight: bool = True
    capture_local_resource_metrics: bool = False
    unload_after_request: bool = False

    @property
    def models(self) -> tuple[str, ...]:
        if self.model_ids is not None:
            return self.model_ids
        return tuple(model for model in (self.model_a, self.model_b) if model)

    @property
    def generate_url(self) -> str:
        return f"{self.ollama_base_url}/api/generate"

    @property
    def ps_url(self) -> str:
        return f"{self.ollama_base_url}/api/ps"

    @property
    def tags_url(self) -> str:
        return f"{self.ollama_base_url}/api/tags"

    @property
    def show_url(self) -> str:
        return f"{self.ollama_base_url}/api/show"

    @property
    def generation_options(self) -> dict[str, int]:
        options = {
            "temperature": self.temperature,
            "num_ctx": self.num_ctx,
            "num_predict": self.num_predict,
            "num_gpu": self.num_gpu,
        }
        if self.seed is not None:
            options["seed"] = self.seed
        if self.num_thread > 0:
            options["num_thread"] = self.num_thread
        return options

    @property
    def generation_settings(self) -> dict[str, object]:
        output_format = "json_schema" if self.use_json_schema else "json"
        return {
            "temperature": self.temperature,
            "seed": self.seed,
            "num_ctx": self.num_ctx,
            "num_predict": self.num_predict,
            "num_gpu": self.num_gpu,
            "num_thread": self.num_thread,
            "stream": False,
            "format": output_format,
            "use_json_schema": self.use_json_schema,
            "keep_alive": self.keep_alive,
            "unload_after_request": self.unload_after_request,
            "ollama_base_url": self.ollama_base_url,
            "ollama_generate_url": self.generate_url,
            "questions_per_request": self.questions_per_request,
        }

    def model_config(self, model_id: str) -> dict[str, Any]:
        configured = self.evaluation_models.get(model_id)
        if configured is None:
            matches = [
                dict(value)
                for value in self.evaluation_models.values()
                if str(value.get("model") or "").strip() == str(model_id).strip()
            ]
            if len(matches) == 1:
                configured = matches[0]
            else:
                configured = {
                    "provider": "ollama",
                    "model": model_id,
                    "deployment_type": "local",
                    "internet_required": False,
                    "data_leaves_institution": False,
                    "offline_supported": True,
                }
        model_config = dict(configured)
        model_config.setdefault("provider", "ollama")
        model_config.setdefault("model", model_id)
        model_config.setdefault("deployment_type", "local")
        model_config.setdefault("internet_required", False)
        model_config.setdefault("data_leaves_institution", False)
        model_config.setdefault("offline_supported", model_config["deployment_type"] == "local")
        model_config.setdefault("pricing", None)
        model_config.setdefault("pricing_display", None)
        return model_config

    def model_tag(self, model_id: str) -> str:
        return str(self.model_config(model_id).get("model") or model_id)


def load_config() -> EvaluationConfig:
    model_ids = _env_model_ids()
    return EvaluationConfig(
        model_a=model_ids[0],
        model_b=model_ids[1] if len(model_ids) > 1 else "",
        model_ids=model_ids,
        evaluation_models=_load_model_registry(),
        ollama_base_url=normalize_base_url(os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")),
        timeout_seconds=_env_int("EVALUATION_OLLAMA_TIMEOUT_SECONDS", 600),
        prompt_chars=_env_int("EVALUATION_PROMPT_CHARS", 1800),
        num_ctx=_env_positive_int("EVALUATION_NUM_CTX", 2048),
        num_predict=_env_positive_int("EVALUATION_NUM_PREDICT", 700),
        temperature=_env_int("EVALUATION_TEMPERATURE", 1),
        seed=_env_optional_int("EVALUATION_SEED", None),
        keep_alive=os.getenv("EVALUATION_KEEP_ALIVE", "2m"),
        num_gpu=_env_int("EVALUATION_NUM_GPU", 0),
        num_thread=_env_int("EVALUATION_NUM_THREAD", 0),
        unload_timeout_seconds=_env_int("EVALUATION_UNLOAD_TIMEOUT_SECONDS", 30),
        request_delay_seconds=_env_int("EVALUATION_REQUEST_DELAY_SECONDS", 5),
        use_json_schema=_env_bool("EVALUATION_USE_JSON_SCHEMA", False),
        attempts_per_model=_env_positive_int("EVALUATION_ATTEMPTS_PER_MODEL", 3),
        questions_per_request=_env_positive_int("EVALUATION_QUESTIONS_PER_REQUEST", 4),
        max_passages=_env_optional_int("EVALUATION_MAX_SLIDES", 1),
        require_cloud_preflight=_env_bool("EVALUATION_REQUIRE_CLOUD_PREFLIGHT", True),
        capture_local_resource_metrics=_env_bool("EVALUATION_CAPTURE_LOCAL_RESOURCE_METRICS", True),
        unload_after_request=_env_bool("EVALUATION_UNLOAD_AFTER_REQUEST", False),
    )
