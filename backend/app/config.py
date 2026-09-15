from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


ENABLE_DEBUG_EXPORT = True
DEBUG_EXPORT_INCLUDE_FULL_PROMPT = True


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "smart_classes"
    frontend_origin: str = "http://localhost:5173"
    ollama_url: str = "http://localhost:11434/api/generate"
    ollama_model: str = "qwen2.5:1.5b"
    ollama_provider: str = "ollama-local"
    ollama_local_base_url: str = ""
    ollama_local_model: str = ""
    ollama_cloud_base_url: str = ""
    ollama_cloud_model: str = ""
    ollama_cloud_api_key: str = ""
    ollama_timeout_seconds: int = 600
    ollama_prompt_chars: int = 1800
    ollama_num_ctx: int = 1024
    ollama_num_predict: int = 280
    ollama_num_gpu: int = 0
    ollama_num_thread: int = 0
    enable_debug_export: bool = ENABLE_DEBUG_EXPORT
    debug_export_include_full_prompt: bool = DEBUG_EXPORT_INCLUDE_FULL_PROMPT
    storage_dir: str = "storage"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
