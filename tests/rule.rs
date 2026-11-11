//! Host tests for the reference rule.
//!
//! These check `score_bps` against an INDEPENDENT restatement of the published
//! rule (computed here in a different shape), not by re-calling the same code.
//! The actual `.wasm` artifact is exercised separately by `tests/wasm_runner.mjs`.

use telegraph_comparator::score_bps;

/// Independent implementation of the published rule, written from the docs
/// rather than from the library, so a shared mistake is unlikely.
fn expected(truth: i64, miner: i64, code: i32, tolerance: i64) -> i64 {
    if code != 1 && code != 2 {
        // 0 Exact, 3 PassFail, unknown: tolerance ignored.
        return if miner == truth { 10000 } else { 0 };
    }
    if tolerance <= 0 {
        return if miner == truth { 10000 } else { 0 };
    }
    let d: i128 = (miner as i128 - truth as i128).abs();
    let err: i128 = if code == 1 {
        d
    } else {
        let denom = if (truth as i128).abs() > 1 { (truth as i128).abs() } else { 1 };
        d * 10000 / denom
    };
    let win: i128 = 2 * tolerance as i128;
    if err >= win {
        0
    } else {
        ((10000i128 * (win - err)) / win) as i64
    }
}

fn check(truth: i64, miner: i64, code: i32, tol: i64) {
    let got = score_bps(truth, miner, code, tol);
    let want = expected(truth, miner, code, tol);
    assert_eq!(
        got, want,
        "truth={truth} miner={miner} code={code} tol={tol}: got {got}, want {want}"
    );
    assert!((0..=10000).contains(&got), "score out of range: {got}");
}

#[test]
fn exact_match_scores_full() {
    check(100, 100, 0, 0);
    check(4250, 4250, 0, 12345); // tolerance ignored for Exact
    check(-7, -7, 0, 9);
    check(1, 1, 0, 0);
}

#[test]
fn exact_mismatch_scores_zero() {
    check(100, 101, 0, 1000); // tolerance ignored
    check(100, 99, 0, 1000);
    check(-5, 5, 0, 5);
}

#[test]
fn passfail_same_as_exact() {
    for &(t, m, tol) in &[(10, 10, 0), (10, 11, 0), (10, 10, 99), (-3, -3, 4), (-3, -2, 4)] {
        assert_eq!(score_bps(t, m, 3, tol), score_bps(t, m, 0, tol), "code 3 vs 0");
    }
}

#[test]
fn unknown_code_is_exact() {
    for code in [4, 5, 42, 255, 1000, -1, i32::MIN, i32::MAX] {
        check(1000, 1000, code, 500, );
        check(1000, 1001, code, 500);
    }
}

#[test]
fn abstol_off_by_one() {
    // Inside the window: linear fall.
    check(1000, 1001, 1, 10);
    check(1000, 999, 1, 10);
    // Two units off with tolerance 2: error 2, window 4 -> 10000*(4-2)/4 = 5000.
    assert_eq!(score_bps(1000, 1002, 1, 2), 5000);
    assert_eq!(score_bps(1000, 998, 1, 2), 5000);
}

#[test]
fn abstol_window_edges() {
    // tolerance 5 -> window 10
    assert_eq!(score_bps(0, 0, 1, 5), 10000);
    assert_eq!(score_bps(0, 5, 1, 5), 5000); // error 5, 10000*(10-5)/10
    assert_eq!(score_bps(0, 9, 1, 5), 1000); // error 9
    assert_eq!(score_bps(0, 10, 1, 5), 0); // error == window
    assert_eq!(score_bps(0, 11, 1, 5), 0); // past the window
    assert_eq!(score_bps(0, -10, 1, 5), 0); // both sides
    assert_eq!(score_bps(0, -9, 1, 5), 1000);
}

#[test]
fn tolerance_zero_or_negative_is_exact_only() {
    for tol in [0, -1, -100, i64::MIN] {
        assert_eq!(score_bps(50, 50, 1, tol), 10000, "code1 tol={tol}");
        assert_eq!(score_bps(50, 51, 1, tol), 0, "code1 tol={tol}");
        assert_eq!(score_bps(50, 50, 2, tol), 10000, "code2 tol={tol}");
        assert_eq!(score_bps(50, 51, 2, tol), 0, "code2 tol={tol}");
    }
}

#[test]
fn reltol_large_values_no_overflow() {
    // 1e18 scale. diff 1000 -> error = 1000*10000/1e18 = 0 bps -> full score.
    let t = 1_000_000_000_000_000_000i64;
    assert_eq!(score_bps(t, t + 1000, 2, 10), 10000);
    assert_eq!(score_bps(t, t, 2, 10), 10000);

    // A 1% relative error is 100 bps. tolerance 200 -> window 400.
    // error 100 -> 10000*(400-100)/400 = 7500.
    let one_pct = t / 100;
    assert_eq!(score_bps(t, t + one_pct, 2, 200), 7500);
    assert_eq!(score_bps(t, t - one_pct, 2, 200), 7500);

    // error 400 bps at and past the window.
    let four_pct = t / 25;
    assert_eq!(score_bps(t, t + four_pct, 2, 200), 0);
    assert_eq!(score_bps(t, t + t / 10, 2, 200), 0);
    // i64::MAX-scale difference must not wrap.
    let got = score_bps(i64::MAX, i64::MIN, 2, i64::MAX);
    assert!((0..=10000).contains(&got), "overflowed to {got}");
}

#[test]
fn reltol_matches_abs_ratio_shape() {
    // error_bps = diff*10000/max(|truth|,1); with truth 200 -> tolerance 50 is 5000 bps.
    // diff 100 -> err = 5000 bps, window 10000 -> 10000*(10000-5000)/10000 = 5000.
    assert_eq!(score_bps(200, 300, 2, 5000), 5000);
    assert_eq!(score_bps(200, 100, 2, 5000), 5000);
}

#[test]
fn negative_truths() {
    check(-1000, -1000, 0, 0);
    check(-1000, -1001, 1, 10);
    check(-1000, -1001, 2, 10);
    check(-1_000_000_000_000_000_000, -1_000_000_000_000_000_000, 2, 10);
}

#[test]
fn small_truth_reltol_denominator_clamped_to_one() {
    // |truth| = 1 -> denom 1 -> error is diff*10000, so one unit is 10000 bps.
    assert_eq!(score_bps(1, 1, 2, 10), 10000);
    assert_eq!(score_bps(1, 2, 2, 10), 0); // err 10000 >= window 20
    assert_eq!(score_bps(0, 1, 2, 10), 0); // |truth|=0 -> denom 1 -> err 10000
    assert_eq!(score_bps(0, 0, 2, 10), 10000);
}

#[test]
fn determinism_same_inputs_same_output() {
    let cases: &[(i64, i64, i32, i64)] = &[
        (1000, 1000, 0, 0),
        (1000, 1001, 1, 10),
        (1000, 1005, 1, 10),
        (10i64.pow(18), 10i64.pow(18) + 10i64.pow(16), 2, 200),
        (0, 0, 3, 5),
        (42, 43, 77, 9),
    ];
    let first: Vec<i64> = cases.iter().map(|&(t, m, c, tol)| score_bps(t, m, c, tol)).collect();
    for _ in 0..8 {
        let again: Vec<i64> = cases.iter().map(|&(t, m, c, tol)| score_bps(t, m, c, tol)).collect();
        assert_eq!(first, again, "non-deterministic result");
    }
}
