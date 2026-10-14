"""Pack an unpacked extension folder into a signed .crx3 file.

Chrome refuses to silently install an extension from a folder, but it will install a
signed .crx that is registered under HKCU (see app/chrome_setup.py). Packing here
instead of shelling out to chrome.exe keeps the build reproducible and Chrome-free.
"""
from __future__ import annotations

import hashlib
import json
import struct
import zipfile
from io import BytesIO
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

SIGNATURE_CONTEXT = b"CRX3 SignedData\x00"


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _field(number: int, payload: bytes) -> bytes:
    """One length-delimited protobuf field (wire type 2)."""
    return _varint((number << 3) | 2) + _varint(len(payload)) + payload


def load_or_create_key(path: Path) -> rsa.RSAPrivateKey:
    """The key fixes the extension's ID, so it is kept between builds."""
    if path.exists():
        return serialization.load_pem_private_key(path.read_bytes(), password=None)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    return key


def extension_id(key: rsa.RSAPrivateKey) -> str:
    """Chrome's ID: first 16 bytes of SHA-256 over the DER public key, as letters a-p."""
    digest = hashlib.sha256(_public_der(key)).digest()[:16]
    return "".join(chr(97 + (b >> 4)) + chr(97 + (b & 0xF)) for b in digest)


def _public_der(key: rsa.RSAPrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )


def _zip_folder(folder: Path) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pem":
                z.write(f, f.relative_to(folder).as_posix())
    return buf.getvalue()


def pack(folder: Path, key_path: Path, out: Path) -> dict:
    key = load_or_create_key(key_path)
    ext_id = extension_id(key)
    archive = _zip_folder(folder)

    signed_header = _field(1, bytes.fromhex(_id_hex(ext_id)))  # SignedData.crx_id
    message = (SIGNATURE_CONTEXT + struct.pack("<I", len(signed_header))
               + signed_header + archive)
    signature = key.sign(message, padding.PKCS1v15(), hashes.SHA256())

    proof = _field(1, _public_der(key)) + _field(2, signature)
    header = _field(2, proof) + _field(10000, signed_header)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(b"Cr24" + struct.pack("<II", 3, len(header)) + header + archive)
    version = json.loads((folder / "manifest.json").read_text("utf-8"))["version"]
    return {"id": ext_id, "crx": out.name, "version": version}


def _id_hex(ext_id: str) -> str:
    """Undo the a-p encoding to get the raw 16-byte crx_id."""
    return "".join(f"{(ord(a) - 97) << 4 | (ord(b) - 97):02x}"
                   for a, b in zip(ext_id[::2], ext_id[1::2]))
