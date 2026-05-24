from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://llmuser:llmpassword@localhost:5432/llmlogs"
    redis_url: str = "redis://localhost:6379"
    secret_key: str = "supersecretkey-change-in-production"
    
    # PII redaction
    enable_pii_redaction: bool = True
    pii_entities: list[str] = [
        "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD",
        "US_SSN", "IP_ADDRESS", "URL", "LOCATION"
    ]
    
    # Ingestion
    max_preview_length: int = 200
    batch_size: int = 100
    
    # CORS
    allowed_origins: list[str] = ["http://localhost:3000", "http://localhost:3001", "*"]

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
