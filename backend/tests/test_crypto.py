"""Refresh token encryption (AC-20)."""

import pytest

from doer.crypto import decrypt, encrypt


def test_roundtrip():
    """T-AUTH-01."""
    secret = "1//0gFAKEREFRESHTOKENvalue"
    assert decrypt(encrypt(secret)) == secret


def test_ciphertext_does_not_contain_the_plaintext():
    """T-AUTH-02. The scan a reviewer would actually run."""
    secret = "1//0gFAKEREFRESHTOKENvalue"
    blob = encrypt(secret)
    assert secret.encode() not in blob
    assert blob != secret.encode()


def test_tampered_ciphertext_is_rejected():
    blob = bytearray(encrypt("something"))
    blob[-1] = blob[-1] ^ 0xFF
    with pytest.raises(ValueError):
        decrypt(bytes(blob))


def test_each_encryption_is_distinct():
    """Fernet includes a random IV, so identical plaintexts must not collide."""
    assert encrypt("same") != encrypt("same")
