"""Fernet envelope for OAuth refresh tokens.

The key lives in the environment, never in the database. Rotating it makes every
stored token undecryptable and forces a reconnect, so it is treated as stable.
"""

from cryptography.fernet import Fernet, InvalidToken

from doer.config import get_settings


def _cipher() -> Fernet:
    key = get_settings().fernet_key
    if not key:
        raise RuntimeError("FERNET_KEY is not set; refresh tokens cannot be stored")
    return Fernet(key.encode())


def encrypt(plaintext: str) -> bytes:
    return _cipher().encrypt(plaintext.encode())


def decrypt(ciphertext: bytes) -> str:
    try:
        return _cipher().decrypt(ciphertext).decode()
    except InvalidToken as exc:
        raise ValueError("stored token could not be decrypted") from exc
