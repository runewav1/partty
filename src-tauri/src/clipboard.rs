//! System clipboard access (Win32) plus the base64 codec OSC 52 requires.
//!
//! OSC 52 arrives on the PTY output stream and is intercepted by the Rust-side
//! OSC stripper in `pty.rs`, which emits structured events. The PTY emitter
//! loop routes those events here: the *set* form base64-decodes and writes the
//! clipboard, the *query* form reads it back and replies over the PTY writer.
//! Keeping the clipboard behind this module means the stripper never touches
//! Win32 directly.

use std::ptr;

/// CF_UNICODETEXT (13) — stable Win32 format id; not exposed by the
/// DataExchange feature in windows-sys 0.61 (lives under Ole).
const CF_UNICODETEXT: u32 = 13;

/// Read UTF-16 text from the system clipboard.
///
/// SAFETY: clipboard access is process-wide; we open, read, and close in a
/// tight sequence. `GetClipboardData` returns a handle we lock for reading;
/// the data is NUL-terminated UTF-16 and we cap the scan defensively.
pub fn read_text() -> Result<String, String> {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err("clipboard unavailable".to_string());
        }
        let result = (|| {
            let handle = GetClipboardData(CF_UNICODETEXT);
            if handle.is_null() {
                return Ok(String::new());
            }
            let locked = GlobalLock(handle);
            if locked.is_null() {
                return Ok(String::new());
            }
            let mut end = 0usize;
            while *locked.cast::<u16>().add(end) != 0 {
                end += 1;
                if end > (1 << 20) {
                    break;
                }
            }
            let text =
                String::from_utf16_lossy(std::slice::from_raw_parts(locked.cast::<u16>(), end));
            GlobalUnlock(handle);
            Ok(text)
        })();
        CloseClipboard();
        result
    }
}

/// Write UTF-16 text to the system clipboard, replacing its contents.
///
/// SAFETY: we open, empty, allocate a moveable global buffer, copy the
/// NUL-terminated UTF-16 payload, hand it to `SetClipboardData`, and close.
/// On success ownership of the buffer transfers to the system (we must not
/// free it); on failure we free it before returning.
pub fn write_text(text: &str) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock,
    };

    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let byte_len = utf16.len() * 2;

    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err("clipboard unavailable".to_string());
        }
        let result = (|| {
            if EmptyClipboard() == 0 {
                return Err("EmptyClipboard failed".to_string());
            }
            let handle = GlobalAlloc(GMEM_MOVEABLE, byte_len);
            if handle.is_null() {
                return Err("GlobalAlloc failed".to_string());
            }
            let locked = GlobalLock(handle);
            if locked.is_null() {
                GlobalFree(handle);
                return Err("GlobalLock failed".to_string());
            }
            ptr::copy_nonoverlapping(utf16.as_ptr(), locked.cast::<u16>(), utf16.len());
            GlobalUnlock(handle);
            if SetClipboardData(CF_UNICODETEXT, handle).is_null() {
                GlobalFree(handle);
                return Err("SetClipboardData failed".to_string());
            }
            Ok(())
        })();
        CloseClipboard();
        result
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Base64 (RFC 4648 §4) — compact codec for OSC 52 payloads. Payloads are
// typically a few KB (bounded by the OSC stripper's MAX_OSC_LEN), so a
// byte-wise implementation is comfortably fast enough; no SIMD required.
// ────────────────────────────────────────────────────────────────────────────

const B64_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(input: &[u8]) -> String {
    if input.is_empty() {
        return String::new();
    }
    let (chunks, rem) = input.as_chunks::<3>();
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in chunks {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(chunk[1]) << 8) | u32::from(chunk[2]);
        out.push(B64_ALPHABET[(n >> 18) as usize & 0x3f] as char);
        out.push(B64_ALPHABET[(n >> 12) as usize & 0x3f] as char);
        out.push(B64_ALPHABET[(n >> 6) as usize & 0x3f] as char);
        out.push(B64_ALPHABET[n as usize & 0x3f] as char);
    }
    if !rem.is_empty() {
        let mut n = u32::from(rem[0]) << 16;
        if rem.len() > 1 {
            n |= u32::from(rem[1]) << 8;
        }
        out.push(B64_ALPHABET[(n >> 18) as usize & 0x3f] as char);
        out.push(B64_ALPHABET[(n >> 12) as usize & 0x3f] as char);
        out.push(if rem.len() == 2 {
            B64_ALPHABET[(n >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push('=');
    }
    out
}

/// Decode base64. Lenient about leading/trailing ASCII whitespace; `None` on
/// any invalid character or stray content after the padding.
pub fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut nbits: u32 = 0;
    let mut seen_padding = false;
    for &b in bytes {
        if seen_padding {
            if b == b'=' || b.is_ascii_whitespace() {
                continue;
            }
            return None;
        }
        let v = match b {
            b'A'..=b'Z' => u32::from(b - b'A'),
            b'a'..=b'z' => u32::from(b - b'a') + 26,
            b'0'..=b'9' => u32::from(b - b'0') + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => {
                seen_padding = true;
                continue;
            }
            b' ' | b'\t' | b'\r' | b'\n' => continue,
            _ => return None,
        };
        acc = (acc << 6) | v;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push((acc >> nbits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64_roundtrip_various_lengths() {
        for len in 0..64 {
            let bytes: Vec<u8> = (0..len)
                .map(|i| (i as u8).wrapping_mul(37).wrapping_add(11))
                .collect();
            let enc = base64_encode(&bytes);
            assert_eq!(
                base64_decode(&enc).as_deref(),
                Some(bytes.as_slice()),
                "len {len}"
            );
        }
    }

    #[test]
    fn b64_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(
            base64_encode("caf\u{e9} \u{1f680}".as_bytes()),
            "Y2Fmw6kg8J+agA=="
        );
    }

    #[test]
    fn b64_decode_edge_cases() {
        assert_eq!(base64_decode(""), Some(vec![]));
        assert_eq!(base64_decode("SGVsbG8="), Some(b"Hello".to_vec()));
        // Unpadded input (no trailing '=') is accepted.
        assert_eq!(base64_decode("SGk"), Some(b"Hi".to_vec()));
        // Whitespace tolerated.
        assert_eq!(base64_decode("SGVs\nbG8=\r\n"), Some(b"Hello".to_vec()));
        // Invalid characters rejected.
        assert_eq!(base64_decode("SGVsbG8$"), None);
        assert_eq!(base64_decode("=SGVsbG8="), None);
        // Stray content after padding rejected.
        assert_eq!(base64_decode("SGVsbG8==AA"), None);
    }
}
