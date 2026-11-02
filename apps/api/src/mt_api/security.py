"""Password hashing (scrypt, standard library) and opaque tokens."""

import base64
import hashlib
import hmac
import secrets

MIN_PASSWORD_LENGTH = 10

# scrypt cost: 2^15 iterations, 32 MiB of memory per hash.
_N, _R, _P, _DKLEN = 2**15, 8, 1, 32
_MAXMEM = 64 * 1024 * 1024


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=_MAXMEM, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, dk = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(dk)
        actual = hashlib.scrypt(
            password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), maxmem=_MAXMEM, dklen=len(expected)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# Used when an email is unknown, so a failed sign-in takes as long either way.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    """A random token for a cookie or link, and the hash that is stored."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)
