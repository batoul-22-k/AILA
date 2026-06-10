from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "smart_classes"
    frontend_origin: str = "http://localhost:5173"
    ollama_url: str = "http://localhost:11434/api/generate"
    ollama_model: str = "tinyllama"
    ollama_timeout_seconds: int = 600
    ollama_prompt_chars: int = 1800
    ollama_num_ctx: int = 1024
    ollama_num_predict: int = 280
    ollama_num_gpu: int = 0
    ollama_num_thread: int = 0
    storage_dir: str = "storage"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
