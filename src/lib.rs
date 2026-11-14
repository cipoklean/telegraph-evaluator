//! Telegraph comparator module for a deterministic intent (registered on the
//! `DNS_RECORD_LOOKUP` family as comparator #340).
//!
//! Implements the published reference rule exactly. `no_std`, no WASI, no imports.
//!
//! Exports:
//!   imw_score_deterministic(truth: i64, miner: i64, spec_ptr: i32) -> i64
//!   imw_alloc(size: i32) -> i32
//!   imw_free(ptr: i32, size: i32)
//!
//! `spec_ptr` points to 16 bytes: two little-endian i64 (comparison code, then
//! tolerance). A score is basis points 0..=10000; negative means refuse.

// `no_std` is scoped to the real artifact: the wasm32 target. On the host (used by
// `cargo test`) the standard library is present and supplies the panic handler and
// the test harness, so forcing `no_std` there produces a duplicate-handler error.
#![cfg_attr(target_arch = "wasm32", no_std)]

use core::cell::UnsafeCell;

/// Size of the bump heap the node writes specs into. A comparator needs 16 bytes
/// per spec; 64 KiB is far above any real request and keeps the binary tiny.
const HEAP_SIZE: usize = 64 * 1024;

/// A trivial single-threaded bump allocator. WebAssembly runs this module in one
/// thread, so no locking is required and none is used.
struct Bump {
    buf: UnsafeCell<[u8; HEAP_SIZE]>,
    off: UnsafeCell<usize>,
}

// SAFETY: the module is single-threaded (no atomics, no shared instances), and
// every method below hands out non-overlapping regions of `buf`.
unsafe impl Sync for Bump {}

static BUMP: Bump = Bump {
    buf: UnsafeCell::new([0u8; HEAP_SIZE]),
    off: UnsafeCell::new(0),
};

/// Allocate `size` bytes with 8-byte alignment. Returns 0 when the request is
/// non-positive or cannot fit. Never frees automatically; `imw_free` rewinds the
/// bump pointer when the block being freed is the most recent one.
#[no_mangle]
pub extern "C" fn imw_alloc(size: i32) -> i32 {
    if size <= 0 {
        return 0;
    }
    let size = size as usize;
    let off_ptr = BUMP.off.get();

    // SAFETY: single-threaded; `off_ptr` is valid for the process lifetime.
    let cur = unsafe { *off_ptr };
    let aligned = (cur + 7) & !7usize;
    let Some(end) = aligned.checked_add(size) else {
        return 0;
    };
    if end > HEAP_SIZE {
        return 0;
    }
    unsafe { *off_ptr = end };

    // SAFETY: `aligned < end <= HEAP_SIZE`, so this points inside `buf`.
    let base = BUMP.buf.get() as usize;
    (base + aligned) as i32
}

/// Release a block. Only the most recent allocation can be reclaimed; anything
/// else is left to the bump pointer (correct, just not reclaimed).
#[no_mangle]
pub extern "C" fn imw_free(ptr: i32, size: i32) {
    if ptr <= 0 || size <= 0 {
        return;
    }
    let base = BUMP.buf.get() as usize;
    let start = (ptr as usize).wrapping_sub(base);
    let off_ptr = BUMP.off.get();
    // SAFETY: single-threaded; `off_ptr` is valid for the process lifetime.
    unsafe {
        let off = *off_ptr;
        if start.checked_add(size as usize) == Some(off) {
            *off_ptr = start;
        }
    }
}

/// Read one little-endian i64 from an unaligned address.
///
/// # Safety
/// `ptr` must be non-null and point to at least 8 readable bytes of module memory.
unsafe fn read_le_i64(ptr: usize) -> i64 {
    let p = ptr as *const i64;
    i64::from_le(core::ptr::read_unaligned(p))
}

/// The reference rule, separated from the FFI so host tests can call it directly.
///
/// * code `0` Exact and `3` PassFail, plus any unknown code: `10000` on an exact
///   match else `0`; tolerance is ignored.
/// * code `1` AbsTol: error is `|miner - truth|` in the same fixed-point scale.
/// * code `2` RelTol: error is `|miner - truth| * 10000 / max(|truth|, 1)` basis
///   points, truncated toward zero.
///
/// AbsTol and RelTol fall linearly: `10000 * (2*tol - error) / (2*tol)`, integer
/// division, `0` at `error >= 2*tol`. A tolerance of `0` or less means only an
/// exact match scores. All arithmetic is done in `i128`, which cannot overflow
/// for i64 inputs, so multiplication saturates in effect rather than wrapping.
pub fn score_bps(truth: i64, miner: i64, code: i32, tolerance: i64) -> i64 {
    let score = match code {
        1 => tolerance_score(i128::from(truth), i128::from(miner), i128::from(tolerance), false),
        2 => tolerance_score(i128::from(truth), i128::from(miner), i128::from(tolerance), true),
        // 0 Exact, 3 PassFail, and every unknown code.
        _ => return if miner == truth { 10_000 } else { 0 },
    };
    // Defensive clamp; the formula already yields a value in range.
    if score < 0 {
        0
    } else if score > 10_000 {
        10_000
    } else {
        score
    }
}

fn tolerance_score(truth: i128, miner: i128, tolerance: i128, relative: bool) -> i64 {
    let exact = truth == miner;

    // A tolerance of 0 or less means only an exact match scores.
    if tolerance <= 0 {
        return if exact { 10_000 } else { 0 };
    }

    let diff = (miner - truth).abs();

    // The error, expressed in the unit the tolerance is measured in.
    let error = if relative {
        let denom = if truth.abs() > 1 { truth.abs() } else { 1 };
        diff * 10_000 / denom
    } else {
        diff
    };

    let window = tolerance * 2; // 2 * tolerance, in the same unit
    if error >= window {
        return 0;
    }
    if error == 0 {
        return 10_000;
    }

    let num = 10_000 * (window - error);
    (num / window) as i64
}

/// FFI entry point. `spec_ptr` points to two LE i64: the comparison code and the
/// tolerance.
#[no_mangle]
pub extern "C" fn imw_score_deterministic(truth: i64, miner: i64, spec_ptr: i32) -> i64 {
    // A non-positive pointer cannot be a spec the node allocated. Fall back to
    // Exact with tolerance 0 rather than trapping, so the result stays defined.
    if spec_ptr <= 0 {
        return score_bps(truth, miner, 0, 0);
    }
    // SAFETY: the node obtained `spec_ptr` from `imw_alloc` and wrote 16 bytes.
    let (code, tolerance) = unsafe {
        let base = spec_ptr as usize;
        let raw_code = read_le_i64(base);
        let raw_tol = read_le_i64(base + 8);
        (raw_code as i32, raw_tol)
    };
    score_bps(truth, miner, code, tolerance)
}

// wasm32-only: this crate is `no_std`, and on a hosted test build std already
// supplies the panic handler, so defining one there would be a duplicate.
#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
